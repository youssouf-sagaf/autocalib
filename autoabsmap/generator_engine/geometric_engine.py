"""GeometricEngine — row clustering, gap fill between SAM3 anchors, deduplication.

Sits between SAM3 vehicle detection and GeoJSON export. Uses the operator ROI
mask and detected-slot row structure to fill gaps between vehicle anchors.

Stages:
    A — Cluster detections into rows (union-find on angle + proximity)
    B — Gap filling strictly between first and last SAM3 anchor per row (ROI-guided)
    C — Mask recovery (optional, ``enable_mask_recovery=False`` by default)
    D — Deduplication via polygon intersection and mask validation
"""

from __future__ import annotations

import math

import cv2
import numpy as np
from scipy.ndimage import distance_transform_edt

from autoabsmap.config.settings import GeometrySettings
from autoabsmap.export.models import SlotSource
from autoabsmap.generator_engine.models import PixelSlot
from autoabsmap.generator_engine.pixel_obb import (
    mean_width_axis_angle,
    pixel_obb_corners_float,
    pixel_obb_corners_int,
)
from autoabsmap.generator_engine.prior import GeometricPrior, PriorSource

import logging

logger = logging.getLogger(__name__)

__all__ = ["GeometricEngine"]


def _prior_trusted_for_sparse_recovery(
    prior: GeometricPrior | None,
    s: GeometrySettings,
) -> bool:
    """Allow Stage C with sparse SAM3 anchors when the prior is sufficiently confident."""
    if prior is None:
        return False
    if prior.source in (PriorSource.markings, PriorSource.operator_hint):
        return True
    if prior.source in (PriorSource.sam3_median, PriorSource.roi_pca):
        return prior.confidence >= s.recovery_min_prior_confidence
    return False


# ── Geometry helpers ──────────────────────────────────────────────────────


def _corners_int(cx: float, cy: float, w: float, h: float, angle: float) -> np.ndarray:
    """Integer OBB corners; *angle* is the width / row-axis (``PixelSlot`` convention)."""
    return pixel_obb_corners_int(cx, cy, w, h, angle)


def _corners_float(cx: float, cy: float, w: float, h: float, angle: float) -> np.ndarray:
    """Float OBB corners for ``cv2.intersectConvexConvex``."""
    return pixel_obb_corners_float(cx, cy, w, h, angle)


def _angle_diff(a: float, b: float) -> float:
    """Unsigned angular distance in [0, π/2], accounting for π-periodicity."""
    d = (a - b) % math.pi
    if d > math.pi / 2:
        d = math.pi - d
    return abs(d)


def _width_dir(angle: float) -> np.ndarray:
    """Unit vector along the width (short) axis — ``angle`` is the row direction."""
    return np.array([math.cos(angle), math.sin(angle)])


def _depth_dir(angle: float) -> np.ndarray:
    """Unit vector along depth (long axis) — perpendicular to the row."""
    return np.array([-math.sin(angle), math.cos(angle)])


def _roi_long_axis_unit(
    mask: np.ndarray, min_points: int, min_eigval_ratio: float,
) -> np.ndarray | None:
    """PCA dominant direction of *mask* (unit vector along the ROI long axis).

    Used by stages B and C to step *along the row* independently of the YOLO
    slot orientation. For angled-bay parking, the slot's width axis (YOLO
    ``angle_rad``) and the rectangle's long axis are not the same direction —
    stepping along the slot width drifts off the strip after a few iterations.
    PCA on the ROI raster recovers the row-pitch direction directly.
    """
    ys, xs = np.where(mask > 0)
    if len(xs) < min_points:
        return None
    pts = np.vstack((xs, ys)).T.astype(np.float64)
    _, eigvecs, eigvals = cv2.PCACompute2(pts, mean=None)
    ev = np.asarray(eigvals).ravel()
    if ev.size < 2:
        return None
    lam1 = float(ev[0])
    lam2 = float(ev[1])
    if lam2 <= 0.0 or lam1 < min_eigval_ratio * lam2:
        return None
    v = eigvecs[0].astype(np.float64)
    n = float(np.linalg.norm(v))
    if n < 1e-9:
        return None
    return v / n


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

            p1 = abs(float(np.dot(vec, w_dir)))
            p2 = abs(float(np.dot(vec, d_dir)))

            # We don't know which axis is "along the row" vs "perpendicular"
            # — YOLO's angle may point along width OR depth.  Accept the pair
            # if *either* interpretation passes: the smaller projection is the
            # perpendicular offset (must be tight) and the larger is along-row
            # (can span several slots).
            perp = min(p1, p2)
            along = max(p1, p2)
            if perp < s.row_normal_factor * avg_h \
               and along < s.row_axis_factor * avg_w:
                union(i, j)

    clusters: dict[int, list[PixelSlot]] = {}
    for i in range(n):
        root = find(i)
        slots[i].row_id = root
        clusters.setdefault(root, []).append(slots[i])

    return list(clusters.values())


