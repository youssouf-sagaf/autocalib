"""GeoSlot slot_type round-trip and B2B payload shape."""

from __future__ import annotations

from autoabsmap.export.b2b_slots import (
    geoslot_to_b2b_entry,
    geoslots_to_b2b_post_payload,
    geoslots_to_b2b_put_payload,
)
from autoabsmap.export.geojson import geoslot_from_feature, geoslots_to_feature_collection
from autoabsmap.export.models import GeoSlot, LngLat, SlotSource, SlotType


def _sample_slot(slot_type: SlotType = SlotType.pmr) -> GeoSlot:
    return GeoSlot(
        slot_id="11111111-1111-4111-8111-111111111111",
        center=LngLat(lng=2.35, lat=48.85),
        polygon={
            "type": "Polygon",
            "coordinates": [[[2.35, 48.85], [2.351, 48.85], [2.351, 48.851], [2.35, 48.851], [2.35, 48.85]]],
        },
        source=SlotSource.manual,
        confidence=1.0,
        slot_type=slot_type,
    )


def test_geoslot_slot_type_geojson_roundtrip() -> None:
    slot = _sample_slot(SlotType.forbidden)
    fc = geoslots_to_feature_collection([slot])
    restored = geoslot_from_feature(fc["features"][0])
    assert restored.slot_type == SlotType.forbidden


def test_geoslot_slot_type_defaults_to_common_in_geojson() -> None:
    slot = _sample_slot()
    fc = geoslots_to_feature_collection([slot])
    del fc["features"][0]["properties"]["slot_type"]
    restored = geoslot_from_feature(fc["features"][0])
    assert restored.slot_type == SlotType.common


def test_b2b_post_payload_includes_slot_type() -> None:
    slot = _sample_slot(SlotType.pmr)
    payload = geoslots_to_b2b_post_payload([slot], client_id="client-1")
    assert payload["0"]["slot_type"] == "pmr"
    assert payload["0"]["client_id"] == "client-1"
    assert payload["0"]["location"] == {"lat": 48.85, "lng": 2.35}


def test_b2b_post_payload_omits_client_id_when_unallocated() -> None:
    slot = _sample_slot()
    payload = geoslots_to_b2b_post_payload([slot], client_id=None)
    assert "client_id" not in payload["0"]


def test_b2b_put_payload_uses_slot_id_key_and_slot_type() -> None:
    slot = _sample_slot(SlotType.taxi)
    payload = geoslots_to_b2b_put_payload([slot])
    assert slot.slot_id in payload
    assert payload[slot.slot_id]["slot_type"] == "taxi"


def test_geoslot_parses_slot_type_from_api_json() -> None:
    """Save / job payloads from the front carry slot_type on each GeoSlot."""
    slot = GeoSlot.model_validate({
        "slot_id": "a",
        "center": {"lng": 1.0, "lat": 2.0},
        "polygon": {
            "type": "Polygon",
            "coordinates": [[[1, 2], [1.1, 2], [1.1, 2.1], [1, 2.1], [1, 2]]],
        },
        "source": "manual",
        "confidence": 0.9,
        "slot_type": "evh",
    })
    assert slot.slot_type == SlotType.evh


def test_geoslot_to_b2b_entry_reflects_type_change() -> None:
    common = _sample_slot(SlotType.common)
    pmr = common.model_copy(update={"slot_type": SlotType.pmr})
    assert geoslot_to_b2b_entry(common)["slot_type"] == "common"
    assert geoslot_to_b2b_entry(pmr)["slot_type"] == "pmr"
