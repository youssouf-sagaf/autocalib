"""ReprocessingHelper — auto-fill missed parking pockets.

When the Generator Engine misses an entire pocket (no detections),
per-click manual Add is too slow.  The Reprocessing Helper takes one
correct slot (the *pattern*) and a scoped region drawn by the operator,
then auto-fills the missed area using geometric row extension.

Algorithm:
1. Extract geometry from reference slot (angle, width, height, pitch)
2. Clip scope with segmentation mask (if available — requires affine metadata, V2)
3. Row extension — place new slots at regular pitch intervals within scope
4. Parallel row fill — extend into adjacent rows if scope covers them
5. Dedup against existing_slots (IoU > threshold)
6. Return proposals with source='auto_reprocess'

Composes coordinate helpers similar to alignment_tool — but the purpose
is *placement*, not *correction*.
"""

from __future__ import annotations

import logging
import math
import uuid
from dataclasses import dataclass

from geojson_pydantic import Polygon as GeoJSONPolygon
from shapely.geometry import Point
from shapely.geometry import Polygon as ShapelyPolygon
from shapely.geometry import shape

from autoabsmap.config.settings import ReprocessingSettings
from autoabsmap.export.models import GeoSlot, LngLat, SlotSource
from autoabsmap.reprocessing_helper.models import ReprocessRequest, ReprocessResult

logger = logging.getLogger(__name__)

__all__ = ["ReprocessingHelper"]

_EARTH_R = 6_378_137.0
_DEG2M_LAT = math.pi * _EARTH_R / 180.0


# ── Internal candidate representation ─────────────────────────────────────


@dataclass
class _Candidate:
    """A candidate slot position in local metric coordinates."""

    cx: float
    cy: float
    angle_rad: float
    width: float
    height: float


# ── Coordinate helpers (equirectangular, same convention as alignment_tool) ─


def _deg2m_lng(lat_rad: float) -> float:
    return _DEG2M_LAT * math.cos(lat_rad)


def _to_local(
    lng: float, lat: float, ref_lng: float, ref_lat: float,
) -> tuple[float, float]:
    lat_rad = math.radians(ref_lat)
    return (lng - ref_lng) * _deg2m_lng(lat_rad), (lat - ref_lat) * _DEG2M_LAT


def _to_wgs84(
    x: float, y: float, ref_lng: float, ref_lat: float,
) -> tuple[float, float]:
    lat_rad = math.radians(ref_lat)
    return ref_lng + x / _deg2m_lng(lat_rad), ref_lat + y / _DEG2M_LAT


def _wrap_pi(a: float) -> float:
    a = a % math.pi
    if a > math.pi / 2:
        a -= math.pi
    return a


# ── Pattern extraction ────────────────────────────────────────────────────


def _extract_pattern(
    slot: GeoSlot, ref_lng: float, ref_lat: float,
) -> _Candidate:
    """Extract local-metric OBB geometry from a GeoSlot."""
    ring = slot.polygon.coordinates[0]
    corners = [_to_local(c[0], c[1], ref_lng, ref_lat) for c in ring[:4]]
    cx, cy = _to_local(slot.center.lng, slot.center.lat, ref_lng, ref_lat)

    e01 = (corners[1][0] - corners[0][0], corners[1][1] - corners[0][1])
    e12 = (corners[2][0] - corners[1][0], corners[2][1] - corners[1][1])
    len01, len12 = math.hypot(*e01), math.hypot(*e12)

    if len01 <= len12:
        width, height = len01, len12
        angle = math.atan2(e01[1], e01[0])
    else:
        width, height = len12, len01
        angle = math.atan2(e12[1], e12[0])

    return _Candidate(cx, cy, _wrap_pi(angle), max(width, 0.01), max(height, 0.01))


# ── Pitch estimation ─────────────────────────────────────────────────────