# ── Stage B — Gap filling + row extension ────────────────────────────────


def _median_adjacent_pitch(
    sorted_slots: list[PixelSlot],
    pitch_dir: np.ndarray,
    row_wp_nominal: float,
    gap_fill_threshold: float,
) -> float:
    """Estimate row pitch from nearby SAM3 anchor pairs.

    Axis-aligned vehicle bboxes on inclined rows inflate ``row_wp_nominal``.
    Center-to-center spacing along the ROI axis is a tighter pitch for gap fill.
    """
    pitches: list[float] = []
    for i in range(len(sorted_slots) - 1):
        s1, s2 = sorted_slots[i], sorted_slots[i + 1]
        vec = np.array([s2.center_x - s1.center_x, s2.center_y - s1.center_y])
        dist_along = abs(float(np.dot(vec, pitch_dir)))
        if dist_along <= gap_fill_threshold * row_wp_nominal:
            continue
        n_span = max(1, round(dist_along / row_wp_nominal))
        if n_span > 3:
            continue
        pitches.append(dist_along / n_span)
    if pitches:
        return float(np.median(pitches))
    return row_wp_nominal


def _point_inside_slot(cx: float, cy: float, slot: PixelSlot) -> bool:
    """True when *(cx, cy)* lies inside *slot*'s OBB."""
    corners = pixel_obb_corners_float(
        slot.center_x, slot.center_y, slot.width, slot.height, slot.angle_rad,
    )
    return cv2.pointPolygonTest(corners, (float(cx), float(cy)), False) >= 0


def _obb_intersection_area(a: PixelSlot, b: PixelSlot) -> float:
    """Convex intersection area between two slot OBBs."""
    box_a = _corners_float(
        a.center_x, a.center_y, a.width, a.height, a.angle_rad,
    )
    box_b = _corners_float(
        b.center_x, b.center_y, b.width, b.height, b.angle_rad,
    )
    inter_area, _ = cv2.intersectConvexConvex(box_a, box_b)
    return float(inter_area)


def _obb_overlap_exceeds(
    candidate: PixelSlot,
    other: PixelSlot,
    iou_threshold: float,
) -> bool:
    """True when OBB intersection exceeds *iou_threshold* × min(area)."""
    inter_area = _obb_intersection_area(candidate, other)
    min_area = min(
        candidate.width * candidate.height,
        other.width * other.height,
    )
    return inter_area > iou_threshold * min_area


def _slot_half_extent_along(slot: PixelSlot, axis: np.ndarray) -> float:
    """Projected half-length of *slot*'s OBB onto *axis* (unit vector)."""
    w_dir = _width_dir(slot.angle_rad)
    d_dir = _depth_dir(slot.angle_rad)
    return (
        0.5 * slot.width * abs(float(np.dot(w_dir, axis)))
        + 0.5 * slot.height * abs(float(np.dot(d_dir, axis)))
    )


def _gap_fill_slot_count(
    dist_along: float,
    half_extent_a: float,
    half_extent_b: float,
    row_wp_fill: float,
    gap_fill_threshold: float,
    min_clearance_factor: float,
) -> int:
    """How many gap-fill slots fit between two anchors along the row axis.

    Uses edge-to-edge clearance (centre distance minus both half-extents) so
    oversized SAM3 vehicle boxes do not leave a phantom gap when their OBBs
    already touch or overlap.
    """
    if dist_along <= gap_fill_threshold * row_wp_fill:
        return 0
    edge_clearance = dist_along - half_extent_a - half_extent_b
    if edge_clearance < min_clearance_factor * row_wp_fill:
        return 0
    return max(0, int(edge_clearance / row_wp_fill))


def _gap_fill_rejects_anchor_overlap(
    candidate: PixelSlot,
    s1: PixelSlot,
    s2: PixelSlot,
    max_anchor_iou: float,
) -> bool:
    """Reject gap-fill when its OBB overlaps either endpoint SAM3 anchor."""
    return (
        _obb_overlap_exceeds(candidate, s1, max_anchor_iou)
        or _obb_overlap_exceeds(candidate, s2, max_anchor_iou)
    )


