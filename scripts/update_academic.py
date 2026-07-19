#!/usr/bin/env python3
"""生成 Atlas 学术追踪待人工审核候选。

发现源（均无需 API key）：Crossref、OpenAlex、DBLP、CVF Open Access、
PMLR 与 Robotics Proceedings (RSS)。OpenReview 不作为自动化主源，因为投稿、
撤稿、拒稿与接收状态很容易被误读，且页面结构与限流并不适合此处的保守更新器。

本脚本只读取 data/papers.json 与 data/academic_tracker.json，只允许写入
data/academic_candidates.json。它绝不修改 papers.json、academic_tracker.json、
models.json、index.json 或 details/。候选必须人工回到官方页面核验后再手动合并。
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable
from urllib.parse import urljoin, urlparse

import requests


ROOT = Path(__file__).resolve().parents[1]
PAPERS_PATH = ROOT / "data" / "papers.json"
TRACKER_PATH = ROOT / "data" / "academic_tracker.json"
OUTPUT_PATH = ROOT / "data" / "academic_candidates.json"

CROSSREF_API = "https://api.crossref.org/works"
CROSSREF_JOURNALS_API = "https://api.crossref.org/journals"
OPENALEX_API = "https://api.openalex.org/works"
DBLP_API = "https://dblp.org/search/publ/api"
CVF_BASE = "https://openaccess.thecvf.com/"
PMLR_BASE = "https://proceedings.mlr.press/"
RSS_BASE = "https://www.roboticsproceedings.org/"

SOURCE_LEVELS = {
    "CVF Open Access": "E1",
    "PMLR": "E1",
    "Robotics Proceedings": "E1",
    "Crossref": "E4",
    "OpenAlex": "E4",
    "DBLP": "E4",
}

TOPICS = {
    "vla": '"vision language action" robot manipulation policy',
    "world": '"world model" video generation prediction',
    "detection": '"object detection" computer vision',
    "representation": '"visual representation" self supervised vision',
    "segmentation": '"image segmentation" vision model',
    "multimodal": '"vision language model" multimodal robot',
}

DIRECTION_PATTERNS = {
    "vla": re.compile(
        r"vision[\s-]+language[\s-]+action|\bvla\b|robot(?:ic)? manipulation|"
        r"visuomotor|robot policy|imitation learning|robot learning|robot grasp",
        re.I,
    ),
    "world": re.compile(
        r"world model|video generation|video diffusion|future prediction|"
        r"predictive world|neural simulator|action[\s-]+conditioned (?:video|prediction)",
        re.I,
    ),
    "detection": re.compile(
        r"object detection|object detector|3d detection|open[\s-]+vocabulary detection|"
        r"grounded detection|\byolo(?:v?\d+)?\b|\bdetr\b",
        re.I,
    ),
    "representation": re.compile(
        r"representation learning|visual representation|self[\s-]+supervised|"
        r"contrastive learning|image retrieval|vision encoder|visual pretrain",
        re.I,
    ),
    "segmentation": re.compile(
        r"semantic segmentation|instance segmentation|image segmentation|"
        r"open[\s-]+vocabulary segmentation|segment anything|mask decoder",
        re.I,
    ),
    "multimodal": re.compile(
        r"vision[\s-]+language|visual language|multimodal|\bmllm\b|\bvlm\b|"
        r"embodied (?:agent|ai|reasoning)|visual grounding",
        re.I,
    ),
}

# 仅帮助匹配出版平台常见缩写；不携带排名、分区或质量判断。
VENUE_ALIASES = {
    "tro": ["transactions on robotics", "ieee tro"],
    "ral": ["robotics and automation letters", "ieee ral"],
    "ijrr": ["international journal of robotics research"],
    "science-robotics": ["science robotics"],
    "tpami": ["transactions on pattern analysis and machine intelligence", "ieee tpami"],
    "ijcv": ["international journal of computer vision"],
    "cviu": ["computer vision and image understanding"],
    "autonomous-robots": ["autonomous robots"],
    "cvpr": ["computer vision and pattern recognition", "ieee cvf cvpr"],
    "iccv": ["international conference on computer vision", "ieee cvf iccv"],
    "eccv": ["european conference on computer vision"],
    "wacv": ["winter conference on applications of computer vision", "ieee cvf wacv"],
    "icra": ["international conference on robotics and automation", "ieee icra"],
    "iros": ["international conference on intelligent robots and systems", "ieee rsj iros"],
    "rss": ["robotics science and systems"],
    "corl": ["conference on robot learning"],
    "neurips": ["neural information processing systems"],
    "iclr": ["international conference on learning representations"],
}


def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def strip_markup(value: Any) -> str:
    return clean(html.unescape(re.sub(r"<[^>]+>", " ", str(value or ""))))


def normalize(value: Any) -> str:
    """保留 Unicode 字母数字，用于稳定且保守的标识归一化。"""
    return re.sub(r"[\W_]+", "", clean(value).casefold(), flags=re.UNICODE)


def source_slug(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", clean(value).casefold()).strip("-") or "unknown"


def canonical_platform_value(source: Any, value: Any) -> str:
    """统一平台 ID 的 URL/短 ID 两种写法，不跨平台猜测等价关系。"""
    source_key = source_slug(source)
    text = clean(value)
    if not text:
        return ""
    parsed = urlparse(text if "://" in text else f"https://placeholder.invalid/{text.lstrip('/')}")
    if source_key == "openalex":
        match = re.search(r"\bW\d+\b", text, re.I)
        return match.group(0).casefold() if match else normalize(text)
    if source_key == "dblp":
        path = parsed.path if parsed.netloc != "placeholder.invalid" else text
        return normalize(re.sub(r"^(?:rec/|db/)", "", path.lstrip("/"), flags=re.I))
    return normalize(text)


def official_platform_references(*values: Any) -> set[str]:
    """Extract same-provider stable IDs from reviewed official publication URLs.

    These references are only used to prevent an already reviewed publication
    event from re-entering the candidate queue.  Host checks stay explicit so a
    look-alike path on an unrelated site cannot be treated as authoritative.
    """
    references: set[str] = set()
    official_hosts = {
        "openaccess.thecvf.com": "cvf-open-access",
        "proceedings.mlr.press": "pmlr",
        "www.roboticsproceedings.org": "robotics-proceedings",
        "roboticsproceedings.org": "robotics-proceedings",
    }
    for value in values:
        text = clean(value)
        if not text or "://" not in text:
            continue
        parsed = urlparse(text)
        source = official_hosts.get(parsed.hostname.casefold() if parsed.hostname else "")
        if not source:
            continue
        stable_path = canonical_platform_value(source, parsed.path)
        if stable_path:
            references.add(f"platform:{source}:{stable_path}")
    return references


def extract_doi(*values: Any) -> str:
    for value in values:
        match = re.search(r"(?:doi\.org/|doi:\s*)?(10\.\d{4,9}/[^\s\"<>]+)", clean(value), re.I)
        if match:
            return match.group(1).rstrip(".,;:)]}").casefold()
    return ""


def extract_arxiv(*values: Any) -> str:
    for value in values:
        text = clean(value)
        match = re.search(
            r"(?:arxiv\s*:\s*|arxiv\.org/(?:abs|pdf)/)?"
            r"(\d{4}\.\d{4,5}|[a-z.-]+/\d{7})(?:v\d+)?(?:\.pdf)?(?:[?#].*)?$",
            text,
            re.I,
        )
        if match:
            return match.group(1).casefold()
    return ""


def first_author(authors: Any) -> str:
    if isinstance(authors, list) and authors:
        first = authors[0]
        if isinstance(first, dict):
            return clean(first.get("name") or first.get("display_name") or first.get("family"))
        return clean(first)
    if isinstance(authors, str):
        return clean(re.split(r"\s*(?:,|;|\band\b)\s*", authors, maxsplit=1, flags=re.I)[0])
    return ""


def year_of(value: Any) -> str:
    match = re.search(r"(?:19|20)\d{2}", clean(value))
    return match.group(0) if match else ""


def title_author_year_key(title: Any, authors: Any, published: Any) -> str:
    title_key = normalize(title)
    author_key = normalize(first_author(authors))
    year = year_of(published)
    if not title_key or not author_key or not year:
        return ""
    return f"title:{title_key}|author:{author_key}|year:{year}"


def soft_title_author_key(title: Any, authors: Any) -> str:
    title_key = normalize(title)
    author_key = normalize(first_author(authors))
    if not title_key or not author_key:
        return ""
    return f"title:{title_key}|author:{author_key}"


def classify_directions(title: Any, abstract: Any = "") -> list[str]:
    text = f"{clean(title)} {strip_markup(abstract)}"
    return [key for key, pattern in DIRECTION_PATTERNS.items() if pattern.search(text)]


def parse_date_parts(value: Any) -> str:
    """读取 Crossref 的 date-parts，并保留真实精度。"""
    if not isinstance(value, dict):
        return ""
    parts = value.get("date-parts")
    if not isinstance(parts, list) or not parts or not isinstance(parts[0], list):
        return ""
    numbers = parts[0]
    if not numbers:
        return ""
    try:
        year = int(numbers[0])
        month = int(numbers[1]) if len(numbers) > 1 else None
        day = int(numbers[2]) if len(numbers) > 2 else None
    except (TypeError, ValueError):
        return ""
    if day is not None and month is not None:
        return f"{year:04d}-{month:02d}-{day:02d}"
    if month is not None:
        return f"{year:04d}-{month:02d}"
    return f"{year:04d}"


def date_precision(value: Any) -> str:
    text = clean(value)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return "day"
    if re.fullmatch(r"\d{4}-\d{2}", text):
        return "month"
    if re.fullmatch(r"\d{4}", text):
        return "year"
    return "unknown"


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


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_papers(path: Path = PAPERS_PATH) -> list[dict[str, Any]]:
    payload = load_json(path)
    papers = payload.get("papers") if isinstance(payload, dict) else payload
    if not isinstance(papers, list):
        raise ValueError(f"{path} 必须是数组，或包含 papers 数组")
    return [paper for paper in papers if isinstance(paper, dict)]


def load_tracker(path: Path = TRACKER_PATH) -> dict[str, Any]:
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise ValueError(f"{path} 顶层必须是对象")
    for key in (
        "journals",
        "conferences",
        "editorial_policy",
        "evidence_levels",
        "publication_statuses",
        "publication_events",
    ):
        if key not in payload:
            raise ValueError(f"{path} 缺少 {key}")
    evidence_ids = {
        clean(level.get("id"))
        for level in payload.get("evidence_levels", [])
        if isinstance(level, dict)
    }
    status_ids = {
        clean(status.get("id"))
        for status in payload.get("publication_statuses", [])
        if isinstance(status, dict)
    }
    if not set(SOURCE_LEVELS.values()) <= evidence_ids:
        raise ValueError(f"{path} 的 evidence_levels 与更新器不兼容")
    if not {"needs_review", "proceedings_published"} <= status_ids:
        raise ValueError(f"{path} 的 publication_statuses 与更新器不兼容")
    return payload


def venue_catalog(tracker: dict[str, Any]) -> list[dict[str, Any]]:
    catalog: list[dict[str, Any]] = []
    for collection, venue_type in (("journals", "journal"), ("conferences", "conference")):
        for raw in tracker.get(collection, []):
            if not isinstance(raw, dict) or not clean(raw.get("id")):
                continue
            item = dict(raw)
            item["venue_type"] = venue_type
            aliases = [item.get("name"), item.get("acronym"), *VENUE_ALIASES.get(item["id"], [])]
            item["_aliases"] = [clean(alias) for alias in aliases if clean(alias)]
            catalog.append(item)
    return catalog


def match_venue(hint: Any, catalog: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, str]:
    text = clean(hint)
    text_normalized = normalize(text)
    if not text_normalized:
        return None, "missing"
    best: tuple[int, dict[str, Any], str] | None = None
    for venue in catalog:
        for alias in venue.get("_aliases", []):
            alias_normalized = normalize(alias)
            if not alias_normalized:
                continue
            acronym = clean(venue.get("acronym"))
            if text_normalized == alias_normalized:
                score, mode = 4, "exact"
            elif len(alias_normalized) >= 12 and alias_normalized in text_normalized:
                score, mode = 3, "full-name"
            elif alias == acronym and re.search(
                rf"(?<![A-Za-z0-9]){re.escape(acronym)}(?![A-Za-z0-9])", text, re.I
            ):
                score, mode = 2, "acronym"
            else:
                continue
            if best is None or score > best[0]:
                best = (score, venue, mode)
    return (best[1], best[2]) if best else (None, "untracked")


def canonical_record(
    *,
    source: str,
    source_id: Any,
    source_url: Any,
    title: Any,
    authors: Any,
    published: Any,
    venue_hint: Any,
    abstract: Any = "",
    doi: Any = "",
    arxiv: Any = "",
    landing_url: Any = "",
    type_hint: Any = "",
    category_hint: Any = "",
    explicit_venue_id: Any = "",
) -> dict[str, Any]:
    if isinstance(authors, str):
        author_list = [clean(part) for part in re.split(r"\s*;\s*", authors) if clean(part)]
    elif isinstance(authors, list):
        author_list = [clean(author.get("name") if isinstance(author, dict) else author) for author in authors]
        author_list = [author for author in author_list if author]
    else:
        author_list = []
    source_url_value = clean(source_url or landing_url)
    landing = clean(landing_url or source_url)
    doi_value = extract_doi(doi, landing, source_url_value)
    arxiv_value = extract_arxiv(arxiv, landing, source_url_value)
    return {
        "source": clean(source),
        "evidence_level": SOURCE_LEVELS.get(clean(source), "C"),
        "source_id": clean(source_id),
        "source_url": source_url_value,
        "title": strip_markup(title),
        "authors": author_list,
        "published": clean(published),
        "date_precision": date_precision(published),
        "venue_hint": strip_markup(venue_hint),
        "type_hint": clean(type_hint),
        "abstract": strip_markup(abstract),
        "external_ids": {"doi": doi_value, "arxiv": arxiv_value},
        "links": {
            "landing": landing,
            "doi": f"https://doi.org/{doi_value}" if doi_value else "",
            "arxiv": f"https://arxiv.org/abs/{arxiv_value}" if arxiv_value else "",
        },
        "category_hint": clean(category_hint),
        "explicit_venue_id": clean(explicit_venue_id),
    }


def request_json(
    session: requests.Session,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    timeout: int = 30,
) -> dict[str, Any]:
    response = session.get(url, params=params, timeout=timeout)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError(f"{url} 未返回 JSON 对象")
    return payload


def fetch_crossref(
    session: requests.Session,
    categories: list[str],
    start: datetime,
    end: datetime,
    per_query: int,
    mailto: str,
    tracker: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[str]]:
    records: list[dict[str, Any]] = []
    warnings: list[str] = []
    journals = [journal for journal in tracker.get("journals", []) if isinstance(journal, dict)]
    catalog = venue_catalog(tracker)
    for journal in journals:
        venue_name = clean(journal.get("name"))
        venue_id = clean(journal.get("id"))
        if not venue_name or not venue_id:
            continue
        try:
            journal_payload = request_json(
                session,
                CROSSREF_JOURNALS_API,
                params={"query": venue_name, "rows": 10, **({"mailto": mailto} if mailto else {})},
            )
            journal_items = journal_payload.get("message", {}).get("items", [])
            if not isinstance(journal_items, list):
                raise ValueError("Crossref journals message.items 不是数组")
            exact_journal = next(
                (
                    item
                    for item in journal_items
                    if isinstance(item, dict) and normalize(item.get("title")) == normalize(venue_name)
                ),
                None,
            )
            issns = exact_journal.get("ISSN") if isinstance(exact_journal, dict) else None
            issn = clean(issns[0]) if isinstance(issns, list) and issns else ""
            if not issn:
                warnings.append(f"{venue_id}: 未从 Crossref 精确解析期刊 ISSN，已跳过模糊标题结果")
                continue
        except (requests.RequestException, ValueError, TypeError) as error:
            warnings.append(f"{venue_id}/journal-lookup: {error}")
            continue
        params: dict[str, Any] = {
            "filter": f"issn:{issn},from-pub-date:{start:%Y-%m-%d},until-pub-date:{end:%Y-%m-%d}",
            "rows": per_query,
            "sort": "published",
            "order": "desc",
        }
        if mailto:
            params["mailto"] = mailto
        try:
            payload = request_json(session, CROSSREF_API, params=params)
            items = payload.get("message", {}).get("items", [])
            if not isinstance(items, list):
                raise ValueError("Crossref message.items 不是数组")
            for item in items:
                if not isinstance(item, dict):
                    continue
                title_values = item.get("title") or []
                title = title_values[0] if isinstance(title_values, list) and title_values else ""
                abstract = item.get("abstract") or ""
                directions = classify_directions(title, abstract)
                selected_directions = [direction for direction in directions if direction in categories]
                if not selected_directions:
                    continue
                containers = item.get("container-title") or []
                venue = containers[0] if isinstance(containers, list) and containers else ""
                matched_venue, _match_mode = match_venue(venue, catalog)
                if matched_venue is None or matched_venue.get("id") != venue_id:
                    continue
                authors = []
                for author in item.get("author") or []:
                    if not isinstance(author, dict):
                        continue
                    name = clean(" ".join(part for part in (author.get("given"), author.get("family")) if part))
                    if name:
                        authors.append(name)
                published = ""
                for field in ("published-online", "published-print", "published", "issued"):
                    published = parse_date_parts(item.get(field))
                    if published:
                        break
                doi = clean(item.get("DOI"))
                url = clean(item.get("URL")) or (f"https://doi.org/{doi}" if doi else "")
                records.append(
                    canonical_record(
                        source="Crossref",
                        source_id=doi or url,
                        source_url=url,
                        title=title,
                        authors=authors,
                        published=published,
                        venue_hint=venue,
                        abstract=abstract,
                        doi=doi,
                        landing_url=url,
                        type_hint=item.get("type"),
                        category_hint=selected_directions[0],
                        explicit_venue_id=venue_id,
                    )
                )
        except (requests.RequestException, ValueError, TypeError) as error:
            warnings.append(f"{venue_id}: {error}")
        time.sleep(0.18)
    return records, warnings


def fetch_openalex(
    session: requests.Session,
    categories: list[str],
    start: datetime,
    end: datetime,
    per_query: int,
    mailto: str,
    _tracker: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[str]]:
    records: list[dict[str, Any]] = []
    warnings: list[str] = []
    for category in categories:
        params: dict[str, Any] = {
            "search": TOPICS[category],
            "filter": f"from_publication_date:{start:%Y-%m-%d},to_publication_date:{end:%Y-%m-%d},is_retracted:false",
            "per-page": per_query,
        }
        if mailto:
            params["mailto"] = mailto
        try:
            payload = request_json(session, OPENALEX_API, params=params)
            results = payload.get("results") or []
            if not isinstance(results, list):
                raise ValueError("OpenAlex results 不是数组")
            for work in results:
                if not isinstance(work, dict) or work.get("is_retracted"):
                    continue
                title = clean(work.get("title") or work.get("display_name"))
                abstract = reconstruct_abstract(work.get("abstract_inverted_index"))
                directions = classify_directions(title, abstract)
                if category not in directions:
                    continue
                location = work.get("primary_location") or work.get("best_oa_location") or {}
                if not isinstance(location, dict):
                    location = {}
                source = location.get("source") or {}
                venue = clean(source.get("display_name")) if isinstance(source, dict) else ""
                authors = []
                for authorship in work.get("authorships") or []:
                    author = authorship.get("author") if isinstance(authorship, dict) else {}
                    name = clean(author.get("display_name")) if isinstance(author, dict) else ""
                    if name:
                        authors.append(name)
                ids = work.get("ids") or {}
                doi = extract_doi(work.get("doi"), ids.get("doi") if isinstance(ids, dict) else "")
                landing = clean(location.get("landing_page_url") or work.get("doi") or work.get("id"))
                arxiv = extract_arxiv(landing, ids.get("arxiv") if isinstance(ids, dict) else "")
                records.append(
                    canonical_record(
                        source="OpenAlex",
                        source_id=work.get("id"),
                        source_url=work.get("id"),
                        title=title,
                        authors=authors,
                        published=work.get("publication_date"),
                        venue_hint=venue,
                        abstract=abstract,
                        doi=doi,
                        arxiv=arxiv,
                        landing_url=landing,
                        type_hint=work.get("type"),
                        category_hint=category,
                    )
                )
        except (requests.RequestException, ValueError, TypeError) as error:
            warnings.append(f"{category}: {error}")
        time.sleep(0.12)
    return records, warnings


def parse_dblp_authors(value: Any) -> list[str]:
    if isinstance(value, dict) and "author" in value:
        value = value["author"]
    values = value if isinstance(value, list) else [value]
    authors: list[str] = []
    for author in values:
        if isinstance(author, dict):
            name = clean(author.get("text") or author.get("name"))
        else:
            name = clean(author)
        if name:
            authors.append(name)
    return authors


def fetch_dblp(
    session: requests.Session,
    categories: list[str],
    start: datetime,
    end: datetime,
    per_query: int,
    _mailto: str,
    _tracker: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[str]]:
    records: list[dict[str, Any]] = []
    warnings: list[str] = []
    for category in categories:
        try:
            payload = request_json(
                session,
                DBLP_API,
                params={"q": TOPICS[category], "h": per_query, "format": "json"},
            )
            hits = payload.get("result", {}).get("hits", {}).get("hit", [])
            if isinstance(hits, dict):
                hits = [hits]
            if not isinstance(hits, list):
                raise ValueError("DBLP hit 不是数组")
            for hit in hits:
                info = hit.get("info") if isinstance(hit, dict) else None
                if not isinstance(info, dict):
                    continue
                year = year_of(info.get("year"))
                if not year or int(year) < start.year or int(year) > end.year:
                    continue
                title = strip_markup(info.get("title"))
                if category not in classify_directions(title):
                    continue
                ee_raw = info.get("ee") or []
                ee_values = ee_raw if isinstance(ee_raw, list) else [ee_raw]
                ee_values = [clean(value) for value in ee_values if clean(value)]
                record_url = clean(info.get("url"))
                if record_url.startswith("db/"):
                    record_url = f"https://dblp.org/rec/{record_url[3:]}"
                key = clean(info.get("key") or record_url)
                records.append(
                    canonical_record(
                        source="DBLP",
                        source_id=key,
                        source_url=record_url or next(iter(ee_values), ""),
                        title=title,
                        authors=parse_dblp_authors(info.get("authors")),
                        published=year,
                        venue_hint=info.get("venue"),
                        doi=extract_doi(info.get("doi"), *ee_values),
                        arxiv=extract_arxiv(*ee_values),
                        landing_url=next(iter(ee_values), "") or record_url,
                        type_hint=info.get("type"),
                        category_hint=category,
                    )
                )
        except (requests.RequestException, ValueError, TypeError) as error:
            warnings.append(f"{category}: {error}")
        time.sleep(0.12)
    return records, warnings


def html_links(page: str, pattern: str) -> list[tuple[str, str]]:
    matches = re.findall(pattern, page, flags=re.I | re.S)
    return [(clean(href), strip_markup(label)) for href, label in matches]


def parse_cvf_entries(page: str) -> list[tuple[str, str, list[str]]]:
    entries: list[tuple[str, str, list[str]]] = []
    pattern = re.compile(
        r'<dt[^>]*class=["\'][^"\']*ptitle[^"\']*["\'][^>]*>.*?'
        r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>.*?</dt>\s*'
        r'<dd[^>]*>(.*?)</dd>',
        flags=re.I | re.S,
    )
    for match in pattern.finditer(page):
        author_block = match.group(3)
        authors = [
            clean(html.unescape(value))
            for value in re.findall(
                r'<input[^>]+name=["\']query_author["\'][^>]+value=["\']([^"\']+)["\']',
                author_block,
                flags=re.I,
            )
        ]
        entries.append((clean(match.group(1)), strip_markup(match.group(2)), authors))
    return entries


def fetch_cvf(
    session: requests.Session,
    _categories: list[str],
    start: datetime,
    end: datetime,
    per_query: int,
    _mailto: str,
    _tracker: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[str]]:
    records: list[dict[str, Any]] = []
    warnings: list[str] = []
    years = range(start.year, end.year + 1)
    for acronym in ("CVPR", "ICCV", "WACV"):
        for year in years:
            url = f"{CVF_BASE}{acronym}{year}?day=all"
            try:
                response = session.get(url, timeout=25)
                if response.status_code == 404:
                    continue
                response.raise_for_status()
                entries = parse_cvf_entries(response.text)
                if not entries:
                    warnings.append(f"{acronym}{year}: 页面可访问但未解析到论文条目，需核对 HTML 结构")
                    continue
                accepted = 0
                for href, title, authors in entries:
                    if not (set(classify_directions(title)) & set(_categories)):
                        continue
                    landing = urljoin(CVF_BASE, href)
                    records.append(
                        canonical_record(
                            source="CVF Open Access",
                            source_id=urlparse(landing).path,
                            source_url=landing,
                            title=title,
                            authors=authors,
                            published=str(year),
                            venue_hint=acronym,
                            landing_url=landing,
                            type_hint="proceedings-article",
                            explicit_venue_id=acronym.casefold(),
                        )
                    )
                    accepted += 1
                    if accepted >= per_query:
                        break
            except requests.RequestException as error:
                warnings.append(f"{acronym}{year}: {error}")
    return records, warnings


def fetch_rss(
    session: requests.Session,
    _categories: list[str],
    start: datetime,
    end: datetime,
    per_query: int,
    _mailto: str,
    _tracker: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[str]]:
    records: list[dict[str, Any]] = []
    warnings: list[str] = []
    try:
        root = session.get(RSS_BASE, timeout=25)
        root.raise_for_status()
    except requests.RequestException as error:
        return [], [f"目录: {error}"]
    # Robotics Proceedings 首页会混入历届会议网站（例如 rss2020），而正式论文集
    # 使用 rss21 这类罗马届次对应的短目录。按 RSS I=2005 推导候选目录，再用
    # HTTP 状态核验；首页发现只接受两位以内的短编号，避免误把年份当卷号。
    volumes = {
        (year - 2004, urljoin(RSS_BASE, f"rss{year - 2004}/"))
        for year in range(start.year, end.year + 1)
        if year >= 2005
    }
    volumes.update(
        {
            (int(number), urljoin(RSS_BASE, href.rstrip("/") + "/"))
            for href, number in re.findall(r'href=["\']([^"\']*rss(\d{1,2})/?)["\']', root.text, flags=re.I)
        }
    )
    volumes = sorted(volumes, reverse=True)
    for volume, url in volumes:
        year = 2004 + volume
        if year < start.year or year > end.year:
            continue
        try:
            response = session.get(url, timeout=25)
            response.raise_for_status()
            entries = [
                (clean(match.group(1)), strip_markup(match.group(2)), [
                    clean(author)
                    for author in re.split(r"\s*,\s*", strip_markup(match.group(3)))
                    if clean(author)
                ])
                for match in re.finditer(
                    r'<a[^>]+href=["\']([^"\']*p\d+\.html)["\'][^>]*>(.*?)</a>\s*<br\s*/?>\s*'
                    r'<i[^>]*>(.*?)</i>',
                    response.text,
                    flags=re.I | re.S,
                )
            ]
            if not entries:
                warnings.append(f"rss{volume}: 页面可访问但未解析到标题/作者条目，需核对 HTML 结构")
                continue
            seen: set[str] = set()
            for href, title, authors in entries:
                landing = urljoin(url, href)
                if landing in seen or not (set(classify_directions(title)) & set(_categories)):
                    continue
                seen.add(landing)
                records.append(
                    canonical_record(
                        source="Robotics Proceedings",
                        source_id=urlparse(landing).path,
                        source_url=landing,
                        title=title,
                        authors=authors,
                        published=str(year),
                        venue_hint="RSS",
                        landing_url=landing,
                        type_hint="proceedings-article",
                        explicit_venue_id="rss",
                    )
                )
                if len(seen) >= per_query:
                    break
        except requests.RequestException as error:
            warnings.append(f"rss{volume}: {error}")
    return records, warnings


def fetch_pmlr(
    session: requests.Session,
    _categories: list[str],
    start: datetime,
    end: datetime,
    per_query: int,
    _mailto: str,
    _tracker: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[str]]:
    records: list[dict[str, Any]] = []
    warnings: list[str] = []
    try:
        root = session.get(PMLR_BASE, timeout=25)
        root.raise_for_status()
    except requests.RequestException as error:
        return [], [f"目录: {error}"]
    volume_links: list[tuple[str, str]] = []
    for href, label in html_links(root.text, r'<a[^>]+href=["\']([^"\']*v\d+/?)["\'][^>]*>(.*?)</a>'):
        text = f"{href} {label}"
        if re.search(r"conference on robot learning|\bcorl\b", text, re.I):
            volume_links.append((urljoin(PMLR_BASE, href), label))
    recent_volumes = [
        (url, label)
        for url, label in volume_links
        if not year_of(label) or start.year <= int(year_of(label)) <= end.year
    ]
    recent_volumes.sort(key=lambda item: year_of(item[1]), reverse=True)
    if not recent_volumes:
        warnings.append("目录可访问但未发现回溯年份内的 CoRL volume，需核对 PMLR 目录结构或发布状态")
    for url, label in recent_volumes[:3]:
        year = year_of(label)
        if year and (int(year) < start.year or int(year) > end.year):
            continue
        try:
            response = session.get(url, timeout=25)
            response.raise_for_status()
            paper_chunks = re.split(
                r'(?=<div[^>]+class=["\'][^"\']*\bpaper\b[^"\']*["\'])',
                response.text,
                flags=re.I,
            )
            parsed_papers: list[tuple[str, str, list[str]]] = []
            for chunk in paper_chunks:
                title_match = re.search(
                    r'<p[^>]*class=["\'][^"\']*\btitle\b[^"\']*["\'][^>]*>(.*?)</p>',
                    chunk,
                    flags=re.I | re.S,
                )
                if not title_match:
                    continue
                title = strip_markup(title_match.group(1))
                href_match = re.search(
                    r'<a[^>]+href=["\']([^"\']+\.html)["\'][^>]*>',
                    chunk,
                    flags=re.I,
                )
                if not href_match:
                    continue
                author_match = re.search(
                    r'<span[^>]*class=["\'][^"\']*\bauthors?\b[^"\']*["\'][^>]*>(.*?)</span>',
                    chunk,
                    flags=re.I | re.S,
                )
                authors = []
                if author_match:
                    authors = [
                        clean(author)
                        for author in re.split(r"\s*(?:,|;|\band\b)\s*", strip_markup(author_match.group(1)), flags=re.I)
                        if clean(author)
                    ]
                parsed_papers.append((href_match.group(1), title, authors))
            if not parsed_papers:
                warnings.append(f"{url}: volume 可访问但未解析到论文条目，需核对 HTML 结构")
                continue
            accepted = 0
            for href, title, authors in parsed_papers:
                if not (set(classify_directions(title)) & set(_categories)):
                    continue
                landing = urljoin(url, href)
                records.append(
                    canonical_record(
                        source="PMLR",
                        source_id=urlparse(landing).path,
                        source_url=landing,
                        title=title,
                        authors=authors,
                        published=year,
                        venue_hint="CoRL",
                        landing_url=landing,
                        type_hint="proceedings-article",
                        explicit_venue_id="corl",
                    )
                )
                accepted += 1
                if accepted >= per_query:
                    break
        except requests.RequestException as error:
            warnings.append(f"{url}: {error}")
    return records, warnings


PROVIDERS: dict[
    str,
    Callable[
        [requests.Session, list[str], datetime, datetime, int, str, dict[str, Any]],
        tuple[list[dict[str, Any]], list[str]],
    ],
] = {
    "crossref": fetch_crossref,
    "openalex": fetch_openalex,
    "dblp": fetch_dblp,
    "cvf": fetch_cvf,
    "rss": fetch_rss,
    "pmlr": fetch_pmlr,
}

SOURCE_DATE_PRECISION = {
    "crossref": "day",
    "openalex": "day",
    "dblp": "year",
    "cvf": "year",
    "rss": "year",
    "pmlr": "year",
    "offline-fixture": "record-dependent",
}


def record_identifier_sets(record: dict[str, Any]) -> dict[str, set[str]]:
    external = record.get("external_ids") or {}
    source = source_slug(record.get("source"))
    doi = extract_doi(external.get("doi"), (record.get("links") or {}).get("doi"))
    arxiv = extract_arxiv(external.get("arxiv"), *((record.get("links") or {}).values()))
    platform_id = canonical_platform_value(record.get("source"), record.get("source_id"))
    fallback = title_author_year_key(record.get("title"), record.get("authors"), record.get("published"))
    return {
        "doi": {f"doi:{doi}"} if doi else set(),
        "arxiv": {f"arxiv:{arxiv}"} if arxiv else set(),
        "platform": {f"platform:{source}:{platform_id}"} if platform_id else set(),
        "title": {fallback} if fallback else set(),
    }


def group_identifier_sets(records: Iterable[dict[str, Any]]) -> dict[str, set[str]]:
    combined = {"doi": set(), "arxiv": set(), "platform": set(), "title": set()}
    for record in records:
        for key, values in record_identifier_sets(record).items():
            combined[key].update(values)
    return combined


def groups_conflict(left: list[dict[str, Any]], right: list[dict[str, Any]]) -> bool:
    left_ids = group_identifier_sets(left)
    right_ids = group_identifier_sets(right)
    if left_ids["doi"] and right_ids["doi"] and left_ids["doi"].isdisjoint(right_ids["doi"]):
        return True
    if left_ids["arxiv"] and right_ids["arxiv"] and left_ids["arxiv"].isdisjoint(right_ids["arxiv"]):
        return True
    return False


def shared_identity_level(left: list[dict[str, Any]], right: list[dict[str, Any]]) -> str:
    left_ids = group_identifier_sets(left)
    right_ids = group_identifier_sets(right)
    for level in ("doi", "arxiv", "platform", "title"):
        if left_ids[level] & right_ids[level]:
            return level
    return ""


def merge_raw_records(records: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """按 DOI→去版本 arXiv→同平台 ID→标题+首作者+年份归并。

    两边都提供 DOI（或 arXiv）但标识冲突时不允许标题兜底自动合并。
    """
    groups: list[list[dict[str, Any]]] = []
    ordered = sorted(
        records,
        key=lambda record: (
            0 if extract_doi((record.get("external_ids") or {}).get("doi")) else 1,
            0 if record.get("evidence_level") == "A" else 1,
            clean(record.get("source")),
            clean(record.get("title")),
        ),
    )
    for record in ordered:
        incoming = [record]
        matches: list[tuple[int, int]] = []
        for index, group in enumerate(groups):
            level = shared_identity_level(group, incoming)
            if not level or groups_conflict(group, incoming):
                continue
            matches.append((("doi", "arxiv", "platform", "title").index(level), index))
        if not matches:
            groups.append(incoming)
            continue
        matches.sort()
        matched_groups = [groups[index] for _, index in matches]
        ambiguous_bridge = any(
            groups_conflict(matched_groups[left], matched_groups[right])
            for left in range(len(matched_groups))
            for right in range(left + 1, len(matched_groups))
        )
        if ambiguous_bridge:
            # 一个没有强标识的标题记录同时命中两个不同 DOI/arXiv 版本时，
            # 不把它任意挂到排序靠前的一侧，单独保留给人工判断版本关系。
            record["_dedupe_ambiguity"] = "同一标题键命中多个强标识冲突组，已禁止自动桥接。"
            groups.append(incoming)
            continue
        owner_index = matches[0][1]
        owner = groups[owner_index]
        owner.append(record)
        for _, other_index in sorted(matches[1:], key=lambda item: item[1], reverse=True):
            if other_index == owner_index:
                continue
            other = groups[other_index]
            if groups_conflict(owner, other):
                continue
            owner.extend(other)
            del groups[other_index]
            if other_index < owner_index:
                owner_index -= 1
    return groups


def object_reference_values(item: dict[str, Any]) -> list[str]:
    values = [
        clean(item.get("id")),
        clean(item.get("url")),
        clean(item.get("paper_url")),
        clean(item.get("doi")),
        clean(item.get("arxiv")),
    ]
    links = item.get("links")
    if isinstance(links, dict):
        values.extend(clean(value) for value in links.values())
    external = item.get("external_ids")
    if isinstance(external, dict):
        values.extend(clean(value) for value in external.values())
    return [value for value in values if value]


def build_paper_index(papers: list[dict[str, Any]]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    index: dict[str, dict[str, list[dict[str, Any]]]] = {
        "doi": defaultdict(list),
        "arxiv": defaultdict(list),
        "platform": defaultdict(list),
        "title": defaultdict(list),
        "soft_title": defaultdict(list),
    }
    for paper in papers:
        versions = [version for version in (paper.get("versions") or []) if isinstance(version, dict)]
        reference_objects = [paper, *versions]
        dois = {
            doi
            for item in reference_objects
            if (doi := extract_doi(*object_reference_values(item)))
        }
        arxivs = {
            arxiv
            for item in reference_objects
            if (arxiv := extract_arxiv(*object_reference_values(item)))
        }
        summary = {
            "paper_id": clean(paper.get("id")),
            "title": clean(paper.get("title")),
            "dois": sorted(dois),
            "arxivs": sorted(arxivs),
        }
        for doi in sorted(dois):
            index["doi"][f"doi:{doi}"].append(summary)
        for arxiv in sorted(arxivs):
            index["arxiv"][f"arxiv:{arxiv}"].append(summary)
        for item in reference_objects:
            external = item.get("external_ids")
            if not isinstance(external, dict):
                continue
            for source in ("openalex", "dblp", "crossref"):
                value = clean(external.get(source))
                if value:
                    key = f"platform:{source}:{canonical_platform_value(source, value)}"
                    index["platform"][key].append(summary)
        title_year_keys = {
            key
            for item in reference_objects
            if (
                key := title_author_year_key(
                    item.get("title") or paper.get("title"),
                    item.get("authors") or paper.get("authors"),
                    item.get("published") or item.get("publication_date") or item.get("year") or paper.get("published") or paper.get("year"),
                )
            )
        }
        for fallback in sorted(title_year_keys):
            index["title"][fallback].append(summary)
        soft = soft_title_author_key(paper.get("title"), paper.get("authors"))
        if soft:
            index["soft_title"][soft].append(summary)
    return index


def build_publication_event_index(tracker: dict[str, Any]) -> dict[str, dict[str, list[dict[str, str]]]]:
    index: dict[str, dict[str, list[dict[str, str]]]] = {
        "doi": defaultdict(list),
        "arxiv": defaultdict(list),
        "platform": defaultdict(list),
    }
    for event in tracker.get("publication_events", []):
        if not isinstance(event, dict):
            continue
        summary = {
            "event_id": clean(event.get("id")),
            "paper_id": clean(event.get("paper_id")),
            "title": clean(event.get("title")),
            "status": clean(event.get("status")),
            "evidence_level": clean(event.get("evidence_level")),
            "source_url": clean(event.get("source_url")),
        }
        values = [
            clean(event.get("work_id")),
            clean(event.get("paper_id")),
            clean(event.get("source_url")),
        ]
        for version in event.get("versions") or []:
            if isinstance(version, dict):
                values.extend([clean(version.get("identifier")), clean(version.get("url"))])
        doi = extract_doi(*values)
        arxiv = extract_arxiv(*values)
        if doi:
            index["doi"][f"doi:{doi}"].append(summary)
        if arxiv:
            index["arxiv"][f"arxiv:{arxiv}"].append(summary)
        for key in official_platform_references(*values):
            index["platform"][key].append(summary)
        for value in values:
            match = re.match(r"^(openalex|dblp|crossref):(.+)$", value, flags=re.I)
            if not match:
                continue
            source, platform_id = match.groups()
            key = f"platform:{source.casefold()}:{canonical_platform_value(source, platform_id)}"
            index["platform"][key].append(summary)
    return index


def match_publication_events(
    records: list[dict[str, Any]],
    event_index: dict[str, dict[str, list[dict[str, str]]]],
) -> dict[str, Any]:
    identifiers = group_identifier_sets(records)
    for level in ("doi", "arxiv", "platform"):
        matches: dict[str, dict[str, str]] = {}
        for key in identifiers[level]:
            for event in event_index[level].get(key, []):
                matches[event["event_id"]] = event
        if matches:
            return {
                "is_known": True,
                "matched_by": level,
                "events": list(matches.values()),
                "note": "已存在于 academic_tracker.json.publication_events，未重复进入待审核候选。",
            }
    return {"is_known": False, "matched_by": "none", "events": [], "note": "未命中已确认发表事件。"}


def match_existing_papers(
    records: list[dict[str, Any]],
    paper_index: dict[str, dict[str, list[dict[str, Any]]]],
) -> dict[str, Any]:
    identifiers = group_identifier_sets(records)
    candidate_dois = {value.removeprefix("doi:") for value in identifiers["doi"]}
    candidate_arxivs = {value.removeprefix("arxiv:") for value in identifiers["arxiv"]}
    conflicts: dict[str, dict[str, Any]] = {}

    def conflicting_fields(paper: dict[str, Any], level: str) -> list[str]:
        fields: list[str] = []
        paper_dois = {clean(value) for value in paper.get("dois") or [] if clean(value)}
        paper_arxivs = {clean(value) for value in paper.get("arxivs") or [] if clean(value)}
        if level != "doi" and candidate_dois and paper_dois and candidate_dois.isdisjoint(paper_dois):
            fields.append("doi")
        if level != "arxiv" and candidate_arxivs and paper_arxivs and candidate_arxivs.isdisjoint(paper_arxivs):
            fields.append("arxiv")
        return fields

    for level in ("doi", "arxiv", "platform", "title"):
        matches: dict[str, dict[str, Any]] = {}
        for key in identifiers[level]:
            for paper in paper_index[level].get(key, []):
                fields = conflicting_fields(paper, level)
                if fields:
                    conflicts[paper["paper_id"]] = {
                        **paper,
                        "reason": "strong_identifier_conflict",
                        "conflicting_fields": fields,
                    }
                    continue
                matches[paper["paper_id"]] = paper
        if matches:
            return {
                "is_duplicate": True,
                "matched_by": level,
                "matches": list(matches.values()),
                "possible_matches": list(conflicts.values()),
                "note": "保留为发表事件候选；审核后应挂到已有 paper_id，不复制论文正文。",
            }
    possible: dict[str, dict[str, Any]] = {}
    for record in records:
        soft = soft_title_author_key(record.get("title"), record.get("authors"))
        if not soft:
            continue
        for paper in paper_index["soft_title"].get(soft, []):
            fields = conflicting_fields(paper, "title")
            possible[paper["paper_id"]] = {
                **paper,
                "reason": "strong_identifier_conflict" if fields else "same_title_author_different_year",
                "conflicting_fields": fields,
            }
    possible.update(conflicts)
    return {
        "is_duplicate": False,
        "matched_by": "none",
        "matches": [],
        "possible_matches": list(possible.values()),
        "note": (
            "存在标题/作者近似或强标识冲突，可能是预印本、会议版、期刊版或元数据错误，禁止自动合并。"
            if possible
            else "未按稳定标识或严格标题键命中已有论文。"
        ),
    }


def record_venue(record: dict[str, Any], catalog: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, str]:
    explicit = clean(record.get("explicit_venue_id"))
    if explicit:
        for venue in catalog:
            if venue.get("id") == explicit:
                return venue, "official-explicit"
    return match_venue(record.get("venue_hint"), catalog)


def confidence_for(
    records: list[dict[str, Any]],
    venues: list[dict[str, Any]],
    modes: list[str],
    directions: list[str],
) -> dict[str, Any]:
    ids = group_identifier_sets(records)
    reasons: list[str] = []
    score = 0.32
    if any(record.get("evidence_level") == "E1" for record in records):
        score += 0.22
        reasons.append("含官方论文库 E1 正式出版记录")
    else:
        reasons.append("目前只有 E4 聚合元数据线索")
    if ids["doi"]:
        score += 0.16
        reasons.append("含 DOI")
    elif ids["arxiv"]:
        score += 0.09
        reasons.append("含去版本 arXiv ID")
    if len({record.get("source") for record in records}) > 1:
        score += 0.12
        reasons.append("多个来源相互印证")
    if any(mode in {"exact", "full-name", "official-explicit"} for mode in modes):
        score += 0.1
        reasons.append("命中跟踪 venue 的完整名称或官方入口")
    elif venues:
        score += 0.05
        reasons.append("通过 venue 缩写匹配")
    if directions:
        score += 0.06
        reasons.append("标题或摘要命中 Atlas 技术方向")
    if all(record.get("date_precision") == "year" for record in records):
        score -= 0.08
        reasons.append("日期只有年份精度")
    if len({venue.get("id") for venue in venues}) > 1:
        score -= 0.2
        reasons.append("来源给出的 venue 冲突")
    if any(record.get("_dedupe_ambiguity") for record in records):
        score -= 0.18
        reasons.append("标题键命中多个冲突版本，未自动桥接")
    score = max(0.0, min(0.98, score))
    level = "high" if score >= 0.82 else "medium" if score >= 0.58 else "low"
    return {"level": level, "score": round(score, 2), "reason": "；".join(reasons)}


def promoted_evidence_level(records: list[dict[str, Any]]) -> str:
    sources = {clean(record.get("source")) for record in records}
    if any(record.get("evidence_level") == "E1" for record in records):
        return "E1"
    if {"Crossref", "DBLP"} <= sources:
        return "E3"
    return "E4"


def candidate_from_group(
    records: list[dict[str, Any]],
    catalog: list[dict[str, Any]],
    paper_index: dict[str, dict[str, list[dict[str, Any]]]],
    status_labels: dict[str, str],
) -> dict[str, Any] | None:
    venue_matches = [record_venue(record, catalog) for record in records]
    tracked = [(venue, mode) for venue, mode in venue_matches if venue is not None]
    if not tracked:
        return None
    tracked_venues: dict[str, dict[str, Any]] = {}
    modes: list[str] = []
    for venue, mode in tracked:
        tracked_venues[venue["id"]] = venue
        modes.append(mode)
    venues = list(tracked_venues.values())
    primary = sorted(
        records,
        key=lambda record: (
            0 if record.get("evidence_level") == "E1" else 1,
            0 if extract_doi((record.get("external_ids") or {}).get("doi")) else 1,
            0 if record.get("date_precision") == "day" else 1,
            clean(record.get("source")),
        ),
    )[0]
    directions = sorted(
        {
            direction
            for record in records
            for direction in classify_directions(record.get("title"), record.get("abstract"))
        }
    )
    if not directions:
        directions = sorted(
            {clean(record.get("category_hint")) for record in records if clean(record.get("category_hint")) in TOPICS}
        )
    identifiers = group_identifier_sets(records)
    duplicate = match_existing_papers(records, paper_index)
    confidence = confidence_for(records, venues, modes, directions)
    source_names = sorted({clean(record.get("source")) for record in records})
    venue = venues[0]
    venue_conflict = len(venues) > 1
    manual_review = [
        "确认论文确已收入该 venue，而非预印本、workshop、海报页面、勘误或元数据误配。",
        "核对标题、作者、DOI/arXiv 与正式出版页是否一致。",
        "确认方向标签与 Atlas 六类定义相符。",
    ]
    evidence_level = promoted_evidence_level(records)
    if evidence_level != "E1":
        manual_review.append("当前尚无 E1 正式出版证据；需回到出版方或官方 proceedings 核验。")
    if any(record.get("date_precision") != "day" for record in records):
        manual_review.append("日期精度不足；核对实际在线发表/会议日期是否落在本次回溯窗口。")
    if venue.get("venue_type") == "journal":
        manual_review.append("如需标注 SCI/SCIE，必须在 Clarivate Master Journal List 按当期结果人工核验。")
    if duplicate.get("is_duplicate") or duplicate.get("possible_matches"):
        manual_review.append("核对与已有 paper_id 的版本关系；只补 versions/venue 引用，不复制标题、摘要或导读正文。")
    if venue_conflict:
        manual_review.append("不同来源给出的 venue 冲突，禁止自动选择。")
    ambiguity_notes = sorted(
        {clean(record.get("_dedupe_ambiguity")) for record in records if clean(record.get("_dedupe_ambiguity"))}
    )
    if ambiguity_notes:
        manual_review.append("该记录可能桥接多个 DOI/arXiv 冲突版本，必须人工选择或保持独立。")
    strongest = next(iter(sorted(identifiers["doi"])), "")
    if not strongest:
        strongest = next(iter(sorted(identifiers["arxiv"])), "")
    if not strongest:
        strongest = next(iter(sorted(identifiers["platform"])), "")
    if not strongest:
        strongest = next(iter(sorted(identifiers["title"])), normalize(primary.get("title")))
    candidate_id = "academic-" + hashlib.sha256(strongest.encode("utf-8")).hexdigest()[:14]
    fact_sources = []
    for record in records:
        observed = [field for field in ("title", "authors", "published", "venue_hint") if record.get(field)]
        if extract_doi((record.get("external_ids") or {}).get("doi")):
            observed.append("doi")
        if extract_arxiv((record.get("external_ids") or {}).get("arxiv")):
            observed.append("arxiv")
        fact_sources.append(
            {
                "source": record.get("source"),
                "evidence_level": record.get("evidence_level"),
                "source_id": record.get("source_id"),
                "url": record.get("source_url") or (record.get("links") or {}).get("landing"),
                "observed_fields": observed,
            }
        )
    # 即使来自官方 proceedings，进入候选队列时仍只能是 needs_review；
    # 只有人工合并进 publication_events 后才能使用正式发表状态。
    publication_status = "needs_review"
    candidate_kind = (
        "已有论文的发表事件候选"
        if duplicate.get("is_duplicate")
        else "官方论文集新条目候选"
        if evidence_level == "E1"
        else "聚合元数据发表事件候选"
    )
    return {
        "id": candidate_id,
        "title": primary.get("title"),
        "authors": primary.get("authors") or next((record.get("authors") for record in records if record.get("authors")), []),
        "first_author": first_author(primary.get("authors") or next((record.get("authors") for record in records if record.get("authors")), [])),
        "published": primary.get("published"),
        "date_precision": primary.get("date_precision"),
        "venue": {
            "id": venue.get("id"),
            "name": venue.get("name"),
            "acronym": venue.get("acronym"),
            "type": venue.get("venue_type"),
            "tracking_priority": venue.get("tracking_priority"),
            "match_mode": modes[0] if modes else "unknown",
            "conflicting_matches": [
                {"id": item.get("id"), "name": item.get("name")} for item in venues[1:]
            ],
        },
        "directions": directions,
        "status": publication_status,
        "status_label": status_labels.get(publication_status, publication_status),
        "candidate_kind": candidate_kind,
        "evidence_level": evidence_level,
        "sources": source_names,
        "fact_sources": fact_sources,
        "external_ids": {
            "doi": sorted(value.removeprefix("doi:") for value in identifiers["doi"]),
            "platform": sorted(value.removeprefix("platform:") for value in identifiers["platform"]),
            "arxiv": sorted(value.removeprefix("arxiv:") for value in identifiers["arxiv"]),
        },
        "links": {
            "landing": next(((record.get("links") or {}).get("landing") for record in records if (record.get("links") or {}).get("landing")), ""),
            "doi": next(((record.get("links") or {}).get("doi") for record in records if (record.get("links") or {}).get("doi")), ""),
            "arxiv": next(((record.get("links") or {}).get("arxiv") for record in records if (record.get("links") or {}).get("arxiv")), ""),
        },
        "confidence": confidence,
        "duplicate_match": duplicate,
        "deduplication_notes": ambiguity_notes,
        "manual_review_required": True,
        "manual_review_items": manual_review,
        "source_record_count": len(records),
    }


def build_candidate_batch(
    raw_records: list[dict[str, Any]],
    papers: list[dict[str, Any]],
    tracker: dict[str, Any],
) -> dict[str, list[dict[str, Any]]]:
    catalog = venue_catalog(tracker)
    paper_index = build_paper_index(papers)
    event_index = build_publication_event_index(tracker)
    status_labels = {
        clean(status.get("id")): clean(status.get("label"))
        for status in tracker.get("publication_statuses", [])
        if isinstance(status, dict)
    }
    normalized_records = [record for record in raw_records if clean(record.get("title"))]
    candidates: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for group in merge_raw_records(normalized_records):
        candidate = candidate_from_group(group, catalog, paper_index, status_labels)
        if candidate is None:
            continue
        publication_match = match_publication_events(group, event_index)
        if publication_match["is_known"]:
            skipped.append(
                {
                    "title": candidate.get("title"),
                    "venue": candidate.get("venue"),
                    "sources": candidate.get("sources"),
                    "external_ids": candidate.get("external_ids"),
                    "publication_event_match": publication_match,
                }
            )
            continue
        candidate["publication_event_match"] = publication_match
        candidates.append(candidate)
    return {
        "candidates": sorted(
            candidates,
            key=lambda item: (clean(item.get("published")), clean(item.get("title"))),
            reverse=True,
        ),
        "skipped_authoritative_events": sorted(
            skipped,
            key=lambda item: clean(item.get("title")),
        ),
    }


def build_candidates(
    raw_records: list[dict[str, Any]],
    papers: list[dict[str, Any]],
    tracker: dict[str, Any],
) -> list[dict[str, Any]]:
    """Compatibility wrapper used by offline tests and small integrations."""
    return build_candidate_batch(raw_records, papers, tracker)["candidates"]


def load_fixture(path: Path) -> list[dict[str, Any]]:
    payload = load_json(path)
    records = payload.get("records") if isinstance(payload, dict) else payload
    if not isinstance(records, list):
        raise ValueError("fixture 必须是数组，或包含 records 数组")
    normalized: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise ValueError(f"fixture 第 {index + 1} 条不是对象")
        source = clean(record.get("source"))
        if source not in SOURCE_LEVELS:
            raise ValueError(f"fixture 第 {index + 1} 条 source 不受支持：{source}")
        normalized.append(
            canonical_record(
                source=source,
                source_id=record.get("source_id"),
                source_url=record.get("source_url"),
                title=record.get("title"),
                authors=record.get("authors"),
                published=record.get("published"),
                venue_hint=record.get("venue_hint"),
                abstract=record.get("abstract"),
                doi=(record.get("external_ids") or {}).get("doi"),
                arxiv=(record.get("external_ids") or {}).get("arxiv"),
                landing_url=(record.get("links") or {}).get("landing"),
                type_hint=record.get("type_hint"),
                category_hint=record.get("category_hint"),
                explicit_venue_id=record.get("explicit_venue_id"),
            )
        )
    return normalized


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    temporary.replace(path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成 Atlas 学术追踪待人工审核候选")
    parser.add_argument("--days", type=int, default=30, help="回溯天数，默认 30")
    parser.add_argument("--categories", nargs="+", choices=sorted(TOPICS), default=list(TOPICS), help="扫描方向")
    parser.add_argument("--sources", nargs="+", choices=sorted(PROVIDERS), default=list(PROVIDERS), help="启用来源")
    parser.add_argument("--per-query", type=int, default=20, help="每个查询最多读取条数，默认 20")
    parser.add_argument("--max-candidates", type=int, default=200, help="最终候选上限，默认 200")
    parser.add_argument("--mailto", default=os.getenv("OPENALEX_MAILTO", ""), help="Crossref/OpenAlex polite pool 邮箱")
    parser.add_argument("--fixture", type=Path, help="使用离线 records fixture，不访问网络")
    parser.add_argument("--dry-run", action="store_true", help="完成读取、去重与校验，但不写输出")
    return parser.parse_args()


def new_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": "AtlasAcademicTracker/1.0 (manual-review candidate collector)",
            "Accept": "application/json,text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        }
    )
    adapter = requests.adapters.HTTPAdapter(max_retries=2)
    session.mount("https://", adapter)
    return session


def main() -> int:
    args = parse_args()
    if not 1 <= args.days <= 365:
        print("--days 必须在 1 到 365 之间", file=sys.stderr)
        return 2
    if not 1 <= args.per_query <= 100:
        print("--per-query 必须在 1 到 100 之间", file=sys.stderr)
        return 2
    if not 1 <= args.max_candidates <= 1000:
        print("--max-candidates 必须在 1 到 1000 之间", file=sys.stderr)
        return 2
    try:
        papers = load_papers()
        tracker = load_tracker()
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"无法读取权威输入：{error}", file=sys.stderr)
        return 2

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=args.days)
    categories = list(dict.fromkeys(args.categories))
    raw_records: list[dict[str, Any]] = []
    source_status: list[dict[str, Any]] = []

    if args.fixture:
        try:
            raw_records = load_fixture(args.fixture.resolve())
        except (OSError, ValueError, json.JSONDecodeError) as error:
            print(f"无法读取离线 fixture：{error}", file=sys.stderr)
            return 2
        source_status.append(
            {
                "source": "offline-fixture",
                "state": "ready",
                "record_count": len(raw_records),
                "date_filter_precision": SOURCE_DATE_PRECISION["offline-fixture"],
                "warnings": [],
            }
        )
        run_state = "offline_fixture"
    else:
        session = new_session()
        for source in list(dict.fromkeys(args.sources)):
            fetcher = PROVIDERS[source]
            try:
                records, warnings = fetcher(
                    session,
                    categories,
                    start,
                    end,
                    args.per_query,
                    clean(args.mailto),
                    tracker,
                )
            except Exception as error:  # provider isolation: one source must not stop the run
                records, warnings = [], [f"未预期错误：{type(error).__name__}: {error}"]
            raw_records.extend(records)
            state = "partial" if records and warnings else "failed" if warnings else "ready"
            source_status.append(
                {
                    "source": source,
                    "state": state,
                    "record_count": len(records),
                    "date_filter_precision": SOURCE_DATE_PRECISION[source],
                    "warnings": warnings,
                }
            )
        failed_count = sum(item["state"] == "failed" for item in source_status)
        run_state = "failed" if failed_count == len(source_status) else "partial" if any(item["state"] != "ready" for item in source_status) else "ready"

    candidate_batch = build_candidate_batch(raw_records, papers, tracker)
    candidates = candidate_batch["candidates"][: args.max_candidates]
    skipped_authoritative = candidate_batch["skipped_authoritative_events"]
    raw_counts = Counter(clean(record.get("source")) for record in raw_records)
    payload = {
        "generated_at": end.isoformat(),
        "state": run_state,
        "window": {"days": args.days, "from": start.date().isoformat(), "to": end.date().isoformat()},
        "categories": categories,
        "manual_review_required": True,
        "warning_zh": (
            "这是半自动发现结果，不是录用、SCI/SCIE 索引或论文质量证明。"
            "人工核验后才能手动合并；脚本绝不修改 papers.json、academic_tracker.json 或模型主数据。"
        ),
        "read_only_inputs": ["data/papers.json", "data/academic_tracker.json"],
        "write_target": "data/academic_candidates.json",
        "deduplication_order": [
            "DOI",
            "去除 v1/v2 的 arXiv ID",
            "同一来源的平台 ID",
            "标准化标题 + 第一作者 + 年份",
        ],
        "candidate_id_order": [
            "DOI",
            "去除 v1/v2 的 arXiv ID",
            "同一来源的平台 ID",
            "标准化标题 + 第一作者 + 年份",
        ],
        "candidate_id_note": "平台 ID 参与同源去重，但候选 ID 优先使用 arXiv，以免某个聚合平台临时失败导致队列 ID 漂移。",
        "evidence_model": {
            "schema_version": tracker.get("schema_version"),
            "levels": [
                {"id": level.get("id"), "label": level.get("label")}
                for level in tracker.get("evidence_levels", [])
                if isinstance(level, dict)
            ],
            "promotion_rule": "官方论文库为 E1；Crossref 与 DBLP 同一候选相互印证时为 E3；单一聚合元数据为 E4。",
        },
        "date_precision_note": (
            "Crossref/OpenAlex 可按日过滤；DBLP 与官方 proceedings 常只提供年份，"
            "这类候选会明确标 date_precision=year，并要求人工确认是否落在实际回溯窗口。"
        ),
        "source_status": source_status,
        "raw_source_counts": dict(sorted(raw_counts.items())),
        "raw_record_count": len(raw_records),
        "candidate_count": len(candidates),
        "skipped_authoritative_event_count": len(skipped_authoritative),
        "skipped_authoritative_events": skipped_authoritative,
        "existing_paper_event_count": sum(
            bool(candidate.get("duplicate_match", {}).get("is_duplicate")) for candidate in candidates
        ),
        "candidates": candidates,
    }

    if args.dry_run:
        print(
            json.dumps(
                {
                    "dry_run": True,
                    "state": run_state,
                    "raw_source_counts": payload["raw_source_counts"],
                    "raw_record_count": payload["raw_record_count"],
                    "candidate_count": payload["candidate_count"],
                    "existing_paper_event_count": payload["existing_paper_event_count"],
                    "skipped_authoritative_event_count": payload["skipped_authoritative_event_count"],
                    "source_status": source_status,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    unreliable_empty = not raw_records and any(item["state"] != "ready" for item in source_status)
    if run_state == "failed" or unreliable_empty:
        if OUTPUT_PATH.exists():
            try:
                previous = load_json(OUTPUT_PATH)
            except (OSError, ValueError, json.JSONDecodeError):
                previous = None
            if isinstance(previous, dict):
                previous_candidates = previous.get("candidates")
                if isinstance(previous_candidates, list):
                    payload["candidates"] = previous_candidates
                    payload["candidate_count"] = len(previous_candidates)
                    payload["existing_paper_event_count"] = sum(
                        bool(candidate.get("duplicate_match", {}).get("is_duplicate"))
                        for candidate in previous_candidates
                        if isinstance(candidate, dict)
                    )
                    payload["previous_success_generated_at"] = previous.get("generated_at")
                    payload["state"] = "failed_preserved_previous"
        atomic_write_json(OUTPUT_PATH, payload)
        print(
            "学术来源本次不可可靠读取；已记录失败状态，并在可能时保留上次待审核队列。",
            file=sys.stderr,
        )
        return 1
    atomic_write_json(OUTPUT_PATH, payload)
    print(f"已生成 {OUTPUT_PATH}，共 {len(candidates)} 个待人工审核候选。")
    partial = [item for item in source_status if item["state"] != "ready"]
    if partial:
        print("部分来源失败或降级，详情已写入 source_status。", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
