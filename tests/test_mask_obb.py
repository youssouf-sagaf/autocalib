"""Tests for SAM3 instance-mask OBB fitting."""

from __future__ import annotations

import math

import cv2
import numpy as np

from autoabsmap.ml.mask_obb import instance_mask_to_obb


def _rotated_rect_mask(
    cx: float,
    cy: float,
    rw: float,
    rh: float,
    angle_deg: float,
    canvas: tuple[int, int] = (200, 200),
) -> np.ndarray:
    mask = np.zeros(canvas, dtype=np.uint8)
    rect = ((cx, cy), (rw, rh), angle_deg)
    box = cv2.boxPoints(rect).astype(np.int32)
    cv2.fillPoly(mask, [box], 1)
    return mask


def test_instance_mask_to_obb_recovers_diagonal_orientation():
    angle_deg = 33.0
    mask = _rotated_rect_mask(100.0, 100.0, 70.0, 40.0, angle_deg)
    x1, y1, x2, y2 = 60.0, 70.0, 140.0, 130.0
    cx, cy, w, h, ang, is_fallback = instance_mask_to_obb(
        mask, (x1, y1, x2, y2), min_points=10,
    )

    assert w < h
    assert abs(w - 40.0) < 4.0
    assert abs(h - 70.0) < 4.0
    assert abs(cx - 100.0) < 3.0
    assert abs(cy - 100.0) < 3.0
    assert is_fallback is False
    expected = math.radians(angle_deg)
    delta = (ang - expected) % math.pi
    if delta > math.pi / 2:
        delta = math.pi - delta
    # OpenCV reports the width-axis at ±90° from the long-edge angle we draw with.
    assert delta < math.radians(5.0) or abs(delta - math.pi / 2) < math.radians(5.0)


def test_instance_mask_to_obb_falls_back_to_axis_aligned_bbox():
    cx, cy, w, h, ang, is_fallback = instance_mask_to_obb(
        None, (10.0, 20.0, 50.0, 80.0), min_points=10,
    )
    assert cx == 30.0
    assert cy == 50.0
    assert w == 40.0
    assert h == 60.0
    assert ang == 0.0
    assert is_fallback is True


def test_instance_mask_to_obb_flags_sparse_mask_as_fallback():
    sparse_mask = np.zeros((50, 50), dtype=np.uint8)
    sparse_mask[10, 10] = 1
    sparse_mask[11, 11] = 1

    _, _, _, _, ang, is_fallback = instance_mask_to_obb(
        sparse_mask, (5.0, 5.0, 15.0, 15.0), min_points=10,
    )

    assert is_fallback is True
    assert ang == 0.0
