"""Per-frame cleaning: cross-cam dedup (ORB + RANSAC), containment, outlier removal.

Ported from ``calib_gen_rd.pipeline.step_clean`` — YOLO-only path.
"""

from __future__ import annotations

import logging

import cv2
import numpy as np

from calib_gen.config.settings import CalibSettings
from calib_gen.models.detection import Detection, FrameResult

logger = logging.getLogger(__name__)


def step_clean(
    frames: list[FrameResult],
    settings: CalibSettings,
) -> list[FrameResult]:
    """Per-frame cleaning: center dedup, containment, then outlier removal."""
    geo = settings.geometry
    all_areas = [
        d.area for f in frames for d in f.detections
        if d.class_name.lower() not in [c.lower() for c in settings.exclude_classes]
    ]

    if len(all_areas) < 3:
        logger.warning("Too few detections for robust cleaning — skipping")
        return frames

    areas = np.array(all_areas)
    median_area = float(np.median(areas))
    mad = float(np.median(np.abs(areas - median_area)))
    sigma_est = mad * 1.4826
    area_lo = max(median_area - geo.area_mad_factor * sigma_est, 0)
    area_hi = median_area + geo.area_mad_factor * sigma_est

    exclude_lower = {c.lower() for c in settings.exclude_classes}
    keep_lower = {c.lower() for c in settings.keep_classes} if settings.keep_classes else None

    total_before = sum(len(f.detections) for f in frames)
    center_dedup_removed = 0
    cleaned: list[FrameResult] = []

    for f in frames:
        before_dedup = len(f.detections)
        if geo.enable_feature_dedup:
            kept, dedup_ids, dedup_boxes = _feature_match_dedup_frame(
                f.image, f.detections, settings,
            )
        else:
            kept = list(f.detections)
            dedup_ids = set()
            dedup_boxes = []
        center_dedup_removed += before_dedup - len(kept)

        kept = _remove_contained(kept, geo.containment_threshold)

        filtered: list[Detection] = []
        for d in kept:
            name = d.class_name.lower()
            if name in exclude_lower:
                continue
            if keep_lower and name not in keep_lower:
                continue
            if d.area < area_lo or d.area > area_hi:
                continue
            ar = d.aspect_ratio
            if ar < geo.min_aspect_ratio or ar > geo.max_aspect_ratio:
                continue
            filtered.append(d)

        cleaned.append(FrameResult(
            path=f.path,
            image=f.image,
            detections=filtered,
            dedup_selected_ids={id(d) for d in filtered if id(d) in dedup_ids},
            dedup_selected_boxes=dedup_boxes,
        ))

    total_after = sum(len(f.detections) for f in cleaned)
    logger.info(
        "Cleaning: %d → %d detections  "
        "(center dedup removed %d, area band [%.0f .. %.0f], "
        "median=%.0f, MAD=%.0f)",
        total_before, total_after, center_dedup_removed,
        area_lo, area_hi, median_area, mad,
    )
    return cleaned


# ── ORB + RANSAC cross-cam dedup ─────────────────────────────────────


