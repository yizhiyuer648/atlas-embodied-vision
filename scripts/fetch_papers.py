#!/usr/bin/env python3
"""抓取六大方向的近期 arXiv 论文,构建本地论文库 data/papers.json。

- 每个方向调用 arXiv API 抓取最新论文(默认每类 80 篇)
- 批量调用 Semantic Scholar 获取引用数
- 重新运行时按 arXiv id 合并,已有的 intro_zh(中文导读)会被保留
- 标记 pinned=true 的人工复核历史论文不会因“每类最新 80 篇”窗口而丢失
- 结束时打印缺少中文导读的论文数量

用法:
    python scripts/fetch_papers.py [--per-category 80]
依赖: requests(pip install -r requirements.txt)
"""
from __future__ import annotations

import argparse
import json
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "papers.json"
ATOM = {"a": "http://www.w3.org/2005/Atom"}
UA = {"User-Agent": "AtlasPaperLibrary/1.0 (local static encyclopedia)"}

QUERIES = {
    "vla": 'cat:cs.RO AND (all:"vision language action" OR all:"robot manipulation" OR all:"imitation learning")',
    "world": '(cat:cs.CV OR cat:cs.AI OR cat:cs.LG) AND (all:"world model" OR all:"video generation model")',
    "detection": 'cat:cs.CV AND all:"object detection"',
    "representation": 'cat:cs.CV AND (all:"self-supervised learning" OR all:"representation learning" OR all:"image retrieval")',
    "segmentation": 'cat:cs.CV AND (all:"semantic segmentation" OR all:"instance segmentation" OR all:"segment anything")',
    "multimodal": 'cat:cs.CV AND (all:"multimodal large language model" OR all:"vision language model")',
}


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def base_id(raw: str) -> str:
    m = re.search(r"arxiv\.org/(?:abs|pdf)/([^?#/]+?)(?:\.pdf)?$", raw, re.I)
    aid = m.group(1) if m else raw
    return re.sub(r"v\d+$", "", aid)


def fetch_category(session: requests.Session, category: str, query: str, count: int) -> list[dict]:
    papers: list[dict] = []
    step = 100
    for start in range(0, count, step):
        params = {
            "search_query": query,
            "sortBy": "submittedDate",
            "sortOrder": "descending",
            "start": str(start),
            "max_results": str(min(step, count - start)),
        }
        r = session.get("https://export.arxiv.org/api/query", params=params, timeout=40)
        r.raise_for_status()
        root = ET.fromstring(r.text)
        entries = root.findall("a:entry", ATOM)
        if not entries:
            break
        for entry in entries:
            link = clean(entry.findtext("a:id", "", ATOM))
            aid = base_id(link)
            title = clean(entry.findtext("a:title", "", ATOM))
            if not aid or not title:
                continue
            papers.append({
                "id": aid,
                "category": category,
                "title": title,
                "abstract": clean(entry.findtext("a:summary", "", ATOM)),
                "published": clean(entry.findtext("a:published", "", ATOM))[:10],
                "authors": [clean(a.findtext("a:name", "", ATOM)) for a in entry.findall("a:author", ATOM)],
                "url": f"https://arxiv.org/abs/{aid}",
            })
        time.sleep(3.1)
    return papers


def fetch_citations(session: requests.Session, ids: list[str]) -> dict[str, int]:
    cites: dict[str, int] = {}
    for i in range(0, len(ids), 400):
        chunk = ids[i:i + 400]
        try:
            r = session.post(
                "https://api.semanticscholar.org/graph/v1/paper/batch",
                params={"fields": "citationCount"},
                json={"ids": [f"ARXIV:{x}" for x in chunk]},
                timeout=40,
            )
            r.raise_for_status()
            for aid, item in zip(chunk, r.json()):
                if item and isinstance(item.get("citationCount"), int):
                    cites[aid] = item["citationCount"]
        except Exception as error:  # noqa: BLE001
            print(f"引用数批次 {i // 400 + 1} 失败: {error}")
        time.sleep(1.2)
    return cites


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-category", type=int, default=80)
    args = parser.parse_args()

    old_intros: dict[str, dict] = {}
    old_papers: dict[str, dict] = {}
    if OUT.exists():
        for paper in json.loads(OUT.read_text(encoding="utf-8")).get("papers", []):
            old_papers[paper["id"]] = paper
            if paper.get("intro_zh"):
                old_intros[paper["id"]] = {"intro_zh": paper["intro_zh"]}

    session = requests.Session()
    session.headers.update(UA)

    all_papers: dict[str, dict] = {}
    for category, query in QUERIES.items():
        try:
            batch = fetch_category(session, category, query, args.per_category)
            print(f"{category}: 抓到 {len(batch)} 篇")
        except Exception as error:  # noqa: BLE001
            print(f"{category}: 抓取失败 {error}")
            continue
        for paper in batch:
            all_papers.setdefault(paper["id"], paper)

    # 人工核实后固定收录的历史主线论文不一定仍位于每类最新 N 篇中。
    # 只保留显式 pinned 条目，避免把整个旧快照误当作永久权威数据。
    for aid, paper in old_papers.items():
        if paper.get("pinned"):
            all_papers.setdefault(aid, paper)

    ids = sorted(all_papers)
    cites = fetch_citations(session, ids)
    missing = 0
    for aid, paper in all_papers.items():
        paper["citations"] = cites.get(aid)
        if aid in old_intros:
            paper["intro_zh"] = old_intros[aid]["intro_zh"]
        else:
            missing += 1

    papers = sorted(all_papers.values(), key=lambda p: p["published"], reverse=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(papers),
        "papers": papers,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1)
        handle.write("\n")
    print(f"已写入 {OUT}: 共 {len(papers)} 篇,其中 {missing} 篇缺少中文导读(intro_zh)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
