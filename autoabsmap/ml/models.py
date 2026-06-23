"""ML output models — Pydantic, single source of truth.

These cross the ml/ → geometry/ and ml/ → pipeline/ layer boundaries.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    "SpotDetection",
    "DetectionResult",
]


class SpotDetection(BaseModel):
    """One oriented vehicle detection from SAM3 (mask-fit OBB)."""

    center_x: float
    center_y: float
    width: float
    height: float
    angle_rad: float = 0.0
    """Width-axis angle from the instance mask ``minAreaRect`` (0 if mask too sparse)."""
    confidence: float = Field(ge=0.0, le=1.0)
    class_id: int = 0
    is_fallback: bool = False
    """True when the OBB came from the axis-aligned xyxy bbox (mask too sparse
    or missing). Such detections have an unreliable orientation — downstream
    aggregations (row angle, prior) should exclude them when possible."""

    model_config = ConfigDict(frozen=True)


class DetectionResult(BaseModel):
    """Complete detection output for one image."""

    spots: list[SpotDetection]
    image_height: int
    image_width: int

    model_config = ConfigDict(frozen=True)