def _feature_match_dedup_frame(
    image: np.ndarray,
    detections: list[Detection],
    settings: CalibSettings,
) -> tuple[list[Detection], set[int], list[tuple[float, float, float, float]]]:
    """Drop duplicate detections via ORB descriptors + RANSAC homography."""
    geo = settings.geometry
    if len(detections) <= 1:
        return list(detections), set(), []

    candidate_pairs = _find_feature_dedup_pairs(image, detections, settings)
    if not candidate_pairs:
        return list(detections), set(), []

    h_img, w_img = image.shape[:2]
    orb = cv2.ORB_create(
        nfeatures=geo.orb_nfeatures,
        edgeThreshold=geo.orb_edge_threshold,
        fastThreshold=geo.orb_fast_threshold,
    )
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)

    feature_cache: dict[int, tuple] = {}

    def _features_for(det: Detection):
        det_id = id(det)
        if det_id in feature_cache:
            return feature_cache[det_id]
        x1 = int(max(0, det.x1))
        y1 = int(max(0, det.y1))
        x2 = int(min(w_img, det.x2))
        y2 = int(min(h_img, det.y2))
        if x2 - x1 < 16 or y2 - y1 < 16:
            feature_cache[det_id] = (None, None)
            return None, None
        crop = image[y1:y2, x1:x2]
        gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
        kp, desc = orb.detectAndCompute(gray, None)
        if desc is None or len(kp) < geo.feature_dedup_min_keypoints:
            feature_cache[det_id] = (None, None)
            return None, None
        feature_cache[det_id] = (kp, desc)
        return kp, desc

    parent: dict[int, int] = {id(d): id(d) for d in detections}

    def _find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def _union(a: int, b: int) -> None:
        ra, rb = _find(a), _find(b)
        if ra != rb:
            parent[ra] = rb

    n_merged = 0
    for det_a, det_b in candidate_pairs:
        kp_a, desc_a = _features_for(det_a)
        kp_b, desc_b = _features_for(det_b)
        if desc_a is None or desc_b is None:
            continue

        try:
            knn = matcher.knnMatch(desc_a, desc_b, k=2)
        except cv2.error:
            continue
        good = []
        for pair in knn:
            if len(pair) < 2:
                continue
            m, n = pair
            if m.distance < geo.feature_dedup_lowe_ratio * n.distance:
                good.append(m)
        if len(good) < geo.feature_dedup_min_matches:
            continue

        src = np.float32([kp_a[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
        dst = np.float32([kp_b[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
        _, mask = cv2.findHomography(
            src, dst, cv2.RANSAC,
            ransacReprojThreshold=geo.feature_dedup_ransac_threshold,
        )
        if mask is None:
            continue
        n_inliers = int(mask.sum())
        if n_inliers >= geo.feature_dedup_min_inliers:
            _union(id(det_a), id(det_b))
            n_merged += 1

    groups: dict[int, list[Detection]] = {}
    for d in detections:
        groups.setdefault(_find(id(d)), []).append(d)

    kept: list[Detection] = []
    selected_ids: set[int] = set()
    selected_boxes: list[tuple[float, float, float, float]] = []
    for group in groups.values():
        winner = max(group, key=lambda d: (d.area, d.confidence))
        kept.append(winner)
        if len(group) > 1:
            selected_ids.add(id(winner))
            selected_boxes.append((winner.x1, winner.y1, winner.width, winner.height))

    logger.info(
        "Dedup: %d detections → %d pairs → %d merged → %d kept",
        len(detections), len(candidate_pairs), n_merged, len(kept),
    )
    return kept, selected_ids, selected_boxes


def _find_feature_dedup_pairs(
    image: np.ndarray,
    detections: list[Detection],
    settings: CalibSettings,
) -> list[tuple[Detection, Detection]]:
    """Restrict ORB matching to seam-zone pairs with similar Y and size."""
    geo = settings.geometry
    _, w_img = image.shape[:2]
    mid = w_img / 2
    half_zone = w_img * geo.overlap_zone_frac / 2
    seam_lo = mid - half_zone
    seam_hi = mid + half_zone

    pairs: list[tuple[Detection, Detection]] = []
    n = len(detections)
    for i in range(n):
        a = detections[i]
        if not (seam_lo < a.center_x < seam_hi):
            continue
        for j in range(i + 1, n):
            b = detections[j]
            if not (seam_lo < b.center_x < seam_hi):
                continue
            avg_h = (a.height + b.height) / 2
            if avg_h <= 0:
                continue
            if abs(a.center_y - b.center_y) > geo.feature_dedup_seam_y_frac * avg_h:
                continue
            min_area = min(a.area, b.area)
            max_area = max(a.area, b.area)
            if max_area <= 0:
                continue
            if min_area / max_area < geo.feature_dedup_seam_area_ratio:
                continue
            pairs.append((a, b))
    return pairs


# ── Containment removal ──────────────────────────────────────────────


def remove_contained(
    detections: list[Detection],
    threshold: float,
) -> list[Detection]:
    """Public wrapper — also used by the detection step for nested SAM boxes."""
    return _remove_contained(detections, threshold)


def _remove_contained(
    detections: list[Detection],
    threshold: float,
) -> list[Detection]:
    """Drop nested bboxes using containment ratio (intersection / smaller area).

    Pass 1: drop large bbox containing >= 2 smaller bboxes (multi-vehicle capture).
    Pass 2: among survivors, drop small bbox mostly inside a larger one.
    """
    n = len(detections)
    if n <= 1:
        return list(detections)

    contains: list[list[int]] = [[] for _ in range(n)]
    for i, big in enumerate(detections):
        for j, small in enumerate(detections):
            if i == j or small.area >= big.area:
                continue
            inter = _intersection_area(big, small)
            if small.area > 0 and inter / small.area >= threshold:
                contains[i].append(j)

    drop: set[int] = {i for i in range(n) if len(contains[i]) >= 2}

    survivors = [i for i in range(n) if i not in drop]
    ranked = sorted(
        survivors,
        key=lambda i: (detections[i].confidence, detections[i].area),
        reverse=True,
    )
    kept_idx: list[int] = []
    for i in ranked:
        nested = False
        for k in kept_idx:
            inter = _intersection_area(detections[i], detections[k])
            smaller_area = min(detections[i].area, detections[k].area)
            if smaller_area > 0 and inter / smaller_area >= threshold:
                nested = True
                break
        if not nested:
            kept_idx.append(i)

    return [detections[i] for i in kept_idx]


def _intersection_area(a: Detection, b: Detection) -> float:
    ix1 = max(a.x1, b.x1)
    iy1 = max(a.y1, b.y1)
    ix2 = min(a.x2, b.x2)
    iy2 = min(a.y2, b.y2)
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    return (ix2 - ix1) * (iy2 - iy1)
