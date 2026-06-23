"""Dirty B2B delta (synchronous slots:save)."""

from __future__ import annotations

from autoabsmap.export.b2b_delta import compute_b2b_delta_dirty
from autoabsmap.export.models import GeoSlot, LngLat, SlotSource, SlotType


def _slot(
    slot_id: str,
    lat: float,
    lng: float,
    *,
    slot_type: SlotType = SlotType.common,
) -> GeoSlot:
    ring = [
        [lng, lat],
        [lng + 0.0001, lat],
        [lng + 0.0001, lat + 0.0001],
        [lng, lat + 0.0001],
        [lng, lat],
    ]
    return GeoSlot(
        slot_id=slot_id,
        center=LngLat(lng=lng, lat=lat),
        polygon={"type": "Polygon", "coordinates": [ring]},
        source=SlotSource.manual,
        confidence=1.0,
        slot_type=slot_type,
    )


def test_dirty_create_without_slot_id() -> None:
    new_slot = _slot("", 48.88, 2.38)
    plan = compute_b2b_delta_dirty([new_slot], [], [])
    assert len(plan.creates) == 1
    assert len(plan.updates) == 0


def test_dirty_update_when_coords_change() -> None:
    prod = _slot("prod-1", 48.85, 2.35)
    moved = _slot("prod-1", 48.86, 2.35)
    plan = compute_b2b_delta_dirty([moved], [prod], [])
    assert len(plan.updates) == 1
    assert len(plan.creates) == 0


def test_dirty_skip_unchanged() -> None:
    prod = _slot("prod-1", 48.85, 2.35)
    plan = compute_b2b_delta_dirty([prod], [prod], [])
    assert len(plan.creates) == 0
    assert len(plan.updates) == 0


def test_dirty_explicit_delete() -> None:
    prod = _slot("prod-1", 48.85, 2.35)
    plan = compute_b2b_delta_dirty([], [prod], ["prod-1"])
    assert len(plan.deletes) == 1
    assert plan.deletes[0].slot_id == "prod-1"
