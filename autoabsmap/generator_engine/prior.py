"""Geometric prior — scale and orientation shared across post-processing stages.

Built from SAM3 vehicle medians, ROI-polygon PCA, or ``GeometrySettings`` defaults.
"""

from __future__ import annotations

import math
from enum import Enum

import cv2
import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from autoabsmap.config.settings import PipelineSettings
from autoabsmap.generator_engine.models import PixelSlot
from autoabsmap.generator_engine.pixel_obb import mean_width_axis_angle

__all__ = [
    "PriorSource",
    "GeometricPrior",
    "build_simple_prior_v1",
    "build_geometric_prior_from_detection_and_roi",
]


class PriorSource(str, Enum):
    """Which signal produced the active geometric prior."""

    operator_hint = "operator_hint"
    markings = "markings"
    sam3_median = "sam3_median"
    roi_pca = "roi_pca"
    settings_default = "settings_default"


class GeometricPrior(BaseModel):
    """Global slot geometry hypothesis in pixel space (+ orientation)."""

    orientation_rad: float
    slot_width_px: float
    slot_height_px: float
    confidence: float = Field(ge=0.0, le=1.0)
    source: PriorSource

    model_config = ConfigDict(frozen=True)


def build_simple_prior_v1(
    detection_slots: list[PixelSlot],
    gsd_m: float,
    settings: PipelineSettings,
) -> GeometricPrior:
    """Fallback prior from SAM3 medians or ``GeometrySettings`` defaults in metres."""
    geo = settings.geometry
    gsd = max(float(gsd_m), 1e-9)

    if detection_slots:
        mw = float(np.median([s.width for s in detection_slots]))
        mh = float(np.median([s.height for s in detection_slots]))
        ma = mean_width_axis_angle([s.angle_rad for s in detection_slots])
        return GeometricPrior(
            orientation_rad=ma,
            slot_width_px=max(mw, 1.0),
            slot_height_px=max(mh, 1.0),
            confidence=0.9,
            source=PriorSource.sam3_median,
        )

    sw = geo.default_slot_w_m / gsd
    sh = geo.default_slot_h_m / gsd
    return GeometricPrior(
        orientation_rad=0.0,
        slot_width_px=max(sw, 1.0),
        slot_height_px=max(sh, 1.0),
        confidence=0.3,
        source=PriorSource.settings_default,
    )


def _detection_summary(slots: list[PixelSlot]) -> tuple[float | None, float | None, float | None, float]:
    """Median width / height / width-axis angle and a [0,1] confidence."""
    if not slots:
        return None, None, None, 0.0
    mw = float(np.median([s.width for s in slots]))
    mh = float(np.median([s.height for s in slots]))
    ma = mean_width_axis_angle([s.angle_rad for s in slots])
    mean_conf = float(np.mean([s.confidence for s in slots]))
    count_factor = min(1.0, len(slots) / 12.0)
    confidence = float(max(0.0, min(1.0, 0.45 * count_factor + 0.55 * mean_conf)))
    return mw, mh, ma, confidence


def _mask_pca_angle(binary: np.ndarray, min_pts: int) -> float | None:
    ys, xs = np.where(binary > 0)
    if len(xs) < min_pts:
        return None
    pts = np.vstack((xs, ys)).T.astype(np.float64)
    _, eigvecs, _ = cv2.PCACompute2(pts, mean=None)
    v = eigvecs[0]
    v = v / np.linalg.norm(v)
    ang = float(math.atan2(v[1], v[0]) + math.pi / 2)
    ang = ang % math.pi
    if ang > math.pi / 2:
        ang -= math.pi
    return ang


def _roi_pca_summary(
    roi_mask: np.ndarray,
    pca_min_points: int,
) -> tuple[np.ndarray, float | None, float]:
    """Return (binary ROI, dominant_orientation_rad, confidence ∈ [0,1]).

    The operator ROI polygon is the geometric fallback signal: its PCA long
    axis gives the row-pitch orientation when SAM3 detections are too sparse
    to define one. Confidence is a fixed moderate value — the ROI shape is a
    weak hint, never as trustworthy as actual detections.
    """
    _, binary = cv2.threshold(roi_mask, 127, 255, cv2.THRESH_BINARY)
    mask_area = int(np.count_nonzero(binary > 0))
    dom = _mask_pca_angle(binary, pca_min_points) if mask_area >= pca_min_points else None
    confidence = 0.5 if dom is not None else 0.0
    return binary, dom, confidence


def _prior_from_roi_pca(
    orientation_rad: float,
    slot_width_px: float,
    slot_height_px: float,
    confidence: float,
) -> GeometricPrior:
    return GeometricPrior(
        orientation_rad=orientation_rad,
        slot_width_px=max(slot_width_px, 1.0),
        slot_height_px=max(slot_height_px, 1.0),
        confidence=max(0.0, min(1.0, confidence)),
        source=PriorSource.roi_pca,
    )


def build_geometric_prior_from_detection_and_roi(
    pixel_slots: list[PixelSlot],
    roi_mask: np.ndarray,
    settings: PipelineSettings,
    gsd_m: float,
) -> tuple[GeometricPrior, np.ndarray]:
    """Single-track prior: strong SAM3 → ROI PCA → defaults.

    Returns ``(prior, binary_mask)`` where ``binary_mask`` is the thresholded
    ROI — callers reuse it for evidence dumping without recomputing.
    """
    fus = settings.fusion
    geo = settings.geometry
    gsd = max(float(gsd_m), 1e-9)

    mw, mh, ma, det_conf = _detection_summary(pixel_slots)
    binary, dom, m_conf = _roi_pca_summary(roi_mask, settings.geometry.pca_min_points)

    if det_conf > fus.sam3_min_confidence and pixel_slots:
        assert mw is not None and mh is not None and ma is not None
        prior = GeometricPrior(
            orientation_rad=float(ma),
            slot_width_px=max(mw, 1.0),
            slot_height_px=max(mh, 1.0),
            confidence=float(min(1.0, det_conf)),
            source=PriorSource.sam3_median,
        )
        return prior, binary

    if m_conf > fus.mask_min_confidence and dom is not None:
        if mw is not None and mh is not None:
            sw, sh = mw, mh
            conf = float(min(1.0, 0.5 * m_conf + 0.5 * det_conf))
        else:
            sw = geo.default_slot_w_m / gsd
            sh = geo.default_slot_h_m / gsd
            conf = float(m_conf * 0.7)
        return _prior_from_roi_pca(float(dom), sw, sh, conf), binary

    return build_simple_prior_v1(pixel_slots, gsd_m, settings), binary
