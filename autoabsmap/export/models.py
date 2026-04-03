"""GeoSlot — the canonical WGS84 slot model exported by the pipeline.

Every slot produced by autoabsmap carries a UUID, provenance (source), and
its OBB polygon in WGS84.  This is the single model that crosses the
autoabsmap → autoabsmap-api boundary.
"""

from __future__ import annotations

from enum import Enum

from geojson_pydantic import Polygon as GeoJSONPolygon
from pydantic import BaseModel, ConfigDict, Field

__all__ = ["SlotSource", "SlotStatus", "LngLat", "GeoSlot"]


class SlotSource(str, Enum):
    """How a slot was generated — fixed taxonomy for CV error analysis."""

    yolo = "yolo"
    row_extension = "row_extension"
    gap_fill = "gap_fill"
    mask_recovery = "mask_recovery"
    auto_reprocess = "auto_reprocess"
    manual = "manual"


class SlotStatus(str, Enum):
    empty = "empty"
    occupied = "occupied"
    unknown = "unknown"


class LngLat(BaseModel):
    """WGS84 longitude / latitude pair."""

    lng: float
    lat: float

    model_config = ConfigDict(frozen=True)


class GeoSlot(BaseModel):
    """One parking slot in WGS84 — the universal output model.

    Ephemeral ``slot_id`` (UUID v4) is generated per pipeline run.
    Stable identity is owned by the save path (B2B / Firestore spatial matching).
    """

    slot_id: str
    center: LngLat
    polygon: GeoJSONPolygon
    source: SlotSource
    confidence: float = Field(ge=0.0, le=1.0)
    status: SlotStatus = SlotStatus.unknown

    model_config = ConfigDict(frozen=True)
