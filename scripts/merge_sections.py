#!/usr/bin/env python3
"""把撰写好的分节详解内容包合并进 data/details/<id>.json(仅标准库)。

用法:
    python scripts/merge_sections.py <pack.json> [pack2.json ...]

内容包格式(两种均可):
    { "<model-id>": [ {"title": "...", "body": "..."}, ... ] }
    { "<model-id>": { "sections": [...], "citations": {...}, ...其他要覆盖的字段 } }

只更新给出的字段,其余字段保持不变。合并后请运行 build_index.py(若改动了索引字段)。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DETAILS_DIR = ROOT / "data" / "details"


def merge_pack(pack_path: Path) -> tuple[int, list[str]]:
    pack = json.loads(pack_path.read_text(encoding="utf-8"))
    merged, problems = 0, []
    for model_id, payload in pack.items():
        detail_path = DETAILS_DIR / f"{model_id}.json"
        if not detail_path.exists():
            problems.append(f"{model_id}: data/details/ 下不存在该条目")
            continue
        model = json.loads(detail_path.read_text(encoding="utf-8"))
        updates = {"sections": payload} if isinstance(payload, list) else dict(payload)
        sections = updates.get("sections")
        if sections is not None:
            bad = [i for i, s in enumerate(sections) if not (isinstance(s, dict) and s.get("title") and s.get("body"))]
            if bad:
                problems.append(f"{model_id}: sections[{bad}] 缺 title/body")
                continue
        model.update(updates)
        with detail_path.open("w", encoding="utf-8") as handle:
            json.dump(model, handle, ensure_ascii=False, indent=1)
            handle.write("\n")
        merged += 1
    return merged, problems


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    total, all_problems = 0, []
    for arg in sys.argv[1:]:
        merged, problems = merge_pack(Path(arg))
        total += merged
        all_problems.extend(problems)
    print(f"已合并 {total} 个条目")
    if all_problems:
        print("问题:", *all_problems, sep="\n- ", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
