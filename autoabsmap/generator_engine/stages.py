"""Pure stage functions — each stage is a stateless function.

The runner composes them; tests can call each independently.
"""

from __future__ import annotations

import logging
import math
from typing import Callable

import cv2
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


def roi_pixel_mask(
    raster: GeoRasterSlice,
    roi: GeoJSONPolygon,
) -> np.ndarray:
    """Build a binary uint8 mask (255 inside ROI, 0 outside) in pixel space."""
    affine = Affine(*raster.affine)
    inv = ~affine

    coords = roi.coordinates[0]
    pixel_pts = np.array(
        [[int(round(px)), int(round(py))]
         for lon, lat in coords
         for px, py in [inv * (lon, lat)]],
        dtype=np.int32,
    )

    mask = np.zeros((raster.height, raster.width), dtype=np.uint8)
    cv2.fillPoly(mask, [pixel_pts], 255)
    return mask


def mask_outside_roi(
    raster: GeoRasterSlice,
    roi: GeoJSONPolygon,
    neutral_rgb: tuple[int, int, int] = (128, 128, 128),
) -> GeoRasterSlice:
    """Gray out pixels outside the original ROI polygon.

    Prevents ML models from hallucinating detections outside the
    area of interest when the fetched image is larger than the ROI.
    """
    mask = roi_pixel_mask(raster, roi)

    masked = raster.pixels.copy()
    bg = np.full_like(masked, neutral_rgb, dtype=np.uint8)
    mask_3c = mask[:, :, np.newaxis] > 0
    masked = np.where(mask_3c, masked, bg)

    return GeoRasterSlice(
        pixels=masked,
        crs_epsg=raster.crs_epsg,
        affine=raster.affine,
        bounds_native=raster.bounds_native,
        bounds_wgs84=raster.bounds_wgs84,
        gsd_m=raster.gsd_m,
    )


def crop_to_roi_bounds(
    raster: GeoRasterSlice,
    roi: GeoJSONPolygon,
    margin_px: int = 4,
) -> GeoRasterSlice:
    """Crop the raster to the pixel-space bounding box of the ROI polygon.

    Eliminates the large gray margins that appear when the ROI is rotated
    relative to the axis-aligned Mapbox bbox.  The affine transform is
    shifted so world↔pixel mapping remains correct.
    """
    affine = Affine(*raster.affine)
    inv = ~affine

    coords = roi.coordinates[0]
    xs, ys = [], []
    for lon, lat in coords:
        px, py = inv * (lon, lat)
        xs.append(px)
        ys.append(py)

    x0 = max(0, int(math.floor(min(xs))) - margin_px)
    y0 = max(0, int(math.floor(min(ys))) - margin_px)
    x1 = min(raster.width, int(math.ceil(max(xs))) + margin_px)
    y1 = min(raster.height, int(math.ceil(max(ys))) + margin_px)

    if x0 == 0 and y0 == 0 and x1 == raster.width and y1 == raster.height:
        return raster

    cropped_pixels = raster.pixels[y0:y1, x0:x1].copy()

    a, b, c, d, e, f = raster.affine
    new_c = c + x0 * a + y0 * b
    new_f = f + x0 * d + y0 * e
    new_affine = (a, b, new_c, d, e, new_f)

    new_aff = Affine(*new_affine)
    h, w = cropped_pixels.shape[:2]
    tl = new_aff * (0, 0)
    br = new_aff * (w, h)

    from autoabsmap.io.geotiff import BBox, compute_gsd_m
    from rasterio.crs import CRS

    new_bounds = BBox(
        west=min(tl[0], br[0]),
        south=min(tl[1], br[1]),
        east=max(tl[0], br[0]),
        north=max(tl[1], br[1]),
    )

    return GeoRasterSlice(
        pixels=cropped_pixels,
        crs_epsg=raster.crs_epsg,
        affine=new_affine,
        bounds_native=new_bounds,
        bounds_wgs84=new_bounds,
        gsd_m=compute_gsd_m(new_aff, CRS.from_epsg(raster.crs_epsg)),
    )


def clip_seg_mask_to_roi(
    seg_mask: np.ndarray,
    raster: GeoRasterSlice,
    roi: GeoJSONPolygon,
) -> np.ndarray:
    """AND the segmentation mask with the ROI boundary.

    Ensures the geometric engine cannot create synthetic slots
    (gap-fill, extension, recovery) outside the original ROI.
    """
    roi_mask = roi_pixel_mask(raster, roi)
    return cv2.bitwise_and(seg_mask, roi_mask)


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
