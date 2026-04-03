"""Segmenter and Detector protocols — injectable, testable.

The pipeline depends only on these protocols.  Swap SegFormer for SAM,
YOLO-OBB for a different detector, or inject mocks for tests — zero
pipeline changes.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import numpy as np

from absmap.ml.models import DetectionResult, SegmentationOutput

__all__ = ["Segmenter", "Detector"]


@runtime_checkable
class Segmenter(Protocol):
    """Binary parkable mask prediction."""

    def predict(self, rgb_hwc: np.ndarray) -> SegmentationOutput:
        """Run segmentation on an (H, W, 3) uint8 RGB image."""
        ...


@runtime_checkable
class Detector(Protocol):
    """Oriented bounding box parking spot detection."""

    def predict(
        self,
        rgb_hwc: np.ndarray,
        *,
        parkable_mask: np.ndarray | None = None,
    ) -> DetectionResult:
        """Run detection on an (H, W, 3) uint8 RGB image.

        If *parkable_mask* is provided, spots whose center falls outside
        the mask may be discarded by the implementation.
        """
        ...
