"""Alignment tool models — request, result, row discovery."""

from __future__ import annotations

from pydantic import BaseModel

from autoabsmap.export.models import GeoSlot

__all__ = ["AlignmentRequest", "AlignmentResult", "RowDiscovery"]


class RowDiscovery(BaseModel):
    """Metadata about a discovered row during the corridor walk."""

    slot_ids: list[str]
    median_angle_rad: float
    slot_count: int


class AlignmentRequest(BaseModel):
    """Input for a row straightening call."""

    reference_slot_id: str
    all_slots: list[GeoSlot]


class AlignmentResult(BaseModel):
    """Output of row straightening — corrected slots for the discovered row."""

    corrected_slots: list[GeoSlot]
    row_discovery: RowDiscovery
