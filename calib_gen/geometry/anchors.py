"""Anchor extraction + local center estimation.

Bottom-center of each detection bbox serves as a stable parking-space
proxy. The center is estimated by shifting the anchor upward by a
configurable fraction of the bbox height.
"""

from __future__ import annotations

import logging

from calib_gen.config.settings import CalibSettings
from calib_gen.models.detection import FrameResult
from calib_gen.models.fusion import CenterCandidate

logger = logging.getLogger(__name__)


def step_extract_candidates(
    frames: list[FrameResult],
    settings: CalibSettings,
) -> list[CenterCandidate]:
    """Bottom-center anchor → estimated parking-spot center."""
    geo = settings.geometry
    candidates: list[CenterCandidate] = []
    for frame_idx, f in enumerate(frames):
        for d in f.detections:
            ax, ay = d.bottom_center
            cx = ax
            cy = ay - geo.center_offset_frac * d.height
            candidates.append(CenterCandidate(
                x=cx, y=cy,
                anchor_x=ax, anchor_y=ay,
                frame_idx=frame_idx,
                detection=d,
            ))
    logger.info(
        "Extracted %d center candidates from %d frames",
        len(candidates), len(frames),
    )
    return candidates
