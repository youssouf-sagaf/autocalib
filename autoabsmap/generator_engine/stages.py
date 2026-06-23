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

from autoabsmap.config.settings import GeometrySettings
from autoabsmap.export.geojson import pixel_slots_to_geoslots
from autoabsmap.export.models import GeoSlot, SlotSource
from autoabsmap.generator_engine.models import PixelSlot, StageProgress
from autoabsmap.imagery.protocols import ImageryProvider
from autoabsmap.io.geotiff import GeoRasterSlice
from autoabsmap.config.settings import DetectionSettings
from autoabsmap.ml.models import DetectionResult
from autoabsmap.ml.detection_filters import filter_spot_detections
from autoabsmap.ml.protocols import Detector

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


def detect(
    detector: Detector,
    raster: GeoRasterSlice,
    detection_settings: DetectionSettings,
    on_progress: ProgressCallback | None = None,
) -> DetectionResult:
    """Run SAM3 vehicle detection on the full raster (unmasked).

    The geometric engine needs all raw detections for proper row clustering;
    ROI-based filtering happens downstream in the geometric postprocessing.
    Tiny false positives are dropped via ``min_detection_width_m``.
    """
    if on_progress:
        on_progress(StageProgress(stage="detect", percent=0))

    result = detector.predict(raster.pixels)
    kept, dropped = filter_spot_detections(
        result.spots,
        detection_settings,
        gsd_m=raster.gsd_m,
    )
    if dropped:
        logger.info(
            "Detection size filter: dropped %d tiny box(es) (short side < %.1f px)",
            dropped,
            detection_settings.min_detection_width_m / max(raster.gsd_m, 1e-9),
        )
    result = DetectionResult(
        spots=kept,
        image_height=result.image_height,
        image_width=result.image_width,
    )

    if on_progress:
        on_progress(StageProgress(stage="detect", percent=100))

    logger.info("Detection: %d vehicle(s)", len(result.spots))
    return result


def detections_to_pixel_slots(det: DetectionResult) -> list[PixelSlot]:
    """Convert SAM3 mask-fit detections to ``PixelSlot`` models."""
    return [
        PixelSlot(
            center_x=s.center_x,
            center_y=s.center_y,
            width=min(s.width, s.height),
            height=max(s.width, s.height),
            angle_rad=s.angle_rad,
            confidence=s.confidence,
            class_id=s.class_id,
            source=SlotSource.sam3,
            is_fallback=s.is_fallback,
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
