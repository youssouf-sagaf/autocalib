"""Compute POST/PUT/delete batches for backend-b2b geography sync."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from geojson_pydantic import Polygon as GeoJSONPolygon
from shapely.geometry import Point, shape

from autoabsmap.export.models import GeoSlot, LngLat, SlotSource, SlotStatus, SlotType

logger = logging.getLogger(__name__)

# Operator tools (ADD single slot, tile row) always use ``SlotSource.manual``.
_OPERATOR_SLOT_SOURCES = frozenset({SlotSource.manual})

__all__ = [
    "B2bSyncPlan",
    "b2b_static_record_to_geoslot",
    "center_in_crop_union",
    "compute_b2b_delta",
    "compute_b2b_delta_dirty",
    "filter_prod_slots_for_client",
    "filter_prod_slots_for_client_id",
    "slot_publishes_to_b2b",
    "working_slots_for_b2b",
]


@dataclass(frozen=True)
class B2bSyncPlan:
    """Slots to create, update, or soft-delete on B2B."""

    creates: list[GeoSlot] = field(default_factory=list)
    updates: list[GeoSlot] = field(default_factory=list)
    deletes: list[GeoSlot] = field(default_factory=list)


def _crop_union(crop_polygons: list[GeoJSONPolygon]):
    if not crop_polygons:
        return None
    geoms = [shape(p.model_dump()) for p in crop_polygons]
    union = geoms[0]
    for g in geoms[1:]:
        union = union.union(g)
    return union


def center_in_crop_union(
    center: LngLat,
    crop_polygons: list[GeoJSONPolygon],
) -> bool:
    """True when there are no crops (whole client) or center lies inside a crop."""
    if not crop_polygons:
        return True
    union = _crop_union(crop_polygons)
    if union is None:
        return True
    return union.contains(Point(center.lng, center.lat))


def _minimal_square_polygon(lat: float, lng: float, half_size_deg: float = 0.000015) -> GeoJSONPolygon:
    ring = [
        [lng - half_size_deg, lat - half_size_deg],
        [lng + half_size_deg, lat - half_size_deg],
        [lng + half_size_deg, lat + half_size_deg],
        [lng - half_size_deg, lat + half_size_deg],
        [lng - half_size_deg, lat - half_size_deg],
    ]
    return GeoJSONPolygon(type="Polygon", coordinates=[ring])


def b2b_static_record_to_geoslot(record: dict) -> GeoSlot | None:
    """Map one B2B GET ``results`` entry to a minimal GeoSlot."""
    slot_id = record.get("slot_id")
    location = record.get("location")
    if not slot_id or not location:
        return None
    try:
        lat = float(location["lat"])
        lng = float(location["lng"])
    except (KeyError, TypeError, ValueError):
        return None
    raw_type = record.get("slot_type", SlotType.common.value)
    try:
        slot_type = SlotType(raw_type)
    except ValueError:
        slot_type = SlotType.common
    center = LngLat(lng=lng, lat=lat)
    return GeoSlot(
        slot_id=str(slot_id),
        center=center,
        polygon=_minimal_square_polygon(lat, lng),
        source=SlotSource.manual,
        confidence=1.0,
        status=SlotStatus.unknown,
        slot_type=slot_type,
    )


def filter_prod_slots_for_client_id(
    records: list[dict],
    client_id: str,
) -> list[GeoSlot]:
    """Keep all prod slots for this B2B client_id (no crop filter)."""
    out: list[GeoSlot] = []
    for record in records:
        if record.get("client_id") != client_id:
            continue
        slot = b2b_static_record_to_geoslot(record)
        if slot is not None:
            out.append(slot)
    return out


def filter_prod_slots_for_client(
    records: list[dict],
    client_id: str,
    crop_polygons: list[GeoJSONPolygon],
) -> list[GeoSlot]:
    """Keep prod slots for this client whose centre lies in the crop union."""
    out: list[GeoSlot] = []
    for record in records:
        if record.get("client_id") != client_id:
            continue
        slot = b2b_static_record_to_geoslot(record)
        if slot is None:
            continue
        if center_in_crop_union(slot.center, crop_polygons):
            out.append(slot)
    return out


def slot_publishes_to_b2b(
    slot: GeoSlot,
    crop_polygons: list[GeoJSONPolygon],
) -> bool:
    """Whether a session final should be POST/PUT to B2B on Save.

    - Mapping crop ROIs: all session finals inside the union (AI + edits).
    - Outside crops: operator ``manual`` slots only (ADD, tile row).
    - No mapping crops drawn: only ``manual`` slots (never wipe the client catalog).
    """
    if slot.source in _OPERATOR_SLOT_SOURCES:
        return True
    if crop_polygons:
        if center_in_crop_union(slot.center, crop_polygons):
            return True
        union = _crop_union(crop_polygons)
        if union is None:
            return True
        try:
            return union.intersects(shape(slot.polygon.model_dump()))
        except Exception:
            return False
    return False


def working_slots_for_b2b(
    final_slots: list[GeoSlot],
    crop_polygons: list[GeoJSONPolygon] | None = None,
) -> list[GeoSlot]:
    """Session finals that should be published to B2B (excludes baseline reference rows)."""
    if crop_polygons is None:
        return list(final_slots)
    return [s for s in final_slots if slot_publishes_to_b2b(s, crop_polygons)]


def _slot_needs_b2b_update(published: GeoSlot, prod: GeoSlot) -> bool:
    """True when lat/lng or slot_type differ from prod (skip no-op PUTs)."""
    if published.slot_type != prod.slot_type:
        return True
    eps = 1e-7
    if abs(published.center.lat - prod.center.lat) > eps:
        return True
    if abs(published.center.lng - prod.center.lng) > eps:
        return True
    return False


def compute_b2b_delta(
    final_slots: list[GeoSlot],
    prod_slots: list[GeoSlot],
    crop_polygons: list[GeoJSONPolygon],
    *,
    removed_prod_slots: list[GeoSlot] | None = None,
) -> B2bSyncPlan:
    """Split publishable session finals vs prod overlay into POST / PUT / to_delete.

    Only slots in the B2B publish footprint (see ``slot_publishes_to_b2b``) are
    considered for create/update. Deletes: prod inside crop ROIs whose id is not
    in that footprint, plus ``removed_prod_slots`` (grey prod pin removed in UI).
    """
    published = working_slots_for_b2b(final_slots, crop_polygons)
    prod_by_id = {s.slot_id: s for s in prod_slots}
    prod_ids = set(prod_by_id)
    published_ids = {s.slot_id for s in published}
    scoped_prod_ids = prod_ids if crop_polygons else set()

    creates: list[GeoSlot] = []
    updates: list[GeoSlot] = []

    for slot in published:
        if slot.slot_id in prod_ids:
            prod = prod_by_id[slot.slot_id]
            if _slot_needs_b2b_update(slot, prod):
                updates.append(slot)
        else:
            creates.append(slot)

    delete_by_id: dict[str, GeoSlot] = {}
    for pid in scoped_prod_ids:
        if pid not in published_ids:
            delete_by_id[pid] = prod_by_id[pid]
    for slot in removed_prod_slots or []:
        if slot.slot_id in published_ids:
            continue
        if slot.slot_id not in prod_ids:
            continue
        delete_by_id[slot.slot_id] = prod_by_id[slot.slot_id]

    deletes = list(delete_by_id.values())

    logger.info(
        "B2B delta: %d create, %d update, %d delete (crops=%d)",
        len(creates), len(updates), len(deletes), len(crop_polygons),
    )
    return B2bSyncPlan(creates=creates, updates=updates, deletes=deletes)


def _is_new_dirty_slot(slot: GeoSlot) -> bool:
    """True when the front sent a slot without a prod ``slot_id``."""
    return not (slot.slot_id or "").strip()


def compute_b2b_delta_dirty(
    dirty_slots: list[GeoSlot],
    prod_slots: list[GeoSlot],
    deleted_prod_ids: list[str] | None = None,
) -> B2bSyncPlan:
    """Diff dirty FE payload vs prod: create / update / explicit deletes only."""
    prod_by_id = {s.slot_id: s for s in prod_slots if s.slot_id}
    creates: list[GeoSlot] = []
    updates: list[GeoSlot] = []

    for slot in dirty_slots:
        if _is_new_dirty_slot(slot):
            creates.append(slot)
            continue
        sid = slot.slot_id.strip()
        prod = prod_by_id.get(sid)
        if prod is None:
            logger.warning("B2B dirty delta: skip unknown slot_id %r (not in prod)", sid)
            continue
        if _slot_needs_b2b_update(slot, prod):
            updates.append(slot)

    delete_by_id: dict[str, GeoSlot] = {}
    for raw_id in deleted_prod_ids or []:
        sid = (raw_id or "").strip()
        if sid and sid in prod_by_id:
            delete_by_id[sid] = prod_by_id[sid]
    deletes = list(delete_by_id.values())

    logger.info(
        "B2B dirty delta: %d create, %d update, %d delete",
        len(creates),
        len(updates),
        len(deletes),
    )
    return B2bSyncPlan(creates=creates, updates=updates, deletes=deletes)
