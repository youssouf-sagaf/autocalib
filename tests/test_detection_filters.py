"""Tests for SAM3 detection size filtering."""

from __future__ import annotations

from autoabsmap.config.settings import DetectionSettings
from autoabsmap.ml.detection_filters import filter_spot_detections, min_detection_width_px
from autoabsmap.ml.models import SpotDetection


def _spot(width: float, height: float) -> SpotDetection:
    return SpotDetection(
        center_x=10.0,
        center_y=10.0,
        width=width,
        height=height,
        angle_rad=0.0,
        confidence=0.9,
    )


def test_min_detection_width_px_scales_with_gsd() -> None:
    settings = DetectionSettings(min_detection_width_m=1.5)
    assert min_detection_width_px(settings, 0.05) == 30.0
    assert min_detection_width_px(settings, 0.10) == 15.0


def test_filter_drops_tiny_mask_slivers_from_artifact_profile() -> None:
    """Reproduce tile_02 false positives (11–20 px) vs real cars (~41+ px)."""
    settings = DetectionSettings(min_detection_width_m=1.5)
    spots = [
        _spot(45.0, 92.0),
        _spot(11.6, 26.9),
        _spot(14.2, 35.1),
        _spot(20.0, 34.0),
        _spot(41.1, 57.3),
    ]
    kept, dropped = filter_spot_detections(spots, settings, gsd_m=0.05)
    assert dropped == 3
    assert len(kept) == 2
    assert all(min(s.width, s.height) >= 30.0 for s in kept)


def test_filter_keeps_all_when_none_below_threshold() -> None:
    settings = DetectionSettings(min_detection_width_m=1.5)
    spots = [_spot(44.0, 90.0), _spot(48.0, 95.0)]
    kept, dropped = filter_spot_detections(spots, settings, gsd_m=0.05)
    assert dropped == 0
    assert len(kept) == 2
