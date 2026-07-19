#!/usr/bin/env python3
"""把人工审核过的术语候选合并进 Atlas 术语表。

用法：python scripts/merge_glossary_candidates.py path/to/community_terms.json

输入文件必须是候选包，脚本只做字段映射、去重和来源合并；它不会联网，也不会
替候选做事实判断。候选包应先由人工核查来源和中文解释。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
GLOSSARY_PATH = ROOT / "data" / "glossary.json"

CATEGORY_MAP = {
    "robotics_vla": "vla",
    "world_video": "world_model",
    "detection": "detection",
    "segmentation": "segmentation",
    "multimodal": "multimodal",
    "training": "training",
    "inference_deployment": "deployment",
    "community_ecosystem": "community",
}

KIND_USAGE = {
    "formal": "论文、官方文档和技术实现里含义较稳定；仍要结合具体任务与指标口径。",
    "community": "社区帖子、Issue、Discussion、模型卡和教程里常见的简称或约定说法。",
    "slang": "明显口语化的圈内说法，适合帮助读懂交流，不应当作严格学术定义。",
    "ambiguous": "不同项目或说话者的含义可能不同，看到时必须连同上下文一起判断。",
}

# 只保留公开讨论 URL，不保存发帖者、评论者、头像或个人资料。
DISCUSSION_EVIDENCE: dict[str, list[tuple[str, str]]] = {
    "rollout": [
        ("GitHub Issue", "https://github.com/huggingface/lerobot/issues/4034"),
        ("GitHub Issue", "https://github.com/openvla/openvla/issues/7"),
    ],
    "teleop": [
        ("GitHub Issue", "https://github.com/huggingface/lerobot/issues/3740"),
        ("GitHub Issue", "https://github.com/huggingface/lerobot/issues/3131"),
    ],
    "confehreshold": [],
    "confthreshold": [
        ("GitHub Issue", "https://github.com/ultralytics/ultralytics/issues/1429"),
        ("GitHub Issue", "https://github.com/ultralytics/ultralytics/issues/189"),
    ],
    "amg": [
        ("GitHub Issue", "https://github.com/facebookresearch/segment-anything/issues/339"),
        ("GitHub Issue", "https://github.com/facebookresearch/segment-anything/issues/414"),
    ],
    "groundedsam": [
        ("GitHub Issue", "https://github.com/facebookresearch/segment-anything/issues/530"),
    ],
    "checkpointckpt": [
        ("GitHub Issue", "https://github.com/huggingface/transformers/issues/27925"),
        ("GitHub Issue", "https://github.com/huggingface/transformers/issues/9996"),
    ],
    "epochvsstep": [
        ("GitHub Issue", "https://github.com/huggingface/transformers/issues/9996"),
    ],
    "nanloss": [
        ("GitHub Issue", "https://github.com/huggingface/transformers/issues/11076"),
        ("GitHub Issue", "https://github.com/huggingface/transformers/issues/26498"),
    ],
    "ttft": [
        ("GitHub Issue", "https://github.com/vllm-project/vllm/issues/39790"),
        ("GitHub Issue", "https://github.com/vllm-project/vllm/issues/12568"),
    ],
    "tps": [
        ("GitHub Issue", "https://github.com/vllm-project/vllm/issues/7567"),
        ("GitHub Issue", "https://github.com/vllm-project/vllm/issues/12568"),
    ],
    "offload": [
        ("GitHub Issue", "https://github.com/huggingface/transformers/issues/9996"),
    ],
    "gguf": [
        ("GitHub Issue", "https://github.com/ggml-org/llama.cpp/issues/7062"),
        ("GitHub Issue", "https://github.com/ggml-org/llama.cpp/issues/25359"),
    ],
    "cudaoom": [
        ("GitHub Issue", "https://github.com/huggingface/transformers/issues/9996"),
        ("Hugging Face Discussion", "https://huggingface.co/lerobot/smolvla_base/discussions/14"),
    ],
    "modelidrepoid": [
        ("Hugging Face Discussion", "https://huggingface.co/lerobot/smolvla_base/discussions/2"),
    ],
    "smoltinynano": [
        ("Hugging Face Discussion", "https://huggingface.co/lerobot/smolvla_base/discussions/6"),
    ],
    "onnx": [
        ("Hugging Face Discussion", "https://huggingface.co/lerobot/smolvla_base/discussions/10"),
        ("GitHub Issue", "https://github.com/facebookresearch/segment-anything/issues/339"),
    ],
    "embodiment": [
        ("GitHub Issue", "https://github.com/NVIDIA/Isaac-GR00T/issues/214"),
        ("GitHub Issue", "https://github.com/NVIDIA/Isaac-GR00T/issues/650"),
    ],
}

EXISTING_META: dict[str, tuple[str, str, str]] = {
    "vla": ("vla", "OpenVLA 论文", "https://arxiv.org/abs/2406.09246"),
    "vlm": ("multimodal", "Hugging Face 文档", "https://huggingface.co/docs/transformers/tasks/image_text_to_text"),
    "world-model": ("world_model", "World Models 论文", "https://arxiv.org/abs/1803.10122"),
    "object-detection": ("detection", "MMDetection 文档", "https://mmdetection.readthedocs.io/en/latest/"),
    "bounding-box": ("detection", "COCO 评测", "https://cocodataset.org/#detection-eval"),
    "iou": ("evaluation", "COCO 评测", "https://cocodataset.org/#detection-eval"),
    "map": ("evaluation", "COCO 评测", "https://cocodataset.org/#detection-eval"),
    "nms": ("detection", "Torchvision 文档", "https://pytorch.org/vision/stable/generated/torchvision.ops.nms.html"),
    "anchor": ("detection", "Faster R-CNN 论文", "https://arxiv.org/abs/1506.01497"),
    "anchor-free": ("detection", "FCOS 论文", "https://arxiv.org/abs/1904.01355"),
    "transformer": ("basics", "Transformer 论文", "https://arxiv.org/abs/1706.03762"),
    "self-attention": ("basics", "Transformer 论文", "https://arxiv.org/abs/1706.03762"),
    "cross-attention": ("basics", "Hugging Face 术语表", "https://huggingface.co/docs/transformers/glossary"),
    "vit": ("representation", "Vision Transformer 论文", "https://arxiv.org/abs/2010.11929"),
    "token": ("basics", "Hugging Face 术语表", "https://huggingface.co/docs/transformers/glossary"),
    "embedding": ("representation", "Hugging Face 术语表", "https://huggingface.co/docs/transformers/glossary"),
    "contrastive-learning": ("representation", "CLIP 论文", "https://arxiv.org/abs/2103.00020"),
    "zero-shot": ("evaluation", "CLIP 论文", "https://arxiv.org/abs/2103.00020"),
    "open-vocabulary": ("detection", "Grounding DINO 论文", "https://arxiv.org/abs/2303.05499"),
    "grounding": ("multimodal", "Grounding DINO 论文", "https://arxiv.org/abs/2303.05499"),
    "semantic-segmentation": ("segmentation", "MMSegmentation 文档", "https://mmsegmentation.readthedocs.io/en/latest/"),
    "instance-segmentation": ("segmentation", "Mask R-CNN 论文", "https://arxiv.org/abs/1703.06870"),
    "panoptic-segmentation": ("segmentation", "Panoptic Segmentation 论文", "https://arxiv.org/abs/1801.00868"),
    "mask": ("segmentation", "Segment Anything 仓库", "https://github.com/facebookresearch/segment-anything"),
    "diffusion-model": ("world_model", "Hugging Face Diffusers 文档", "https://huggingface.co/docs/diffusers/index"),
    "imitation-learning": ("vla", "LeRobot 文档", "https://huggingface.co/docs/lerobot/index"),
    "behavior-cloning": ("vla", "LeRobot 文档", "https://huggingface.co/docs/lerobot/index"),
    "reinforcement-learning": ("training", "Hugging Face RL Course", "https://huggingface.co/learn/deep-rl-course/unit1/what-is-rl"),
    "action-chunking": ("vla", "ACT 论文", "https://arxiv.org/abs/2304.13705"),
    "mrope": ("multimodal", "Qwen2-VL 论文", "https://arxiv.org/abs/2409.12191"),
    "dynamic-resolution": ("multimodal", "Qwen2-VL 论文", "https://arxiv.org/abs/2409.12191"),
    "vision-projector": ("multimodal", "LLaVA 仓库", "https://github.com/haotian-liu/LLaVA"),
    "temporal-modeling": ("world_model", "V-JEPA 论文", "https://arxiv.org/abs/2404.08471"),
    "knowledge-distillation": ("training", "Distilling the Knowledge 论文", "https://arxiv.org/abs/1503.02531"),
    "feature-pyramid": ("detection", "FPN 论文", "https://arxiv.org/abs/1612.03144"),
    "moe": ("basics", "Hugging Face MoE 博客", "https://huggingface.co/blog/moe"),
    "q-former": ("multimodal", "BLIP-2 论文", "https://arxiv.org/abs/2301.12597"),
}


def normalized(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def slug(value: str) -> str:
    result = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return result[:72] or "term"


def strings(value: Any) -> list[str]:
    values = value if isinstance(value, list) else [] if value in (None, "") else [value]
    return [str(item).strip() for item in values if str(item).strip()]


def unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        key = value.strip().casefold()
        if value.strip() and key not in seen:
            seen.add(key)
            output.append(value.strip())
    return output


def term_keys(item: dict[str, Any]) -> set[str]:
    values = [item.get("term"), item.get("term_en"), *strings(item.get("aliases"))]
    keys = {normalized(value) for value in values if normalized(value)}
    for value in values:
        keys.update(normalized(match) for match in re.findall(r"\(([A-Za-z0-9+-]{2,12})\)", str(value or "")))
    return {key for key in keys if len(key) >= 2}


def source_pairs(item: dict[str, Any]) -> list[tuple[str, str]]:
    platforms = strings(item.get("source_platforms"))
    urls = strings(item.get("source_urls"))
    return list(zip(platforms, urls))


def set_sources(item: dict[str, Any], pairs: list[tuple[str, str]]) -> None:
    seen: set[str] = set()
    clean: list[tuple[str, str]] = []
    for platform, url in pairs:
        if not url.startswith(("https://", "http://")) or url in seen:
            continue
        seen.add(url)
        clean.append((platform or "公开来源", url))
    item["source_platforms"] = [pair[0] for pair in clean]
    item["source_urls"] = [pair[1] for pair in clean]


def convert(category: str, raw: dict[str, Any], used_ids: set[str]) -> dict[str, Any]:
    english = str(raw.get("term") or "unknown").strip()
    aliases = strings(raw.get("aliases"))
    chinese = next((alias for alias in aliases if re.search(r"[\u3400-\u9fff]", alias)), "")
    identifier = slug(english)
    suffix = 2
    while identifier in used_ids:
        identifier = f"{slug(english)}-{suffix}"
        suffix += 1
    used_ids.add(identifier)
    kind = str(raw.get("status") or "ambiguous").lower()
    if kind not in KIND_USAGE:
        kind = "ambiguous"
    source = raw.get("source") if isinstance(raw.get("source"), dict) else {}
    item = {
        "id": identifier,
        "term": chinese or english,
        "term_en": english,
        "aliases": unique([alias for alias in aliases if alias != chinese]),
        "category": CATEGORY_MAP.get(category, category),
        "kind": kind,
        "definition_zh": str(raw.get("explanation_zh") or "释义待复核。").strip(),
        "usage_zh": KIND_USAGE[kind],
        "example_zh": str(raw.get("usage_example") or "").strip(),
        "related_model_ids": [],
    }
    base_pairs = [(str(source.get("platform") or "公开来源"), str(source.get("url") or ""))]
    base_pairs.extend(DISCUSSION_EVIDENCE.get(normalized(english), []))
    set_sources(item, base_pairs)
    return item


def merge(existing: dict[str, Any], candidate: dict[str, Any]) -> None:
    existing["aliases"] = unique(strings(existing.get("aliases")) + strings(candidate.get("aliases")))
    existing.setdefault("category", candidate.get("category", "uncategorized"))
    existing.setdefault("kind", candidate.get("kind", "formal"))
    existing.setdefault("usage_zh", candidate.get("usage_zh", ""))
    existing.setdefault("example_zh", candidate.get("example_zh", ""))
    set_sources(existing, source_pairs(existing) + source_pairs(candidate))


def main() -> int:
    if len(sys.argv) != 2:
        print("用法: python scripts/merge_glossary_candidates.py <候选 JSON>", file=sys.stderr)
        return 2
    candidate_path = Path(sys.argv[1]).expanduser().resolve()
    package = json.loads(candidate_path.read_text(encoding="utf-8"))
    existing: list[dict[str, Any]] = json.loads(GLOSSARY_PATH.read_text(encoding="utf-8"))
    if not isinstance(package, dict) or not isinstance(package.get("categories"), list):
        raise ValueError("候选包缺少 categories")
    if not isinstance(existing, list):
        raise ValueError("data/glossary.json 必须是数组")

    used_ids = {str(item.get("id")) for item in existing}
    converted: list[dict[str, Any]] = []
    for group in package["categories"]:
        if not isinstance(group, dict):
            continue
        for raw in group.get("items", []):
            if isinstance(raw, dict):
                converted.append(convert(str(group.get("id") or "uncategorized"), raw, used_ids))

    merged_count = 0
    for candidate in converted:
        candidate_keys = term_keys(candidate)
        match = next((item for item in existing if term_keys(item) & candidate_keys), None)
        if match:
            merge(match, candidate)
            merged_count += 1
        else:
            existing.append(candidate)

    for item in existing:
        meta = EXISTING_META.get(str(item.get("id") or ""))
        if meta:
            category, platform, url = meta
            item.setdefault("category", category)
            item.setdefault("kind", "formal")
            item.setdefault("usage_zh", KIND_USAGE["formal"])
            set_sources(item, source_pairs(item) + [(platform, url)])
        else:
            item.setdefault("category", "uncategorized")
            item.setdefault("kind", "formal")
            item.setdefault("usage_zh", KIND_USAGE["formal"])

    existing.sort(key=lambda item: (str(item.get("category", "uncategorized")), str(item.get("term_en") or item.get("term") or "").casefold()))
    GLOSSARY_PATH.write_text(json.dumps(existing, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"候选 {len(converted)} 条；合并重复 {merged_count} 条；术语表现有 {len(existing)} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
