#!/usr/bin/env python3
"""增量下载 Atlas 已收录论文的合法公开全文，并提取本地检索文本。

PDF 与纯文本只写入被 Git 忽略的 ``library/``。脚本不绕过登录、付费墙、
验证码或 robots 限制；无法直接取得 PDF 的记录会留在 manifest 中等待人工核验。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import time
from datetime import datetime, timezone
from itertools import chain
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


ROOT = Path(__file__).resolve().parents[1]
PAPERS_PATH = ROOT / "data" / "papers.json"
TRACKER_PATH = ROOT / "data" / "academic_tracker.json"
LIBRARY_ROOT = ROOT / "library"
PDF_ROOT = LIBRARY_ROOT / "pdfs"
TEXT_ROOT = LIBRARY_ROOT / "text"
MANIFEST_PATH = LIBRARY_ROOT / "manifest.json"
USER_AGENT = "AtlasResearchLibrary/1.0 (personal research archive; contact via repository)"


def session() -> requests.Session:
    client = requests.Session()
    retries = Retry(
        total=3,
        backoff_factor=1.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
        respect_retry_after_header=True,
    )
    client.mount("https://", HTTPAdapter(max_retries=retries))
    client.headers.update({"User-Agent": USER_AGENT, "Accept": "application/pdf,text/html;q=0.8"})
    return client


def safe_id(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", value).strip("-").lower()


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_manifest() -> dict[str, Any]:
    if not MANIFEST_PATH.exists():
        return {"schema_version": 1, "updated_at": None, "records": {}}
    data = load_json(MANIFEST_PATH)
    if not isinstance(data.get("records"), dict):
        raise ValueError("library/manifest.json records 必须是对象")
    return data


def save_manifest(manifest: dict[str, Any]) -> None:
    manifest["updated_at"] = datetime.now(timezone.utc).isoformat()
    LIBRARY_ROOT.mkdir(parents=True, exist_ok=True)
    temporary = MANIFEST_PATH.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(MANIFEST_PATH)


def iter_records() -> list[dict[str, Any]]:
    papers = load_json(PAPERS_PATH).get("papers", [])
    records = [
        {
            "paper_id": f"arxiv:{paper['id']}",
            "slug": safe_id(f"arxiv-{paper['id']}"),
            "title": paper.get("title", ""),
            "category": paper.get("category", "unknown"),
            "source_kind": "arxiv",
            "landing_url": paper.get("url", ""),
            "pdf_url": f"https://arxiv.org/pdf/{paper['id']}.pdf",
        }
        for paper in papers
    ]
    tracker = load_json(TRACKER_PATH)
    for event in tracker.get("publication_events", []):
        records.append(
            {
                "paper_id": event.get("paper_id") or event["id"],
                "slug": safe_id(event.get("paper_id") or event["id"]),
                "title": event.get("title", ""),
                "category": event.get("category", "unknown"),
                "source_kind": "formal_publication",
                "landing_url": event.get("source_url", ""),
                "pdf_url": None,
            }
        )
    unique: dict[str, dict[str, Any]] = {}
    for record in records:
        unique.setdefault(record["paper_id"], record)
    return list(unique.values())


def discover_pdf(client: requests.Session, record: dict[str, Any]) -> tuple[str | None, str | None]:
    if record.get("pdf_url"):
        return record["pdf_url"], None
    landing_url = record.get("landing_url") or ""
    if not landing_url:
        return None, "缺少公开来源页"
    try:
        response = client.get(landing_url, timeout=45)
        response.raise_for_status()
    except requests.RequestException as error:
        return None, f"来源页访问失败: {error}"
    content_type = response.headers.get("content-type", "").lower()
    if "application/pdf" in content_type or response.content.startswith(b"%PDF-"):
        return response.url, None
    candidates = re.findall(r'''href=["']([^"']+\.pdf(?:\?[^"']*)?)["']''', response.text, re.I)
    if not candidates:
        return None, "正式来源页未公开可直接下载的 PDF"
    ranked = sorted(candidates, key=lambda value: ("supp" in value.lower(), len(value)))
    return urljoin(response.url, ranked[0]), None


def download_pdf(client: requests.Session, url: str, target: Path) -> tuple[str, int, str]:
    temporary = target.with_suffix(".pdf.part")
    digest = hashlib.sha256()
    size = 0
    with client.get(url, timeout=(20, 120), stream=True) as response:
        response.raise_for_status()
        content_type = response.headers.get("content-type", "").lower()
        iterator = response.iter_content(chunk_size=1024 * 256)
        first = next(iterator, b"")
        if not first.startswith(b"%PDF-"):
            raise ValueError(f"响应不是 PDF（content-type={content_type or 'unknown'}）")
        target.parent.mkdir(parents=True, exist_ok=True)
        with temporary.open("wb") as handle:
            for chunk in chain((first,), iterator):
                if not chunk:
                    continue
                handle.write(chunk)
                digest.update(chunk)
                size += len(chunk)
    temporary.replace(target)
    return digest.hexdigest(), size, response.url


def extract_text(pdf_path: Path, text_path: Path) -> tuple[bool, str | None]:
    text_path.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["pdftotext", "-layout", "-enc", "UTF-8", str(pdf_path), str(text_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return False, (result.stderr or result.stdout or "pdftotext failed").strip()
    return True, None


def process(client: requests.Session, manifest: dict[str, Any], record: dict[str, Any]) -> str:
    slug = record["slug"]
    pdf_path = PDF_ROOT / f"{slug}.pdf"
    text_path = TEXT_ROOT / f"{slug}.txt"
    entry = manifest["records"].get(record["paper_id"], {})
    if pdf_path.exists() and text_path.exists() and entry.get("sha256"):
        return "cached"
    pdf_url, discovery_error = discover_pdf(client, record)
    entry.update({
        **record,
        "pdf_url": pdf_url,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    })
    if not pdf_url:
        entry.update({"status": "metadata_only", "error": discovery_error})
        manifest["records"][record["paper_id"]] = entry
        return "metadata_only"
    try:
        checksum, size, resolved_url = download_pdf(client, pdf_url, pdf_path)
        extracted, extract_error = extract_text(pdf_path, text_path)
        entry.update({
            "status": "downloaded" if extracted else "pdf_only",
            "resolved_pdf_url": resolved_url,
            "local_pdf": str(pdf_path.relative_to(ROOT)),
            "local_text": str(text_path.relative_to(ROOT)) if extracted else None,
            "sha256": checksum,
            "bytes": size,
            "error": extract_error,
        })
        outcome = entry["status"]
    except (requests.RequestException, OSError, ValueError) as error:
        entry.update({"status": "failed", "error": str(error)})
        outcome = "failed"
    manifest["records"][record["paper_id"]] = entry
    return outcome


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="本轮最多处理多少篇；0 表示全部")
    parser.add_argument("--category", default="", help="只处理一个 Atlas 类别")
    parser.add_argument("--paper-id", action="append", default=[], help="只处理指定 paper_id；可重复传入")
    parser.add_argument("--delay", type=float, default=1.0, help="论文之间的礼貌等待秒数")
    args = parser.parse_args()

    records = [record for record in iter_records() if not args.category or record["category"] == args.category]
    if args.paper_id:
        wanted = set(args.paper_id)
        records = [record for record in records if record["paper_id"] in wanted]
    if args.limit > 0:
        records = records[: args.limit]
    manifest = load_manifest()
    counts: dict[str, int] = {}
    client = session()
    for index, record in enumerate(records, start=1):
        outcome = process(client, manifest, record)
        counts[outcome] = counts.get(outcome, 0) + 1
        save_manifest(manifest)
        print(f"[{index}/{len(records)}] {outcome:13} {record['paper_id']} {record['title'][:80]}")
        if index < len(records) and outcome != "cached":
            time.sleep(max(0, args.delay))
    print(json.dumps({"processed": len(records), "outcomes": counts}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
