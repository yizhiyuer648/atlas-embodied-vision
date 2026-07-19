#!/usr/bin/env python3
"""Atlas 本地结构与数据一致性检查（仅标准库，不联网）。

覆盖:
- data/details/*.json  每模型一个文件的主数据(字段/类别/谱系/A级架构代码/分节详解)
- data/index.json      轻量索引与 details 的一致性
- data/glossary.json   术语分类、来源与模型引用
- 已移除的学习页、Quiz 与相关运行时代码不会回流
- data/papers.json     论文库结构与中文导读覆盖率
- 页面文件、当前导航/搜索/趋势产品约束与便携安装文件完整性
"""

from __future__ import annotations

import ast
import hashlib
import json
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = {
    "vla": 30,
    "world": 25,
    "detection": 30,
    "representation": 18,
    "segmentation": 15,
    "multimodal": 12,
}
REQUIRED = {
    "id", "name", "org", "country", "year", "paper_url", "github_url",
    "category", "sub_category", "one_liner_zh", "key_idea_zh", "tags",
    "tier", "lineage_parent", "sections",
}
INDEX_FIELDS = [
    "id", "name", "org", "country", "year", "paper_url", "github_url",
    "category", "sub_category", "one_liner_zh", "tags", "tier", "lineage_parent",
]
PAGES = [
    "index.html", "explore.html", "model.html", "compare.html", "lineage.html",
    "timeline.html", "trends.html", "glossary.html", "radar.html", "reader.html", "venues.html",
]
GLOSSARY_KINDS = {"formal", "community", "slang", "ambiguous"}
ACADEMIC_VIEWS = {"journals", "conferences", "compare"}
ACADEMIC_PUBLICATION_STATUSES = {
    "preprint", "submitted", "accepted", "published_online",
    "proceedings_published", "issue_assigned", "needs_review", "unknown",
}
ACADEMIC_TOP_LEVEL_FIELDS = {
    "schema_version", "snapshot_date", "status_note", "editorial_policy",
    "paper_quality_framework",
    "publication_statuses", "evidence_levels", "platforms", "deduplication",
    "journals", "conferences", "publication_events", "comparison_dimensions",
    "direction_comparisons", "editorial_summaries", "editorial_summary",
}
ACADEMIC_COMMON_VENUE_FIELDS = {
    "id", "name", "acronym", "official_url", "library_url", "tracking_priority",
    "areas", "fact", "atlas_observation", "evidence_level",
}
ACADEMIC_PUBLICATION_EVENT_FIELDS = {
    "id", "work_id", "paper_id", "title", "category", "publication_type",
    "venue_id", "status", "event_date", "evidence_level", "source_label",
    "source_url", "fact_zh", "atlas_observation_zh", "methods", "model_ids",
    "versions", "last_verified",
}
ACADEMIC_FORBIDDEN_METRIC_KEY_FRAGMENTS = {
    "jcr", "quartile", "impactfactor", "acceptancerate", "caspartition",
    "分区", "影响因子", "录用率",
}
ACADEMIC_FACT_OPINION_MARKERS = {
    "适合", "优先", "建议", "值得", "更强", "领先", "顶级", "高质量",
}
ACADEMIC_CANDIDATE_ID_ORDER = [
    "DOI",
    "去除 v1/v2 的 arXiv ID",
    "同一来源的平台 ID",
    "标准化标题 + 第一作者 + 年份",
]
ACADEMIC_CANONICAL_KEY_ORDER = [
    "DOI（去除 https://doi.org/ 前缀并转小写）",
    "arXiv ID（去除版本号 v1/v2）",
    "Anthology / PMLR / DBLP / PII / OpenReview / 官方 proceedings ID",
    "规范化标题 + 第一作者 + 首次公开年份",
]
ACADEMIC_CANDIDATE_STATES = {
    "ready", "partial", "failed", "offline_fixture", "failed_preserved_previous",
}
REQUIRED_MODEL_IDS = {
    "vla": {
        "rt-1", "rt-2", "rt-x", "openvla", "pi0", "pi0-5", "act",
        "diffusion-policy", "octo", "groot-n1", "helix", "hpt", "palm-e",
        "rdt-1b", "gr-1", "gr-2", "roboflamingo", "cogact", "tinyvla",
        "dexvla", "spatialvla", "univla", "robomamba", "hirt",
        "agibot-go-1", "era-42", "galaxea-g0-5",
        "groot-n1-5", "groot-n1-6", "groot-n1-7",
        "qwen-vla",
    },
    "world": {
        "world-models", "dreamer", "dreamer-v2", "dreamer-v3", "genie-1",
        "genie-2", "genie-3", "sora", "v-jepa", "v-jepa-2", "muzero",
        "gaia-1", "gaia-2", "unisim", "cosmos", "kling", "vidu",
        "wan-2-1", "hunyuan-video", "emu3", "emu3-5",
        "xiaomi-robotics-u0", "pangu-world-model",
        "magicdrive", "drivedreamer", "vista-world-model",
    },
    "detection": {
        *(f"yolo-v{version}" for version in range(1, 14)), "yolo-v26", "yolox",
        "ssd", "faster-r-cnn", "retinanet", "detr", "deformable-detr",
        "efficientdet", "pp-yolo", "pp-yoloe", "damo-yolo", "rt-detr",
        "rtmdet", "nanodet", "dino-detr", "grounding-dino", "co-detr",
    },
    "representation": {
        "clip", "siglip", "siglip-2", "dinov2", "dinov3", "blip", "blip-2",
        "imagebind", "eva", "eva-clip", "chinese-clip", "internimage",
        "internvl", "align",
        "qwen3-vl-embedding-reranker",
    },
    "segmentation": {
        "sam", "sam-2", "sam-3", "sam-3-1", "mask-r-cnn", "segformer", "mask2former", "fastsam",
        "mobilesam", "sam-hq",
    },
    "multimodal": {
        "gpt-4v", "gemini-robotics", "qwen-vl", "qwen2-vl", "qwen2-5-vl",
        "internvl-chat", "internvl2-chat", "internvl3", "internvl3-5",
        "llava", "minigpt-4", "cogvlm",
        "deepseek-vl",
        "qwen3-vl", "qwen3-5", "qwen3-5-omni",
    },
}
REQUIRED_LINEAGE_PARENTS = {
    "qwen3-vl": "qwen2-5-vl",
    "qwen3-5": "qwen3-vl",
    "qwen3-5-omni": "qwen3-5",
    "qwen-vla": "qwen3-5",
    "qwen3-vl-embedding-reranker": "qwen3-vl",
    "emu3-5": "emu3",
    "xiaomi-robotics-u0": "emu3-5",
}


def read_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def normalize_identity(value):
    return re.sub(r"[\W_]+", "", str(value or "").strip().casefold(), flags=re.UNICODE)


def validate_url(value, label, errors):
    if value == "unknown":
        return
    parsed = urlparse(str(value))
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        errors.append(f"{label}: 不是有效 HTTP(S) 链接，也不是 unknown")


