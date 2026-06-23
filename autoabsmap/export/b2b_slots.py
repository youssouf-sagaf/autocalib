"""Payload builders for backend-b2b ``/geography/slots`` (POST / PUT).

Keeps the HTTP contract in one place: location + slot_type (+ client_id on create).
"""

from __future__ import annotations

from typing import Any

from autoabsmap.export.models import GeoSlot, SlotType

__all__ = [
    "geoslot_to_b2b_entry",
    "geoslots_to_b2b_post_payload",
    "geoslots_to_b2b_put_payload",
    "geoslots_to_b2b_delete_payload",
]


def geoslot_to_b2b_entry(
    slot: GeoSlot,
    *,
    client_id: str | None = None,
) -> dict[str, Any]:
    """One slot body for B2B absolute map (PUT value or POST inner dict)."""
    entry: dict[str, Any] = {
        "location": {"lat": slot.center.lat, "lng": slot.center.lng},
        "slot_type": slot.slot_type.value,
    }
    if client_id is not None:
        entry["client_id"] = client_id
    return entry


def geoslots_to_b2b_post_payload(
    slots: list[GeoSlot],
    client_id: str | None,
) -> dict[str, dict[str, Any]]:
    """POST body: arbitrary keys; B2B mints slot_id server-side.

    Includes ``slot_id`` in each value (Cocopilot parity; stripped server-side).
    Omit ``client_id`` when ``None`` (unallocated slots — required for demo cities).
    """
    payload: dict[str, dict[str, Any]] = {}
    for i, slot in enumerate(slots):
        entry = geoslot_to_b2b_entry(slot, client_id=client_id)
        entry["slot_id"] = slot.slot_id
        payload[str(i)] = entry
    return payload


def geoslots_to_b2b_put_payload(
    slots: list[GeoSlot],
    *,
    slot_ids: list[str] | None = None,
) -> dict[str, dict[str, Any]]:
    """PUT body: dict keys are real B2B slot_ids.

    Pass ``slot_ids`` when the key differs from ``GeoSlot.slot_id`` (e.g. after
  reconciliation). Otherwise each entry is keyed by ``slot.slot_id``.
    """
    payload: dict[str, dict[str, Any]] = {}
    for i, slot in enumerate(slots):
        key = slot_ids[i] if slot_ids is not None else slot.slot_id
        payload[key] = geoslot_to_b2b_entry(slot)
    return payload


def geoslots_to_b2b_delete_payload(
    slots: list[GeoSlot],
    *,
    slot_ids: list[str] | None = None,
) -> dict[str, dict[str, Any]]:
    """PUT body entries with ``slot_type: to_delete`` (B2B soft delete)."""
    payload: dict[str, dict[str, Any]] = {}
    for i, slot in enumerate(slots):
        key = slot_ids[i] if slot_ids is not None else slot.slot_id
        payload[key] = {
            "location": {"lat": slot.center.lat, "lng": slot.center.lng},
            "slot_type": SlotType.to_delete.value,
        }
    return payload
