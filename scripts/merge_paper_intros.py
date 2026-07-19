#!/usr/bin/env python3
"""把中文导读内容包合并进 data/papers.json(仅标准库)。

用法:
    python scripts/merge_paper_intros.py <pack.json> [pack2.json ...]

内容包格式: { "<arxiv-id>": "中文导读文本", ... }
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAPERS = ROOT / "data" / "papers.json"


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    data = json.loads(PAPERS.read_text(encoding="utf-8"))
    by_id = {p["id"]: p for p in data["papers"]}
    merged, unknown = 0, []
    for arg in sys.argv[1:]:
        pack = json.loads(Path(arg).read_text(encoding="utf-8"))
        for pid, intro in pack.items():
            if pid in by_id and isinstance(intro, str) and intro.strip():
                by_id[pid]["intro_zh"] = intro.strip()
                merged += 1
            else:
                unknown.append(pid)
    with PAPERS.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=1)
        handle.write("\n")
    missing = sum(1 for p in data["papers"] if not p.get("intro_zh"))
    print(f"已合并 {merged} 条导读;仍缺 {missing} 条")
    if unknown:
        print("未匹配 id:", ", ".join(unknown), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