def iter_json_items(value, path="$"):
    """Yield every mapping key/value pair with a stable diagnostic path."""
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}"
            yield child_path, str(key), child
            yield from iter_json_items(child, child_path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from iter_json_items(child, f"{path}[{index}]")


def validate_academic_tracker(errors):
    """Validate the reviewed academic-tracking seed and its evidence contract."""
    path = ROOT / "data" / "academic_tracker.json"
    if not path.exists():
        errors.append("缺少 data/academic_tracker.json（学术追踪唯一数据源）")
        return None
    try:
        data = read_json(path)
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"data/academic_tracker.json: 无法解析：{exc}")
        return None
    if not isinstance(data, dict):
        errors.append("data/academic_tracker.json: 顶层必须是对象")
        return None

    missing_top = ACADEMIC_TOP_LEVEL_FIELDS - set(data)
    if missing_top:
        errors.append(f"academic_tracker: 缺顶层字段 {sorted(missing_top)}")
    if not isinstance(data.get("schema_version"), int) or data.get("schema_version", 0) < 1:
        errors.append("academic_tracker.schema_version: 必须是正整数")
    snapshot_date = data.get("snapshot_date")
    try:
        if not isinstance(snapshot_date, str):
            raise ValueError
        date.fromisoformat(snapshot_date)
    except ValueError:
        errors.append("academic_tracker.snapshot_date: 必须是有效 YYYY-MM-DD 日期")
    if not isinstance(data.get("status_note"), str) or not data.get("status_note", "").strip():
        errors.append("academic_tracker.status_note: 缺少核验时效说明")

    policy = data.get("editorial_policy")
    required_policy = {
        "purpose", "priority_note", "metric_policy", "fact_label", "observation_label",
    }
    if not isinstance(policy, dict):
        errors.append("academic_tracker.editorial_policy: 必须是对象")
        policy = {}
    missing_policy = required_policy - set(policy)
    if missing_policy:
        errors.append(f"academic_tracker.editorial_policy: 缺字段 {sorted(missing_policy)}")
    for field in required_policy:
        if not isinstance(policy.get(field), str) or not policy.get(field, "").strip():
            errors.append(f"academic_tracker.editorial_policy.{field}: 必须是非空文本")
    if policy.get("fact_label") == policy.get("observation_label"):
        errors.append("academic_tracker.editorial_policy: 事实与观察标签必须不同")
    if "事实" not in policy.get("fact_label", ""):
        errors.append("academic_tracker.editorial_policy.fact_label: 必须明确标示事实")
    if not any(word in policy.get("observation_label", "") for word in ("观察", "观点", "理解")):
        errors.append("academic_tracker.editorial_policy.observation_label: 必须明确标示观点/观察")
    priority_note = policy.get("priority_note", "")
    if "排名" not in priority_note or not any(word in priority_note for word in ("不是", "不代表", "并非")):
        errors.append("academic_tracker.editorial_policy.priority_note: 必须声明追踪优先级不是排名")
    metric_policy = policy.get("metric_policy", "")
    for keyword in ("JCR", "影响因子", "录用率", "待核验", "Clarivate"):
        if keyword.casefold() not in metric_policy.casefold():
            errors.append(f"academic_tracker.editorial_policy.metric_policy: 缺少边界词 {keyword}")
    if not any(word in metric_policy for word in ("不展示", "不记录", "不推断", "不得")):
        errors.append("academic_tracker.editorial_policy.metric_policy: 必须明确禁止静态指标猜测")

    quality = data.get("paper_quality_framework")
    if not isinstance(quality, dict):
        errors.append("academic_tracker.paper_quality_framework: 必须是对象")
        quality = {}
    for field in ("title", "boundary", "scoring_policy"):
        if not isinstance(quality.get(field), str) or not quality.get(field, "").strip():
            errors.append(f"academic_tracker.paper_quality_framework.{field}: 必须是非空文本")
    if "不等于论文质量" not in quality.get("boundary", ""):
        errors.append("academic_tracker.paper_quality_framework.boundary: 必须区分证据等级与论文质量")
    if "不汇总" not in quality.get("scoring_policy", ""):
        errors.append("academic_tracker.paper_quality_framework.scoring_policy: 必须禁止脱离条件的总分")
    labels = quality.get("result_labels")
    if not isinstance(labels, list) or set(labels) != {"证据充分", "证据部分", "暂不可判"}:
        errors.append("academic_tracker.paper_quality_framework.result_labels: 必须使用三档可解释结论")
    dimensions = quality.get("dimensions")
    seen_dimension_ids: set[str] = set()
    if not isinstance(dimensions, list) or len(dimensions) < 5:
        errors.append("academic_tracker.paper_quality_framework.dimensions: 至少需要 5 个判断维度")
    else:
        for index, dimension in enumerate(dimensions):
            where = f"academic_tracker.paper_quality_framework.dimensions[{index}]"
            if not isinstance(dimension, dict):
                errors.append(f"{where}: 必须是对象")
                continue
            for field in ("id", "label", "question", "caution"):
                if not isinstance(dimension.get(field), str) or not dimension.get(field, "").strip():
                    errors.append(f"{where}.{field}: 必须是非空文本")
            dimension_id = dimension.get("id")
            if dimension_id in seen_dimension_ids:
                errors.append(f"{where}.id: 重复 {dimension_id}")
            seen_dimension_ids.add(dimension_id)
            signals = dimension.get("signals")
            if not isinstance(signals, list) or len(signals) < 2 or not all(isinstance(item, str) and item.strip() for item in signals):
                errors.append(f"{where}.signals: 至少需要 2 个非空证据信号")

    publication_statuses = data.get("publication_statuses")
    publication_status_ids: set[str] = set()
    if not isinstance(publication_statuses, list) or not publication_statuses:
        errors.append("academic_tracker.publication_statuses: 必须是非空数组")
    else:
        for index, status in enumerate(publication_statuses):
            where = f"academic_tracker.publication_statuses[{index}]"
            if not isinstance(status, dict):
                errors.append(f"{where}: 必须是对象")
                continue
            if any(not isinstance(status.get(field), str) or not status.get(field, "").strip()
                   for field in ("id", "label", "definition")):
                errors.append(f"{where}: 必须提供非空 id/label/definition")
                continue
            status_id = status["id"]
            if status_id in publication_status_ids:
                errors.append(f"{where}: 重复状态 id {status_id}")
            publication_status_ids.add(status_id)
    if publication_status_ids != ACADEMIC_PUBLICATION_STATUSES:
        errors.append(
            "academic_tracker.publication_statuses: 必须完整覆盖 "
            f"{sorted(ACADEMIC_PUBLICATION_STATUSES)}，当前 {sorted(publication_status_ids)}"
        )

    evidence_levels = data.get("evidence_levels")
    evidence_ids: set[str] = set()
    if not isinstance(evidence_levels, list) or not evidence_levels:
        errors.append("academic_tracker.evidence_levels: 必须是非空数组")
    else:
        for index, level in enumerate(evidence_levels):
            where = f"academic_tracker.evidence_levels[{index}]"
            if not isinstance(level, dict):
                errors.append(f"{where}: 必须是对象")
                continue
            if any(not isinstance(level.get(field), str) or not level.get(field, "").strip()
                   for field in ("id", "label", "definition")):
                errors.append(f"{where}: 缺 id/label/definition")
                continue
            level_id = level["id"]
            if level_id in evidence_ids:
                errors.append(f"{where}: 重复证据等级 id {level_id}")
            evidence_ids.add(level_id)
    if evidence_ids != {"E1", "E2", "E3", "E4", "E5"}:
        errors.append("academic_tracker.evidence_levels: 必须完整使用 E1-E5 五级证据")

    platforms = data.get("platforms")
    platform_names: set[str] = set()
    if not isinstance(platforms, list) or not platforms:
        errors.append("academic_tracker.platforms: 必须是非空数组")
    else:
        for index, platform in enumerate(platforms):
            where = f"academic_tracker.platforms[{index}]"
            if not isinstance(platform, dict):
                errors.append(f"{where}: 必须是对象")
                continue
            for field in ("name", "url", "evidence_level", "role", "caveat"):
                if not isinstance(platform.get(field), str) or not platform.get(field, "").strip():
                    errors.append(f"{where}: 缺字段 {field}")
            name = platform.get("name")
            if name in platform_names:
                errors.append(f"{where}: 来源平台名称重复 {name}")
            platform_names.add(name)
            validate_url(platform.get("url"), f"{where}.url", errors)
            if platform.get("evidence_level") not in evidence_ids:
                errors.append(f"{where}: 未知 evidence_level {platform.get('evidence_level')}")

    venue_ids: set[str] = set()
    venue_ids_by_kind = {"journals": set(), "conferences": set()}
    for kind, owner_field in (("journals", "publisher"), ("conferences", "organizer")):
        entries = data.get(kind)
        if not isinstance(entries, list) or not entries:
            errors.append(f"academic_tracker.{kind}: 必须是非空数组")
            continue
        for index, item in enumerate(entries):
            where = f"academic_tracker.{kind}[{index}]"
            if not isinstance(item, dict):
                errors.append(f"{where}: 必须是对象")
                continue
            required = ACADEMIC_COMMON_VENUE_FIELDS | {owner_field}
            if kind == "journals":
                required.add("index_status")
            missing = required - set(item)
            if missing:
                errors.append(f"{where}: 缺字段 {sorted(missing)}")
            venue_id = item.get("id")
            if not isinstance(venue_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", venue_id):
                errors.append(f"{where}.id: 必须是小写 slug")
            elif venue_id in venue_ids:
                errors.append(f"{where}.id: 重复 id {venue_id}")
            else:
                venue_ids.add(venue_id)
                venue_ids_by_kind[kind].add(venue_id)
            for field in ("name", "acronym", owner_field, "tracking_priority", "fact", "atlas_observation"):
                if not isinstance(item.get(field), str) or not item.get(field, "").strip():
                    errors.append(f"{where}: 缺字段 {field}")
            if item.get("tracking_priority") not in {"核心追踪", "扩展追踪"}:
                errors.append(f"{where}.tracking_priority: 只能是核心追踪/扩展追踪")
            if kind == "journals" and item.get("index_status") != "待核验":
                errors.append(f"{where}.index_status: 必须保持“待核验”，不得缓存或猜测 SCI/JCR 状态")
            areas = item.get("areas")
            if not isinstance(areas, list) or not areas:
                errors.append(f"{where}.areas: 必须是非空数组")
            else:
                unknown_areas = sorted(set(areas) - set(CATEGORIES))
                if unknown_areas:
                    errors.append(f"{where}.areas: 未知类别 {unknown_areas}")
            validate_url(item.get("official_url"), f"{where}.official_url", errors)
            validate_url(item.get("library_url"), f"{where}.library_url", errors)
            if item.get("evidence_level") not in evidence_ids:
                errors.append(f"{where}: 未知 evidence_level {item.get('evidence_level')}")
            fact = item.get("fact", "")
            observation = item.get("atlas_observation", "")
            if fact.strip() == observation.strip() and fact.strip():
                errors.append(f"{where}: fact 与 atlas_observation 不得复用同一文本")
            opinion_markers = sorted(marker for marker in ACADEMIC_FACT_OPINION_MARKERS if marker in fact)
            if opinion_markers:
                errors.append(f"{where}.fact: 混入观点性措辞 {opinion_markers}，请移到 atlas_observation")

    publication_events = data.get("publication_events")
    event_ids: set[str] = set()
    publication_types: set[str] = set()
    if not isinstance(publication_events, list) or not publication_events:
        errors.append("academic_tracker.publication_events: 必须是非空数组")
    else:
        for index, event in enumerate(publication_events):
            where = f"academic_tracker.publication_events[{index}]"
            if not isinstance(event, dict):
                errors.append(f"{where}: 必须是对象")
                continue
            missing = ACADEMIC_PUBLICATION_EVENT_FIELDS - set(event)
            if missing:
                errors.append(f"{where}: 缺字段 {sorted(missing)}")
            forbidden_body_fields = sorted(set(event) & {"abstract", "abstract_zh", "intro_zh", "summary_zh"})
            if forbidden_body_fields:
                errors.append(f"{where}: 学术追踪不得复制论文正文/摘要字段 {forbidden_body_fields}")
            for field in (
                "id", "work_id", "paper_id", "title", "publication_type", "venue_id",
                "status", "event_date", "evidence_level", "source_label", "source_url",
                "fact_zh", "atlas_observation_zh", "last_verified",
            ):
                if not isinstance(event.get(field), str) or not event.get(field, "").strip():
                    errors.append(f"{where}: 缺非空文本字段 {field}")
            event_id = event.get("id")
            if not isinstance(event_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", event_id):
                errors.append(f"{where}.id: 必须是小写 slug")
            elif event_id in event_ids:
                errors.append(f"{where}.id: 重复 id {event_id}")
            else:
                event_ids.add(event_id)
            publication_type = event.get("publication_type")
            if publication_type not in {"journal", "conference"}:
                errors.append(f"{where}.publication_type: 只能是 journal/conference")
            else:
                publication_types.add(publication_type)
                expected_kind = "journals" if publication_type == "journal" else "conferences"
                if event.get("venue_id") not in venue_ids_by_kind[expected_kind]:
                    errors.append(f"{where}.venue_id: 与 publication_type 不匹配或不存在")
            if event.get("category") not in CATEGORIES:
                errors.append(f"{where}.category: 未知类别 {event.get('category')}")
            if event.get("status") not in publication_status_ids:
                errors.append(f"{where}.status: 未知发表状态 {event.get('status')}")
            if event.get("evidence_level") not in evidence_ids:
                errors.append(f"{where}.evidence_level: 未知证据等级 {event.get('evidence_level')}")
            event_date = event.get("event_date")
            if not isinstance(event_date, str) or not re.fullmatch(r"\d{4}(?:-\d{2}-\d{2})?", event_date):
                errors.append(f"{where}.event_date: 必须是 YYYY 或 YYYY-MM-DD")
            elif len(event_date) == 10:
                try:
                    date.fromisoformat(event_date)
                except ValueError:
                    errors.append(f"{where}.event_date: 不是有效日期")
            try:
                if not isinstance(event.get("last_verified"), str):
                    raise ValueError
                date.fromisoformat(event["last_verified"])
            except ValueError:
                errors.append(f"{where}.last_verified: 必须是有效 YYYY-MM-DD 日期")
            validate_url(event.get("source_url"), f"{where}.source_url", errors)
            if event.get("fact_zh", "").strip() == event.get("atlas_observation_zh", "").strip():
                errors.append(f"{where}: fact_zh 与 atlas_observation_zh 必须分离")
            methods = event.get("methods")
            if not isinstance(methods, list) or not methods or any(not isinstance(method, str) or not method.strip() for method in methods):
                errors.append(f"{where}.methods: 必须是非空文本数组")
            if not isinstance(event.get("model_ids"), list):
                errors.append(f"{where}.model_ids: 必须是数组")
            versions = event.get("versions")
            if not isinstance(versions, list) or not versions:
                errors.append(f"{where}.versions: 必须至少保留一个规范版本记录")
            else:
                for version_index, version in enumerate(versions):
                    version_where = f"{where}.versions[{version_index}]"
                    if not isinstance(version, dict) or any(
                        not isinstance(version.get(field), str) or not version.get(field, "").strip()
                        for field in ("kind", "identifier", "url")
                    ):
                        errors.append(f"{version_where}: 必须提供 kind/identifier/url")
                        continue
                    validate_url(version.get("url"), f"{version_where}.url", errors)
    if publication_types != {"journal", "conference"}:
        errors.append("academic_tracker.publication_events: 必须同时包含期刊与会议事件")

    comparisons = data.get("comparison_dimensions")
    if not isinstance(comparisons, list) or not comparisons:
        errors.append("academic_tracker.comparison_dimensions: 必须是非空数组")
    else:
        for index, item in enumerate(comparisons):
            where = f"academic_tracker.comparison_dimensions[{index}]"
            required = ("dimension", "journal_fact", "conference_fact", "atlas_observation")
            if not isinstance(item, dict) or any(not isinstance(item.get(field), str) or not item.get(field, "").strip() for field in required):
                errors.append(f"{where}: 必须分开提供 dimension/journal_fact/conference_fact/atlas_observation")
                continue
            if item["atlas_observation"].strip() in {item["journal_fact"].strip(), item["conference_fact"].strip()}:
                errors.append(f"{where}: 观察文本不得与事实列相同")

    directions = data.get("direction_comparisons")
    direction_categories: set[str] = set()
    if not isinstance(directions, list) or not directions:
        errors.append("academic_tracker.direction_comparisons: 必须是非空数组")
    else:
        for index, item in enumerate(directions):
            where = f"academic_tracker.direction_comparisons[{index}]"
            required = ("category", "label", "conference_watch", "journal_watch", "methods", "atlas_observation")
            if not isinstance(item, dict) or any(field not in item for field in required):
                errors.append(f"{where}: 缺方向对比字段")
                continue
            category = item.get("category")
            if category in direction_categories:
                errors.append(f"{where}: 重复 category {category}")
            direction_categories.add(category)
            if category not in CATEGORIES:
                errors.append(f"{where}: 未知 category {category}")
            for field in ("label", "conference_watch", "journal_watch", "atlas_observation"):
                if not isinstance(item.get(field), str) or not item.get(field, "").strip():
                    errors.append(f"{where}: 缺字段 {field}")
            if not isinstance(item.get("methods"), list) or not item.get("methods"):
                errors.append(f"{where}.methods: 必须是非空数组")
    if direction_categories != set(CATEGORIES):
        errors.append(f"academic_tracker.direction_comparisons: 必须覆盖六类，当前 {sorted(direction_categories)}")

    dedupe = data.get("deduplication")
    if not isinstance(dedupe, dict):
        errors.append("academic_tracker.deduplication: 必须是对象")
    else:
        for field in ("version_rule", "conflict_rule", "radar_boundary"):
            if not isinstance(dedupe.get(field), str) or not dedupe.get(field, "").strip():
                errors.append(f"academic_tracker.deduplication.{field}: 必须是非空文本")
        canonical = dedupe.get("canonical_key_order")
        if canonical != ACADEMIC_CANONICAL_KEY_ORDER:
            errors.append(
                "academic_tracker.deduplication.canonical_key_order: "
                "必须为 DOI → arXiv → platform → title"
            )
        boundary = dedupe.get("radar_boundary", "")
        if "论文雷达" not in boundary or "学术追踪" not in boundary:
            errors.append("academic_tracker.deduplication.radar_boundary: 必须明确论文雷达与学术追踪的分工")
        if "人工审核" not in dedupe.get("conflict_rule", ""):
            errors.append("academic_tracker.deduplication.conflict_rule: 冲突必须进入人工审核")

    summary = data.get("editorial_summary")
    if not isinstance(summary, dict):
        errors.append("academic_tracker.editorial_summary: 必须是对象")
    else:
        for field in ("title", "fact", "interpretation"):
            if not isinstance(summary.get(field), str) or not summary.get(field, "").strip():
                errors.append(f"academic_tracker.editorial_summary.{field}: 必须是非空文本")
        if summary.get("fact", "").strip() == summary.get("interpretation", "").strip():
            errors.append("academic_tracker.editorial_summary: fact 与 interpretation 必须分离")
        if not isinstance(summary.get("next_watch"), list) or not summary.get("next_watch"):
            errors.append("academic_tracker.editorial_summary.next_watch: 必须是非空数组")

    view_summaries = data.get("editorial_summaries")
    if not isinstance(view_summaries, dict):
        errors.append("academic_tracker.editorial_summaries: 必须是对象")
    else:
        missing_views = ACADEMIC_VIEWS - set(view_summaries)
        if missing_views:
            errors.append(f"academic_tracker.editorial_summaries: 缺视图 {sorted(missing_views)}")
        fact_texts = []
        interpretation_texts = []
        for view in sorted(ACADEMIC_VIEWS):
            view_summary = view_summaries.get(view)
            where = f"academic_tracker.editorial_summaries.{view}"
            if not isinstance(view_summary, dict):
                errors.append(f"{where}: 必须是对象")
                continue
            for field in ("title", "fact", "interpretation"):
                if not isinstance(view_summary.get(field), str) or not view_summary.get(field, "").strip():
                    errors.append(f"{where}.{field}: 必须是非空文本")
            if not isinstance(view_summary.get("next_watch"), list) or not view_summary.get("next_watch"):
                errors.append(f"{where}.next_watch: 必须是非空数组")
            fact_texts.append(view_summary.get("fact", "").strip())
            interpretation_texts.append(view_summary.get("interpretation", "").strip())
        if len(fact_texts) == len(ACADEMIC_VIEWS) and len(set(fact_texts)) != len(fact_texts):
            errors.append("academic_tracker.editorial_summaries: 三视图 fact 不得复制同一模板")
        if len(interpretation_texts) == len(ACADEMIC_VIEWS) and len(set(interpretation_texts)) != len(interpretation_texts):
            errors.append("academic_tracker.editorial_summaries: 三视图 interpretation 不得复制同一模板")

    metric_claim_patterns = (
        r"\bJCR\s*(?:Q\s*)?[1-4]\b",
        r"(?:中科院|CAS|JCR)[^。；\n]{0,16}(?:[1-4一二三四]\s*区|Q\s*[1-4])",
        r"(?:影响因子|impact\s*factor)[^。；\n]{0,20}\b\d+(?:\.\d+)?\b",
        r"(?:录用率|acceptance\s*rate)[^。；\n]{0,20}\b\d+(?:\.\d+)?\s*%",
    )
    for item_path, key, value in iter_json_items(data):
        normalized_key = re.sub(r"[\s_-]+", "", key).casefold()
        if any(fragment.casefold() in normalized_key for fragment in ACADEMIC_FORBIDDEN_METRIC_KEY_FRAGMENTS):
            errors.append(f"{item_path}: 禁止保存 JCR/分区/影响因子/录用率静态字段")
        if isinstance(value, str):
            matched = [pattern for pattern in metric_claim_patterns if re.search(pattern, value, re.I)]
            if matched:
                errors.append(f"{item_path}: 含未经动态核验的排名或指标数值")

    return data


def validate_candidate_boundary(errors):
    """Candidates may exist, but must remain explicitly non-authoritative."""
    path = ROOT / "data" / "candidates.json"
    if not path.exists():
        return None
    try:
        data = read_json(path)
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"data/candidates.json: 无法解析：{exc}")
        return None
    if not isinstance(data, dict):
        errors.append("data/candidates.json: 顶层必须是带人工审核声明的对象")
        return None
    if data.get("manual_review_required") is not True:
        errors.append("data/candidates.json: manual_review_required 必须为 true")
    warning = data.get("warning_zh", "")
    for phrase in ("候选", "人工审核", "不修改"):
        if phrase not in warning:
            errors.append(f"data/candidates.json.warning_zh: 缺少非权威边界词 {phrase}")
    candidates = data.get("candidates")
    if not isinstance(candidates, list):
        errors.append("data/candidates.json.candidates: 必须是数组")
        return None
    if data.get("count") != len(candidates):
        errors.append(f"data/candidates.json.count: {data.get('count')} 与实际 {len(candidates)} 不一致")
    for key in ("verified_records", "authoritative_records", "approved_records", "models"):
        if data.get(key):
            errors.append(f"data/candidates.json.{key}: 候选文件不得包含权威/已批准记录集合")

    source_ids: set[str] = set()
    authoritative_flags = {
        "verified", "is_verified", "authoritative", "is_authoritative",
        "approved", "is_approved", "human_verified", "official",
    }
    authoritative_statuses = {"verified", "approved", "authoritative", "official", "accepted"}
    required = {
        "title", "source", "source_id", "org_guess", "links", "matched_category",
        "confidence", "confidence_reason", "manual_review_required",
    }
    for index, candidate in enumerate(candidates):
        where = f"candidates[{index}]"
        if not isinstance(candidate, dict):
            errors.append(f"{where}: 必须是对象")
            continue
        missing = required - set(candidate)
        if missing:
            errors.append(f"{where}: 缺字段 {sorted(missing)}")
        if candidate.get("manual_review_required") is not True:
            errors.append(f"{where}: manual_review_required 必须为 true")
        if candidate.get("confidence") not in {"low", "medium", "high"}:
            errors.append(f"{where}.confidence: 只能是 low/medium/high")
        if not isinstance(candidate.get("confidence_reason"), str) or not candidate.get("confidence_reason", "").strip():
            errors.append(f"{where}.confidence_reason: 缺置信度说明")
        if candidate.get("matched_category") not in CATEGORIES:
            errors.append(f"{where}.matched_category: 未知类别 {candidate.get('matched_category')}")
        if not isinstance(candidate.get("links"), dict) or not candidate.get("links"):
            errors.append(f"{where}.links: 必须保留至少一个来源链接字段")
        source_id = candidate.get("source_id")
        if not isinstance(source_id, str) or not source_id.strip():
            errors.append(f"{where}.source_id: 必须是非空来源 ID")
        elif source_id in source_ids:
            errors.append(f"{where}.source_id: 重复候选来源 ID {source_id}")
        else:
            source_ids.add(source_id)
        if "tier" in candidate:
            errors.append(f"{where}.tier: 候选不得使用权威模型 A/B tier")
        for flag in authoritative_flags:
            if candidate.get(flag):
                errors.append(f"{where}.{flag}: 候选不得标记为已核验/权威")
        status = str(candidate.get("status", "")).strip().casefold()
        if status in authoritative_statuses:
            errors.append(f"{where}.status: 候选不得使用权威状态 {status}")
    return len(candidates)


def expected_academic_candidate_id(candidate):
    external = candidate.get("external_ids")
    if not isinstance(external, dict):
        return None
    dois = sorted(
        str(value).strip().casefold().removeprefix("doi:")
        for value in external.get("doi", [])
        if isinstance(value, str) and value.strip()
    )
    arxivs = sorted(
        re.sub(r"v\d+$", "", str(value).strip().casefold().removeprefix("arxiv:"))
        for value in external.get("arxiv", [])
        if isinstance(value, str) and value.strip()
    )
    platforms = sorted(
        str(value).strip().casefold().removeprefix("platform:")
        for value in external.get("platform", [])
        if isinstance(value, str) and value.strip()
    )
    if dois:
        strongest = f"doi:{dois[0]}"
    elif arxivs:
        strongest = f"arxiv:{arxivs[0]}"
    elif platforms:
        strongest = f"platform:{platforms[0]}"
    else:
        year_match = re.search(r"(?:19|20)\d{2}", str(candidate.get("published", "")))
        title = normalize_identity(candidate.get("title"))
        author = normalize_identity(candidate.get("first_author"))
        if not title or not author or not year_match:
            return None
        strongest = f"title:{title}|author:{author}|year:{year_match.group(0)}"
    digest = hashlib.sha256(strongest.encode("utf-8")).hexdigest()[:14]
    return f"academic-{digest}"


def validate_academic_candidate_boundary(errors, tracker):
    """Validate the non-authoritative academic publication review queue."""
    path = ROOT / "data" / "academic_candidates.json"
    if not path.exists():
        errors.append("缺少 data/academic_candidates.json（学术发表待审核队列）")
        return None
    try:
        data = read_json(path)
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"data/academic_candidates.json: 无法解析：{exc}")
        return None
    if not isinstance(data, dict):
        errors.append("data/academic_candidates.json: 顶层必须是对象")
        return None

    if data.get("manual_review_required") is not True:
        errors.append("academic_candidates.manual_review_required: 必须为 true")
    warning = str(data.get("warning_zh", ""))
    for phrase in ("人工核验", "不修改"):
        if phrase not in warning:
            errors.append(f"academic_candidates.warning_zh: 缺少非权威边界词 {phrase}")
    if data.get("write_target") != "data/academic_candidates.json":
        errors.append("academic_candidates.write_target: 只能是 data/academic_candidates.json")
    read_only_inputs = data.get("read_only_inputs")
    if not isinstance(read_only_inputs, list) or not {
        "data/papers.json", "data/academic_tracker.json",
    } <= set(read_only_inputs):
        errors.append("academic_candidates.read_only_inputs: 必须声明 papers 与 academic_tracker 只读")
    if data.get("candidate_id_order") != ACADEMIC_CANDIDATE_ID_ORDER:
        errors.append("academic_candidates.candidate_id_order: 必须为 DOI → arXiv → platform → title")
    if data.get("deduplication_order") != ACADEMIC_CANDIDATE_ID_ORDER:
        errors.append("academic_candidates.deduplication_order: 必须为 DOI → arXiv → platform → title")
    state = data.get("state")
    if state not in ACADEMIC_CANDIDATE_STATES:
        errors.append(f"academic_candidates.state: 未知状态 {state}")

    raw_counts = data.get("raw_source_counts")
    if not isinstance(raw_counts, dict) or any(
        not isinstance(name, str) or not name.strip() or not isinstance(count, int) or count < 0
        for name, count in (raw_counts or {}).items()
    ):
        errors.append("academic_candidates.raw_source_counts: 必须是来源到非负整数的映射")
        raw_total = None
    else:
        raw_total = sum(raw_counts.values())
        if data.get("raw_record_count") != raw_total:
            errors.append(
                f"academic_candidates.raw_record_count: {data.get('raw_record_count')} 与来源合计 {raw_total} 不一致"
            )

    source_status = data.get("source_status")
    status_total = 0
    if not isinstance(source_status, list) or not source_status:
        errors.append("academic_candidates.source_status: 必须是非空数组")
        source_status = []
    seen_source_status: set[str] = set()
    for index, item in enumerate(source_status):
        where = f"academic_candidates.source_status[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{where}: 必须是对象")
            continue
        source = item.get("source")
        if not isinstance(source, str) or not source.strip() or source in seen_source_status:
            errors.append(f"{where}.source: 必须是唯一非空来源")
        else:
            seen_source_status.add(source)
        if item.get("state") not in {"ready", "partial", "failed"}:
            errors.append(f"{where}.state: 必须为 ready/partial/failed")
        count = item.get("record_count")
        if not isinstance(count, int) or count < 0:
            errors.append(f"{where}.record_count: 必须是非负整数")
        else:
            status_total += count
        if not isinstance(item.get("warnings"), list):
            errors.append(f"{where}.warnings: 必须是数组")
    if raw_total is not None and status_total != raw_total:
        errors.append(f"academic_candidates.source_status: record_count 合计 {status_total} 与 raw {raw_total} 不一致")
    if state == "ready" and any(item.get("state") != "ready" for item in source_status if isinstance(item, dict)):
        errors.append("academic_candidates.state=ready 时所有来源状态也必须为 ready")

    candidates = data.get("candidates")
    if not isinstance(candidates, list):
        errors.append("academic_candidates.candidates: 必须是数组")
        return None
    if data.get("candidate_count") != len(candidates):
        errors.append(
            f"academic_candidates.candidate_count: {data.get('candidate_count')} 与实际 {len(candidates)} 不一致"
        )
    skipped = data.get("skipped_authoritative_events")
    if not isinstance(skipped, list):
        errors.append("academic_candidates.skipped_authoritative_events: 必须是数组")
        skipped = []
    if data.get("skipped_authoritative_event_count") != len(skipped):
        errors.append("academic_candidates.skipped_authoritative_event_count 与数组长度不一致")

    evidence_ids = {
        level.get("id")
        for level in (tracker or {}).get("evidence_levels", [])
        if isinstance(level, dict)
    }
    status_labels = {
        item.get("id"): item.get("label")
        for item in (tracker or {}).get("publication_statuses", [])
        if isinstance(item, dict)
    }
    venue_ids = {
        venue.get("id")
        for key in ("journals", "conferences")
        for venue in (tracker or {}).get(key, [])
        if isinstance(venue, dict)
    }
    candidate_ids: set[str] = set()
    duplicate_event_count = 0
    authoritative_flags = {
        "verified", "is_verified", "authoritative", "is_authoritative",
        "approved", "is_approved", "human_verified", "official",
    }
    required = {
        "id", "title", "authors", "first_author", "published", "date_precision",
        "venue", "directions", "status", "status_label", "candidate_kind",
        "evidence_level", "sources", "fact_sources", "external_ids", "links",
        "confidence", "duplicate_match", "publication_event_match",
        "manual_review_required", "manual_review_items",
    }
    for index, candidate in enumerate(candidates):
        where = f"academic_candidates.candidates[{index}]"
        if not isinstance(candidate, dict):
            errors.append(f"{where}: 必须是对象")
            continue
        missing = required - set(candidate)
        if missing:
            errors.append(f"{where}: 缺字段 {sorted(missing)}")
        candidate_id = candidate.get("id")
        if not isinstance(candidate_id, str) or not re.fullmatch(r"academic-[0-9a-f]{14}", candidate_id):
            errors.append(f"{where}.id: 格式错误")
        elif candidate_id in candidate_ids:
            errors.append(f"{where}.id: 重复 {candidate_id}")
        else:
            candidate_ids.add(candidate_id)
        expected_id = expected_academic_candidate_id(candidate)
        if expected_id is None:
            errors.append(f"{where}.id: 无法从 DOI/arXiv/platform/title 回算稳定 ID")
        elif candidate_id != expected_id:
            errors.append(f"{where}.id: {candidate_id} 不符合 DOI→arXiv→platform→title，预期 {expected_id}")
        if candidate.get("manual_review_required") is not True:
            errors.append(f"{where}.manual_review_required: 必须为 true")
        if candidate.get("status") != "needs_review":
            errors.append(f"{where}.status: 候选始终只能是 needs_review")
        if candidate.get("status_label") != status_labels.get("needs_review"):
            errors.append(f"{where}.status_label: 必须对应 tracker 的 needs_review")
        if candidate.get("evidence_level") not in evidence_ids:
            errors.append(f"{where}.evidence_level: 不在 tracker 证据模型中")
        venue = candidate.get("venue")
        if not isinstance(venue, dict) or venue.get("id") not in venue_ids:
            errors.append(f"{where}.venue: 必须命中受跟踪 venue")
        directions = candidate.get("directions")
        if not isinstance(directions, list) or not directions or any(item not in CATEGORIES for item in directions):
            errors.append(f"{where}.directions: 必须是非空六类方向子集")
        sources = candidate.get("sources")
        if not isinstance(sources, list) or not sources or any(source not in (raw_counts or {}) for source in sources):
            errors.append(f"{where}.sources: 必须来自 raw_source_counts")
        facts = candidate.get("fact_sources")
        if not isinstance(facts, list) or not facts:
            errors.append(f"{where}.fact_sources: 必须保留事实来源")
        else:
            for fact_index, fact in enumerate(facts):
                fact_where = f"{where}.fact_sources[{fact_index}]"
                if not isinstance(fact, dict) or fact.get("source") not in (sources or []):
                    errors.append(f"{fact_where}.source: 必须属于候选来源")
                    continue
                if fact.get("evidence_level") not in evidence_ids:
                    errors.append(f"{fact_where}.evidence_level: 不在 tracker 证据模型中")
                validate_url(fact.get("url", ""), f"{fact_where}.url", errors)
        confidence = candidate.get("confidence")
        if not isinstance(confidence, dict):
            errors.append(f"{where}.confidence: 必须是对象")
        else:
            if confidence.get("level") not in {"low", "medium", "high"}:
                errors.append(f"{where}.confidence.level: 非法")
            score = confidence.get("score")
            if not isinstance(score, (int, float)) or not 0 <= score <= 1:
                errors.append(f"{where}.confidence.score: 必须在 0-1")
            if not isinstance(confidence.get("reason"), str) or not confidence.get("reason", "").strip():
                errors.append(f"{where}.confidence.reason: 必须非空")
        duplicate_match = candidate.get("duplicate_match")
        if not isinstance(duplicate_match, dict) or not isinstance(duplicate_match.get("is_duplicate"), bool):
            errors.append(f"{where}.duplicate_match: 结构错误")
        elif duplicate_match.get("is_duplicate"):
            duplicate_event_count += 1
        publication_match = candidate.get("publication_event_match")
        if not isinstance(publication_match, dict) or publication_match.get("is_known") is not False:
            errors.append(f"{where}.publication_event_match: 已确认事件不得进入候选队列")
        if not isinstance(candidate.get("manual_review_items"), list) or not candidate.get("manual_review_items"):
            errors.append(f"{where}.manual_review_items: 必须是非空数组")
        if "tier" in candidate:
            errors.append(f"{where}.tier: 候选不得进入权威层级")
        for flag in authoritative_flags:
            if candidate.get(flag):
                errors.append(f"{where}.{flag}: 候选不得标记权威")
    if data.get("existing_paper_event_count") != duplicate_event_count:
        errors.append(
            f"academic_candidates.existing_paper_event_count: {data.get('existing_paper_event_count')} "
            f"与实际 {duplicate_event_count} 不一致"
        )
    for index, item in enumerate(skipped):
        match = item.get("publication_event_match") if isinstance(item, dict) else None
        if not isinstance(match, dict) or match.get("is_known") is not True:
            errors.append(f"academic_candidates.skipped_authoritative_events[{index}]: 必须带已确认事件匹配")
    return len(candidates)


