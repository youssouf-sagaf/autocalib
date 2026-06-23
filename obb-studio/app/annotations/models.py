"""Pydantic models for oriented bounding box annotations."""

from __future__ import annotations

import math

from pydantic import BaseModel, Field


class ObbAnnotation(BaseModel):
    """Single OBB in pixel coordinates (center, size, rotation)."""

    class_id: int = Field(ge=0)
    cx_px: float
    cy_px: float
    w_px: float = Field(gt=0)
    h_px: float = Field(gt=0)
    angle_rad: float = 0.0

    @property
    def area_px(self) -> float:
        return self.w_px * self.h_px

    @property
    def aspect_ratio(self) -> float:
        short_side = min(self.w_px, self.h_px)
        if short_side <= 0:
            return float("inf")
        return max(self.w_px, self.h_px) / short_side

    def corners_px(self) -> list[tuple[float, float]]:
        """Four corner points in image pixel space (before normalization)."""
        cos_a = math.cos(self.angle_rad)
        sin_a = math.sin(self.angle_rad)
        hw, hh = self.w_px / 2.0, self.h_px / 2.0
        local = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
        out: list[tuple[float, float]] = []
        for lx, ly in local:
            x = self.cx_px + lx * cos_a - ly * sin_a
            y = self.cy_px + lx * sin_a + ly * cos_a
            out.append((x, y))
        return out

    def to_yolo_obb_line(self, width: int, height: int) -> str:
        """YOLO-OBB: class + 8 normalized corner coords."""
        parts: list[str] = [str(self.class_id)]
        w = max(width, 1)
        h = max(height, 1)
        for x, y in self.corners_px():
            col = min(1.0, max(0.0, x / w))
            row = min(1.0, max(0.0, y / h))
            parts.append(f"{col:.6f}")
            parts.append(f"{row:.6f}")
        return " ".join(parts)
