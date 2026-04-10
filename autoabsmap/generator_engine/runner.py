"""ParkingSlotPipeline — the single public entry point for the API layer.

Composes stages sequentially on ONE crop.  Multi-crop orchestration
and SSE streaming are the API layer's concern.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

from autoabsmap.config.settings import PipelineSettings
from autoabsmap.export.models import GeoSlot
from autoabsmap.imagery.protocols import ImageryProvider
from autoabsmap.ml.protocols import Detector, Segmenter
from autoabsmap.generator_engine.models import PipelineRequest, PipelineResult, RunMeta, StageProgress
from autoabsmap.generator_engine.geometric_engine import GeometricEngine
from autoabsmap.generator_engine.mask_vectorize import pixel_slots_to_overlay_fc, vectorize_mask
from autoabsmap.generator_engine.learning_artifacts import CropLearningArtifacts
from autoabsmap.generator_engine.stage_artifacts import ArtifactDumper
from autoabsmap.generator_engine.stages import (
    ProgressCallback,
    clip_seg_mask_to_roi,
    crop_to_roi_bounds,
    detect,
    detections_to_pixel_slots,
    export_to_geoslots,
    fetch_imagery,
    mask_outside_roi,
    segment,
)

logger = logging.getLogger(__name__)

__all__ = ["ParkingSlotPipeline"]


class ParkingSlotPipeline:
    """Stateless pipeline for one crop — injectable imagery + ML backends.

    The concrete ImageryProvider is injected at construction; today the only
    implementation is MapboxImageryProvider.
    """

    def __init__(
        self,
        imagery: ImageryProvider,
        segmenter: Segmenter,
        detector: Detector,
        settings: PipelineSettings | None = None,
    ) -> None:
        self._imagery = imagery
        self._segmenter = segmenter
        self._detector = detector
        self._settings = settings or PipelineSettings()

    def run(
        self,
        request: PipelineRequest,
        on_progress: ProgressCallback | None = None,
        artifacts_dir: Path | str | None = None,
        *,
        learning_sink: Callable[[CropLearningArtifacts], None] | None = None,
    ) -> PipelineResult:
        """Run the full pipeline on a single crop ROI.

        Stages: fetch_imagery → segment → detect → geometric_engine → export.
        Emits StageProgress events via *on_progress* for SSE streaming.
        When *artifacts_dir* is set, saves debug images at each stage.
        """
        dumper = ArtifactDumper(artifacts_dir)
        target_gsd = self._settings.imagery.target_gsd_m

        fetch_window = request.fetch_window or request.roi

        coords = request.roi.coordinates[0]
        lons = [c[0] for c in coords]
        lats = [c[1] for c in coords]
        logger.info(
            "ROI polygon: %d vertices, bbox=[%.6f,%.6f,%.6f,%.6f]",
            len(coords) - 1, min(lons), min(lats), max(lons), max(lats),
        )
        for i, (lon, lat) in enumerate(coords[:-1]):
            logger.debug("  vertex %d: (%.7f, %.7f)", i, lon, lat)

        if request.fetch_window is not None:
            f_coords = fetch_window.coordinates[0]
            f_lons = [c[0] for c in f_coords]
            f_lats = [c[1] for c in f_coords]
            logger.info(
                "Fetch window: %d vertices, bbox=[%.6f,%.6f,%.6f,%.6f]",
                len(f_coords) - 1, min(f_lons), min(f_lats), max(f_lons), max(f_lats),
            )

        raster_raw = fetch_imagery(self._imagery, fetch_window, target_gsd, on_progress)
        raster_masked = mask_outside_roi(raster_raw, request.roi)
        raster = crop_to_roi_bounds(raster_masked, request.roi)
        logger.info(
            "ROI crop: %dx%d → %dx%d (trimmed %d%% gray margin)",
            raster_masked.width, raster_masked.height,
            raster.width, raster.height,
            int((1 - (raster.width * raster.height) / max(1, raster_masked.width * raster_masked.height)) * 100),
        )
        dumper.dump_imagery(raster, request.roi)

        seg_output = segment(self._segmenter, raster, on_progress)
        clipped_mask = clip_seg_mask_to_roi(seg_output.mask_refined, raster, request.roi)
        dumper.dump_segmentation(raster, seg_output, clipped_mask)

        mask_geojson = vectorize_mask(
            clipped_mask, raster.affine, raster.crs_epsg, gsd_m=raster.gsd_m,
        )

        det_result = detect(self._detector, raster, seg_output, on_progress)
        pixel_slots = detections_to_pixel_slots(det_result)
        dumper.dump_detections(raster, pixel_slots)

        baseline_geo = export_to_geoslots(pixel_slots, raster, on_progress)
        detection_overlay = pixel_slots_to_overlay_fc(
            pixel_slots, raster.affine, raster.crs_epsg,
        )

        geo_engine = GeometricEngine(self._settings.geometry)
        enriched_slots = geo_engine.process(pixel_slots, clipped_mask)
        dumper.dump_postprocess(raster, enriched_slots, len(pixel_slots))

        final_geo = export_to_geoslots(enriched_slots, raster, on_progress)
        dumper.dump_export(final_geo)
        postprocess_overlay = pixel_slots_to_overlay_fc(
            enriched_slots, raster.affine, raster.crs_epsg,
        )

        if learning_sink is not None:
            bw = raster.bounds_wgs84
            learning_sink(
                CropLearningArtifacts(
                    rgb_hwc=raster.pixels,
                    segmentation_mask=clipped_mask,
                    crop_meta={
                        "affine": tuple(float(x) for x in raster.affine),
                        "crs_epsg": raster.crs_epsg,
                        "bounds_wgs84_west": bw.west,
                        "bounds_wgs84_south": bw.south,
                        "bounds_wgs84_east": bw.east,
                        "bounds_wgs84_north": bw.north,
                        "image_height": raster.height,
                        "image_width": raster.width,
                        "gsd_m": raster.gsd_m,
                    },
                    raw_detection_slots=list(baseline_geo),
                    post_processed_slots=list(final_geo),
                ),
            )

        run_meta = RunMeta(
            segformer_checkpoint=self._settings.segmentation.segformer_checkpoint_dir,
            yolo_weights=self._settings.detection.yolo_weights_path,
            imagery_provider="mapbox",
            crs_epsg=raster.crs_epsg,
            gsd_m=raster.gsd_m,
            roi_geojson=request.roi.model_dump(),
        )

        logger.info(
            "Pipeline complete: %d baseline slots, %d final slots",
            len(baseline_geo), len(final_geo),
        )

        return PipelineResult(
            slots=final_geo,
            baseline_slots=baseline_geo,
            run_meta=run_meta,
            mask_polygons_geojson=mask_geojson,
            detection_overlay_geojson=detection_overlay,
            postprocess_overlay_geojson=postprocess_overlay,
        )
