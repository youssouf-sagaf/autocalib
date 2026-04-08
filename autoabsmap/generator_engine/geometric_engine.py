"""GeometricEngine — row extension, gap fill, mask recovery, deduplication.

Sits between YOLO-OBB detection and GeoJSON export.  Uses the segmentation
mask geometry and detected-slot row structure to fill gaps, extend rows,
and recover uncovered regions.

Stages (ported from R&D ``absolutemap-gen/geometric_engine.py``):
    A — Cluster detections into rows (union-find on angle + proximity)
    B — Gap filling and bidirectional row extension (distance-transform-guided)
    C — Uncovered mask region recovery (PCA orientation + propagation)
    D — Deduplication via polygon intersection and mask validation

All magic numbers come from ``GeometrySettings`` — zero hardcoded constants.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

from autoabsmap.config.settings import GeometrySettings
from autoabsmap.export.models import SlotSource
from autoabsmap.generator_engine.models import PixelSlot

import logging

logger = logging.getLogger(__name__)

__all__ = ["GeometricEngine"]


# ── Geometry helpers ──────────────────────────────────────────────────────


def _corners_int(cx: float, cy: float, w: float, h: float, angle: float) -> np.ndarray:
    """Four integer corners of an OBB — R&D convention.

    *angle* is the depth (long) axis direction.  Height is placed along
    (cos a, sin a), width perpendicular (-sin a, cos a).
    """
    h_vec = np.array([math.cos(angle), math.sin(angle)]) * (h / 2.0)
    w_vec = np.array([-math.sin(angle), math.cos(angle)]) * (w / 2.0)
    c = np.array([cx, cy])
    return np.int32([c + h_vec + w_vec, c - h_vec + w_vec,
                     c - h_vec - w_vec, c + h_vec - w_vec])


def _corners_float(cx: float, cy: float, w: float, h: float, angle: float) -> np.ndarray:
    """Float version of _corners_int for cv2.intersectConvexConvex."""
    h_vec = np.array([math.cos(angle), math.sin(angle)]) * (h / 2.0)
    w_vec = np.array([-math.sin(angle), math.cos(angle)]) * (w / 2.0)
    c = np.array([cx, cy])
    return np.float32([c + h_vec + w_vec, c - h_vec + w_vec,
                       c - h_vec - w_vec, c + h_vec - w_vec])


def _angle_diff(a: float, b: float) -> float:
    """Unsigned angular distance in [0, π/2], accounting for π-periodicity."""
    d = (a - b) % math.pi
    if d > math.pi / 2:
        d = math.pi - d
    return abs(d)


def _normalize_angle(a: float) -> float:
    """Normalize angle to [-π/2, π/2]."""
    a = a % math.pi
    if a > math.pi / 2:
        a -= math.pi
    return a


def _width_dir(angle: float) -> np.ndarray:
    """Unit vector along the width (short) axis — the row/street direction."""
    return np.array([math.cos(angle), math.sin(angle)])


def _depth_dir(angle: float) -> np.ndarray:
    """Unit vector along the depth (long) axis — perpendicular to the row."""
    return np.array([-math.sin(angle), math.cos(angle)])


# ── Stage A — Row clustering ─────────────────────────────────────────────


def _cluster_rows(
    slots: list[PixelSlot], s: GeometrySettings,
) -> list[list[PixelSlot]]:
    """Group slots sharing similar orientation and spatial alignment (union-find)."""
    if not slots:
        return []

    n = len(slots)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj

    angle_tol = math.radians(s.angle_tolerance_deg)

    for i in range(n):
        for j in range(i + 1, n):
            s1, s2 = slots[i], slots[j]
            if _angle_diff(s1.angle_rad, s2.angle_rad) > angle_tol:
                continue

            w_dir = _width_dir(s1.angle_rad)
            d_dir = _depth_dir(s1.angle_rad)
            vec = np.array([s2.center_x - s1.center_x, s2.center_y - s1.center_y])

            avg_w = (s1.width + s2.width) / 2.0
            avg_h = (s1.height + s2.height) / 2.0

            proj_along_row = abs(float(np.dot(vec, w_dir)))
            proj_perp_row = abs(float(np.dot(vec, d_dir)))

            if proj_perp_row < s.row_normal_factor * avg_h \
               and proj_along_row < s.row_axis_factor * avg_w:
                union(i, j)

    clusters: dict[int, list[PixelSlot]] = {}
    for i in range(n):
        root = find(i)
        slots[i].row_id = root
        clusters.setdefault(root, []).append(slots[i])

    return list(clusters.values())


# ── Stage B — Gap filling + row extension ────────────────────────────────


def _process_row(
    row: list[PixelSlot],
    dt_mask: np.ndarray,
    binary_mask: np.ndarray,
    s: GeometrySettings,
) -> list[PixelSlot]:
    """Fill internal gaps and extend the row bidirectionally while the mask allows."""
    if len(row) < 2:
        return []

    row_wp = float(np.median([slot.width for slot in row]))
    row_hp = float(np.median([slot.height for slot in row]))
    row_angle = float(np.median([slot.angle_rad for slot in row]))
    w_dir = _width_dir(row_angle)

    projections = [
        (float(np.dot(np.array([slot.center_x, slot.center_y]), w_dir)), slot)
        for slot in row
    ]
    projections.sort(key=lambda x: x[0])
    sorted_slots = [p[1] for p in projections]

    h_max, w_max = dt_mask.shape[:2]
    ref_row_id = row[0].row_id
    new_slots: list[PixelSlot] = []

    # ── Internal gap filling ──────────────────────────────────────────
    for i in range(len(sorted_slots) - 1):
        s1, s2 = sorted_slots[i], sorted_slots[i + 1]
        vec = np.array([s2.center_x - s1.center_x, s2.center_y - s1.center_y])
        dist = float(np.linalg.norm(vec))
        if dist == 0:
            continue

        street_dir = vec / dist
        derived_angle = _normalize_angle(math.atan2(street_dir[1], street_dir[0]) + math.pi / 2)
        dist_along = abs(float(np.dot(vec, w_dir)))

        if dist_along > s.gap_fill_threshold * row_wp:
            n_fill = max(1, round(dist_along / row_wp) - 1)
            for k in range(1, n_fill + 1):
                t = k / (n_fill + 1)
                cx = s1.center_x + t * vec[0]
                cy = s1.center_y + t * vec[1]
                iy, ix = int(cy), int(cx)
                if 0 <= iy < h_max and 0 <= ix < w_max and dt_mask[iy, ix] > 0:
                    new_slots.append(PixelSlot(
                        center_x=cx, center_y=cy, width=row_wp, height=row_hp,
                        angle_rad=derived_angle, confidence=s.gap_fill_confidence,
                        class_id=0, source=SlotSource.gap_fill, row_id=ref_row_id,
                    ))

    # ── Bidirectional extrapolation ───────────────────────────────────
    def _extrapolate(start: PixelSlot, ref: PixelSlot, sign: float) -> None:
        vec = np.array([start.center_x - ref.center_x, start.center_y - ref.center_y])
        norm = float(np.linalg.norm(vec))
        street_dir = vec / norm if norm > 0 else _width_dir(row_angle)
        derived_angle = _normalize_angle(math.atan2(street_dir[1], street_dir[0]) + math.pi / 2)
        step = sign * row_wp * street_dir
        curr = np.array([start.center_x, start.center_y])

        for _ in range(s.max_extension_steps):
            curr = curr + step
            cx, cy = float(curr[0]), float(curr[1])
            iy, ix = int(cy), int(cx)
            if not (0 <= iy < h_max and 0 <= ix < w_max):
                break
            if dt_mask[iy, ix] < s.dt_threshold_fraction * row_hp:
                break
            new_slots.append(PixelSlot(
                center_x=cx, center_y=cy, width=row_wp, height=row_hp,
                angle_rad=derived_angle, confidence=s.extension_confidence,
                class_id=0, source=SlotSource.row_extension, row_id=ref_row_id,
            ))

    _extrapolate(sorted_slots[-1], sorted_slots[-2], 1.0)
    _extrapolate(sorted_slots[0], sorted_slots[1], -1.0)

    return new_slots


# ── Stage C — Uncovered mask region recovery ─────────────────────────────


def _pca_angle(mask_region: np.ndarray, min_pts: int) -> float:
    """Dominant orientation of a binary mask region via PCA.

    Returns the angle in PixelSlot convention (width-axis / along-row direction).
    """
    ys, xs = np.where(mask_region > 0)
    if len(xs) < min_pts:
        return 0.0
    pts = np.vstack((xs, ys)).T.astype(np.float64)
    _, eigvecs, _ = cv2.PCACompute2(pts, mean=None)
    v = eigvecs[0]
    v = v / np.linalg.norm(v)
    return _normalize_angle(float(math.atan2(v[1], v[0])) + math.pi / 2)


def _recover_uncovered(
    current_slots: list[PixelSlot],
    binary_mask: np.ndarray,
    dt_mask: np.ndarray,
    yolo_slots: list[PixelSlot],
    s: GeometrySettings,
) -> list[PixelSlot]:
    """Find mask regions with no coverage and fill them via PCA + propagation."""
    if not yolo_slots:
        return []

    global_wp = float(np.median([slot.width for slot in yolo_slots]))
    global_hp = float(np.median([slot.height for slot in yolo_slots]))

    # Build coverage map from enlarged current slot footprints
    cov_map = np.zeros_like(binary_mask)
    for slot in current_slots:
        box = _corners_int(
            slot.center_x, slot.center_y,
            slot.width * s.coverage_width_factor,
            slot.height * s.coverage_height_factor,
            slot.angle_rad,
        )
        cv2.drawContours(cov_map, [box], 0, 255, -1)

    uncovered = cv2.bitwise_and(binary_mask, cv2.bitwise_not(cov_map))
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(
        uncovered, connectivity=8,
    )

    h_max, w_max = binary_mask.shape[:2]
    new_slots: list[PixelSlot] = []

    for label_idx in range(1, num_labels):
        area = stats[label_idx, cv2.CC_STAT_AREA]
        if area < s.min_island_area_factor * global_wp * global_hp:
            continue

        island = np.zeros_like(binary_mask)
        island[labels == label_idx] = 255

        island_dt = cv2.bitwise_and(dt_mask, dt_mask, mask=island)
        _, max_val, _, max_loc = cv2.minMaxLoc(island_dt)
        if max_val < s.min_island_dt_factor * global_hp:
            continue

        seed_x, seed_y = max_loc
        angle = _pca_angle(island, s.pca_min_points)
        street_dir = np.array([
            math.cos(angle - math.pi / 2),
            math.sin(angle - math.pi / 2),
        ])

        def _fill_island(direction_sign: float) -> None:
            curr = np.array([seed_x, seed_y], dtype=float)
            step = direction_sign * global_wp * street_dir

            if direction_sign == 1.0:
                new_slots.append(PixelSlot(
                    center_x=float(seed_x), center_y=float(seed_y),
                    width=global_wp, height=global_hp,
                    angle_rad=angle, confidence=s.recovery_confidence,
                    class_id=0, source=SlotSource.mask_recovery,
                ))

            for _ in range(s.max_recovery_steps):
                curr = curr + step
                cx, cy = float(curr[0]), float(curr[1])
                iy, ix = int(cy), int(cx)
                if not (0 <= iy < h_max and 0 <= ix < w_max):
                    break
                if binary_mask[iy, ix] == 0:
                    break
                if dt_mask[iy, ix] < s.dt_threshold_fraction * global_hp:
                    break
                new_slots.append(PixelSlot(
                    center_x=cx, center_y=cy, width=global_wp, height=global_hp,
                    angle_rad=angle, confidence=s.recovery_confidence,
                    class_id=0, source=SlotSource.mask_recovery,
                ))

        _fill_island(1.0)
        _fill_island(-1.0)

    return new_slots


# ── Stage D — Deduplication and mask validation ──────────────────────────


def _dedup_and_validate(
    all_slots: list[PixelSlot],
    binary_mask: np.ndarray,
    s: GeometrySettings,
) -> list[PixelSlot]:
    """Remove overlapping spots and reject those outside the mask.

    YOLO originals are always prioritised over generated spots.
    """
    all_slots.sort(
        key=lambda slot: (1 if slot.source == SlotSource.yolo else 0, slot.confidence),
        reverse=True,
    )

    h_max, w_max = binary_mask.shape[:2]
    kept: list[PixelSlot] = []

    for slot in all_slots:
        iy, ix = int(slot.center_y), int(slot.center_x)
        if not (0 <= iy < h_max and 0 <= ix < w_max):
            continue
        if binary_mask[iy, ix] == 0:
            continue

        slot_box = _corners_float(
            slot.center_x, slot.center_y, slot.width, slot.height, slot.angle_rad,
        )
        slot_area = slot.width * slot.height
        overlap = False

        for k_slot in kept:
            dist = math.hypot(
                slot.center_x - k_slot.center_x, slot.center_y - k_slot.center_y,
            )
            if dist > s.dedup_distance_factor * max(slot.width, slot.height):
                continue
            k_box = _corners_float(
                k_slot.center_x, k_slot.center_y,
                k_slot.width, k_slot.height, k_slot.angle_rad,
            )
            inter_area, _ = cv2.intersectConvexConvex(slot_box, k_box)
            if inter_area > s.iou_dedup_threshold * min(slot_area, k_slot.width * k_slot.height):
                overlap = True
                break

        if not overlap:
            kept.append(slot)

    return kept


# ── Public API ────────────────────────────────────────────────────────────


class GeometricEngine:
    """Post-processing engine: row clustering → gap fill → row extension
    → mask recovery → dedup.

    All tunable constants come from ``GeometrySettings`` — zero magic numbers.
    """

    def __init__(self, settings: GeometrySettings | None = None) -> None:
        self._s = settings or GeometrySettings()

    def process(
        self,
        pixel_slots: list[PixelSlot],
        seg_mask: np.ndarray,
    ) -> list[PixelSlot]:
        """Run full geometric post-processing on raw detections.

        Stages:
            A. Row clustering (angle + proximity)
            B. Gap filling + row extension (distance-transform-guided)
            C. Uncovered mask region recovery (PCA + propagation)
            D. Deduplication and mask validation

        Returns enriched pixel slots with source attribution.
        """
        if seg_mask.ndim != 2:
            raise ValueError(f"seg_mask must be 2D, got shape {seg_mask.shape}")

        _, binary = cv2.threshold(seg_mask, 127, 255, cv2.THRESH_BINARY)
        dt = cv2.distanceTransform(binary, cv2.DIST_L2, 5)

        yolo_slots = list(pixel_slots)
        if not yolo_slots:
            logger.info("GeometricEngine: no input slots — skipping")
            return []

        # A. Row clustering
        rows = _cluster_rows(yolo_slots, self._s)
        logger.info("Stage A: %d rows from %d detections", len(rows), len(yolo_slots))

        # B. Gap filling + row extension
        enriched = list(yolo_slots)
        for row in rows:
            enriched.extend(_process_row(row, dt, binary, self._s))
        n_added_b = len(enriched) - len(yolo_slots)
        logger.info("Stage B: +%d gap-fill / row-extension slots", n_added_b)

        # C. Uncovered mask region recovery
        recovered = _recover_uncovered(enriched, binary, dt, yolo_slots, self._s)
        enriched.extend(recovered)
        logger.info("Stage C: +%d mask-recovery slots", len(recovered))

        # D. Deduplication and mask validation
        final = _dedup_and_validate(enriched, binary, self._s)
        logger.info(
            "Stage D: %d → %d after dedup (removed %d)",
            len(enriched), len(final), len(enriched) - len(final),
        )

        return final
