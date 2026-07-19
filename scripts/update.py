#!/usr/bin/env python3
"""为 Atlas 拉取近期待人工审核的模型/论文候选。

默认发现源：
- 论文：arXiv、OpenAlex、Semantic Scholar、Hugging Face Papers
- 项目：GitHub、Hugging Face 公开模型卡

重要：本脚本只写入 data/candidates.json，绝不修改 data/models.json、
data/index.json 或 data/details/。机构、类别和来源冲突只作为审核线索保留，
不能未经人工核验直接并入图鉴。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests


ROOT = Path(__file__).resolve().parents[1]
MODELS_PATH = ROOT / "data" / "index.json"
OUTPUT_PATH = ROOT / "data" / "candidates.json"
ARXIV_API = "https://export.arxiv.org/api/query"
OPENALEX_API = "https://api.openalex.org/works"
SEMANTIC_SCHOLAR_API = "https://api.semanticscholar.org/graph/v1/paper/search"
HF_PAPERS_API = "https://huggingface.co/api/daily_papers"
GITHUB_API = "https://api.github.com/search/repositories"
HF_MODELS_API = "https://huggingface.co/api/models"
ATOM = {"a": "http://www.w3.org/2005/Atom"}

TOPICS = {
    "vla": {
        "paper": '"vision language action" robotics',
        "arxiv": 'cat:cs.RO AND all:"vision language action"',
        "github": '"vision language action" robot',
        "hf_models": "vision language action",
    },
    "world": {
        "paper": '"world model" video generation',
        "arxiv": 'cat:cs.AI AND (all:"world model" OR all:"video generation")',
        "github": '"world model" generative video',
        "hf_models": "world model",
    },
    "detection": {
        "paper": '"object detection" computer vision',
        "arxiv": 'cat:cs.CV AND all:"object detection"',
        "github": '"object detection"',
        "hf_models": "object detection",
    },
    "multimodal": {
        "paper": '"vision language model" multimodal',
        "arxiv": 'cat:cs.CV AND (all:"multimodal" OR all:"vision language model")',
        "github": '"vision language model" multimodal',
        "hf_models": "vision language model",
    },
    "representation": {
        "paper": '"visual representation" self supervised vision',
        "arxiv": 'cat:cs.CV AND (all:"vision encoder" OR all:"visual representation")',
        "github": '"vision encoder"',
        "hf_models": "vision encoder",
    },
    "segmentation": {
        "paper": '"image segmentation" computer vision',
        "arxiv": 'cat:cs.CV AND all:"image segmentation"',
        "github": '"image segmentation"',
        "hf_models": "image segmentation",
    },
}

TOPIC_PATTERNS = {
    "vla": re.compile(
        r"vision[\s-]+language[\s-]+action|\bvla\b|robot(?:ic)? manipulation|robot policy|embodied agent",
        re.I,
    ),
    "world": re.compile(
        r"world model|video generation|video diffusion|physical consistency|environment simulator",
        re.I,
    ),
    "detection": re.compile(r"object detection|object detector|\byolo\b|\bdetr\b|grounded detection", re.I),
    "representation": re.compile(
        r"visual representation|representation learning|self[\s-]+supervised|image retrieval|vision encoder|contrastive vision",
        re.I,
    ),
    "segmentation": re.compile(
        r"image segmentation|semantic segmentation|instance segmentation|segment anything|\bsam\b",
        re.I,
    ),
    "multimodal": re.compile(
        r"vision[\s-]+language model|large vision[\s-]+language|multimodal.{0,30}language|\bmllm\b|\bvlm\b",
        re.I,
    ),
}


def normalize(text: str) -> str:
    """保留 Unicode 字母数字，兼容中文/英文标题的保守去重。"""
    return re.sub(r"[\W_]+", "", text.casefold(), flags=re.UNICODE)


def clean(text: Any) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def contains_model_name(title: str, model_name: str) -> bool:
    """按完整词组匹配模型名，避免 ACT 误命中 action 等普通单词。"""
    parts = re.findall(r"[^\W_]+", model_name, flags=re.UNICODE)
    if not parts:
        return False
    pattern = r"(?<!\w)" + r"[\W_]*".join(re.escape(part) for part in parts) + r"(?!\w)"
    return re.search(pattern, title, flags=re.IGNORECASE | re.UNICODE) is not None


def canonical_reference(url: str) -> str:
    """归一化 arXiv / DOI / GitHub 链接，以便识别同论文版本或同一仓库。"""
    value = url.strip()
    if not value or value.lower() == "unknown":
        return ""
    parsed = urlparse(value if "://" in value else f"https://{value}")
    host = parsed.netloc.lower().removeprefix("www.")
    path = parsed.path.rstrip("/")
    if host in {"arxiv.org", "export.arxiv.org"}:
        identifier = re.sub(r"^/(?:abs|pdf)/", "", path, flags=re.IGNORECASE)
        identifier = re.sub(r"\.pdf$", "", identifier, flags=re.IGNORECASE)
        identifier = re.sub(r"v\d+$", "", identifier, flags=re.IGNORECASE)
        return f"arxiv:{identifier.lower()}" if identifier else ""
    if host in {"doi.org", "dx.doi.org"}:
        return f"doi:{path.lstrip('/').lower()}" if path else ""
    if host == "github.com":
        parts = [part for part in path.split("/") if part]
        if len(parts) >= 2:
            repo = parts[1].removesuffix(".git")
            return f"github:{parts[0].lower()}/{repo.lower()}"
    return f"{host}{path}" if host else ""


def arxiv_id(value: Any) -> str:
    match = re.search(
        r"(?:arxiv\.org/(?:abs|pdf)/|^)(\d{4}\.\d{4,5}|[a-z.-]+/\d{7})(?:v\d+)?(?:\.pdf)?$",
        clean(value),
        re.I,
    )
    return match.group(1) if match else ""


def doi_id(value: Any) -> str:
    match = re.search(r"(?:doi\.org/|doi:)?(10\.\d{4,9}/\S+)", clean(value), re.I)
    return match.group(1).rstrip(".,;)").lower() if match else ""


def parse_api_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def matches_topic(category: str, title: str, abstract: str = "") -> bool:
    pattern = TOPIC_PATTERNS.get(category)
    return bool(pattern and pattern.search(f"{title} {abstract}"))


def classify_topics(title: str, abstract: str = "") -> list[str]:
    text_value = f"{title} {abstract}"
    return [category for category, pattern in TOPIC_PATTERNS.items() if pattern.search(text_value)]


def load_models() -> list[dict[str, Any]]:
    if not MODELS_PATH.exists():
        raise FileNotFoundError(f"找不到主数据：{MODELS_PATH}")
    with MODELS_PATH.open("r", encoding="utf-8") as handle:
        models = json.load(handle)
    if not isinstance(models, list):
        raise ValueError("data/index.json 顶层必须是数组")
    return models


def looks_duplicate(
    title: str,
    models: list[dict[str, Any]],
    links: dict[str, Any] | None = None,
) -> tuple[bool, str]:
    candidate = normalize(title)
    if not candidate:
        return True, "空标题"
    candidate_references = {
        reference
        for reference in (canonical_reference(str(url)) for url in (links or {}).values())
        if reference
    }
    for model in models:
        model_references = {
            reference
            for reference in (
                canonical_reference(str(model.get("paper_url", ""))),
                canonical_reference(str(model.get("github_url", ""))),
            )
            if reference
        }
        shared_references = candidate_references & model_references
        if shared_references:
            return True, f"与已有模型 {model.get('name')} 使用同一链接"
        name = normalize(str(model.get("name", "")))
        if not name:
            continue
        model_name = str(model.get("name", ""))
        if candidate == name or contains_model_name(title, model_name):
            return True, f"与已有名称 {model.get('name')} 高度重合"
        ratio = SequenceMatcher(None, candidate, name).ratio()
        if ratio >= 0.88:
            return True, f"与已有名称 {model.get('name')} 相似度 {ratio:.2f}"
    return False, "未命中已有模型名"


def atom_text(node: ET.Element, path: str) -> str:
    child = node.find(path, ATOM)
    return clean(child.text) if child is not None else ""


def fetch_arxiv(
    session: requests.Session,
    category: str,
    query: str,
    start: datetime,
    end: datetime,
) -> list[dict[str, Any]]:
    date_filter = f"submittedDate:[{start:%Y%m%d%H%M} TO {end:%Y%m%d%H%M}]"
    params = {
        "search_query": f"({query}) AND {date_filter}",
        "sortBy": "submittedDate",
        "sortOrder": "descending",
        "max_results": 50,
    }
    response = session.get(ARXIV_API, params=params, timeout=35)
    response.raise_for_status()
    root = ET.fromstring(response.text)
    candidates: list[dict[str, Any]] = []
    for entry in root.findall("a:entry", ATOM):
        title = atom_text(entry, "a:title")
        link = atom_text(entry, "a:id")
        authors = [atom_text(author, "a:name") for author in entry.findall("a:author", ATOM)]
        identifier = arxiv_id(link)
        candidates.append(
            {
                "title": title,
                "org_guess": "unknown",
                "links": {"paper": link, "github": "unknown"},
                "external_ids": {"arxiv": identifier},
                "matched_category": category,
                "published_at": atom_text(entry, "a:published"),
                "source": "arXiv",
                "source_id": identifier or link,
                "authors": [author for author in authors if author],
                "abstract": atom_text(entry, "a:summary"),
                "confidence": "medium",
                "confidence_reason": f"命中预置 {category} arXiv 查询；Atom 不提供机构，需人工核验",
                "manual_review_required": True,
            }
        )
    return candidates


def reconstruct_abstract(index: Any) -> str:
    if not isinstance(index, dict):
        return ""
    words: dict[int, str] = {}
    for word, positions in index.items():
        for position in positions or []:
            try:
                words[int(position)] = str(word)
            except (TypeError, ValueError):
                continue
    return " ".join(words[position] for position in sorted(words))


def fetch_openalex(
    session: requests.Session,
    category: str,
    query: str,
    start: datetime,
    end: datetime,
    mailto: str | None,
) -> list[dict[str, Any]]:
    params = {
        "search": query,
        "filter": (
            f"from_publication_date:{start:%Y-%m-%d},"
            f"to_publication_date:{end:%Y-%m-%d},is_retracted:false"
        ),
        "per-page": 50,
        "select": (
            "id,doi,title,display_name,publication_date,ids,primary_location,best_oa_location,"
            "authorships,abstract_inverted_index,cited_by_count,is_retracted,relevance_score"
        ),
    }
    if mailto:
        params["mailto"] = mailto
    response = session.get(OPENALEX_API, params=params, timeout=35)
    response.raise_for_status()
    candidates: list[dict[str, Any]] = []
    for work in response.json().get("results", []):
        title = clean(work.get("title") or work.get("display_name"))
        abstract = reconstruct_abstract(work.get("abstract_inverted_index"))
        if not title or work.get("is_retracted") or not matches_topic(category, title, abstract):
            continue
        ids = work.get("ids") or {}
        identifier = arxiv_id(ids.get("arxiv"))
        doi = doi_id(work.get("doi") or ids.get("doi"))
        best_location = work.get("best_oa_location") or {}
        primary_location = work.get("primary_location") or {}
        paper_link = (
            f"https://arxiv.org/abs/{identifier}"
            if identifier
            else f"https://doi.org/{doi}"
            if doi
            else best_location.get("landing_page_url")
            or primary_location.get("landing_page_url")
            or work.get("id")
            or "unknown"
        )
        authors = []
        institutions = []
        for authorship in work.get("authorships") or []:
            author_name = clean((authorship.get("author") or {}).get("display_name"))
            if author_name:
                authors.append(author_name)
            for institution in authorship.get("institutions") or []:
                institution_name = clean(institution.get("display_name"))
                if institution_name and institution_name not in institutions:
                    institutions.append(institution_name)
        org_guess = (
            " / ".join(institutions[:2]) + "（OpenAlex 元数据，需核验）"
            if institutions
            else "unknown"
        )
        candidates.append(
            {
                "title": title,
                "org_guess": org_guess,
                "links": {
                    "paper": paper_link,
                    "github": "unknown",
                    "openalex": work.get("id") or "unknown",
                },
                "external_ids": {
                    "arxiv": identifier,
                    "doi": doi,
                    "openalex": clean(work.get("id")).rsplit("/", 1)[-1],
                },
                "matched_category": category,
                "published_at": clean(work.get("publication_date")) or "unknown",
                "source": "OpenAlex",
                "source_id": work.get("id") or "unknown",
                "authors": authors,
                "abstract": abstract,
                "reported_institutions": institutions,
                "citations": work.get("cited_by_count")
                if isinstance(work.get("cited_by_count"), int)
                else "unknown",
                "confidence": "medium",
                "confidence_reason": (
                    f"OpenAlex 近期作品检索命中 {category} 关键词；机构与日期按来源原样保留，需人工核验"
                ),
                "manual_review_required": True,
            }
        )
    return candidates


def fetch_semantic_scholar(
    session: requests.Session,
    category: str,
    query: str,
    start: datetime,
    end: datetime,
) -> list[dict[str, Any]]:
    params = {
        "query": query,
        "limit": 50,
        "year": f"{start.year}-{end.year}",
        "fields": "title,abstract,authors,publicationDate,url,externalIds,citationCount,openAccessPdf",
    }
    response = session.get(SEMANTIC_SCHOLAR_API, params=params, timeout=35)
    response.raise_for_status()
    candidates: list[dict[str, Any]] = []
    for paper in response.json().get("data", []):
        title = clean(paper.get("title"))
        abstract = clean(paper.get("abstract"))
        published = parse_api_datetime(paper.get("publicationDate"))
        if (
            not title
            or published is None
            or published < start
            or published > end
            or not matches_topic(category, title, abstract)
        ):
            continue
        external = paper.get("externalIds") or {}
        identifier = arxiv_id(external.get("ArXiv"))
        doi = doi_id(external.get("DOI"))
        source_link = paper.get("url") or "unknown"
        paper_link = (
            f"https://arxiv.org/abs/{identifier}"
            if identifier
            else f"https://doi.org/{doi}"
            if doi
            else (paper.get("openAccessPdf") or {}).get("url") or source_link
        )
        candidates.append(
            {
                "title": title,
                "org_guess": "unknown",
                "links": {"paper": paper_link, "github": "unknown", "semantic_scholar": source_link},
                "external_ids": {
                    "arxiv": identifier,
                    "doi": doi,
                    "semantic_scholar": clean(paper.get("paperId")),
                },
                "matched_category": category,
                "published_at": published.isoformat(),
                "source": "Semantic Scholar",
                "source_id": paper.get("paperId") or "unknown",
                "authors": [clean(author.get("name")) for author in paper.get("authors") or [] if clean(author.get("name"))],
                "abstract": abstract,
                "citations": paper.get("citationCount")
                if isinstance(paper.get("citationCount"), int)
                else "unknown",
                "confidence": "medium",
                "confidence_reason": (
                    f"Semantic Scholar 搜索命中 {category} 且发布日期落在扫描窗口；接口不提供机构，需人工核验"
                ),
                "manual_review_required": True,
            }
        )
    return candidates


def fetch_hf_papers(
    session: requests.Session,
    categories: set[str],
    start: datetime,
    end: datetime,
) -> list[dict[str, Any]]:
    response = session.get(HF_PAPERS_API, params={"limit": 100}, timeout=35)
    response.raise_for_status()
    candidates: list[dict[str, Any]] = []
    for item in response.json():
        paper = item.get("paper") or item
        title = clean(paper.get("title") or item.get("title"))
        abstract = clean(paper.get("summary") or item.get("summary"))
        published = parse_api_datetime(paper.get("publishedAt") or item.get("publishedAt"))
        if not title or published is None or published < start or published > end:
            continue
        matched = [category for category in classify_topics(title, abstract) if category in categories]
        if not matched:
            continue
        category = matched[0]
        identifier = arxiv_id(paper.get("id"))
        source_link = f"https://huggingface.co/papers/{identifier}" if identifier else "unknown"
        paper_link = f"https://arxiv.org/abs/{identifier}" if identifier else paper.get("projectPage") or source_link
        organization = paper.get("organization") or item.get("organization") or {}
        organization_name = clean(organization.get("fullname") or organization.get("name"))
        org_guess = (
            f"{organization_name}（Hugging Face Papers 页面标注，需核验）"
            if organization_name
            else "unknown"
        )
        authors = [
            clean(author.get("name") or (author.get("user") or {}).get("fullname"))
            for author in paper.get("authors") or []
        ]
        candidates.append(
            {
                "title": title,
                "org_guess": org_guess,
                "links": {
                    "paper": paper_link,
                    "github": paper.get("githubRepo") or "unknown",
                    "huggingface_paper": source_link,
                    "project": paper.get("projectPage") or "unknown",
                },
                "external_ids": {"arxiv": identifier},
                "matched_category": category,
                "category_matches": matched,
                "published_at": published.isoformat(),
                "source": "Hugging Face Papers",
                "source_id": identifier or source_link,
                "authors": [author for author in authors if author],
                "abstract": abstract,
                "reported_organization": organization_name or "unknown",
                "upvotes": paper.get("upvotes") if isinstance(paper.get("upvotes"), int) else "unknown",
                "github_stars": paper.get("githubStars")
                if isinstance(paper.get("githubStars"), int)
                else "unknown",
                "confidence": "medium",
                "confidence_reason": (
                    "Hugging Face Papers 近期公开条目命中领域关键词；收录、票数和组织标签不代表论文质量或官方归属"
                ),
                "manual_review_required": True,
            }
        )
    return candidates


def fetch_github(
    session: requests.Session,
    category: str,
    query: str,
    start: datetime,
    min_stars: int,
) -> list[dict[str, Any]]:
    params = {
        "q": f"{query} created:>={start:%Y-%m-%d} stars:>={min_stars}",
        "sort": "stars",
        "order": "desc",
        "per_page": 30,
    }
    response = session.get(GITHUB_API, params=params, timeout=35)
    response.raise_for_status()
    candidates: list[dict[str, Any]] = []
    for repo in response.json().get("items", []):
        owner = repo.get("owner") or {}
        is_org = owner.get("type") == "Organization"
        description = repo.get("description") or ""
        stars = int(repo.get("stargazers_count") or 0)
        candidates.append(
            {
                "title": repo.get("name") or repo.get("full_name") or "unknown",
                "org_guess": f"{owner.get('login')}（GitHub 组织，需核验）" if is_org else "unknown",
                "links": {"paper": "unknown", "github": repo.get("html_url") or "unknown"},
                "matched_category": category,
                "published_at": repo.get("created_at") or "unknown",
                "source": "GitHub",
                "source_id": repo.get("full_name") or "unknown",
                "stars": stars,
                "description": description,
                "confidence": "high" if stars >= max(min_stars * 4, 500) else "medium",
                "confidence_reason": f"新建仓库命中 {category} 关键词且有 {stars} stars；项目性质和机构仍需人工核验",
                "manual_review_required": True,
            }
        )
    return candidates


def fetch_hf_models(
    session: requests.Session,
    category: str,
    query: str,
    start: datetime,
    min_likes: int,
    min_downloads: int,
) -> list[dict[str, Any]]:
    """抓取近期公开模型卡；账号、论文对应关系与机构一律留待人工核验。"""
    params = {"search": query, "sort": "createdAt", "direction": -1, "limit": 50, "full": "true"}
    response = session.get(HF_MODELS_API, params=params, timeout=35)
    response.raise_for_status()
    candidates: list[dict[str, Any]] = []
    for model in response.json():
        created_at = parse_api_datetime(model.get("createdAt"))
        if created_at is None or created_at < start or model.get("private"):
            continue
        model_id = model.get("modelId") or model.get("id")
        if not model_id:
            continue
        author = model.get("author") or str(model_id).split("/", 1)[0]
        tags = [str(tag) for tag in model.get("tags") or []]
        arxiv_ids = [tag.split(":", 1)[1] for tag in tags if tag.startswith("arxiv:")]
        paper_url = f"https://arxiv.org/abs/{arxiv_ids[0]}" if arxiv_ids else "unknown"
        likes = int(model.get("likes") or 0)
        downloads = int(model.get("downloads") or 0)
        if not arxiv_ids and likes < min_likes and downloads < min_downloads:
            continue
        candidates.append(
            {
                "title": str(model_id),
                "org_guess": f"{author}（Hugging Face 账号，机构需核验）",
                "links": {
                    "paper": paper_url,
                    "github": "unknown",
                    "huggingface": f"https://huggingface.co/{model_id}",
                },
                "external_ids": {"arxiv": arxiv_ids[0] if arxiv_ids else ""},
                "matched_category": category,
                "published_at": created_at.isoformat(),
                "source": "Hugging Face Models",
                "source_id": str(model_id),
                "likes": likes,
                "downloads": downloads,
                "pipeline_tag": model.get("pipeline_tag") or "unknown",
                "model_tags": tags[:30],
                "confidence": "high" if likes >= 100 or downloads >= 10_000 else "medium",
                "confidence_reason": (
                    f"近期公开模型卡命中 {category}，{downloads} downloads / {likes} likes；"
                    "账号归属、论文对应关系与模型成熟度仍需核验"
                ),
                "manual_review_required": True,
            }
        )
    return candidates


def source_record(candidate: dict[str, Any]) -> dict[str, Any]:
    record = {
        "source": candidate.get("source", "unknown"),
        "source_id": candidate.get("source_id", "unknown"),
        "title": candidate.get("title", "unknown"),
        "published_at": candidate.get("published_at", "unknown"),
        "authors": candidate.get("authors", []),
        "org_guess": candidate.get("org_guess", "unknown"),
        "matched_category": candidate.get("matched_category", "unknown"),
        "links": candidate.get("links", {}),
        "external_ids": candidate.get("external_ids", {}),
    }
    for field in ("citations", "stars", "likes", "downloads", "upvotes", "github_stars"):
        if field in candidate:
            record[field] = candidate[field]
    return record


def initialize_candidate(candidate: dict[str, Any], reason: str) -> None:
    source_name = str(candidate.get("source", "unknown"))
    candidate["sources"] = [source_name]
    candidate["source_records"] = [source_record(candidate)]
    candidate["metadata_conflicts"] = []
    candidate["dedupe_note"] = reason


def comparable(value: Any) -> str:
    if isinstance(value, list):
        return "|".join(
            re.sub(r"[\W_]+", "", clean(item).lower(), flags=re.UNICODE)
            for item in value
            if clean(item)
        )
    return re.sub(r"[\W_]+", "", clean(value).lower(), flags=re.UNICODE)


def comparable_field(field: str, value: Any) -> str:
    if field == "published_at":
        match = re.match(r"\d{4}-\d{2}-\d{2}", clean(value))
        return match.group(0).replace("-", "") if match else comparable(value)
    return comparable(value)


def add_conflict(
    target: dict[str, Any],
    field: str,
    old_source: str,
    old_value: Any,
    new_source: str,
    new_value: Any,
    note: str,
) -> None:
    signature = (field, comparable_field(field, old_value), comparable_field(field, new_value))
    if not all(signature):
        return
    for conflict in target.setdefault("metadata_conflicts", []):
        existing = (
            conflict.get("field"),
            comparable_field(field, (conflict.get("records") or [{}, {}])[0].get("value")),
            comparable_field(field, (conflict.get("records") or [{}, {}])[-1].get("value")),
        )
        if existing == signature or existing == (signature[0], signature[2], signature[1]):
            return
    target["metadata_conflicts"].append(
        {
            "field": field,
            "records": [
                {"source": old_source, "value": old_value},
                {"source": new_source, "value": new_value},
            ],
            "note_zh": note,
        }
    )


def merge_candidate(target: dict[str, Any], incoming: dict[str, Any]) -> None:
    old_source = str((target.get("sources") or [target.get("source", "unknown")])[0])
    new_source = str(incoming.get("source", "unknown"))
    for field, note in (
        ("title", "来源标题不同，未自动选择所谓正确版本"),
        ("published_at", "来源发布日期不同，保留全部记录"),
        ("matched_category", "来源/规则给出的类别不同，需人工判断"),
        ("org_guess", "来源给出的机构线索不同，不能自动认定归属"),
    ):
        old_value = target.get(field)
        new_value = incoming.get(field)
        if (
            clean(old_value).lower() not in {"", "unknown"}
            and clean(new_value).lower() not in {"", "unknown"}
            and comparable_field(field, old_value) != comparable_field(field, new_value)
        ):
            add_conflict(target, field, old_source, old_value, new_source, new_value, note)

    old_external = target.get("external_ids") or {}
    new_external = incoming.get("external_ids") or {}
    for key in set(old_external) & set(new_external):
        old_value, new_value = old_external.get(key), new_external.get(key)
        if clean(old_value) and clean(new_value) and comparable(old_value) != comparable(new_value):
            add_conflict(
                target,
                f"external_ids.{key}",
                old_source,
                old_value,
                new_source,
                new_value,
                "来源标识不一致，必须回到原始页面核验",
            )

    sources = target.setdefault("sources", [old_source])
    if new_source not in sources:
        sources.append(new_source)
    target["source"] = " + ".join(sources)
    target.setdefault("source_records", []).append(source_record(incoming))

    for label, url in (incoming.get("links") or {}).items():
        if not url or str(url).lower() == "unknown":
            continue
        current = (target.get("links") or {}).get(label, "unknown")
        if not current or str(current).lower() == "unknown":
            target.setdefault("links", {})[label] = url
        elif canonical_reference(str(current)) != canonical_reference(str(url)):
            target.setdefault("alternate_links", {}).setdefault(new_source, {})[label] = url

    for key, value in new_external.items():
        if value and not target.setdefault("external_ids", {}).get(key):
            target["external_ids"][key] = value
    for field in (
        "abstract",
        "authors",
        "citations",
        "stars",
        "likes",
        "downloads",
        "upvotes",
        "github_stars",
        "pipeline_tag",
        "model_tags",
    ):
        current = target.get(field)
        incoming_value = incoming.get(field)
        if (current in (None, "", "unknown", []) or current is False) and incoming_value not in (None, "", "unknown", []):
            target[field] = incoming_value


def candidate_identity_keys(candidate: dict[str, Any]) -> set[str]:
    keys = {
        reference
        for reference in (
            canonical_reference(str(url)) for url in (candidate.get("links") or {}).values()
        )
        if reference
    }
    external = candidate.get("external_ids") or {}
    if external.get("arxiv"):
        keys.add(f"arxiv:{arxiv_id(external['arxiv']).lower()}")
    if external.get("doi"):
        keys.add(f"doi:{doi_id(external['doi']).lower()}")
    return {key for key in keys if not key.endswith(":")}


def merge_candidates(raw: list[dict[str, Any]], models: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """按标题和稳定标识归并候选，并处理跨来源的桥接关系。

    同一条后到记录可能同时带有论文标识和仓库 URL，从而把此前分开的
    arXiv 记录与 GitHub 记录连接起来。这里先合并候选组，最后再逐条调用
    ``merge_candidate``，避免只选择第一个 owner 而留下重复候选，同时完整
    保留每个来源的 ``source_records`` 与元数据冲突。
    """
    groups: list[dict[str, Any]] = []
    reference_owner: dict[str, dict[str, Any]] = {}
    title_owner: dict[str, dict[str, Any]] = {}
    for candidate in raw:
        title = str(candidate.get("title", ""))
        title_key = normalize(title)
        duplicate, reason = looks_duplicate(title, models, candidate.get("links"))
        if duplicate or not title_key:
            continue
        references = candidate_identity_keys(candidate)
        owners: list[dict[str, Any]] = []
        for reference in references:
            owner = reference_owner.get(reference)
            if owner is not None and all(owner is not existing for existing in owners):
                owners.append(owner)
        title_match = title_owner.get(title_key)
        if title_match is not None and all(title_match is not existing for existing in owners):
            owners.append(title_match)
        if len(owners) > 1:
            # ``references`` 是 set，遍历顺序会随 Python 进程的哈希种子变化。
            # 桥接多个已有分组时固定选择原始抓取中最早建立的分组，确保
            # sources / source_records 的顺序稳定，候选文件可重复生成。
            owners.sort(
                key=lambda owner: next(
                    index for index, known_group in enumerate(groups) if known_group is owner
                )
            )
        group = owners[0] if owners else None
        if group is None:
            group = {
                "candidates": [candidate],
                "references": set(references),
                "titles": {title_key},
                "dedupe_note": reason,
            }
            groups.append(group)
        else:
            # A record can bridge multiple previously separate groups, for example
            # a HF Papers item carrying both an arXiv id and a GitHub repository.
            for other in owners[1:]:
                if other is group:
                    continue
                group["candidates"].extend(other["candidates"])
                group["references"].update(other["references"])
                group["titles"].update(other["titles"])
                for reference in other["references"]:
                    reference_owner[reference] = group
                for known_title in other["titles"]:
                    title_owner[known_title] = group
                groups.remove(other)
            group["candidates"].append(candidate)
            group["references"].update(references)
            group["titles"].add(title_key)

        title_owner[title_key] = group
        for reference in references:
            reference_owner[reference] = group

    kept: list[dict[str, Any]] = []
    for group in groups:
        grouped_candidates = group["candidates"]
        merged = grouped_candidates[0]
        initialize_candidate(merged, group["dedupe_note"])
        for incoming in grouped_candidates[1:]:
            merge_candidate(merged, incoming)
        kept.append(merged)
    return sorted(kept, key=lambda item: str(item.get("published_at", "")), reverse=True)


def new_session(user_agent: str) -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": user_agent})
    return session


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成 Atlas 待人工审核的多来源近期候选")
    parser.add_argument("--days", type=int, default=30, help="回溯天数，默认 30")
    parser.add_argument("--categories", nargs="+", choices=sorted(TOPICS), default=list(TOPICS), help="只扫描指定类别")
    parser.add_argument("--min-stars", type=int, default=50, help="GitHub 最低 stars，默认 50")
    parser.add_argument("--arxiv-only", action="store_true", help="只查 arXiv，跳过全部其他来源")
    parser.add_argument("--no-openalex", action="store_true", help="跳过 OpenAlex")
    parser.add_argument("--no-semantic-scholar", action="store_true", help="跳过 Semantic Scholar")
    parser.add_argument("--no-hf-papers", action="store_true", help="跳过 Hugging Face Papers")
    parser.add_argument("--no-github", action="store_true", help="跳过 GitHub 仓库搜索")
    parser.add_argument("--no-huggingface", action="store_true", help="跳过 Hugging Face 模型卡搜索")
    parser.add_argument("--min-hf-likes", type=int, default=10, help="无 arXiv 标签时 HF 模型最低 likes")
    parser.add_argument("--min-hf-downloads", type=int, default=1000, help="无 arXiv 标签时 HF 模型最低 downloads")
    parser.add_argument("--dry-run", action="store_true", help="执行抓取和合并校验，但不写 candidates.json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.days < 1 or args.days > 365:
        print("--days 必须在 1 到 365 之间", file=sys.stderr)
        return 2
    if args.min_stars < 0 or args.min_hf_likes < 0 or args.min_hf_downloads < 0:
        print("stars / likes / downloads 阈值不能为负数", file=sys.stderr)
        return 2

    models = load_models()
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=args.days)
    categories = list(dict.fromkeys(args.categories))
    category_set = set(categories)

    arxiv_session = new_session("AtlasModelRadar/1.1 (manual-review candidate collector)")
    openalex_session = new_session("AtlasModelRadar/1.1 (manual-review candidate collector; OpenAlex)")
    semantic_session = new_session("AtlasModelRadar/1.1 (manual-review candidate collector; Semantic Scholar)")
    s2_key = os.getenv("S2_API_KEY")
    if s2_key:
        semantic_session.headers.update({"x-api-key": s2_key})
    hf_papers_session = new_session("AtlasModelRadar/1.1 (manual-review candidate collector; HF Papers)")

    github_session = new_session("AtlasModelRadar/1.1 (manual-review candidate collector; GitHub)")
    github_session.headers.update(
        {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    )
    github_token = os.getenv("GITHUB_TOKEN")
    if github_token:
        github_session.headers.update({"Authorization": f"Bearer {github_token}"})

    hf_models_session = new_session("AtlasModelRadar/1.1 (manual-review candidate collector; HF Models)")
    hf_token = os.getenv("HF_TOKEN")
    if hf_token:
        hf_models_session.headers.update({"Authorization": f"Bearer {hf_token}"})

    raw: list[dict[str, Any]] = []
    failures: list[str] = []
    hf_paper_candidates: list[dict[str, Any]] = []

    if not args.arxiv_only and not args.no_hf_papers:
        try:
            # 只请求一次，但延后合并，让 arXiv/OpenAlex 等原始论文记录先成为候选主记录。
            hf_paper_candidates = fetch_hf_papers(hf_papers_session, category_set, start, end)
        except (requests.RequestException, ValueError, TypeError) as error:
            failures.append(f"Hugging Face Papers: {error}")

    for topic_index, category in enumerate(categories):
        config = TOPICS[category]
        try:
            raw.extend(fetch_arxiv(arxiv_session, category, config["arxiv"], start, end))
        except (requests.RequestException, ET.ParseError) as error:
            failures.append(f"arXiv/{category}: {error}")
        if topic_index < len(categories) - 1:
            time.sleep(3.1)

        if not args.arxiv_only and not args.no_openalex:
            try:
                raw.extend(
                    fetch_openalex(
                        openalex_session,
                        category,
                        config["paper"],
                        start,
                        end,
                        os.getenv("OPENALEX_MAILTO"),
                    )
                )
            except (requests.RequestException, ValueError, TypeError) as error:
                failures.append(f"OpenAlex/{category}: {error}")
            time.sleep(0.2)

        if not args.arxiv_only and not args.no_semantic_scholar:
            try:
                raw.extend(fetch_semantic_scholar(semantic_session, category, config["paper"], start, end))
            except (requests.RequestException, ValueError, TypeError) as error:
                failures.append(f"Semantic Scholar/{category}: {error}")
            time.sleep(1.1)

        if not args.arxiv_only and not args.no_github:
            try:
                raw.extend(fetch_github(github_session, category, config["github"], start, args.min_stars))
            except (requests.RequestException, ValueError) as error:
                failures.append(f"GitHub/{category}: {error}")
            time.sleep(0.4)

        if not args.arxiv_only and not args.no_huggingface:
            try:
                raw.extend(
                    fetch_hf_models(
                        hf_models_session,
                        category,
                        config["hf_models"],
                        start,
                        args.min_hf_likes,
                        args.min_hf_downloads,
                    )
                )
            except (requests.RequestException, ValueError, TypeError) as error:
                failures.append(f"Hugging Face Models/{category}: {error}")
            time.sleep(0.2)

    raw.extend(hf_paper_candidates)
    source_counts = Counter(str(candidate.get("source", "unknown")) for candidate in raw)
    candidates = merge_candidates(raw, models)
    payload = {
        "generated_at": end.isoformat(),
        "window_days": args.days,
        "categories": categories,
        "manual_review_required": True,
        "warning_zh": (
            "候选来自公开 API 的关键词与启发式匹配，需人工审核后手动合并；"
            "来源冲突保存在 source_records / metadata_conflicts，本脚本从不修改 data/models.json、"
            "data/details 或 data/index.json。"
        ),
        "sources_attempted": [
            "arXiv",
            *([] if args.arxiv_only or args.no_openalex else ["OpenAlex"]),
            *([] if args.arxiv_only or args.no_semantic_scholar else ["Semantic Scholar"]),
            *([] if args.arxiv_only or args.no_hf_papers else ["Hugging Face Papers"]),
            *([] if args.arxiv_only or args.no_github else ["GitHub"]),
            *([] if args.arxiv_only or args.no_huggingface else ["Hugging Face Models"]),
        ],
        "raw_source_counts": dict(sorted(source_counts.items())),
        "failures": failures,
        "metadata_conflict_count": sum(len(item.get("metadata_conflicts") or []) for item in candidates),
        "count": len(candidates),
        "candidates": candidates,
    }

    if args.dry_run:
        print(
            json.dumps(
                {
                    "dry_run": True,
                    "raw_source_counts": payload["raw_source_counts"],
                    "candidate_count": payload["count"],
                    "metadata_conflict_count": payload["metadata_conflict_count"],
                    "failures": failures,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        with OUTPUT_PATH.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        print(f"已生成 {OUTPUT_PATH}，共 {len(candidates)} 个待审核候选。")
    if failures:
        print("部分来源失败：", *failures, sep="\n- ", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