def _estimate_pitch(
    ref: _Candidate,
    existing_slots: list[GeoSlot],
    ref_lng: float,
    ref_lat: float,
    fallback_factor: float,
) -> float:
    """Estimate centre-to-centre spacing along the row axis.

    Uses the nearest angle-compatible existing neighbour.
    Falls back to ``fallback_factor × slot width`` if none found.
    """
    ca, sa = math.cos(ref.angle_rad), math.sin(ref.angle_rad)
    best_along = float("inf")

    for slot in existing_slots:
        pat = _extract_pattern(slot, ref_lng, ref_lat)
        if abs(_wrap_pi(pat.angle_rad - ref.angle_rad)) > math.radians(20):
            continue
        along = abs((pat.cx - ref.cx) * ca + (pat.cy - ref.cy) * sa)
        if 0.5 < along < best_along:
            best_along = along

    return best_along if best_along < float("inf") else ref.width * fallback_factor


# ── Candidate generation ─────────────────────────────────────────────────


def _candidate_obb_wgs84(
    cand: _Candidate, ref_lng: float, ref_lat: float,
) -> ShapelyPolygon:
    """Build the WGS84 OBB polygon for a candidate (for containment checks)."""
    corners = _obb_corners(cand)
    ring = [_to_wgs84(x, y, ref_lng, ref_lat) for x, y in corners]
    ring.append(ring[0])
    return ShapelyPolygon(ring)


def _generate_candidates(
    ref: _Candidate,
    pitch: float,
    scope_shape: ShapelyPolygon,
    ref_lng: float,
    ref_lat: float,
    settings: ReprocessingSettings,
) -> list[_Candidate]:
    """Place candidate slots along the reference row and adjacent parallel rows.

    For each row (reference + parallel offsets), walk in both directions
    along the row axis.  A candidate is emitted when its **entire OBB**
    fits inside the scope polygon — not just the centre.  Walking stops
    after 2 consecutive misses (irregular scope boundary tolerance).
    """
    row_dx = math.cos(ref.angle_rad)
    row_dy = math.sin(ref.angle_rad)
    perp_dx = -math.sin(ref.angle_rad)
    perp_dy = math.cos(ref.angle_rad)

    row_spacing = ref.height * 1.1

    row_offsets = [0]
    if settings.parallel_row_search:
        for i in range(1, settings.max_parallel_rows + 1):
            row_offsets.extend([i, -i])

    candidates: list[_Candidate] = []

    for row_off in row_offsets:
        base_cx = ref.cx + row_off * row_spacing * perp_dx
        base_cy = ref.cy + row_off * row_spacing * perp_dy

        for direction in (+1, -1):
            consecutive_out = 0
            for step in range(settings.max_row_slots):
                if step == 0 and direction == -1:
                    continue  # centre already covered by +1 walk
                if step == 0 and row_off == 0:
                    continue  # reference slot position — already exists

                cx = base_cx + step * direction * pitch * row_dx
                cy = base_cy + step * direction * pitch * row_dy

                cand = _Candidate(cx, cy, ref.angle_rad, ref.width, ref.height)
                obb = _candidate_obb_wgs84(cand, ref_lng, ref_lat)
                if scope_shape.contains(obb):
                    candidates.append(cand)
                    consecutive_out = 0
                else:
                    consecutive_out += 1
                    if consecutive_out >= 2:
                        break

    return candidates


# ── OBB IoU ───────────────────────────────────────────────────────────────


