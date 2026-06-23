"""Shared YOLO-OBB training defaults for OBB Studio."""

from __future__ import annotations

import re

# Ultralytics checkpoint name (see https://docs.ultralytics.com/models/yolo11/)
DEFAULT_YOLO_OBB_MODEL = "yolo11s-obb.pt"

_YOLO_OBB_NAME = re.compile(r"^yolo(\d+)([a-z])-obb$")


def yolo_model_display_name(weights: str) -> str:
    """Human-readable label, e.g. ``yolo11s-obb.pt`` → ``YOLO11s-OBB``."""
    stem = weights.removesuffix(".pt")
    match = _YOLO_OBB_NAME.match(stem)
    if match:
        return f"YOLO{match.group(1)}{match.group(2)}-OBB"
    if stem.endswith("-obb"):
        return f"{stem[: -len('-obb')].upper()}-OBB"
    return stem.upper()