def _row_reference_line(
    anchors: list[PixelSlot],
    pitch_dir: np.ndarray,
) -> tuple[np.ndarray, float]:
    """Compute the row's straight reference line (perpendicular axis + offset).

    SAM3 centres carry a few pixels of perpendicular noise (a car parked
    slightly off-centre, mask edges biased, etc.). Using the raw chord
    ``s2 - s1`` to interpolate gap-fill slots, or starting extension from a
    noisy endpoint centre, propagates that noise to the synthesised slots and
    they end up zig-zagging across the row.

    We collapse the noise by computing the median perpendicular projection of
    all anchors and treating that as the row's true offset. ``pitch_dir`` is
    the along-row unit vector (PCA of the ROI mask, or the row's width axis as
    a fallback) and ``perp_dir`` is its 90° rotation.

    Returns ``(perp_dir, median_perp_offset)`` so callers can snap any point
    onto the clean line via :func:`_snap_to_row_line`.
    """
    perp_dir = np.array([-pitch_dir[1], pitch_dir[0]])
    centers = np.array([[a.center_x, a.center_y] for a in anchors])
    perp_proj = centers @ perp_dir
    median_perp = float(np.median(perp_proj))
    return perp_dir, median_perp


def _snap_to_row_line(
    center: np.ndarray,
    pitch_dir: np.ndarray,
    perp_dir: np.ndarray,
    median_perp: float,
) -> np.ndarray:
    """Project *center* onto the row reference line.

    The along-row component (``center · pitch_dir``) is preserved — only the
    perpendicular component is replaced by the row's median offset. Synthesised
    slots therefore land exactly on the clean line, regardless of which anchor
    seeded them.
    """
    along = float(np.dot(center, pitch_dir))
    return along * pitch_dir + median_perp * perp_dir


def _fill_gaps_between_consecutive(
    sorted_slots: list[PixelSlot],
    pitch_dir: np.ndarray,
    perp_dir: np.ndarray,
    median_perp: float,
    row_wp_fill: float,
    row_hp: float,
    row_angle: float,
    ref_row_id: int,
    dt_mask: np.ndarray,
    s: GeometrySettings,
) -> list[PixelSlot]:
    """Insert ``gap_fill`` slots strictly between consecutive row anchors.

    Both endpoints are first snapped onto the row reference line so the
    interpolation segment is perfectly parallel to ``pitch_dir``. Without that
    projection, perpendicular noise in SAM3 anchors tilts the chord and the
    synthesised slots drift across the row.
    """
    h_max, w_max = dt_mask.shape[:2]
    new_slots: list[PixelSlot] = []

    for i in range(len(sorted_slots) - 1):
        s1, s2 = sorted_slots[i], sorted_slots[i + 1]
        raw_vec = np.array([s2.center_x - s1.center_x, s2.center_y - s1.center_y])
        if float(np.linalg.norm(raw_vec)) == 0:
            continue

        dist_along = abs(float(np.dot(raw_vec, pitch_dir)))

        half1 = min(_slot_half_extent_along(s1, pitch_dir), 0.5 * row_wp_fill)
        half2 = min(_slot_half_extent_along(s2, pitch_dir), 0.5 * row_wp_fill)
        n_fill = _gap_fill_slot_count(
            dist_along,
            half1,
            half2,
            row_wp_fill,
            s.gap_fill_threshold,
            s.gap_fill_min_clearance_factor,
        )
        if n_fill < 1:
            continue

        p1 = _snap_to_row_line(
            np.array([s1.center_x, s1.center_y]),
            pitch_dir, perp_dir, median_perp,
        )
        p2 = _snap_to_row_line(
            np.array([s2.center_x, s2.center_y]),
            pitch_dir, perp_dir, median_perp,
        )
        line_vec = p2 - p1

        anchor_pair = [s1, s2]
        for k in range(1, n_fill + 1):
            t = k / (n_fill + 1)
            cx = float(p1[0] + t * line_vec[0])
            cy = float(p1[1] + t * line_vec[1])
            iy, ix = int(cy), int(cx)
            if not (0 <= iy < h_max and 0 <= ix < w_max and dt_mask[iy, ix] > 0):
                continue
            candidate = PixelSlot(
                center_x=cx, center_y=cy, width=row_wp_fill, height=row_hp,
                angle_rad=row_angle, confidence=s.gap_fill_confidence,
                class_id=0, source=SlotSource.gap_fill, row_id=ref_row_id,
            )
            if _gap_fill_rejects_anchor_overlap(
                candidate,
                s1,
                s2,
                s.gap_fill_max_anchor_iou,
            ):
                continue
            new_slots.append(candidate)

    return new_slots


