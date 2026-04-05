"""Pure stage functions — each stage is a stateless function.

The runner composes them; tests can call each independently.
"""

from __future__ import annotations

import logging
import math
from typing import Callable

import numpy as np
from geojson_pydantic import Polygon as GeoJSONPolygon
from rasterio.transform import Affine

from autoabsmap.export.geojson import pixel_slots_to_geoslots
from autoabsmap.export.models import GeoSlot, SlotSource
from autoabsmap.generator_engine.models import PixelSlot, StageProgress
from autoabsmap.imagery.protocols import ImageryProvider
from autoabsmap.io.geotiff import GeoRasterSlice
from autoabsmap.ml.models import DetectionResult, SegmentationOutput, SpotDetection
from autoabsmap.ml.protocols import Detector, Segmenter

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
    """Run OBB detection on the full raster (unmasked).

    The segmentation mask is NOT used here — the geometric engine
    needs all raw detections for proper row clustering. Mask-based
    filtering happens downstream in the geometric postprocessing.
    """
    if on_progress:
        on_progress(StageProgress(stage="detect", percent=0))

    result = detector.predict(raster.pixels)

    if on_progress:
        on_progress(StageProgress(stage="detect", percent=100))

    logger.info("Detection: %d spots (%d empty, %d occupied)", len(result.spots), result.num_empty, result.num_occupied)
    return result


def _normalize_slot_geometry(s: SpotDetection) -> PixelSlot:
    """Re-derive width/height/angle from OBB corners — matching R&D's
    ``_from_detections`` normalization.

    Ultralytics ``xywhr`` does not guarantee width < height. This function
    ensures width = shorter side (row axis) and height = longer side (depth),
    then computes the angle of the width (short) axis, normalized to
    [-π/2, π/2].  The geometric engine assumes this convention everywhere.
    """
    corners = np.array(s.corners)
    v1 = corners[1] - corners[0]
    v2 = corners[2] - corners[1]
    len1 = float(np.linalg.norm(v1))
    len2 = float(np.linalg.norm(v2))

    if len1 < len2:
        w, h = len1, len2
        dir_vec = v2 / len2 if len2 > 0 else np.array([1.0, 0.0])
    else:
        w, h = len2, len1
        dir_vec = v1 / len1 if len1 > 0 else np.array([1.0, 0.0])

    ang = math.atan2(float(dir_vec[1]), float(dir_vec[0]))
    ang = (ang + math.pi / 2) % math.pi - math.pi / 2

    return PixelSlot(
        center_x=s.center_x,
        center_y=s.center_y,
        width=w,
        height=h,
        angle_rad=ang,
        confidence=s.confidence,
        class_id=s.class_id,
        source=SlotSource.yolo,
    )


def detections_to_pixel_slots(det: DetectionResult) -> list[PixelSlot]:
    """Convert raw detector output to PixelSlot models.

    Re-normalizes each OBB so that width < height and angle follows
    the width-axis convention expected by the geometric engine.
    """
    return [_normalize_slot_geometry(s) for s in det.spots]


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
