"""API-layer models — multi-crop orchestration contracts.

These models live in autoabsmap-api, NOT in the autoabsmap package.
The API layer is responsible for orchestrating N crops and merging results.
"""

from __future__ import annotations

from enum import Enum

from geojson_pydantic import Polygon as GeoJSONPolygon
from pydantic import BaseModel, Field

from autoabsmap.export.models import GeoSlot
from autoabsmap.generator_engine.models import HintMasks, PipelineResult
from autoabsmap.learning_loop.models import DifficultyTag, EditEvent, ReprocessStep

__all__ = [
    "CropRequest",
    "JobRequest",
    "JobStatus",
    "OrchestratorProgress",
    "PipelineJob",
    "JobResult",
    "StraightenRequest",
    "ReprocessRequest",
    "SaveRequest",
]


class CropRequest(BaseModel):
    """One crop drawn by the operator (ROI polygon + optional hints)."""

    polygon: GeoJSONPolygon
    hints: HintMasks | None = None


class JobRequest(BaseModel):
    """Multi-crop job submission — N rectangles drawn while scrolling."""

    crops: list[CropRequest]


class JobStatus(str, Enum):
    pending = "pending"
    running = "running"
    done = "done"
    failed = "failed"


class OrchestratorProgress(BaseModel):
    """Progress wrapper — adds crop context around the pure StageProgress."""

    crop_index: int
    crop_total: int
    stage: str
    percent: int = Field(ge=0, le=100)


class PipelineJob(BaseModel):
    """Job state as seen by the frontend (polling or SSE)."""

    id: str
    status: JobStatus = JobStatus.pending
    progress: OrchestratorProgress | None = None
    error: str | None = None


class JobResult(BaseModel):
    """Final result of a multi-crop job."""

    job_id: str
    slots: list[GeoSlot]
    baseline_slots: list[GeoSlot]
    crop_results: list[PipelineResult]


class StraightenRequest(BaseModel):
    """Row straightening — click one slot, get the corrected row back."""

    slot_id: str


class ReprocessRequest(BaseModel):
    """Reprocessing helper — reference slot + scope polygon → proposed slots."""

    reference_slot_id: str
    scope_polygon: GeoJSONPolygon


class SaveRequest(BaseModel):
    """Session save — final slots + full edit trace → persistence + B2B forward."""

    final_slots: list[GeoSlot]
    baseline_slots: list[GeoSlot] = Field(default_factory=list)
    edit_events: list[EditEvent]
    reprocessed_steps: list[ReprocessStep] = Field(default_factory=list)
    difficulty_tags: list[DifficultyTag] = Field(default_factory=list)
    other_difficulty_note: str | None = None
