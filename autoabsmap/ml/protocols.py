"""Detector protocol — injectable, testable.

The pipeline depends only on this protocol.  Swap SAM3 for a different
detector, or inject mocks for tests — zero pipeline changes.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import numpy as np

from autoabsmap.ml.models import DetectionResult

__all__ = ["Detector"]


@runtime_checkable
class Detector(Protocol):
    """Vehicle detection — axis-aligned bboxes from SAM3."""

    def predict(
        self,
        rgb_hwc: np.ndarray,
        *,
        parkable_mask: np.ndarray | None = None,
    ) -> DetectionResult:
        """Run detection on an (H, W, 3) uint8 RGB image.

        If *parkable_mask* is provided, detections whose center falls outside
        the mask may be discarded by the implementation.
        """
        ...
