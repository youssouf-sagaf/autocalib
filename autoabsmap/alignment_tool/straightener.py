"""RowStraightener — align slots on one row from two anchor slots.

The operator picks any two slots on the same row (not necessarily the
outermost detections). The row axis is the line through their centroids in
local metric space (any map orientation / inclination). Slots are collected if
their OBB is parallel to that axis modulo 90° (short vs long edge ambiguity
from detection), their centroid lies in a perpendicular corridor, and their
projection falls between the anchors (with padding). Both anchors are always
included. Then:

- shared angle = row axis
- centroids projected onto the axis (line through mean centroid)
- footprint width/height unchanged
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass

from geojson_pydantic import Polygon as GeoJSONPolygon

from autoabsmap.config.settings import AlignmentSettings
from autoabsmap.export.models import GeoSlot, LngLat

logger = logging.getLogger(__name__)

__all__ = ["RowStraightener"]

_EARTH_R = 6_378_137.0  # WGS84 semi-major axis (metres)
_DEG2M_LAT = math.pi * _EARTH_R / 180.0


@dataclass
class _LocalSlot:
    geo_slot: GeoSlot
    cx: float
    cy: float
    angle_rad: float
    width: float
    height: float


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


def _angle_diff(a: float, b: float) -> float:
    return abs(_wrap_pi(a - b))


def _slot_axis_aligns_with_row(slot_angle: float, row_angle: float, tol: float) -> bool:
    """True if the row direction matches either OBB principal direction (±90°).

    Spots on an inclined row share the same axis as the anchor segment; the
    detector may attach ``angle_rad`` to the short or long edge depending on the
    quad ordering, so we accept parallelism modulo 90°.
    """
    d0 = _angle_diff(slot_angle, row_angle)
    d1 = _angle_diff(slot_angle + math.pi / 2, row_angle)
    return min(d0, d1) <= tol


def _extract_local_slot(
    slot: GeoSlot, ref_lng: float, ref_lat: float,
) -> _LocalSlot:
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


def _collect_row_between_anchors(
    local_a: _LocalSlot,
    local_b: _LocalSlot,
    all_locals: list[_LocalSlot],
    row_angle: float,
    corridor_hw: float,
    angle_tol: float,
    pad_along: float,
) -> list[_LocalSlot]:
    """Slots on the row segment between anchor A and B (with padding along axis)."""
    ca, sa = math.cos(row_angle), math.sin(row_angle)
    mx = (local_a.cx + local_b.cx) / 2
    my = (local_a.cy + local_b.cy) / 2

    def along_from_mid(s: _LocalSlot) -> float:
        return (s.cx - mx) * ca + (s.cy - my) * sa

    t_a = along_from_mid(local_a)
    t_b = along_from_mid(local_b)
    t_lo = min(t_a, t_b) - pad_along
    t_hi = max(t_a, t_b) + pad_along

    def in_corridor_band(s: _LocalSlot) -> bool:
        dx = s.cx - mx
        dy = s.cy - my
        perp = abs(-dx * sa + dy * ca)
        if perp > corridor_hw:
            return False
        along = dx * ca + dy * sa
        return t_lo <= along <= t_hi

    # Always keep both anchors — their OBB angles can disagree slightly with AB.
    by_id: dict[str, _LocalSlot] = {
        local_a.geo_slot.slot_id: local_a,
        local_b.geo_slot.slot_id: local_b,
    }
    for s in all_locals:
        if s.geo_slot.slot_id in by_id:
            continue
        if not _slot_axis_aligns_with_row(s.angle_rad, row_angle, angle_tol):
            continue
        if not in_corridor_band(s):
            continue
        by_id[s.geo_slot.slot_id] = s

    members = sorted(by_id.values(), key=along_from_mid)
    return members


def _apply_correction(row: list[_LocalSlot], row_angle: float) -> list[_LocalSlot]:
    target = _wrap_pi(row_angle)
    ca, sa = math.cos(target), math.sin(target)
    mx = sum(s.cx for s in row) / len(row)
    my = sum(s.cy for s in row) / len(row)

    corrected: list[_LocalSlot] = []
    for s in row:
        # After alignment, ``width`` must lie along ``target``. If the stored
        # angle matched the row via the orthogonal direction, swap dimensions.
        d_par = _angle_diff(s.angle_rad, target)
        d_orth = _angle_diff(s.angle_rad + math.pi / 2, target)
        if d_orth + 1e-9 < d_par:
            w, h = s.height, s.width
        else:
            w, h = s.width, s.height
        proj = (s.cx - mx) * ca + (s.cy - my) * sa
        corrected.append(_LocalSlot(
            geo_slot=s.geo_slot,
            cx=mx + proj * ca,
            cy=my + proj * sa,
            angle_rad=target,
            width=w,
            height=h,
        ))
    return corrected


class RowStraightener:
    """Straighten all slots on one row given two anchor slot ids."""

    def __init__(self, settings: AlignmentSettings | None = None) -> None:
        self._s = settings or AlignmentSettings()

    def straighten(
        self,
        anchor_slot_id_a: str,
        anchor_slot_id_b: str,
        all_slots: list[GeoSlot],
    ) -> list[GeoSlot]:
        """Collect slots between the two anchors on the row and align them."""
        if anchor_slot_id_a == anchor_slot_id_b:
            logger.warning("Straighten: identical anchor ids")
            return []

        geo_a = next((s for s in all_slots if s.slot_id == anchor_slot_id_a), None)
        geo_b = next((s for s in all_slots if s.slot_id == anchor_slot_id_b), None)
        if geo_a is None or geo_b is None:
            logger.warning(
                "Straighten: anchor not found (a=%s, b=%s)",
                anchor_slot_id_a[:8], anchor_slot_id_b[:8],
            )
            return []

        ref_lng = (geo_a.center.lng + geo_b.center.lng) / 2
        ref_lat = (geo_a.center.lat + geo_b.center.lat) / 2

        all_local = [_extract_local_slot(s, ref_lng, ref_lat) for s in all_slots]
        local_a = next(s for s in all_local if s.geo_slot.slot_id == anchor_slot_id_a)
        local_b = next(s for s in all_local if s.geo_slot.slot_id == anchor_slot_id_b)

        dx = local_b.cx - local_a.cx
        dy = local_b.cy - local_a.cy
        dist = math.hypot(dx, dy)
        if dist < 0.02:
            logger.info("Straighten: anchors too close (%.2fm)", dist)
            return []

        row_angle = _wrap_pi(math.atan2(dy, dx))

        angle_tol = math.radians(self._s.angle_tolerance_deg)
        avg_w = (local_a.width + local_b.width) / 2
        corridor_hw = self._s.corridor_width_factor * max(local_a.width, local_b.width)
        # Slack along axis: centroid jitter + fraction of anchor span (pitch varies).
        pad_along = max(0.55 * avg_w, 0.22 * dist)

        row = _collect_row_between_anchors(
            local_a, local_b, all_local, row_angle,
            corridor_hw, angle_tol, pad_along,
        )

        logger.info(
            "Straighten anchors %s… / %s…: axis=%.1f° corridor=%.2fm pad=%.2fm | %d slots",
            anchor_slot_id_a[:8], anchor_slot_id_b[:8],
            math.degrees(row_angle), corridor_hw, pad_along, len(row),
        )

        if len(row) < 2:
            logger.info("Straighten: fewer than 2 slots in row strip — no proposal")
            return []

        corrected = _apply_correction(row, row_angle)
        return [_rebuild_geoslot(s, ref_lng, ref_lat) for s in corrected]
