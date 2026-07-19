#!/usr/bin/env python3
"""Atlas 数据层构建脚本(仅标准库)。

数据架构:
- data/details/<id>.json  每个模型一个文件,唯一权威数据源(含分节详解/架构/代码)
- data/index.json         由本脚本从 details/ 生成的轻量索引,供列表、搜索、筛选、
                          谱系、时间线等页面一次性加载

首次运行时,如果 data/details/ 为空而旧的 data/models.json 存在,会先把它拆分成
per-model 文件,并把原文件归档到 data/archive/models-v1.json。

编辑或新增任何模型条目后,重新运行:
    python scripts/build_index.py
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DETAILS_DIR = ROOT / "data" / "details"
INDEX_PATH = ROOT / "data" / "index.json"
LEGACY_MODELS = ROOT / "data" / "models.json"
ARCHIVE = ROOT / "data" / "archive" / "models-v1.json"

# index.json 中保留的轻量字段;其余(key_idea_zh/sections/architecture/code 等)只在 details 中
INDEX_FIELDS = [
    "id", "name", "org", "country", "year", "paper_url", "github_url",
    "category", "sub_category", "one_liner_zh", "tags", "tier", "lineage_parent",
]


def dump(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1)
        handle.write("\n")


def migrate_if_needed() -> None:
    if not LEGACY_MODELS.exists():
        return
    existing = list(DETAILS_DIR.glob("*.json")) if DETAILS_DIR.exists() else []
    if existing:
        print(f"data/details/ 已有 {len(existing)} 个文件,跳过 models.json 拆分(如需重拆请先清空)")
        return
    models = json.loads(LEGACY_MODELS.read_text(encoding="utf-8"))
    if not isinstance(models, list):
        raise SystemExit("models.json 顶层必须是数组")
    DETAILS_DIR.mkdir(parents=True, exist_ok=True)
    for model in models:
        model.setdefault("sections", [])
        dump(DETAILS_DIR / f"{model['id']}.json", model)
    ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    LEGACY_MODELS.replace(ARCHIVE)
    print(f"已把 {len(models)} 个模型拆分到 data/details/,原文件归档为 {ARCHIVE.relative_to(ROOT)}")


def build_index() -> int:
    files = sorted(DETAILS_DIR.glob("*.json"))
    if not files:
        raise SystemExit("data/details/ 为空,没有可索引的模型")
    entries = []
    problems: list[str] = []
    seen: set[str] = set()
    for path in files:
        model = json.loads(path.read_text(encoding="utf-8"))
        model_id = model.get("id")
        if path.stem != model_id:
            problems.append(f"{path.name}: 文件名与 id “{model_id}” 不一致")
        if model_id in seen:
            problems.append(f"{path.name}: id 重复")
        seen.add(model_id)
        entry = {field: model.get(field, "unknown") for field in INDEX_FIELDS}
        citations = model.get("citations") or {}
        entry["citations"] = citations.get("count") if isinstance(citations.get("count"), int) else None
        entries.append(entry)
    entries.sort(key=lambda item: (str(item["category"]), str(item["id"])))
    if problems:
        print("构建失败:", *problems, sep="\n- ", file=sys.stderr)
        return 1
    dump(INDEX_PATH, entries)
    print(f"已生成 data/index.json:{len(entries)} 个模型({date.today().isoformat()})")
    return 0


if __name__ == "__main__":
    migrate_if_needed()
    raise SystemExit(build_index())
