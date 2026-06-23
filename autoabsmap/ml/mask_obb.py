"""Oriented bounding box from a binary instance mask — SAM3 vehicle geometry."""

from __future__ import annotations

import math

import cv2
import numpy as np

__all__ = ["instance_mask_to_obb"]


def _wrap_pi_half(angle_rad: float) -> float:
    angle_rad = angle_rad % math.pi
    if angle_rad > math.pi / 2:
        angle_rad -= math.pi
    return angle_rad


def instance_mask_to_obb(
    mask: np.ndarray | None,
    xyxy: tuple[float, float, float, float],
    *,
    min_points: int = 10,
) -> tuple[float, float, float, float, float, bool]:
    """Fit an OBB to one instance mask in ``PixelSlot`` convention.

    Returns ``(center_x, center_y, width, height, angle_rad, is_fallback)``
    where *width* is the short side, *angle_rad* is the width / row axis
    (see ``pixel_obb``), and *is_fallback* signals that the OBB came from the
    axis-aligned *xyxy* bbox rather than the instance mask. Downstream
    consumers use that flag to exclude unreliable angles from row-orientation
    averages.

    Falls back to the axis-aligned *xyxy* bbox with ``angle_rad=0`` when the
    mask is missing or too sparse for ``cv2.minAreaRect``.
    """
    x1, y1, x2, y2 = xyxy
    fallback_cx = (x1 + x2) / 2.0
    fallback_cy = (y1 + y2) / 2.0
    fallback_bw = max(x2 - x1, 0.0)
    fallback_bh = max(y2 - y1, 0.0)
    fallback_w = min(fallback_bw, fallback_bh)
    fallback_h = max(fallback_bw, fallback_bh)
    fallback_result = (fallback_cx, fallback_cy, fallback_w, fallback_h, 0.0, True)

    if mask is None:
        return fallback_result

    binary = np.asarray(mask)
    if binary.ndim != 2:
        return fallback_result
    if binary.dtype == bool or np.issubdtype(binary.dtype, np.floating):
        binary = (binary > 0.5).astype(np.uint8)
    else:
        binary = (binary > 0).astype(np.uint8)

    ys, xs = np.where(binary > 0)
    if len(xs) < min_points:
        return fallback_result

    pts = np.float32(np.column_stack([xs, ys]))
    (cx, cy), (rw, rh), ang_deg = cv2.minAreaRect(pts)
    w, h = float(rw), float(rh)
    if w < 1.0 or h < 1.0:
        return fallback_result

    angle_rad = math.radians(float(ang_deg))
    if w > h:
        w, h = h, w
        angle_rad += math.pi / 2.0

    return float(cx), float(cy), w, h, _wrap_pi_half(angle_rad), False
