"""Session data models for the learning loop.

These models capture everything needed for CV improvement:
operator edits, difficulty assessment, and computed deltas.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from geojson_pydantic import Polygon as GeoJSONPolygon
from pydantic import BaseModel, Field

from autoabsmap.export.models import GeoSlot
from autoabsmap.pipeline.models import RunMeta

__all__ = [
    "EditEventType",
    "EditEvent",
    "ReprocessStep",
    "DifficultyTag",
    "DeltaSummary",
    "SessionTrace",
]


class EditEventType(str, Enum):
    add = "add"
    delete = "delete"
    bulk_delete = "bulk_delete"
    modify = "modify"
    reprocess = "reprocess"
    align = "align"


class EditEvent(BaseModel):
    """One operator edit action — timestamped for replay and analysis."""

    type: EditEventType
    timestamp: float
    slot_ids: list[str]
    before: list[GeoSlot]
    after: list[GeoSlot]


class ReprocessStep(BaseModel):
    """Record of one reprocessing call (reference slot + scope → proposed slots)."""

    trigger_slot_id: str
    scope_polygon: GeoJSONPolygon
    proposed: list[GeoSlot]
    accepted: list[GeoSlot]


class DifficultyTag(str, Enum):
    occlusion = "occlusion"
    shadow = "shadow"
    weak_ground_markings = "weak_ground_markings"
    visual_clutter = "visual_clutter"
    other = "other"


class DeltaSummary(BaseModel):
    """Computed on save — the primary KPI source for model revalidation."""

    additions: int
    deletions: int
    geometric_corrections: int
    reprocess_calls: int
    align_calls: int
    operator_time_sec: float


class SessionTrace(BaseModel):
    """Complete session record for learning loop persistence."""

    session_id: str
    run_meta: RunMeta
    crops: list[GeoJSONPolygon]
    edit_events: list[EditEvent]
    reprocessed_steps: list[ReprocessStep]
    final_slots: list[GeoSlot]
    difficulty_tags: list[DifficultyTag]
    other_difficulty_note: str | None = None
    delta: DeltaSummary
