"""API-layer models — multi-crop orchestration contracts.

These models live in autocalib-api, NOT in the autoabsmap package.
The API layer is responsible for orchestrating N crops and merging results.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from geojson_pydantic import Polygon as GeoJSONPolygon
from pydantic import BaseModel, Field, model_validator

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
    "SlotsSaveRequest",
    "SlotsSyncRequest",
    "SaveSummary",
]


class CropRequest(BaseModel):
    """One crop drawn by the operator (ROI polygon + optional hints)."""

    polygon: GeoJSONPolygon
    hints: HintMasks | None = None


class JobRequest(BaseModel):
    """Multi-crop job submission — N rectangles drawn while scrolling."""

    crops: list[CropRequest]
    imagery_source: Literal[
        "mapbox",
        "ign-current",
        "ign-pleiades-2026",
    ] | None = None
    """Override the default imagery provider for this job. ``None`` keeps the
    server-configured default (``settings.imagery.provider``). The ``ign-*``
    values map to named WMTS layer presets — see
    :data:`autoabsmap.imagery.ign.IGN_LAYER_PRESETS`."""


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
    detection_overlay: dict | None = None
    """Merged detection OBBs overlay (true pixel-space geometry)."""
    postprocess_overlay: dict | None = None
    """Merged post-process OBBs overlay (true pixel-space geometry)."""


class StraightenRequest(BaseModel):
    """Row straightening — two anchor slots on the same row define the segment to align."""

    slot_id_a: str
    slot_id_b: str
    slots: list[GeoSlot] | None = None
    """Optional WGS84 snapshot (e.g. current map state). When set, straightening runs on this
    list so anchors match baseline-only views and edited geometries; otherwise the job's
    merged ``slots`` from the server store are used."""

    @model_validator(mode="after")
    def _anchors_must_differ(self) -> StraightenRequest:
        if self.slot_id_a == self.slot_id_b:
            raise ValueError("slot_id_a and slot_id_b must be different slots")
        return self


class ReprocessRequest(BaseModel):
    """Reprocessing helper — reference slot + scope polygon → proposed slots.

    The operator places a reference slot manually inside the drawn scope zone;
    the full slot geometry is sent so the backend can use its orientation and
    size as the pattern to replicate.
    """

    reference_slot: GeoSlot
    scope_polygon: GeoJSONPolygon


class SaveSummary(BaseModel):
    """Counts returned after synchronous slots:save."""

    created: int = 0
    updated: int = 0
    deleted: int = 0
    total_slots: int = 0


class SlotsSaveRequest(BaseModel):
    """Synchronous dirty B2B save — new + modified slots and explicit deletes."""

    slots: list[GeoSlot]
    deleted_prod_ids: list[str] = Field(default_factory=list)
    client_display_name: str | None = None
    job_id: str | None = None
    baseline_slots: list[GeoSlot] = Field(default_factory=list)
    edit_events: list[EditEvent] = Field(default_factory=list)
    reprocessed_steps: list[ReprocessStep] = Field(default_factory=list)
    difficulty_tags: list[DifficultyTag] = Field(default_factory=list)
    other_difficulty_note: str | None = None


class SlotsSyncRequest(BaseModel):
    """Client-centric B2B slot sync — prod writes + optional learning-loop sidecar."""

    slots: list[GeoSlot]
    crop_polygons: list[GeoJSONPolygon] = Field(default_factory=list)
    removed_prod_slots: list[GeoSlot] = Field(default_factory=list)
    client_display_name: str | None = None
    """Pipeline job id — used internally as learning-loop session id when set."""
    job_id: str | None = None
    baseline_slots: list[GeoSlot] = Field(default_factory=list)
    edit_events: list[EditEvent] = Field(default_factory=list)
    reprocessed_steps: list[ReprocessStep] = Field(default_factory=list)
    difficulty_tags: list[DifficultyTag] = Field(default_factory=list)
    other_difficulty_note: str | None = None