def validate_academic_updater_write_boundary(errors):
    path = ROOT / "scripts" / "update_academic.py"
    if not path.exists():
        errors.append("缺少 scripts/update_academic.py")
        return
    source = path.read_text(encoding="utf-8")
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        errors.append(f"scripts/update_academic.py: Python 语法错误 {exc}")
        return
    output_assignment_ok = False
    atomic_calls = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "OUTPUT_PATH" for target in node.targets
        ):
            expression = ast.get_source_segment(source, node.value) or ""
            if '"data" / "academic_candidates.json"' in expression:
                output_assignment_ok = True
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "atomic_write_json":
            atomic_calls += 1
            if not node.args or not isinstance(node.args[0], ast.Name) or node.args[0].id != "OUTPUT_PATH":
                errors.append("scripts/update_academic.py: atomic_write_json 只能接收 OUTPUT_PATH")
    if not output_assignment_ok:
        errors.append("scripts/update_academic.py: OUTPUT_PATH 必须固定为 data/academic_candidates.json")
    if atomic_calls < 1:
        errors.append("scripts/update_academic.py: 缺少候选原子写入")
    if re.search(r"add_argument\(\s*['\"]--output", source):
        errors.append("scripts/update_academic.py: 不得开放任意输出路径参数")
    direct_write_calls = re.findall(r"\.open\(\s*['\"]([wax])", source)
    if direct_write_calls != ["w"]:
        errors.append("scripts/update_academic.py: 除原子候选临时文件外不得直接写其他文件")
    strongest_pattern = re.compile(
        r'identifiers\["doi"\].*?identifiers\["arxiv"\].*?'
        r'identifiers\["platform"\].*?identifiers\["title"\]',
        re.S,
    )
    if not strongest_pattern.search(source):
        errors.append("scripts/update_academic.py: candidate_id 顺序必须为 DOI→arXiv→platform→title")


