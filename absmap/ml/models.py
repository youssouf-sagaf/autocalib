"""ML output models — Pydantic, single source of truth.

These cross the ml/ → geometry/ and ml/ → pipeline/ layer boundaries.
"""

from __future__ import annotations

import math
from enum import Enum

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, field_validator

__all__ = [
    "SegmentationOutput",
    "SpotDetection",
    "DetectionResult",
]


class SegmentationOutput(BaseModel):
    """Binary parkable masks aligned with the input RGB image."""

    mask_raw: np.ndarray
    """Raw model output — uint8 (H, W), 0=background, 255=parkable."""
    mask_refined: np.ndarray
    """Post-processed (morphology + simplification) — uint8 (H, W)."""

    model_config = ConfigDict(arbitrary_types_allowed=True, frozen=True)

    @field_validator("mask_raw", "mask_refined")
    @classmethod
    def _validate_mask(cls, v: np.ndarray) -> np.ndarray:
        if v.ndim != 2:
            raise ValueError(f"Mask must be 2D, got shape {v.shape}")
        if v.dtype != np.uint8:
            raise ValueError(f"Mask must be uint8, got {v.dtype}")
        return v


class SpotDetection(BaseModel):
    """One oriented parking spot from a detector."""

    center_x: float
    center_y: float
    width: float
    height: float
    angle_rad: float
    confidence: float = Field(ge=0.0, le=1.0)
    class_id: int
    occupied: bool
    source: str = "yolo"

    model_config = ConfigDict(frozen=True)

    @property
    def corners(self) -> list[tuple[float, float]]:
        """Four corners of the oriented bounding box in pixel space."""
        hw, hh = self.width / 2.0, self.height / 2.0
        ct, st = math.cos(self.angle_rad), math.sin(self.angle_rad)
        offsets = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
        return [
            (self.center_x + dx * ct - dy * st,
             self.center_y + dx * st + dy * ct)
            for dx, dy in offsets
        ]


class DetectionResult(BaseModel):
    """Complete detection output for one image."""

    spots: list[SpotDetection]
    image_height: int
    image_width: int
    class_names: dict[int, str] = Field(
        default_factory=lambda: {0: "empty_slot", 1: "occupied_slot"},
    )

    model_config = ConfigDict(frozen=True)

    @property
    def num_occupied(self) -> int:
        return sum(1 for s in self.spots if s.occupied)

    @property
    def num_empty(self) -> int:
        return sum(1 for s in self.spots if not s.occupied)
