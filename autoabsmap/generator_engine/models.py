"""Generator engine data models — request, result, progress, pixel slots.

ParkingSlotPipeline operates on ONE crop at a time.  It knows nothing
about which imagery provider fetches the raster, and nothing about the
other crops in the job.  Multi-crop orchestration is the API layer's
responsibility.
"""

from __future__ import annotations

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
    """Width / row-axis direction (short side) in radians, ``[-π/2, π/2]``."""
    confidence: float = Field(ge=0.0, le=1.0)
    class_id: int = 0
    source: SlotSource = SlotSource.sam3
    row_id: int | None = None
    is_fallback: bool = False
    """SAM3 fallback flag — set when the orientation was lifted from the
    axis-aligned xyxy bbox because the instance mask was too sparse. Used by
    the geometric engine to drop such anchors from row-angle averages."""

    model_config = ConfigDict(frozen=False)

    @property
    def corners(self) -> list[tuple[float, float]]:
        """Four OBB corners in pixel space (same convention as GeoJSON export)."""
        from autoabsmap.generator_engine.pixel_obb import pixel_obb_corner_points

        return pixel_obb_corner_points(
            self.center_x, self.center_y, self.width, self.height, self.angle_rad,
        )


class HintMasks(BaseModel):
    """Optional WGS84 hint polygons for a single crop (API contract).

    The single-crop runner does not rasterize or apply these; they are kept on
    the request model so clients can submit them without validation errors.
    """

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
    """Accepted for API compatibility; not used by :class:`ParkingSlotPipeline`."""


class StageProgress(BaseModel):
    """Progress within a single crop run (no crop_index here).

    The MultiCropOrchestrator in autocalib-api wraps this into an
    OrchestratorProgress that adds crop context before forwarding to SSE.
    """

    stage: str
    percent: int = Field(ge=0, le=100)


class RunMeta(BaseModel):
    """Metadata captured during a pipeline run — for learning loop traceability."""

    sam3_model_id: str | None = None
    sam3_text_prompt: str | None = None
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
    detection_overlay_geojson: dict[str, Any] | None = None
    """Baseline OBBs as FeatureCollection — true pixel-space geometry, no export rotation."""
    postprocess_overlay_geojson: dict[str, Any] | None = None
    """Enriched OBBs as FeatureCollection — true pixel-space geometry, no export rotation."""
