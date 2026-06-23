"""Geometric prior propagation and GeometricEngine integration."""

from __future__ import annotations

import numpy as np

from autoabsmap.config.settings import GeometrySettings, PipelineSettings
from autoabsmap.export.models import SlotSource
from autoabsmap.generator_engine.geometric_engine import GeometricEngine
from autoabsmap.generator_engine.models import PixelSlot
from autoabsmap.generator_engine.prior import (
    GeometricPrior,
    PriorSource,
    build_simple_prior_v1,
)


def test_build_simple_prior_prefers_sam3_medians():
    detections = [
        PixelSlot(
            center_x=10, center_y=10, width=4, height=10, angle_rad=0.0,
            confidence=0.9, class_id=0, source=SlotSource.sam3,
        ),
    ]
    p = build_simple_prior_v1(detections, gsd_m=0.05, settings=PipelineSettings())
    assert p.source == PriorSource.sam3_median
    assert p.slot_width_px == 4.0


def test_geometric_engine_runs_stage_c_with_prior_no_sam3():
    """Mask recovery fills a disconnected zone unreachable by row extension."""
    mask = np.zeros((200, 400), dtype=np.uint8)
    mask[40:160, 20:180] = 255
    # Separate island far from detections — extension cannot reach it.
    mask[40:160, 280:380] = 255
    inferred = [
        PixelSlot(
            center_x=60, center_y=100, width=22, height=38, angle_rad=0.0,
            confidence=0.75, class_id=0, source=SlotSource.sam3,
        ),
        PixelSlot(
            center_x=90, center_y=100, width=22, height=38, angle_rad=0.0,
            confidence=0.75, class_id=0, source=SlotSource.sam3,
        ),
    ]
    prior = GeometricPrior(
        orientation_rad=0.0,
        slot_width_px=22.0,
        slot_height_px=38.0,
        confidence=0.8,
        source=PriorSource.sam3_median,
    )
    engine = GeometricEngine(
        GeometrySettings().model_copy(update={"enable_mask_recovery": True}),
    )
    out = engine.process(inferred, mask, prior=prior)
    recoveries = [s for s in out if s.source == SlotSource.mask_recovery]
    assert len(recoveries) >= 1
    assert any(s.center_x > 250 for s in recoveries), (
        "Recovery should fill the disconnected island (x > 250)"
    )
