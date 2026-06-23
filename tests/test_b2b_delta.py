"""B2B sync delta — including prod delete on session remove."""

from __future__ import annotations

from geojson_pydantic import Polygon as GeoJSONPolygon

from autoabsmap.export.b2b_delta import (
    compute_b2b_delta,
    slot_publishes_to_b2b,
    working_slots_for_b2b,
)
from autoabsmap.export.models import GeoSlot, LngLat, SlotSource, SlotType


def _slot(
    slot_id: str,
    lat: float,
    lng: float,
    *,
    source: SlotSource = SlotSource.manual,
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
        source=source,
        confidence=1.0,
        slot_type=SlotType.common,
    )


def _crop_around(lat: float, lng: float, half: float = 0.05) -> list[GeoJSONPolygon]:
    ring = [
        [lng - half, lat - half],
        [lng + half, lat - half],
        [lng + half, lat + half],
        [lng - half, lat + half],
        [lng - half, lat - half],
    ]
    return [GeoJSONPolygon(type="Polygon", coordinates=[ring])]


def test_delete_prod_slot_missing_from_final() -> None:
    prod = _slot("prod-1", 48.85, 2.35)
    crops = _crop_around(48.85, 2.35)
    plan = compute_b2b_delta([], [prod], crops)
    assert len(plan.deletes) == 1
    assert plan.deletes[0].slot_id == "prod-1"


def test_removed_prod_slot_from_ui() -> None:
    removed = _slot("prod-2", 48.86, 2.36)
    prod = _slot("prod-2", 48.86, 2.36)
    plan = compute_b2b_delta([], [prod], [], removed_prod_slots=[removed])
    assert len(plan.deletes) == 1
    assert plan.deletes[0].slot_id == "prod-2"


def test_removed_prod_slot_ignored_when_not_in_prod_catalog() -> None:
    removed = _slot("ghost", 48.86, 2.36)
    plan = compute_b2b_delta([], [], [], removed_prod_slots=[removed])
    assert len(plan.deletes) == 0


def test_session_delete_of_prod_id_triggers_delete() -> None:
    prod = _slot("prod-3", 48.87, 2.37)
    plan = compute_b2b_delta([], [prod], _crop_around(48.87, 2.37))
    assert plan.deletes[0].slot_id == "prod-3"


def test_new_session_slot_is_create() -> None:
    session = _slot("new-uuid", 48.88, 2.38)
    plan = compute_b2b_delta([session], [], [])
    assert len(plan.creates) == 1
    assert len(plan.deletes) == 0


def test_existing_prod_id_is_update() -> None:
    prod = _slot("prod-4", 48.89, 2.39)
    updated = _slot("prod-4", 48.8901, 2.3901)
    plan = compute_b2b_delta([updated], [prod], [])
    assert len(plan.creates) == 0
    assert len(plan.updates) == 1
    assert plan.updates[0].slot_id == "prod-4"


def test_unchanged_prod_slot_is_not_update() -> None:
    prod = _slot("prod-4", 48.89, 2.39)
    plan = compute_b2b_delta([prod], [prod], [])
    assert len(plan.creates) == 0
    assert len(plan.updates) == 0
    assert len(plan.deletes) == 0


def test_slot_type_change_on_existing_prod_is_put_update() -> None:
    from autoabsmap.export.models import SlotType

    prod = _slot("prod-5", 48.9, 2.4)
    updated = prod.model_copy(update={"slot_type": SlotType.pmr})
    plan = compute_b2b_delta([updated], [prod], [])
    assert len(plan.creates) == 0
    assert len(plan.updates) == 1
    assert plan.updates[0].slot_type == SlotType.pmr


def test_working_slots_for_b2b_without_crops_keeps_manual_only() -> None:
    manual = _slot("manual-1", 48.9, 2.4)
    sam3 = _slot("sam3-1", 48.91, 2.41, source=SlotSource.sam3)
    out = working_slots_for_b2b([manual, sam3], [])
    assert [s.slot_id for s in out] == ["manual-1"]


def test_working_slots_for_b2b_with_crops_includes_manual_outside_roi() -> None:
    manual = _slot("manual-out", 50.0, 3.0)
    crops = _crop_around(48.85, 2.35)
    assert slot_publishes_to_b2b(manual, crops)
    sam3_out = _slot("sam3-out", 50.0, 3.0, source=SlotSource.sam3)
    assert not slot_publishes_to_b2b(sam3_out, crops)
    sam3_in = _slot("sam3-in", 48.85, 2.35, source=SlotSource.sam3)
    assert slot_publishes_to_b2b(sam3_in, crops)


def test_manual_outside_crop_is_create_when_mapping_crops_exist() -> None:
    crops = _crop_around(48.85, 2.35)
    manual = _slot("new-manual", 50.0, 3.0)
    plan = compute_b2b_delta([manual], [], crops)
    assert len(plan.creates) == 1
    assert len(plan.deletes) == 0


def test_no_crops_does_not_mass_delete_client_prod() -> None:
    """Saving a small session without crop ROIs must not wipe the client catalog."""
    prod = [_slot(f"prod-{i}", 48.85 + i * 0.001, 2.35) for i in range(3)]
    session = _slot("new-uuid", 48.88, 2.38)
    plan = compute_b2b_delta([session], prod, [])
    assert len(plan.creates) == 1
    assert len(plan.updates) == 0
    assert len(plan.deletes) == 0
