"""Pure stage functions — each stage is a stateless function.

The runner composes them; tests can call each independently.
"""

from __future__ import annotations

import logging
from typing import Callable

import numpy as np
from geojson_pydantic import Polygon as GeoJSONPolygon
from rasterio.transform import Affine

from absmap.export.geojson import pixel_slots_to_geoslots
from absmap.export.models import GeoSlot
from absmap.geometry.models import PixelSlot, SlotSource
from absmap.imagery.protocols import ImageryProvider
from absmap.io.geotiff import GeoRasterSlice
from absmap.ml.models import DetectionResult, SegmentationOutput
from absmap.ml.protocols import Detector, Segmenter
from absmap.pipeline.models import StageProgress

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[StageProgress], None]


def fetch_imagery(
    provider: ImageryProvider,
    roi: GeoJSONPolygon,
    target_gsd_m: float,
    on_progress: ProgressCallback | None = None,
) -> GeoRasterSlice:
    """Fetch high-res raster for one crop ROI."""
    if on_progress:
        on_progress(StageProgress(stage="fetch_imagery", percent=0))

    raster = provider.fetch_geotiff(roi, target_gsd_m)

    if on_progress:
        on_progress(StageProgress(stage="fetch_imagery", percent=100))

    logger.info(
        "Fetched imagery: %dx%d, CRS=%d, GSD=%.4fm",
        raster.width, raster.height, raster.crs_epsg, raster.gsd_m,
    )
    return raster


def segment(
    segmenter: Segmenter,
    raster: GeoRasterSlice,
    on_progress: ProgressCallback | None = None,
) -> SegmentationOutput:
    """Run binary segmentation on the raster pixels."""
    if on_progress:
        on_progress(StageProgress(stage="segment", percent=0))

    result = segmenter.predict(raster.pixels)

    if on_progress:
        on_progress(StageProgress(stage="segment", percent=100))

    mask_px = int(np.count_nonzero(result.mask_refined))
    total_px = result.mask_refined.shape[0] * result.mask_refined.shape[1]
    logger.info("Segmentation: %d/%d pixels parkable (%.1f%%)", mask_px, total_px, 100 * mask_px / max(total_px, 1))
    return result


def detect(
    detector: Detector,
    raster: GeoRasterSlice,
    seg_output: SegmentationOutput,
    on_progress: ProgressCallback | None = None,
) -> DetectionResult:
    """Run OBB detection on the raster, optionally masked by segmentation."""
    if on_progress:
        on_progress(StageProgress(stage="detect", percent=0))

    result = detector.predict(raster.pixels, parkable_mask=seg_output.mask_refined)

    if on_progress:
        on_progress(StageProgress(stage="detect", percent=100))

    logger.info("Detection: %d spots (%d empty, %d occupied)", len(result.spots), result.num_empty, result.num_occupied)
    return result


def detections_to_pixel_slots(det: DetectionResult) -> list[PixelSlot]:
    """Convert raw detector output to PixelSlot models."""
    return [
        PixelSlot(
            center_x=s.center_x,
            center_y=s.center_y,
            width=s.width,
            height=s.height,
            angle_rad=s.angle_rad,
            confidence=s.confidence,
            class_id=s.class_id,
            source=SlotSource.yolo,
        )
        for s in det.spots
    ]


def export_to_geoslots(
    pixel_slots: list[PixelSlot],
    raster: GeoRasterSlice,
    on_progress: ProgressCallback | None = None,
) -> list[GeoSlot]:
    """Convert pixel slots to WGS84 GeoSlots (outbound CRS gate)."""
    if on_progress:
        on_progress(StageProgress(stage="export", percent=0))

    affine = Affine(*raster.affine)
    geo_slots = pixel_slots_to_geoslots(pixel_slots, affine, raster.crs_epsg)

    if on_progress:
        on_progress(StageProgress(stage="export", percent=100))

    return geo_slots
