"""Pipeline data models — request, result, progress.

ParkingSlotPipeline operates on ONE crop at a time.  It knows nothing
about which imagery provider fetches the raster, and nothing about the
other crops in the job.  Multi-crop orchestration is the API layer's
responsibility.
"""

from __future__ import annotations

from typing import Any

from geojson_pydantic import Polygon as GeoJSONPolygon
from pydantic import BaseModel, ConfigDict, Field

from absmap.export.models import GeoSlot

__all__ = [
    "HintMasks",
    "PipelineRequest",
    "StageProgress",
    "RunMeta",
    "PipelineResult",
]


class HintMasks(BaseModel):
    """Optional freehand hint masks (class A / class B) for a single crop."""

    class_a: GeoJSONPolygon | None = None
    class_b: GeoJSONPolygon | None = None


class PipelineRequest(BaseModel):
    """Input for a single crop pipeline run."""

    roi: GeoJSONPolygon
    hints: HintMasks | None = None


class StageProgress(BaseModel):
    """Progress within a single crop run (no crop_index here).

    The MultiCropOrchestrator in absmap-api wraps this into an
    OrchestratorProgress that adds crop context before forwarding to SSE.
    """

    stage: str
    percent: int = Field(ge=0, le=100)


class RunMeta(BaseModel):
    """Metadata captured during a pipeline run — for learning loop traceability."""

    segformer_checkpoint: str | None = None
    yolo_weights: str | None = None
    imagery_provider: str = ""
    crs_epsg: int = 0
    gsd_m: float = 0.0
    roi_geojson: dict[str, Any] | None = None

    model_config = ConfigDict(frozen=True)


class PipelineResult(BaseModel):
    """Output of a single crop pipeline run."""

    slots: list[GeoSlot]
    baseline_slots: list[GeoSlot]
    run_meta: RunMeta
