"""YOLO-OBB validation wrapper."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def run_validation(
    weights: Path,
    data_yaml: Path,
    *,
    imgsz: int = 1024,
    device: str = "",
) -> dict[str, Any]:
    """Run ``YOLO.val`` and return serializable metrics."""
    from ultralytics import YOLO

    model = YOLO(str(weights))
    kwargs: dict[str, Any] = {"data": str(data_yaml), "imgsz": imgsz}
    if device:
        kwargs["device"] = device
    metrics = model.val(**kwargs)
    out: dict[str, Any] = {"weights": str(weights), "data_yaml": str(data_yaml)}
    if hasattr(metrics, "results_dict"):
        out["results"] = dict(metrics.results_dict)
    elif hasattr(metrics, "box"):
        out["map50"] = float(getattr(metrics.box, "map50", 0.0))
        out["map"] = float(getattr(metrics.box, "map", 0.0))
    logger.info("Validation finished for %s", weights)
    return out
