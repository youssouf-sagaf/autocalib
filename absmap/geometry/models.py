"""Pixel-space slot model and source taxonomy — single source of truth.

``SlotSource`` is the fixed taxonomy for object lineage, critical for
per-path error analysis in the learning loop.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

__all__ = ["SlotSource", "PixelSlot"]


class SlotSource(str, Enum):
    """How a slot was generated — fixed taxonomy for CV error analysis."""

    yolo = "yolo"
    row_extension = "row_extension"
    gap_fill = "gap_fill"
    mask_recovery = "mask_recovery"
    auto_reprocess = "auto_reprocess"
    manual = "manual"


class PixelSlot(BaseModel):
    """Internal representation of an oriented parking slot in pixel space.

    Used during geometric post-processing.  Carries ``row_id`` for cluster
    bookkeeping and ``source`` for provenance tracking.
    """

    center_x: float
    center_y: float
    width: float
    """Shorter dimension (slot width along the row axis)."""
    height: float
    """Longer dimension (slot depth perpendicular to the row)."""
    angle_rad: float
    """Angle of the depth (long) axis in radians, normalized to [-pi/2, pi/2]."""
    confidence: float = Field(ge=0.0, le=1.0)
    class_id: int = 0
    source: SlotSource = SlotSource.yolo
    row_id: int | None = None

    model_config = ConfigDict(frozen=False)
