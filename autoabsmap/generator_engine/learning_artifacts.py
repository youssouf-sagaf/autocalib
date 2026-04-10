"""Optional per-crop payloads for the learning loop (no dependency on learning_loop)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from autoabsmap.export.models import GeoSlot

__all__ = ["CropLearningArtifacts"]


@dataclass
class CropLearningArtifacts:
    """RGB tile + seg mask + slots for SessionStore.save_crop_artifacts."""

    rgb_hwc: np.ndarray
    """H×W×C uint8 RGB."""
    segmentation_mask: np.ndarray
    """2D uint8 mask (same convention as pipeline: 0 / 255)."""
    crop_meta: dict[str, Any]
    """Keyword args compatible with :class:`autoabsmap.learning_loop.models.CropMeta`."""
    raw_detection_slots: list[GeoSlot]
    post_processed_slots: list[GeoSlot]
