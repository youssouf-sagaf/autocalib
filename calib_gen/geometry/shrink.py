"""Shrink fused spots to small calibration bboxes.

Each ``FusedSpot`` becomes a ``CalibBbox`` — a square of configurable
size centered on the fused spot's center. This is the final pipeline
output consumed by the frontend.
"""

from __future__ import annotations

import logging

import numpy as np

from calib_gen.config.settings import CalibSettings
from calib_gen.models.fusion import CalibBbox, FusedSpot

logger = logging.getLogger(__name__)


def step_shrink_to_calib(
    fused: list[FusedSpot],
    settings: CalibSettings,
) -> list[CalibBbox]:
    """Create a small square bbox at the center of each fused spot."""
    size = settings.geometry.calib_bbox_size
    half = size / 2

    points: list[CalibBbox] = []
    for i, spot in enumerate(fused):
        avg_conf = float(np.mean([c.detection.confidence for c in spot.candidates]))
        points.append(CalibBbox(
            spot_id=i,
            center_x=round(spot.center_x, 1),
            center_y=round(spot.center_y, 1),
            x=round(spot.center_x - half, 1),
            y=round(spot.center_y - half, 1),
            width=size,
            height=size,
            n_frames=spot.n_frames,
            confidence=round(avg_conf, 3),
        ))

    logger.info(
        "Shrunk %d fused spots → %d calib bboxes (%.0f×%.0f px)",
        len(fused), len(points), size, size,
    )
    return points
