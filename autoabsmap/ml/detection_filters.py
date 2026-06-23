"""Shared gates for raw detector output before geometric post-processing."""

from __future__ import annotations

from autoabsmap.config.settings import DetectionSettings
from autoabsmap.ml.models import SpotDetection

__all__ = ["filter_spot_detections", "min_detection_width_px"]


def min_detection_width_px(settings: DetectionSettings, gsd_m: float) -> float:
    """Minimum OBB short-side length in pixels for a vehicle anchor."""
    return settings.min_detection_width_m / max(float(gsd_m), 1e-9)


def filter_spot_detections(
    spots: list[SpotDetection],
    settings: DetectionSettings,
    *,
    gsd_m: float,
) -> tuple[list[SpotDetection], int]:
    """Drop tiny SAM3 mask slivers that are not plausible vehicle footprints.

    Returns ``(kept, dropped_count)``.
    """
    min_w = min_detection_width_px(settings, gsd_m)
    kept: list[SpotDetection] = []
    dropped = 0
    for spot in spots:
        short_side = min(float(spot.width), float(spot.height))
        if short_side < min_w:
            dropped += 1
            continue
        kept.append(spot)
    return kept, dropped
