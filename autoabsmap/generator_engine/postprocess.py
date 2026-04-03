"""Mask morphology and simplification — extracted from R&D segmentation.py.

Post-processes the raw SegFormer binary mask: morphological close/open,
small hole filling, and boundary simplification via Shapely.
"""

from __future__ import annotations

import logging

import cv2
import numpy as np
from shapely.geometry import Polygon

from autoabsmap.config.settings import SegmentationSettings

logger = logging.getLogger(__name__)

__all__ = ["postprocess_parkable_mask"]


def _ensure_odd_kernel(size: int) -> int:
    k = max(1, int(size))
    if k % 2 == 0:
        k += 1
    return k


def _morph_close_open(mask_uint8: np.ndarray, close_ksize: int, open_ksize: int) -> np.ndarray:
    """Apply binary close then open on a 0/255 uint8 mask."""
    m = (mask_uint8 > 0).astype(np.uint8)
    if close_ksize >= 1:
        kc = _ensure_odd_kernel(close_ksize)
        kernel_c = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kc, kc))
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, kernel_c)
    if open_ksize >= 1:
        ko = _ensure_odd_kernel(open_ksize)
        kernel_o = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ko, ko))
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, kernel_o)
    return (m * 255).astype(np.uint8)


def _fill_small_holes(mask_uint8: np.ndarray, max_hole_area_px: int) -> np.ndarray:
    """Fill interior holes whose area is at most *max_hole_area_px* pixels.

    Uses RETR_CCOMP: contours with a parent are hole boundaries.
    """
    if max_hole_area_px <= 0:
        return mask_uint8

    m = (mask_uint8 > 0).astype(np.uint8)
    contours, hierarchy = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None or len(contours) == 0:
        return mask_uint8

    out = m.copy()
    h0 = hierarchy[0]
    for i, h in enumerate(h0):
        parent = int(h[3])
        if parent < 0:
            continue
        area = cv2.contourArea(contours[i])
        if area <= float(max_hole_area_px):
            cv2.drawContours(out, contours, i, 1, thickness=cv2.FILLED)
    return (out * 255).astype(np.uint8)


def _simplify_mask_boundary(
    mask_uint8: np.ndarray,
    *,
    tolerance_px: float,
    min_polygon_area_px: float,
) -> np.ndarray:
    """Rebuild a 0/255 mask from external contours after Shapely simplification."""
    if tolerance_px <= 0:
        return mask_uint8

    m = (mask_uint8 > 0).astype(np.uint8)
    h, w = m.shape
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return np.zeros((h, w), dtype=np.uint8)

    polys: list[Polygon] = []
    for cnt in contours:
        if len(cnt) < 3:
            continue
        pts = cnt.reshape(-1, 2).astype(np.float64)
        if pts[0, 0] != pts[-1, 0] or pts[0, 1] != pts[-1, 1]:
            pts = np.vstack([pts, pts[0:1]])
        try:
            poly = Polygon(pts)
        except Exception:
            continue
        if poly.is_empty or poly.area < min_polygon_area_px:
            continue
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty or not isinstance(poly, Polygon):
            continue
        simplified = poly.simplify(tolerance_px, preserve_topology=True)
        if simplified.is_empty:
            continue
        if isinstance(simplified, Polygon) and simplified.area >= min_polygon_area_px:
            polys.append(simplified)
        elif simplified.geom_type == "MultiPolygon":
            for g in simplified.geoms:
                if isinstance(g, Polygon) and g.area >= min_polygon_area_px:
                    polys.append(g)

    if not polys:
        return np.zeros((h, w), dtype=np.uint8)

    canvas = np.zeros((h, w), dtype=np.uint8)
    for poly in polys:
        ext = np.array(poly.exterior.coords, dtype=np.int32)
        if ext.shape[0] < 3:
            continue
        cv2.fillPoly(canvas, [ext], 255)
        for interior in poly.interiors:
            hole = np.array(interior.coords, dtype=np.int32)
            if hole.shape[0] >= 3:
                cv2.fillPoly(canvas, [hole], 0)
    return canvas


def postprocess_parkable_mask(
    mask_uint8: np.ndarray,
    settings: SegmentationSettings,
) -> np.ndarray:
    """Close/open, fill small holes, then simplify external boundaries.

    Full post-processing pipeline for a raw SegFormer binary mask.
    Defaults in SegmentationSettings reproduce R&D behavior exactly.
    """
    if mask_uint8.ndim != 2:
        raise ValueError(f"mask must be 2D, got shape {mask_uint8.shape}")
    work = mask_uint8.astype(np.uint8, copy=True)
    work = _morph_close_open(work, settings.morph_close_kernel, settings.morph_open_kernel)
    work = _fill_small_holes(work, settings.max_hole_area_px)
    work = _simplify_mask_boundary(
        work,
        tolerance_px=settings.simplify_tolerance_px,
        min_polygon_area_px=settings.min_polygon_area_px,
    )
    return work
