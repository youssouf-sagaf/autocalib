"""Generator engine data models — request, result, progress, pixel slots.

ParkingSlotPipeline operates on ONE crop at a time.  It knows nothing
about which imagery provider fetches the raster, and nothing about the
other crops in the job.  Multi-crop orchestration is the API layer's
responsibility.
"""

from __future__ import annotations

import math
from typing import Any

from geojson_pydantic import Polygon as GeoJSONPolygon
from pydantic import BaseModel, ConfigDict, Field

from autoabsmap.export.models import GeoSlot, SlotSource

__all__ = [
    "PixelSlot",
    "HintMasks",
    "PipelineRequest",
    "StageProgress",
    "RunMeta",
    "PipelineResult",
]


class PixelSlot(BaseModel):
    """Internal representation of an oriented parking slot in pixel space.

    Used during geometric post-processing.  Carries ``row_id`` for cluster
    bookkeeping and ``source`` for provenance tracking.
    """

    center_x: float
    center_y: float
    width: float
    """Shorter dimension (slot width along the row axis)."""
    height: float
    """Longer dimension (slot depth perpendicular to the row)."""
    angle_rad: float
    """Angle of the depth (long) axis in radians, normalized to [-pi/2, pi/2]."""
    confidence: float = Field(ge=0.0, le=1.0)
    class_id: int = 0
    source: SlotSource = SlotSource.yolo
    row_id: int | None = None

    model_config = ConfigDict(frozen=False)

    @property
    def corners(self) -> list[tuple[float, float]]:
        """Four corners of the OBB in pixel space — R&D convention.

        ``angle_rad`` is the depth (long) axis direction.  Height goes along
        (cos a, sin a), width perpendicular (-sin a, cos a).
        """
        a = self.angle_rad
        h_vec_x, h_vec_y = math.cos(a) * self.height / 2, math.sin(a) * self.height / 2
        w_vec_x, w_vec_y = -math.sin(a) * self.width / 2, math.cos(a) * self.width / 2
        cx, cy = self.center_x, self.center_y
        return [
            (cx + h_vec_x + w_vec_x, cy + h_vec_y + w_vec_y),
            (cx - h_vec_x + w_vec_x, cy - h_vec_y + w_vec_y),
            (cx - h_vec_x - w_vec_x, cy - h_vec_y - w_vec_y),
            (cx + h_vec_x - w_vec_x, cy + h_vec_y - w_vec_y),
        ]


class HintMasks(BaseModel):
    """Optional freehand hint masks (class A / class B) for a single crop."""

    class_a: GeoJSONPolygon | None = None
    class_b: GeoJSONPolygon | None = None


class PipelineRequest(BaseModel):
    """Input for a single crop pipeline run."""

    roi: GeoJSONPolygon
    fetch_window: GeoJSONPolygon | None = None
    """Optional imagery fetch window (WGS84).

    When set, the imagery provider fetches a raster for this window, but the
    pipeline still treats ``roi`` as the true area of interest for masking
    and ROI clipping. This is used by the API auto-tiling logic: tiles are
    fetched as rectangles, while the original (possibly non-rectangular) ROI
    remains the semantic crop boundary.
    """
    hints: HintMasks | None = None


class StageProgress(BaseModel):
    """Progress within a single crop run (no crop_index here).

    The MultiCropOrchestrator in autoabsmap-api wraps this into an
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
    mask_polygons_geojson: dict[str, Any] | None = None
    """Vectorized segmentation mask as a GeoJSON FeatureCollection (WGS84)."""
