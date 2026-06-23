"""Cross-frame deduplication + weighted-median XYXY fusion.

Clusters spatially close center candidates across frames using
hierarchical agglomerative clustering, then fuses each cluster's
bounding boxes with confidence-weighted median.
"""

from __future__ import annotations

import logging

import numpy as np
from scipy.cluster.hierarchy import fclusterdata

from calib_gen.config.settings import CalibSettings
from calib_gen.models.fusion import CenterCandidate, FusedSpot

logger = logging.getLogger(__name__)


def _weighted_median(values: list[float], weights: list[float]) -> float:
    """Value at which cumulative weight reaches 50 %."""
    order = np.argsort(values)
    sorted_vals = np.array(values)[order]
    sorted_wts = np.array(weights)[order]
    cum = np.cumsum(sorted_wts)
    half = cum[-1] / 2.0
    idx = int(np.searchsorted(cum, half))
    return float(sorted_vals[min(idx, len(sorted_vals) - 1)])


def step_deduplicate_and_fuse(
    candidates: list[CenterCandidate],
    settings: CalibSettings,
) -> list[FusedSpot]:
    """Cluster spatially close candidates, fuse with confidence-weighted median on XYXY."""
    geo = settings.geometry
    if not candidates:
        return []

    if len(candidates) == 1:
        c = candidates[0]
        d = c.detection
        return [FusedSpot(
            x1=d.x1, y1=d.y1, x2=d.x2, y2=d.y2,
            candidates=[c], n_frames=1, cluster_id=0,
        )]

    diags = [
        np.sqrt(c.detection.width ** 2 + c.detection.height ** 2)
        for c in candidates
    ]
    eps = geo.dedup_eps_frac * float(np.median(diags))

    points = np.array([(c.x, c.y) for c in candidates])
    labels = fclusterdata(
        points, t=max(eps, 1.0), criterion="distance", method="complete",
    )

    clusters: dict[int, list[CenterCandidate]] = {}
    for label, cand in zip(labels, candidates):
        clusters.setdefault(int(label), []).append(cand)

    fused: list[FusedSpot] = []
    for cid, group in clusters.items():
        frame_set = {c.frame_idx for c in group}
        if len(frame_set) < geo.dedup_min_frames:
            continue

        x1s = [c.detection.x1 for c in group]
        y1s = [c.detection.y1 for c in group]
        x2s = [c.detection.x2 for c in group]
        y2s = [c.detection.y2 for c in group]
        weights = [c.detection.confidence for c in group]

        fused.append(FusedSpot(
            x1=_weighted_median(x1s, weights),
            y1=_weighted_median(y1s, weights),
            x2=_weighted_median(x2s, weights),
            y2=_weighted_median(y2s, weights),
            candidates=group,
            n_frames=len(frame_set),
            cluster_id=cid,
        ))

    logger.info(
        "Dedup+fusion: %d candidates → %d spots  (eps=%.1f, min_frames=%d)",
        len(candidates), len(fused), eps, geo.dedup_min_frames,
    )
    return fused


def step_dedup_fused(
    fused: list[FusedSpot],
    settings: CalibSettings,
) -> list[FusedSpot]:
    """Remove overlapping fused spots — keep the one seen in more frames."""
    geo = settings.geometry
    if len(fused) <= 1:
        return list(fused)

    threshold = geo.containment_threshold
    ranked = sorted(fused, key=lambda s: (s.n_frames, s.median_width * s.median_height), reverse=True)
    kept: list[FusedSpot] = []
    for spot in ranked:
        spot_area = spot.median_width * spot.median_height
        if spot_area <= 0:
            continue
        is_dup = False
        for k in kept:
            inter = _fused_intersection_area(spot, k)
            smaller_area = min(spot_area, k.median_width * k.median_height)
            if smaller_area > 0 and inter / smaller_area >= threshold:
                is_dup = True
                break
        if not is_dup:
            kept.append(spot)

    logger.info("Post-fusion dedup: %d → %d spots", len(fused), len(kept))
    return kept


def _fused_intersection_area(a: FusedSpot, b: FusedSpot) -> float:
    ix1 = max(a.x1, b.x1)
    iy1 = max(a.y1, b.y1)
    ix2 = min(a.x2, b.x2)
    iy2 = min(a.y2, b.y2)
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    return (ix2 - ix1) * (iy2 - iy1)