def main() -> int:
    errors: list[str] = []
    details_dir = ROOT / "data" / "details"
    if not details_dir.exists():
        print("缺少 data/details/ 目录", file=sys.stderr)
        return 1
    models = [read_json(path) for path in sorted(details_dir.glob("*.json"))]
    if not 120 <= len(models) <= 200:
        errors.append(f"模型总数应在 120-200，当前 {len(models)}")

    ids: set[str] = set()
    counts = Counter()
    a_counts = Counter()
    section_chars = 0
    for model in models:
        where = f"details/{model.get('id', '?')}"
        missing = REQUIRED - set(model)
        if missing:
            errors.append(f"{where}: 缺字段 {sorted(missing)}")
        model_id = model.get("id")
        if not model_id or model_id in ids:
            errors.append(f"{where}: id 为空或重复")
        ids.add(model_id)
        category = model.get("category")
        if category not in CATEGORIES:
            errors.append(f"{where}: 未知 category {category}")
        counts[category] += 1
        tier = model.get("tier")
        if tier not in {"A", "B"}:
            errors.append(f"{where}: tier 只能是 A/B")
        if not isinstance(model.get("tags"), list):
            errors.append(f"{where}: tags 必须是数组")
        validate_url(model.get("paper_url"), f"{where}.paper_url", errors)
        validate_url(model.get("github_url"), f"{where}.github_url", errors)
        sections = model.get("sections")
        if not isinstance(sections, list) or not sections:
            errors.append(f"{where}: 缺少分节详解 sections")
        else:
            for i, section in enumerate(sections):
                if not (isinstance(section, dict) and section.get("title") and section.get("body")):
                    errors.append(f"{where}: sections[{i}] 缺 title/body")
                else:
                    section_chars += len(section["body"])
        citations = model.get("citations")
        if citations is not None and not isinstance(citations.get("count"), int):
            errors.append(f"{where}: citations.count 必须是整数")
        if tier == "A":
            a_counts[category] += 1
            architecture = model.get("architecture")
            code = model.get("code")
            if not architecture or not architecture.get("modules") or not architecture.get("edges"):
                errors.append(f"{where}: A 级缺少完整 architecture")
            else:
                module_ids = {module.get("id") for module in architecture["modules"]}
                for edge in architecture["edges"]:
                    if edge.get("from") not in module_ids or edge.get("to") not in module_ids:
                        errors.append(f"{where}: architecture edge 引用了不存在的模块")
            if not code:
                errors.append(f"{where}: A 级缺少 code")
            else:
                lines = code.get("lines") or []
                if not 15 <= len(lines) <= 40:
                    errors.append(f"{where}: A 级代码应为 15-40 行，当前 {len(lines)}")
                if not code.get("simplified"):
                    errors.append(f"{where}: code.simplified 必须为 true")
                if not code.get("source_repo") or not code.get("source_path"):
                    errors.append(f"{where}: code 缺来源仓库或文件路径")
                for line_index, line in enumerate(lines):
                    if not isinstance(line, dict) or not line.get("code") or not line.get("comment_zh"):
                        errors.append(f"{where}: code.lines[{line_index}] 缺代码或逐行中文注释")

    for scope, required_ids in REQUIRED_MODEL_IDS.items():
        category_ids = {model["id"] for model in models if model.get("category") == scope}
        missing_required = sorted(required_ids - category_ids)
        if missing_required:
            errors.append(f"必收模型缺失（{scope}）：{missing_required}")

    for category, minimum in CATEGORIES.items():
        if counts[category] < minimum:
            errors.append(f"{category}: 至少 {minimum} 条，当前 {counts[category]}")
        if a_counts[category] != 4:
            errors.append(f"{category}: A 级必须恰好 4 条，当前 {a_counts[category]}")
    for model in models:
        parent = model.get("lineage_parent")
        if parent != "unknown" and parent not in ids:
            errors.append(f"{model.get('id')}: lineage_parent {parent} 不存在")
    model_by_id = {model["id"]: model for model in models}
    for model_id, expected_parent in REQUIRED_LINEAGE_PARENTS.items():
        model = model_by_id.get(model_id)
        if model and model.get("lineage_parent") != expected_parent:
            errors.append(
                f"{model_id}: 已核实版本线父节点应为 {expected_parent}，"
                f"当前为 {model.get('lineage_parent')}"
            )
    for model in models:
        seen: set[str] = set()
        cursor = model
        while cursor.get("lineage_parent") != "unknown":
            parent_id = cursor.get("lineage_parent")
            if parent_id in seen or parent_id == model["id"]:
                errors.append(f"{model['id']}: 谱系存在环")
                break
            seen.add(parent_id)
            parent = model_by_id.get(parent_id)
            if not parent:
                break
            if isinstance(parent.get("year"), int) and isinstance(cursor.get("year"), int) and parent["year"] > cursor["year"]:
                errors.append(f"{cursor['id']}: 父节点 {parent_id} 年份晚于子节点")
                break
            cursor = parent

    index_path = ROOT / "data" / "index.json"
    if not index_path.exists():
        errors.append("缺少 data/index.json（运行 python scripts/build_index.py）")
    else:
        index = read_json(index_path)
        if len(index) != len(models):
            errors.append(f"index.json 有 {len(index)} 条，details 有 {len(models)} 条，请重新构建索引")
        by_id = {model["id"]: model for model in models}
        for entry in index:
            source = by_id.get(entry.get("id"))
            if source is None:
                errors.append(f"index/{entry.get('id')}: details 中不存在")
                continue
            for field in INDEX_FIELDS:
                if entry.get(field) != source.get(field, "unknown"):
                    errors.append(f"index/{entry['id']}: 字段 {field} 与 details 不一致，请重新构建索引")
                    break

    glossary = read_json(ROOT / "data" / "glossary.json")
    if len(glossary) < 100:
        errors.append(f"术语表至少 100 条，当前 {len(glossary)}")
    glossary_ids: set[str] = set()
    for term in glossary:
        where = f"glossary/{term.get('id', '?')}"
        if not term.get("id") or term.get("id") in glossary_ids:
            errors.append(f"{where}: id 为空或重复")
        glossary_ids.add(term.get("id"))
        for field in ("term", "term_en", "definition_zh", "category", "kind"):
            if not term.get(field):
                errors.append(f"{where}: 缺字段 {field}")
        if term.get("kind") not in GLOSSARY_KINDS:
            errors.append(f"{where}: kind 必须是 {sorted(GLOSSARY_KINDS)}")
        platforms = term.get("source_platforms")
        source_urls = term.get("source_urls")
        if not isinstance(platforms, list) or not isinstance(source_urls, list) or not source_urls:
            errors.append(f"{where}: 缺公开来源")
        elif len(platforms) != len(source_urls):
            errors.append(f"{where}: source_platforms 与 source_urls 数量不一致")
        else:
            for index, url in enumerate(source_urls):
                validate_url(url, f"{where}.source_urls[{index}]", errors)
        for model_id in term.get("related_model_ids", []):
            if model_id not in ids:
                errors.append(f"{where}: related_model_id {model_id} 不存在")

    papers_path = ROOT / "data" / "papers.json"
    papers_note = "论文库未生成"
    if papers_path.exists():
        library = read_json(papers_path)
        papers = library.get("papers", [])
        if len(papers) < 100:
            errors.append(f"论文库应至少 100 篇，当前 {len(papers)}")
        with_intro = 0
        for paper in papers:
            if not paper.get("id") or not paper.get("title") or not paper.get("category"):
                errors.append(f"papers/{paper.get('id', '?')}: 缺 id/title/category")
            if paper.get("category") not in CATEGORIES:
                errors.append(f"papers/{paper.get('id')}: 未知 category {paper.get('category')}")
            if paper.get("intro_zh"):
                with_intro += 1
        papers_note = f"{len(papers)} 篇（{with_intro} 篇有中文导读）"
        if papers and with_intro < len(papers) * 0.9:
            errors.append(f"论文中文导读覆盖率过低：{with_intro}/{len(papers)}")

    academic_data = validate_academic_tracker(errors)
    candidate_count = validate_candidate_boundary(errors)
    academic_candidate_count = validate_academic_candidate_boundary(errors, academic_data)
    validate_academic_updater_write_boundary(errors)

    css_versions = set()
    app_versions = set()
    page_sources = {}
    for page in PAGES:
        page_path = ROOT / page
        if not page_path.exists():
            errors.append(f"缺少页面 {page}")
            continue
        html = page_path.read_text(encoding="utf-8")
        page_sources[page] = html
        if "academic_candidates.json" in html.casefold():
            errors.append(f"{page}: 学术候选文件不得作为页面权威数据源")
        if re.search(r"<(?:script|link)\b[^>]*(?:src|href)=[\"']https?://", html, re.I):
            errors.append(f"{page}: 存在外部 CDN/运行时资源")
        css_match = re.search(r"assets/css/main\.css\?v=([^\"']+)", html)
        app_match = re.search(r"assets/js/app\.js\?v=([^\"']+)", html)
        if not css_match:
            errors.append(f"{page}: 缺少带版本号的 main.css")
        else:
            css_versions.add(css_match.group(1))
        if not app_match:
            errors.append(f"{page}: 缺少带版本号的 app.js")
        else:
            app_versions.add(app_match.group(1))
    if len(css_versions) > 1:
        errors.append(f"页面 main.css 版本号不一致：{sorted(css_versions)}")
    if len(app_versions) > 1:
        errors.append(f"页面 app.js 版本号不一致：{sorted(app_versions)}")

    portable_paths = [
        ROOT / "安装每日优化循环.bat",
        ROOT / "迁移到新电脑.md",
        ROOT / "scripts" / "install_daily_automation.ps1",
        ROOT / ".codex" / "portable-automation-prompt.txt",
        ROOT / ".codex" / "atlas-maintenance-state.json",
    ]
    for portable_path in portable_paths:
        if not portable_path.exists():
            errors.append(f"缺少便携日更文件 {portable_path.relative_to(ROOT)}")
    removed_paths = [
        ROOT / "learn.html",
        ROOT / "assets" / "js" / "pages" / "learn.js",
        ROOT / "data" / "learning_paths.json",
        ROOT / "quiz.html",
        ROOT / "assets" / "js" / "pages" / "quiz.js",
    ]
    for removed_path in removed_paths:
        if removed_path.exists():
            errors.append(f"{removed_path.relative_to(ROOT)} 应已删除")
    runtime_paths = [ROOT / "assets" / "css" / "main.css", *sorted((ROOT / "assets" / "js").rglob("*.js"))]
    forbidden_runtime_fragments = ("quiz", "learn.html", "learning_paths.json", "atlas:learning", "data-learning")
    for runtime_path in runtime_paths:
        runtime = runtime_path.read_text(encoding="utf-8").casefold()
        found = [fragment for fragment in forbidden_runtime_fragments if fragment in runtime]
        if found:
            errors.append(f"{runtime_path.relative_to(ROOT)}: 仍含已删除功能的运行时代码或样式 {found}")
        if "data/candidates.json" in runtime:
            errors.append(f"{runtime_path.relative_to(ROOT)}: 候选文件不得作为页面运行时权威数据源")
        if "academic_candidates.json" in runtime:
            errors.append(f"{runtime_path.relative_to(ROOT)}: 学术候选文件不得作为页面运行时权威数据源")

    core_path = ROOT / "assets" / "js" / "core.js"
    core = core_path.read_text(encoding="utf-8") if core_path.exists() else ""
    for required_href in ("explore.html", "radar.html", "venues.html", "lineage.html", "timeline.html", "trends.html", "glossary.html"):
        if required_href not in core:
            errors.append(f"assets/js/core.js: 主导航缺少 {required_href}")
    nav_match = re.search(
        r"function\s+navMarkup\(page\)\s*\{(.*?)\n\}\n\nfunction\s+footerMarkup",
        core,
        re.S,
    )
    footer_match = re.search(
        r"function\s+footerMarkup\(\)\s*\{(.*?)\n\}\n\nexport\s+async\s+function\s+setupShell",
        core,
        re.S,
    )
    if not nav_match:
        errors.append("assets/js/core.js: 无法定位 navMarkup 主导航")
    if not footer_match:
        errors.append("assets/js/core.js: 无法定位 footerMarkup 页脚")
    nav_source = nav_match.group(1) if nav_match else ""
    footer_source = footer_match.group(1) if footer_match else ""
    for shell_name, shell_source in (("主导航", nav_source), ("页脚", footer_source)):
        if "venues.html" not in shell_source or "学术追踪" not in shell_source:
            errors.append(f"assets/js/core.js: {shell_name}缺少学术追踪入口")
        if re.search(r"learn(?:\.html)?|[>\"']\s*学习(?:路径)?\s*[<\"']", shell_source, re.I):
            errors.append(f"assets/js/core.js: {shell_name}不得恢复 learn/学习入口")
    if core.count("data-search-submit") < 2:
        errors.append("assets/js/core.js: 桌面与移动搜索必须都有明确搜索按钮")
    if re.search(r"<kbd[^>]*>\s*/\s*</kbd>|event\.key\s*===?\s*['\"]\/['\"]", core, re.I):
        errors.append("assets/js/core.js: 不得恢复斜杠快捷键或提示")
    if "data-favorite-count" not in core or "favoriteTotal || ''" not in core:
        errors.append("assets/js/core.js: 收藏空态必须隐藏零值，只显示收藏标签")

    home = page_sources.get("index.html", "")
    if "data-search-submit" not in home:
        errors.append("index.html: Hero 搜索缺少明确搜索按钮")

    venues_html = page_sources.get("venues.html", "")
    if 'data-page="venues"' not in venues_html:
        errors.append('venues.html: body 必须声明 data-page="venues"')
    for element_id in (
        "academic-view-tabs", "academic-overview", "academic-content",
        "academic-method", "academic-sources",
    ):
        if f'id="{element_id}"' not in venues_html:
            errors.append(f"venues.html: 缺少三视图运行所需容器 #{element_id}")
    if 'href="radar.html"' not in venues_html:
        errors.append("venues.html: 必须保留返回论文雷达的边界链接")

    venues_runtime_path = ROOT / "assets" / "js" / "pages" / "venues.js"
    if not venues_runtime_path.exists():
        errors.append("缺少 assets/js/pages/venues.js")
        venues_runtime = ""
    else:
        venues_runtime = venues_runtime_path.read_text(encoding="utf-8")
    if "data/academic_tracker.json" not in venues_runtime:
        errors.append("assets/js/pages/venues.js: 必须只读 data/academic_tracker.json")
    if "candidates.json" in venues_runtime.casefold():
        errors.append("assets/js/pages/venues.js: 不得把 candidates.json 当作学术权威数据")
    if "URLSearchParams(location.search)" not in venues_runtime or ".get('view')" not in venues_runtime:
        errors.append("assets/js/pages/venues.js: 缺少 ?view= URL 直达解析")
    if "venues.html?view=${key}" not in venues_runtime:
        errors.append("assets/js/pages/venues.js: 三个视图必须输出可分享的 ?view= URL")
    for view in sorted(ACADEMIC_VIEWS):
        if not re.search(rf"\b{re.escape(view)}\s*:", venues_runtime):
            errors.append(f"assets/js/pages/venues.js: 缺少学术追踪视图 {view}")
    for separation_token in (
        "item.fact", "item.atlas_observation", "journal_fact", "conference_fact",
        "event.fact_zh", "event.atlas_observation_zh", "publication_statuses",
        "fact_label", "observation_label", "paper_quality_framework",
        "result_labels", "scoring_policy",
    ):
        if separation_token not in venues_runtime:
            errors.append(f"assets/js/pages/venues.js: 事实/观点分离渲染缺少 {separation_token}")

    trend_runtime = "\n".join([
        page_sources.get("trends.html", ""),
        (ROOT / "assets" / "js" / "pages" / "trends.js").read_text(encoding="utf-8"),
        (ROOT / "assets" / "js" / "pages" / "home.js").read_text(encoding="utf-8"),
    ])
    forbidden_trend_fragments = ("国产占比", "开源比例", "国产与开源可验证性", "可验证性", "ratio-chart", "drawratios")
    found_trends = [fragment for fragment in forbidden_trend_fragments if fragment.casefold() in trend_runtime.casefold()]
    if found_trends:
        errors.append(f"趋势运行时仍含已移除指标：{found_trends}")
    for required_chart in ('id="release-chart"', 'id="category-chart"'):
        if required_chart not in page_sources.get("trends.html", ""):
            errors.append(f"trends.html: 缺少中性统计图 {required_chart}")

    if errors:
        print(f"校验失败，共 {len(errors)} 项：", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Atlas 数据校验通过")
    print(f"- 模型：{len(models)} 条 / " + " / ".join(f"{key} {counts[key]}" for key in CATEGORIES))
    print(f"- A 级：{sum(a_counts.values())} 条（每类 4）；分节详解共约 {section_chars} 字")
    print(f"- 论文库：{papers_note}；术语：{len(glossary)} 条；页面：{len(PAGES)} 个")
    if academic_data:
        print(
            f"- 学术追踪：{len(academic_data.get('journals', []))} 期刊 / "
            f"{len(academic_data.get('conferences', []))} 会议 / "
            f"{len(academic_data.get('publication_events', []))} 条发表事件 / "
            f"{len(ACADEMIC_VIEWS)} 个 URL 视图"
        )
    if candidate_count is not None:
        print(f"- 待审候选：{candidate_count} 条（全部保持 manual_review_required）")
    if academic_candidate_count is not None:
        print(f"- 学术发表待审候选：{academic_candidate_count} 条（全部为 needs_review）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
