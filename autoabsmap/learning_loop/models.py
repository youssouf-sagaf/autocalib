"""Learning loop data models — session trace, difficulty tags, deltas.

These models capture everything needed for CV improvement:
operator edits, difficulty assessment, and computed deltas.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from geojson_pydantic import Polygon as GeoJSONPolygon
from pydantic import BaseModel, Field

from autoabsmap.export.models import GeoSlot
from autoabsmap.generator_engine.models import RunMeta

__all__ = [
    "CropMeta",
    "EditEventType",
    "EditEvent",
    "ReprocessStep",
    "DifficultyTag",
    "DeltaSummary",
    "SessionTrace",
    "SessionKPIs",
    "compute_session_kpis",
]


class CropMeta(BaseModel):
    """Per-crop raster metadata persisted alongside pipeline artifacts.

    Enables precise WGS84 ↔ pixel mapping for dataset building (mask checks,
    pseudo-mask generation, image crop references).
    """

    affine: tuple[float, float, float, float, float, float]
    """Rasterio-style affine coefficients (a, b, c, d, e, f)."""
    crs_epsg: int
    bounds_wgs84_west: float
    bounds_wgs84_south: float
    bounds_wgs84_east: float
    bounds_wgs84_north: float
    image_height: int
    image_width: int
    gsd_m: float = 0.0


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
    """Record of one reprocessing call (reference slot + scope -> proposed slots)."""

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
    baseline_slots: list[GeoSlot] = Field(default_factory=list)
    difficulty_tags: list[DifficultyTag]
    other_difficulty_note: str | None = None
    delta: DeltaSummary


class SessionKPIs(BaseModel):
    """Computed KPIs from a session — the promotion-decision data source.

    Primary KPI: ``effort`` (lower is better).
    Secondary KPIs: rates that pinpoint *where* the model fails.
    """

    effort: int
    """Total manual actions: adds + deletes + corrections + reprocess + align."""
    useful_detection_rate: float
    """``1 - deletions / total_baseline_slots`` — higher is better."""
    fp_rate: float
    """``deletions / total_baseline_slots`` — lower is better."""
    fn_rate: float
    """``additions / total_final_slots`` — lower is better."""
    geometric_correction_rate: float
    """``geometric_corrections / total_final_slots`` — lower is better."""
    operator_time_sec: float


def compute_session_kpis(
    delta: DeltaSummary,
    total_baseline_slots: int,
    total_final_slots: int,
) -> SessionKPIs:
    """Compute all KPIs from a session's DeltaSummary and slot counts.

    Formulas follow the architecture spec (section "KPI framework").
    """
    effort = (
        delta.additions
        + delta.deletions
        + delta.geometric_corrections
        + delta.reprocess_calls
        + delta.align_calls
    )
    fp_rate = delta.deletions / total_baseline_slots if total_baseline_slots > 0 else 0.0
    fn_rate = delta.additions / total_final_slots if total_final_slots > 0 else 0.0
    geo_rate = (
        delta.geometric_corrections / total_final_slots
        if total_final_slots > 0
        else 0.0
    )
    return SessionKPIs(
        effort=effort,
        useful_detection_rate=1.0 - fp_rate,
        fp_rate=fp_rate,
        fn_rate=fn_rate,
        geometric_correction_rate=geo_rate,
        operator_time_sec=delta.operator_time_sec,
    )