def _obb_corners(c: _Candidate) -> list[tuple[float, float]]:
    hw, hh = c.width / 2, c.height / 2
    ca, sa = math.cos(c.angle_rad), math.sin(c.angle_rad)
    return [
        (c.cx + dx * ca - dy * sa, c.cy + dx * sa + dy * ca)
        for dx, dy in [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
    ]


def _iou(corners_a: list[tuple[float, float]], corners_b: list[tuple[float, float]]) -> float:
    """IoU of two OBBs from their corners in local metric coordinates."""
    pa = ShapelyPolygon(corners_a)
    pb = ShapelyPolygon(corners_b)
    if not pa.is_valid:
        pa = pa.buffer(0)
    if not pb.is_valid:
        pb = pb.buffer(0)
    if pa.is_empty or pb.is_empty:
        return 0.0
    inter = pa.intersection(pb).area
    union = pa.union(pb).area
    return inter / union if union > 0 else 0.0


# ── Deduplication ─────────────────────────────────────────────────────────


def _dedup(
    candidates: list[_Candidate],
    existing_slots: list[GeoSlot],
    reference_slot: GeoSlot,
    ref_lng: float,
    ref_lat: float,
    iou_threshold: float,
) -> list[_Candidate]:
    """Remove candidates overlapping existing slots or the reference."""
    blockers: list[list[tuple[float, float]]] = []
    for slot in [reference_slot, *existing_slots]:
        pat = _extract_pattern(slot, ref_lng, ref_lat)
        blockers.append(_obb_corners(pat))

    kept: list[_Candidate] = []
    for cand in candidates:
        cc = _obb_corners(cand)
        duplicate = False
        for bc in blockers:
            if _iou(cc, bc) > iou_threshold:
                duplicate = True
                break
        if not duplicate:
            for prev in kept:
                if _iou(cc, _obb_corners(prev)) > iou_threshold:
                    duplicate = True
                    break
        if not duplicate:
            kept.append(cand)

    return kept


# ── GeoSlot reconstruction ───────────────────────────────────────────────


def _build_geoslot(
    cand: _Candidate, ref_lng: float, ref_lat: float, confidence: float,
) -> GeoSlot:
    clng, clat = _to_wgs84(cand.cx, cand.cy, ref_lng, ref_lat)

    hw, hh = cand.width / 2, cand.height / 2
    ca, sa = math.cos(cand.angle_rad), math.sin(cand.angle_rad)
    ring = []
    for dx, dy in [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]:
        lx = cand.cx + dx * ca - dy * sa
        ly = cand.cy + dx * sa + dy * ca
        ring.append(list(_to_wgs84(lx, ly, ref_lng, ref_lat)))
    ring.append(ring[0])

    return GeoSlot(
        slot_id=str(uuid.uuid4()),
        center=LngLat(lng=clng, lat=clat),
        polygon=GeoJSONPolygon(type="Polygon", coordinates=[ring]),
        source=SlotSource.auto_reprocess,
        confidence=confidence,
    )


# ── Public API ────────────────────────────────────────────────────────────


class ReprocessingHelper:
    """Auto-fill missed parking pockets from a reference slot + scope.

    The operator places one correct slot (the *pattern*) and draws a scope
    region.  The helper generates new slots at regular intervals that fit
    inside the scope, deduplicates against existing slots, and returns
    proposals for operator review.
    """

    def __init__(self, settings: ReprocessingSettings | None = None) -> None:
        self._s = settings or ReprocessingSettings()

    def reprocess(self, request: ReprocessRequest) -> ReprocessResult:
        ref = request.reference_slot
        ref_lng, ref_lat = ref.center.lng, ref.center.lat

        # 1. Extract pattern from the reference slot
        pattern = _extract_pattern(ref, ref_lng, ref_lat)

        # 2. Estimate pitch from nearest existing neighbour
        pitch = _estimate_pitch(
            pattern, request.existing_slots, ref_lng, ref_lat,
            self._s.pitch_fallback_factor,
        )

        # 3. Build scope shape for point-in-polygon checks
        #    (mask clipping deferred to V2 — requires affine metadata in request)
        scope_shape = shape(request.scope_polygon.model_dump())
        if request.seg_mask is not None:
            logger.info(
                "seg_mask provided but mask-clipping requires affine metadata "
                "(not yet in ReprocessRequest) — using scope polygon only",
            )

        # 4. Generate candidate positions (row extension + parallel rows)
        candidates = _generate_candidates(
            pattern, pitch, scope_shape, ref_lng, ref_lat, self._s,
        )
        if not candidates:
            logger.info("No candidate positions within scope")
            return ReprocessResult(proposed_slots=[])

        # 5. Dedup against existing slots + reference
        kept = _dedup(
            candidates, request.existing_slots, ref,
            ref_lng, ref_lat, self._s.iou_dedup_threshold,
        )

        # 6. Build GeoSlots
        proposed = [
            _build_geoslot(c, ref_lng, ref_lat, self._s.reprocess_confidence)
            for c in kept
        ]

        logger.info(
            "Reprocessing: %d candidates generated, %d kept after dedup",
            len(candidates), len(proposed),
        )
        return ReprocessResult(proposed_slots=proposed)
