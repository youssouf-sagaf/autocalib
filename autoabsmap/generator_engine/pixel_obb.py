"""Shared OBB math in pixel space — one convention for the whole pipeline.

Detector outputs are fixed by :func:`detections_to_pixel_slots` /
``_normalize_slot_geometry`` (``PixelSlot`` centre, ``width`` < ``height``,
``angle_rad`` = width / row-axis). That geometry is **not** overridden by the
geometric post-process; synthesis stages (gap-fill, extension, recovery)
derive their ``angle_rad`` and size from row / YOLO aggregates so boxes stay
parallel to and consistent with detections.

The long side (depth) lies at ``angle_rad + π/2``. This matches the Ultralytics corner
remap in ``stages._normalize_slot_geometry`` and must be used everywhere we
build rectangle corners — otherwise mixed conventions skew overlays.
"""

from __future__ import annotations

import math

import numpy as np

__all__ = [
    "pixel_obb_corner_points",
    "pixel_obb_corners_float",
    "pixel_obb_corners_int",
    "mean_width_axis_angle",
]


def pixel_obb_corner_points(
    center_x: float,
    center_y: float,
    width: float,
    height: float,
    angle_rad: float,
) -> list[tuple[float, float]]:
    """Four polygon vertices (CCW), corners of the oriented slot in pixels."""
    depth_angle = angle_rad + math.pi / 2.0
    hvx = math.cos(depth_angle) * (height / 2.0)
    hvy = math.sin(depth_angle) * (height / 2.0)
    wvx = -math.sin(depth_angle) * (width / 2.0)
    wvy = math.cos(depth_angle) * (width / 2.0)
    cx, cy = center_x, center_y
    return [
        (cx + hvx + wvx, cy + hvy + wvy),
        (cx - hvx + wvx, cy - hvy + wvy),
        (cx - hvx - wvx, cy - hvy - wvy),
        (cx + hvx - wvx, cy + hvy - wvy),
    ]


def pixel_obb_corners_float(
    center_x: float,
    center_y: float,
    width: float,
    height: float,
    angle_rad: float,
) -> np.ndarray:
    """Float32 (4, 2) corner array for ``cv2.intersectConvexConvex``."""
    pts = pixel_obb_corner_points(center_x, center_y, width, height, angle_rad)
    return np.float32([[p[0], p[1]] for p in pts])


def pixel_obb_corners_int(
    center_x: float,
    center_y: float,
    width: float,
    height: float,
    angle_rad: float,
) -> np.ndarray:
    """Int32 (4, 2) corner array for ``cv2.drawContours`` / ``polylines``."""
    pts = pixel_obb_corner_points(center_x, center_y, width, height, angle_rad)
    return np.int32([[int(round(p[0])), int(round(p[1]))] for p in pts])


def _wrap_pi_half(a: float) -> float:
    a = a % math.pi
    if a > math.pi / 2:
        a -= math.pi
    return a


def mean_width_axis_angle(angle_rads: list[float]) -> float:
    """Mean orientation modulo π — stable when all slots share one stall row.

    Naïve ``median`` of angles fails when noise splits values near ±π/2; the
    double-angle average collapses equivalent headings.
    """
    if not angle_rads:
        return 0.0
    s2 = sum(math.sin(2.0 * a) for a in angle_rads)
    c2 = sum(math.cos(2.0 * a) for a in angle_rads)
    return _wrap_pi_half(0.5 * math.atan2(s2, c2))