def _extend_row_endpoints(
    sorted_slots: list[PixelSlot],
    pitch_dir: np.ndarray,
    perp_dir: np.ndarray,
    median_perp: float,
    row_wp_fill: float,
    row_hp: float,
    row_angle: float,
    ref_row_id: int,
    dt_mask: np.ndarray,
    s: GeometrySettings,
) -> list[PixelSlot]:
    """Step outward from the row's first/last anchor while still in the ROI mask.

    The seed centre is snapped to the row reference line before walking so the
    extension chain stays parallel to the row, even when the outermost SAM3
    anchor is perpendicular-noisy. Skips a step when the new centre would land
    too close to an existing slot (prevents stacked micro-boxes at row ends).
    """
    if not sorted_slots:
        return []
    if len(sorted_slots) < s.min_anchors_for_extension:
        return []
    if row_wp_fill < s.min_row_wp_px:
        return []

    h_max, w_max = dt_mask.shape[:2]
    out: list[PixelSlot] = []
    min_center_dist = 0.75 * row_wp_fill

    existing_centers = [
        (slot.center_x, slot.center_y) for slot in sorted_slots
    ]

    for endpoint_idx, direction in ((-1, 1.0), (0, -1.0)):
        seed = sorted_slots[endpoint_idx]
        curr = _snap_to_row_line(
            np.array([seed.center_x, seed.center_y]),
            pitch_dir, perp_dir, median_perp,
        )
        step = direction * row_wp_fill * pitch_dir
        for _ in range(s.max_extension_steps):
            curr = curr + step
            cx, cy = float(curr[0]), float(curr[1])
            iy, ix = int(cy), int(cx)
            if not (0 <= iy < h_max and 0 <= ix < w_max):
                break
            if dt_mask[iy, ix] <= 0:
                break
            if any(
                math.hypot(cx - ex, cy - ey) < min_center_dist
                for ex, ey in existing_centers
            ):
                break
            out.append(PixelSlot(
                center_x=cx, center_y=cy, width=row_wp_fill, height=row_hp,
                angle_rad=row_angle, confidence=s.extension_confidence,
                class_id=0, source=SlotSource.row_extension, row_id=ref_row_id,
            ))
            existing_centers.append((cx, cy))
    return out


def _wrap_pi_half(a: float) -> float:
    a = a % math.pi
    if a > math.pi / 2:
        a -= math.pi
    return a


