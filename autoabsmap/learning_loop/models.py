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
    """``1 - fp_rate`` — higher is better.  ``0.0`` when baseline is empty (#9)."""
    fp_rate: float
    """``deletions / total_baseline_slots`` — lower is better."""
    fn_rate: float
    """``additions / total_final_slots`` — lower is better."""
    geometric_correction_rate: float
    """``geometric_corrections / max(baseline - deletions, 1)`` — lower is better.

    Denominator is the number of baseline slots the operator kept (#8); those
    are the only slots that could have been geometrically corrected.
    """
    operator_time_sec: float


def compute_session_kpis(
    delta: DeltaSummary,
    total_baseline_slots: int,
    total_final_slots: int,
) -> SessionKPIs:
    """Compute all KPIs from a session's DeltaSummary and slot counts.

    Formulas follow the architecture spec (section "KPI framework").

    Edge cases:

    - Empty baseline (``total_baseline_slots == 0``) produces
      ``fp_rate = 0.0`` **and** ``useful_detection_rate = 0.0`` — there was
      no baseline to judge, so "useful" is undefined and defaults to zero
      rather than the misleading ``1.0`` (#9).
    - Geometric correction rate is normalised by ``baseline - deletions``
      (the preserved baseline slots), not ``total_final_slots`` — additions
      cannot be "geometrically corrected" because they started from operator
      evidence (#8).
    """
    effort = (
        delta.additions
        + delta.deletions
        + delta.geometric_corrections
        + delta.reprocess_calls
        + delta.align_calls
    )

    if total_baseline_slots > 0:
        fp_rate = delta.deletions / total_baseline_slots
        useful_detection_rate = 1.0 - fp_rate
    else:
        fp_rate = 0.0
        useful_detection_rate = 0.0  # no baseline → undefined, report 0 (#9)

    fn_rate = delta.additions / total_final_slots if total_final_slots > 0 else 0.0

    preserved_baseline = total_baseline_slots - delta.deletions
    geo_rate = (
        delta.geometric_corrections / preserved_baseline
        if preserved_baseline > 0
        else 0.0
    )

    return SessionKPIs(
        effort=effort,
        useful_detection_rate=useful_detection_rate,
        fp_rate=fp_rate,
        fn_rate=fn_rate,
        geometric_correction_rate=geo_rate,
        operator_time_sec=delta.operator_time_sec,
    )
