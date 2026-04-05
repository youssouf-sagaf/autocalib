"""RowStraightener — directed corridor walk with rolling direction update.

Algorithm (V1 — straight rows only, curved rows deferred to V2):

1. Estimate local direction from K nearest neighbors (median angle)
2. Open a narrow corridor (1–1.5× slot width) centered on the reference slot
3. Walk the corridor in both directions, accepting slots by:
   - centroid inside corridor
   - angle compatible with current direction
   - spacing consistent with estimated pitch
   Rolling direction update after each accepted slot (handles gentle curves)
4. Stop when: no valid slot found / angle breaks sharply
5. Apply correction:
   - Orientation: rotate each OBB to median angle of all row members
   - Alignment: snap centroids onto fitted row axis
   - Footprints: width and length unchanged (only center + angle move)
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass

import numpy as np
from geojson_pydantic import Polygon as GeoJSONPolygon

from autoabsmap.config.settings import AlignmentSettings
from autoabsmap.export.models import GeoSlot, LngLat

logger = logging.getLogger(__name__)

__all__ = ["RowStraightener"]

_EARTH_R = 6_378_137.0  # WGS84 semi-major axis (metres)
_DEG2M_LAT = math.pi * _EARTH_R / 180.0


# ── Internal slot representation in local metric coords ───────────────────


@dataclass
class _LocalSlot:
    geo_slot: GeoSlot
    cx: float
    cy: float
    angle_rad: float  # rotation angle of the OBB (width-axis direction)
    width: float  # shorter dimension (along row)
    height: float  # longer dimension (slot depth)


# ── Coordinate conversion (equirectangular, accurate at parking-lot scale) ─


def _deg2m_lng(lat_rad: float) -> float:
    return _DEG2M_LAT * math.cos(lat_rad)


def _to_local(
    lng: float, lat: float, ref_lng: float, ref_lat: float,
) -> tuple[float, float]:
    """WGS84 degrees → local metres centred on (ref_lng, ref_lat)."""
    lat_rad = math.radians(ref_lat)
    return (lng - ref_lng) * _deg2m_lng(lat_rad), (lat - ref_lat) * _DEG2M_LAT


def _to_wgs84(
    x: float, y: float, ref_lng: float, ref_lat: float,
) -> tuple[float, float]:
    """Local metres → WGS84 degrees."""
    lat_rad = math.radians(ref_lat)
    return ref_lng + x / _deg2m_lng(lat_rad), ref_lat + y / _DEG2M_LAT


# ── Angle helpers (OBB has 180° symmetry) ─────────────────────────────────


def _wrap_pi(a: float) -> float:
    """Normalise angle to [-π/2, π/2] respecting OBB 180° symmetry."""
    a = a % math.pi
    if a > math.pi / 2:
        a -= math.pi
    return a


def _angle_diff(a: float, b: float) -> float:
    """Smallest absolute angle difference with 180° symmetry."""
    return abs(_wrap_pi(a - b))


def _circular_median(angles: list[float]) -> float:
    """Circular median of angles with 180° symmetry."""
    if not angles:
        return 0.0
    ref = angles[0]
    diffs = [_wrap_pi(a - ref) for a in angles]
    return _wrap_pi(ref + float(np.median(diffs)))


# ── Geometry extraction / reconstruction ──────────────────────────────────


def _extract_local_slot(
    slot: GeoSlot, ref_lng: float, ref_lat: float,
) -> _LocalSlot:
    """Convert a GeoSlot polygon into local metric geometry.

    Determines width/height from the two edge lengths of the OBB
    and extracts the rotation angle from the shorter (width) edge direction.
    """
    ring = slot.polygon.coordinates[0]
    corners = [_to_local(c[0], c[1], ref_lng, ref_lat) for c in ring[:4]]
    cx, cy = _to_local(slot.center.lng, slot.center.lat, ref_lng, ref_lat)

    e01 = (corners[1][0] - corners[0][0], corners[1][1] - corners[0][1])
    e12 = (corners[2][0] - corners[1][0], corners[2][1] - corners[1][1])
    len01 = math.hypot(*e01)
    len12 = math.hypot(*e12)

    if len01 <= len12:
        width, height = len01, len12
        angle = math.atan2(e01[1], e01[0])
    else:
        width, height = len12, len01
        angle = math.atan2(e12[1], e12[0])

    return _LocalSlot(
        geo_slot=slot, cx=cx, cy=cy,
        angle_rad=_wrap_pi(angle),
        width=max(width, 0.01), height=max(height, 0.01),
    )


def _build_obb_polygon(
    cx: float, cy: float, w: float, h: float, angle: float,
    ref_lng: float, ref_lat: float,
) -> GeoJSONPolygon:
    """Reconstruct a GeoJSON OBB polygon from local metric parameters."""
    hw, hh = w / 2, h / 2
    ca, sa = math.cos(angle), math.sin(angle)
    ring = []
    for dx, dy in [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]:
        lx = cx + dx * ca - dy * sa
        ly = cy + dx * sa + dy * ca
        ring.append(list(_to_wgs84(lx, ly, ref_lng, ref_lat)))
    ring.append(ring[0])
    return GeoJSONPolygon(type="Polygon", coordinates=[ring])


def _rebuild_geoslot(local: _LocalSlot, ref_lng: float, ref_lat: float) -> GeoSlot:
    """Create a corrected GeoSlot from local-metric geometry."""
    clng, clat = _to_wgs84(local.cx, local.cy, ref_lng, ref_lat)
    poly = _build_obb_polygon(
        local.cx, local.cy, local.width, local.height,
        local.angle_rad, ref_lng, ref_lat,
    )
    return GeoSlot(
        slot_id=local.geo_slot.slot_id,
        center=LngLat(lng=clng, lat=clat),
        polygon=poly,
        source=local.geo_slot.source,
        confidence=local.geo_slot.confidence,
        status=local.geo_slot.status,
    )


# ── Row discovery helpers ─────────────────────────────────────────────────


def _find_k_nearest(
    ref: _LocalSlot, all_locals: list[_LocalSlot], k: int,
) -> list[_LocalSlot]:
    others = [s for s in all_locals if s.geo_slot.slot_id != ref.geo_slot.slot_id]
    others.sort(key=lambda s: math.hypot(s.cx - ref.cx, s.cy - ref.cy))
    return others[:k]


def _estimate_pitch(
    ref: _LocalSlot,
    neighbors: list[_LocalSlot],
    row_angle: float,
    angle_tol: float,
) -> float:
    """Estimate row pitch (centre-to-centre spacing along the row axis).

    Uses the median along-axis distance of angle-compatible neighbours.
    Falls back to 1.2× slot width if no compatible neighbour is found.
    """
    ca, sa = math.cos(row_angle), math.sin(row_angle)
    along: list[float] = []
    for n in neighbors:
        if _angle_diff(n.angle_rad, row_angle) > angle_tol:
            continue
        d = abs((n.cx - ref.cx) * ca + (n.cy - ref.cy) * sa)
        if d > 0.1:
            along.append(d)
    return float(np.median(along)) if along else ref.width * 1.2


def _walk_direction(
    start: _LocalSlot,
    candidates: list[_LocalSlot],
    direction: int,
    row_angle: float,
    corridor_hw: float,
    pitch: float,
    angle_tol: float,
    pitch_tol: float,
    max_gaps: int,
    rolling_alpha: float,
    visited: set[str],
) -> list[_LocalSlot]:
    """Walk along the row in one direction, collecting compatible slots.

    At each step the nearest unvisited slot that satisfies corridor, angle,
    and distance constraints is accepted. The search direction is updated via
    exponential moving average (``rolling_alpha``).
    """
    current = start
    cur_angle = row_angle
    result: list[_LocalSlot] = []
    misses = 0

    for _ in range(50):  # hard safety limit
        if misses >= max_gaps:
            break

        d_ca = math.cos(cur_angle) * direction
        d_sa = math.sin(cur_angle) * direction

        best: _LocalSlot | None = None
        best_along = float("inf")

        for s in candidates:
            if s.geo_slot.slot_id in visited:
                continue
            rx = s.cx - current.cx
            ry = s.cy - current.cy
            along = rx * d_ca + ry * d_sa
            if along <= 0:
                continue
            perp = abs(-rx * d_sa + ry * d_ca)
            if perp > corridor_hw:
                continue
            if _angle_diff(s.angle_rad, cur_angle) > angle_tol:
                continue
            max_reach = pitch * (1.0 + pitch_tol) * (misses + 1.5)
            if along > max_reach:
                continue
            if along < best_along:
                best_along = along
                best = s

        if best is not None:
            result.append(best)
            visited.add(best.geo_slot.slot_id)
            cur_angle = _wrap_pi(
                cur_angle + rolling_alpha * _wrap_pi(best.angle_rad - cur_angle),
            )
            current = best
            misses = 0
        else:
            misses += 1
            # Advance the virtual position so the next iteration searches further
            current = _LocalSlot(
                geo_slot=current.geo_slot,
                cx=current.cx + d_ca * pitch,
                cy=current.cy + d_sa * pitch,
                angle_rad=cur_angle,
                width=current.width,
                height=current.height,
            )

    return result


# ── Correction ────────────────────────────────────────────────────────────


def _apply_correction(row: list[_LocalSlot]) -> list[_LocalSlot]:
    """Snap all row members to a shared angle and a fitted row axis.

    - Orientation: each OBB rotated to the circular median angle.
    - Alignment: each centroid projected onto the row axis (line through
      the row's mean centre in the median-angle direction).
    - Width/height: unchanged.
    """
    target = _circular_median([s.angle_rad for s in row])
    ca, sa = math.cos(target), math.sin(target)
    mx = sum(s.cx for s in row) / len(row)
    my = sum(s.cy for s in row) / len(row)

    corrected: list[_LocalSlot] = []
    for s in row:
        proj = (s.cx - mx) * ca + (s.cy - my) * sa
        corrected.append(_LocalSlot(
            geo_slot=s.geo_slot,
            cx=mx + proj * ca,
            cy=my + proj * sa,
            angle_rad=target,
            width=s.width,
            height=s.height,
        ))
    return corrected


# ── Public API ────────────────────────────────────────────────────────────


class RowStraightener:
    """Discover and straighten a parking row from a single reference slot.

    Returns corrected GeoSlots with uniform angle and collinear centroids.
    Width and height of each slot are preserved.
    Returns an empty list if the reference is isolated (no compatible row found).
    """

    def __init__(self, settings: AlignmentSettings | None = None) -> None:
        self._s = settings or AlignmentSettings()

    def straighten(
        self,
        reference_slot_id: str,
        all_slots: list[GeoSlot],
    ) -> list[GeoSlot]:
        ref_geo = next(
            (s for s in all_slots if s.slot_id == reference_slot_id), None,
        )
        if ref_geo is None:
            logger.warning("Reference slot %s not found", reference_slot_id)
            return []
        if len(all_slots) < 2:
            return []

        ref_lng, ref_lat = ref_geo.center.lng, ref_geo.center.lat

        all_local = [_extract_local_slot(s, ref_lng, ref_lat) for s in all_slots]
        ref_local = next(
            s for s in all_local if s.geo_slot.slot_id == reference_slot_id
        )

        neighbors = _find_k_nearest(ref_local, all_local, self._s.neighbor_count)
        if not neighbors:
            return []

        row_angle = _circular_median(
            [ref_local.angle_rad] + [n.angle_rad for n in neighbors],
        )
        angle_tol = math.radians(self._s.angle_tolerance_deg)
        pitch = _estimate_pitch(ref_local, neighbors, row_angle, angle_tol)
        corridor_hw = self._s.corridor_width_factor * ref_local.width / 2.0

        visited: set[str] = {reference_slot_id}

        fwd = _walk_direction(
            ref_local, all_local, +1, row_angle, corridor_hw, pitch,
            angle_tol, self._s.pitch_tolerance_factor, self._s.max_gap_steps,
            self._s.rolling_alpha, visited,
        )
        bwd = _walk_direction(
            ref_local, all_local, -1, row_angle, corridor_hw, pitch,
            angle_tol, self._s.pitch_tolerance_factor, self._s.max_gap_steps,
            self._s.rolling_alpha, visited,
        )

        row = list(reversed(bwd)) + [ref_local] + fwd

        if len(row) < 2:
            logger.info("Row too short (%d slot) — no correction proposed", len(row))
            return []

        corrected = _apply_correction(row)
        logger.info(
            "Straightened row: %d slots, target angle=%.1f°",
            len(corrected), math.degrees(corrected[0].angle_rad),
        )
        return [_rebuild_geoslot(s, ref_lng, ref_lat) for s in corrected]