def _resolve_row_orientation(
    row: list[PixelSlot],
    pitch_dir: np.ndarray | None,
    row_wp: float,
    row_hp: float,
    s: GeometrySettings,
    *,
    pitch_from_roi: bool = False,
) -> tuple[float, float, float, int, int]:
    """Derive row OBB angle and gabarit for synthesised slots.

    ``pitch_dir`` (ROI PCA long axis) drives **centre stepping** along the row.
    ``angle_rad`` on synthesised slots stays the **width / short axis**, parallel
    to SAM3 anchors — not the pitch direction itself. On parallel parking the
    ROI long axis usually matches bay **depth**, so it differs from ``angle_rad``
    by ~90°.
    """
    n_total = len(row)
    n_fallback = sum(1 for slot in row if slot.is_fallback)
    reliable = [slot.angle_rad for slot in row if not slot.is_fallback]
    anchor_angles = reliable if reliable else [slot.angle_rad for slot in row]
    angle = mean_width_axis_angle(anchor_angles)

    if pitch_dir is None:
        return angle, row_wp, row_hp, n_total, n_fallback

    pitch_angle = _wrap_pi_half(
        math.atan2(float(pitch_dir[1]), float(pitch_dir[0])),
    )

    # SAM3 anchors define bay orientation; ROI pitch is only for centre stepping.
    if reliable:
        return angle, row_wp, row_hp, n_total, n_fallback

    # No reliable SAM3 — infer width axis from ROI / pitch (fallback-only or empty row).
    weak_row = n_total <= 2 or n_fallback >= max(1, n_total // 2)
    if weak_row or pitch_from_roi:
        depth_angle = _wrap_pi_half(angle + math.pi / 2)
        pitch_is_depth = _angle_diff(pitch_angle, depth_angle) < _angle_diff(
            pitch_angle, angle,
        )
        width_from_pitch = (
            _wrap_pi_half(pitch_angle - math.pi / 2)
            if pitch_is_depth
            else pitch_angle
        )
        if _angle_diff(angle, width_from_pitch) > math.radians(25):
            logger.info(
                "Row %s: no reliable SAM3 — width axis %.1f° from pitch (depth_axis=%s)",
                row[0].row_id,
                math.degrees(width_from_pitch),
                pitch_is_depth,
            )
            angle = width_from_pitch

    return angle, row_wp, row_hp, n_total, n_fallback


def _row_angle_from_anchors(
    row: list[PixelSlot],
    min_reliable: int = 3,
) -> tuple[float, int, int]:
    """Compute the row's representative width-axis angle (legacy helper).

    Prefer :func:`_resolve_row_orientation` when ``pitch_dir`` is available.
    """
    n_total = len(row)
    n_fallback = sum(1 for slot in row if slot.is_fallback)
    reliable = [slot.angle_rad for slot in row if not slot.is_fallback]

    if len(reliable) >= min_reliable:
        angle = mean_width_axis_angle(reliable)
    else:
        angle = mean_width_axis_angle([slot.angle_rad for slot in row])

    return angle, n_total, n_fallback


def _process_row(
    row: list[PixelSlot],
    dt_mask: np.ndarray,
    s: GeometrySettings,
    roi_axis_unit: np.ndarray | None = None,
    *,
    pitch_from_roi: bool = False,
) -> list[PixelSlot]:
    """Fill internal gaps between SAM3 anchors, then extend along the ROI axis.

    *roi_axis_unit* (optional): unit vector along the ROI long axis. When
    available it drives slot ordering, gap detection and extension direction
    — decoupling the row-pitch direction from each slot's own width axis.

    Synthesis runs in two stages per row:
        1. Gap fill — strictly between consecutive SAM3 anchors.
        2. Row extension — step outward from each endpoint while the centre
           stays inside the ROI mask. Dedup (Stage D) drops anything that
           collides with neighbouring rows.

    Single-detection rows still extend bidirectionally along the ROI axis.
    """
    if not row:
        return []

    row_wp = float(np.median([slot.width for slot in row]))
    row_hp = float(np.median([slot.height for slot in row]))

    w_dir = _width_dir(
        mean_width_axis_angle([slot.angle_rad for slot in row]),
    )
    pitch_dir = roi_axis_unit if roi_axis_unit is not None else w_dir

    row_angle, row_wp, row_hp, n_total, n_fallback = _resolve_row_orientation(
        row, pitch_dir, row_wp, row_hp, s,
        pitch_from_roi=pitch_from_roi,
    )

    pitch_deg = (
        math.degrees(_wrap_pi_half(math.atan2(float(pitch_dir[1]), float(pitch_dir[0]))))
        if pitch_dir is not None else float("nan")
    )
    logger.info(
        "Row %s: n=%d (fallback=%d), row_angle=%.1f°, pitch=%.1f°, "
        "Δ=%.1f°, wp=%.1fpx hp=%.1fpx",
        row[0].row_id, n_total, n_fallback,
        math.degrees(row_angle), pitch_deg,
        math.degrees(_angle_diff(
            row_angle,
            _wrap_pi_half(math.atan2(float(pitch_dir[1]), float(pitch_dir[0]))),
        )) if pitch_dir is not None else float("nan"),
        row_wp, row_hp,
    )

    ref_row_id = row[0].row_id

    # Clean reference line for the row: pitch_dir + median perpendicular
    # offset of all anchors. Synthesised slots (gap_fill, extension) snap to
    # this line so SAM3 per-anchor perpendicular noise does not propagate to
    # the post-process output.
    perp_dir, median_perp = _row_reference_line(row, pitch_dir)

    projections = [
        (float(np.dot(np.array([slot.center_x, slot.center_y]), pitch_dir)), slot)
        for slot in row
    ]
    projections.sort(key=lambda x: x[0])
    sorted_slots = [p[1] for p in projections]
    fill_pitch = _median_adjacent_pitch(
        sorted_slots, pitch_dir, row_wp, s.gap_fill_threshold,
    )
    row_wp_fill = min(row_wp, fill_pitch) if fill_pitch > 0 else row_wp

    if row_wp_fill < s.min_row_wp_px:
        logger.info(
            "Row %s: wp_fill %.1fpx < min_row_wp_px — skipping synthesis",
            ref_row_id, row_wp_fill,
        )
        return []

    new_slots: list[PixelSlot] = []

    if len(sorted_slots) >= 2:
        new_slots.extend(_fill_gaps_between_consecutive(
            sorted_slots, pitch_dir, perp_dir, median_perp,
            row_wp_fill, row_hp, row_angle,
            ref_row_id, dt_mask, s,
        ))

    # Row extension only after gap-fill: walks the ROI mask outward; dedup
    # removes anything that lands on an existing anchor or sibling row.
    extension_anchors = sorted(
        sorted_slots + new_slots,
        key=lambda slot: float(
            np.dot(np.array([slot.center_x, slot.center_y]), pitch_dir),
        ),
    )
    new_slots.extend(_extend_row_endpoints(
        extension_anchors, pitch_dir, perp_dir, median_perp,
        row_wp_fill, row_hp, row_angle,
        ref_row_id, dt_mask, s,
    ))

    return new_slots


# ── Stage C — Uncovered mask region recovery ─────────────────────────────


def _recover_uncovered(
    current_slots: list[PixelSlot],
    binary_mask: np.ndarray,
    dt_mask: np.ndarray,
    ref_detection_slots: list[PixelSlot],
    s: GeometrySettings,
    prior: GeometricPrior | None = None,
    roi_axis_unit: np.ndarray | None = None,
    *,
    pitch_from_roi: bool = False,
) -> list[PixelSlot]:
    """Find mask regions with no coverage and fill them via propagation.

    Slot OBB orientation matches SAM3 / prior medians — recovery slots
    stay parallel to detected ones. The *step direction* used to walk the
    island is taken from *roi_axis_unit* when supplied (= ROI long axis,
    i.e. the row-pitch direction); falling back to the slot's width axis
    when absent. This split matters for angled-bay parking, where the slot
    width axis (≈ −53°) and the rectangle long axis (≈ −22°) differ — pre-fix
    behavior stepped along the slot width and drifted off the strip in 2-3
    iterations.

    Skipped early when neither SAM3 nor a trusted prior provides enough evidence
    to derive a reliable slot gabarit — sparse anchors produce huge spurious
    grids on car-segmented or low-quality masks.
    """
    n_anchors = len(ref_detection_slots)
    trusted_prior = _prior_trusted_for_sparse_recovery(prior, s)

    if n_anchors < s.min_anchors_for_recovery and not trusted_prior:
        logger.info(
            "Stage C skipped: %d anchors < min_anchors_for_recovery=%d and prior not trusted",
            n_anchors, s.min_anchors_for_recovery,
        )
        return []

    if prior is not None and not trusted_prior and prior.confidence < s.recovery_min_prior_confidence:
        logger.info(
            "Stage C skipped: prior conf %.2f < %.2f (source=%s)",
            prior.confidence, s.recovery_min_prior_confidence, prior.source.value,
        )
        return []

    if ref_detection_slots:
        global_wp = float(np.median([slot.width for slot in ref_detection_slots]))
        global_hp = float(np.median([slot.height for slot in ref_detection_slots]))
        recovery_angle, _, _, _, _ = _resolve_row_orientation(
            ref_detection_slots,
            roi_axis_unit,
            global_wp,
            global_hp,
            s,
            pitch_from_roi=pitch_from_roi,
        )
    elif prior is not None:
        global_wp = prior.slot_width_px
        global_hp = prior.slot_height_px
        recovery_angle = float(prior.orientation_rad)
    else:
        return []

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
        # OBB orientation follows SAM3 / prior anchors so recovery slots stay
        # parallel to detections. Step direction comes from the ROI long axis
        # when available (true row-pitch direction), otherwise from the slot's
        # own width axis as a fallback.
        slot_angle = recovery_angle
        step_dir = roi_axis_unit if roi_axis_unit is not None else _width_dir(slot_angle)

        def _fill_island(direction_sign: float) -> None:
            curr = np.array([seed_x, seed_y], dtype=float)
            step = direction_sign * global_wp * step_dir

            if direction_sign == 1.0:
                new_slots.append(PixelSlot(
                    center_x=float(seed_x), center_y=float(seed_y),
                    width=global_wp, height=global_hp,
                    angle_rad=slot_angle, confidence=s.recovery_confidence,
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
                    angle_rad=slot_angle, confidence=s.recovery_confidence,
                    class_id=0, source=SlotSource.mask_recovery,
                ))

        _fill_island(1.0)
        _fill_island(-1.0)

    return new_slots


# ── Stage D — Deduplication and mask validation ──────────────────────────


def _tier_priority(slot: PixelSlot) -> int:
    if slot.source == SlotSource.sam3:
        return 2
    return 0


def _roi_corners_inside(
    slot: PixelSlot,
    roi_mask: np.ndarray,
    min_inside: int = 2,
) -> bool:
    """At least *min_inside* OBB corners must fall on the ROI foreground.

    SAM3 anchors bypass this check — only synthesized slots are boundary-clipped.
    """
    h_max, w_max = roi_mask.shape[:2]
    corners = pixel_obb_corners_float(
        slot.center_x, slot.center_y, slot.width, slot.height, slot.angle_rad,
    )
    inside = 0
    for px, py in corners:
        iy, ix = int(round(py)), int(round(px))
        if 0 <= iy < h_max and 0 <= ix < w_max and roi_mask[iy, ix] > 0:
            inside += 1
    return inside >= min_inside


def _dedup_and_validate(
    all_slots: list[PixelSlot],
    binary_mask: np.ndarray,
    s: GeometrySettings,
    prior: GeometricPrior | None = None,
    roi_mask: np.ndarray | None = None,
) -> list[PixelSlot]:
    """Remove overlapping spots, apply mask constraints, and rank by source."""
    h_max, w_max = binary_mask.shape[:2]
    boundary_mask = roi_mask if roi_mask is not None else binary_mask

    fg = binary_mask > 0
    dist_to_fg = distance_transform_edt(~np.asarray(fg))

    anchor_sources = (SlotSource.sam3,)
    synthetic_sources = (
        SlotSource.gap_fill,
        SlotSource.mask_recovery,
    )

    def _mask_accepts(slot: PixelSlot) -> bool:
        iy, ix = int(slot.center_y), int(slot.center_x)
        if not (0 <= iy < h_max and 0 <= ix < w_max):
            return False
        if binary_mask[iy, ix] > 0:
            return True
        # Only operator-trusted priors can rescue a slot whose center fell
        # Loosening this for sam3_median / roi_pca routinely
        # lets recovery slots survive in driving aisles between mask stripes.
        if (
            prior is not None
            and prior.source.value == "operator_hint"
            and s.prior_mask_center_tolerance > 0.0
        ):
            tol = prior.slot_width_px * s.prior_mask_center_tolerance
            return float(dist_to_fg[iy, ix]) <= tol
        # SAM3 detections bypass the strict on-mask check: they are the primary
        # observable anchors. The segmenter routinely misses empty stalls whose
        # asphalt blends with the driving aisle.
        if slot.source in anchor_sources:
            return True
        return False

    def _roi_accepts(slot: PixelSlot) -> bool:
        """Synthesized slots must have ≥2 corners inside the ROI boundary."""
        if slot.source in anchor_sources:
            return True
        return _roi_corners_inside(slot, boundary_mask, min_inside=2)

    all_slots.sort(
        key=lambda slot: (_tier_priority(slot), slot.confidence),
        reverse=True,
    )

    kept: list[PixelSlot] = []

    for slot in all_slots:
        if not _mask_accepts(slot):
            continue
        if not _roi_accepts(slot):
            continue

        slot_box = _corners_float(
            slot.center_x, slot.center_y, slot.width, slot.height, slot.angle_rad,
        )
        slot_area = slot.width * slot.height
        overlap = False

        for k_slot in kept:
            if slot.source in anchor_sources and k_slot.source in anchor_sources:
                continue
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
            min_area = min(slot_area, k_slot.width * k_slot.height)
            iou_threshold = s.iou_dedup_threshold
            if (
                slot.source in synthetic_sources
                and k_slot.source in anchor_sources
            ):
                iou_threshold = min(iou_threshold, s.gap_fill_max_anchor_iou)
            if inter_area > iou_threshold * min_area:
                overlap = True
                break

        if not overlap:
            kept.append(slot)

    return kept


# ── Public API ────────────────────────────────────────────────────────────


def _geometry_settings_for_gsd(
    settings: GeometrySettings,
    gsd_m: float | None,
) -> GeometrySettings:
    """Scale ``min_row_wp_px`` from metres when GSD is known."""
    if gsd_m is not None and gsd_m > 0:
        return settings.model_copy(
            update={"min_row_wp_px": settings.min_row_wp_m / gsd_m},
        )
    return settings


class GeometricEngine:
    """Post-processing engine: row clustering → gap fill → dedup.

    **Detection invariance:** inputs from SAM3 (`SlotSource.sam3`) are never
    altered in ``center_*``, ``width``, ``height``, or ``angle_rad``. The engine
    works on shallow copies so cluster ``row_id`` and dedup ordering do not
    mutate the caller's ``PixelSlot`` instances. Only *synthesised* ``gap_fill``
    slots take orientation and gabarit from row aggregates — strictly between
    the first and last SAM3 anchor of each row, inside the ROI mask.

    When ``roi_mask`` is passed, stages B–D use the operator ROI raster (polygon
    projected on the crop grid) instead of the SegFormer mask. Stages B–D fall
    back to *seg_mask* when ``roi_mask`` is omitted (e.g. unit tests).

    Stage C (mask recovery) runs only when ``GeometrySettings.enable_mask_recovery``
    is True (off by default).
    """

    def __init__(self, settings: GeometrySettings | None = None) -> None:
        self._s = settings or GeometrySettings()

    def process(
        self,
        pixel_slots: list[PixelSlot],
        seg_mask: np.ndarray,
        prior: GeometricPrior | None = None,
        roi_mask: np.ndarray | None = None,
        gsd_m: float | None = None,
    ) -> list[PixelSlot]:
        """Run full geometric post-processing on detector anchors and seg mask.

        *prior* supplies global width/height when SAM3 anchors are absent (mask
        recovery).

        SAM3 / anchor geometry in *pixel_slots* is copied before clustering; the
        returned list contains those copies for anchor sources plus new slots.
        Callers keep their original ``PixelSlot`` list unchanged (including
        ``angle_rad`` from :func:`~autoabsmap.generator_engine.stages.detections_to_pixel_slots`).

        *roi_mask* (optional): 2D uint8 binary mask of the operator ROI polygon
        rasterised on the same grid as *seg_mask*. When provided, stages B–D
        use this mask (distance transform + foreground test) instead of
        *seg_mask* — recovery and dedup agree with the drawn ROI, not the
        segmenter. When omitted, the segmentation mask guides all stages.
        """
        if seg_mask.ndim != 2:
            raise ValueError(f"seg_mask must be 2D, got shape {seg_mask.shape}")
        if roi_mask is not None:
            if roi_mask.ndim != 2:
                raise ValueError(f"roi_mask must be 2D, got shape {roi_mask.shape}")
            if roi_mask.shape != seg_mask.shape:
                raise ValueError(
                    f"roi_mask shape {roi_mask.shape} != seg_mask shape {seg_mask.shape}",
                )

        if not pixel_slots:
            logger.info("GeometricEngine: no input slots — skipping")
            return []

        stage_settings = _geometry_settings_for_gsd(self._s, gsd_m)
        if gsd_m is not None and gsd_m > 0:
            logger.info(
                "Pitch floor: min_row_wp_px=%.1f (%.2fm @ gsd=%.3fm/px)",
                stage_settings.min_row_wp_px,
                stage_settings.min_row_wp_m,
                gsd_m,
            )

        # Work on copies so detector-issued slots (SAM3) are never mutated —
        # only row_id is written during clustering.
        working_slots = [s.model_copy() for s in pixel_slots]

        _, binary = cv2.threshold(seg_mask, 127, 255, cv2.THRESH_BINARY)
        dt = cv2.distanceTransform(binary, cv2.DIST_L2, 5)

        if roi_mask is not None:
            _, binary_b = cv2.threshold(roi_mask, 127, 255, cv2.THRESH_BINARY)
            dt_b = cv2.distanceTransform(binary_b, cv2.DIST_L2, 5)
            stage_b_source = "roi"
        else:
            binary_b = binary
            dt_b = dt
            stage_b_source = "seg"

        # Row-pitch direction = ROI long axis (PCA on the binding mask).
        # Decoupled from SAM3 ``angle_rad`` so angled-bay parking works:
        # OBB orientation stays = slot width axis, but stepping uses the
        # rectangle's actual long direction. ``None`` when the mask is too
        # sparse or square-ish — stages B/C then keep their previous behavior.
        roi_axis_unit = _roi_long_axis_unit(
            binary_b, stage_settings.pca_min_points, stage_settings.roi_axis_min_eigval_ratio,
        )
        if roi_axis_unit is not None:
            logger.info(
                "ROI long axis (%s): unit=(%.3f, %.3f) → %.1f°",
                stage_b_source, roi_axis_unit[0], roi_axis_unit[1],
                math.degrees(math.atan2(roi_axis_unit[1], roi_axis_unit[0])),
            )

        sam3_only = [s for s in working_slots if s.source == SlotSource.sam3]
        n_fallback_total = sum(1 for s in sam3_only if s.is_fallback)

        # A. Row clustering (SAM3 vehicle anchors)
        rows = _cluster_rows(working_slots, stage_settings)
        logger.info(
            "Stage A: %d rows from %d detections (%d fallback, row_axis_factor=%.1f)",
            len(rows), len(working_slots), n_fallback_total, stage_settings.row_axis_factor,
        )

        pitch_from_roi = roi_mask is not None

        # B. Gap filling + row extension — guided by ROI if provided, else seg.
        enriched = list(working_slots)
        for row in rows:
            enriched.extend(
                _process_row(
                    row, dt_b, stage_settings, roi_axis_unit,
                    pitch_from_roi=pitch_from_roi,
                ),
            )
        n_added_b = len(enriched) - len(working_slots)
        logger.info(
            "Stage B (%s-guided): +%d gap-fill slots",
            stage_b_source, n_added_b,
        )

        # C. Uncovered region recovery — disabled by default (gap-fill only).
        if stage_settings.enable_mask_recovery:
            recovered = _recover_uncovered(
                enriched, binary_b, dt_b, sam3_only, stage_settings,
                prior=prior, roi_axis_unit=roi_axis_unit,
                pitch_from_roi=pitch_from_roi,
            )
            enriched.extend(recovered)
            logger.info(
                "Stage C (%s-guided): +%d mask-recovery slots",
                stage_b_source, len(recovered),
            )
        else:
            logger.info("Stage C skipped: enable_mask_recovery=False")

        # D. Deduplication and mask validation — same guidance mask as B.
        #    roi_mask drives the corner boundary check (≥2 of 4 corners inside).
        final = _dedup_and_validate(
            enriched, binary_b, stage_settings, prior=prior, roi_mask=binary_b,
        )
        logger.info(
            "Stage D: %d → %d after dedup (removed %d)",
            len(enriched), len(final), len(enriched) - len(final),
        )

        return final
