"""ParkingSlotPipeline — the single public entry point for the API layer.

Composes stages sequentially on ONE crop.  Multi-crop orchestration
and SSE streaming are the API layer's concern.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

import numpy as np

from autoabsmap.config.settings import PipelineSettings
from autoabsmap.imagery.protocols import ImageryProvider
from autoabsmap.ml.protocols import Detector
from autoabsmap.generator_engine.models import PipelineRequest, PipelineResult, RunMeta
from autoabsmap.generator_engine.geometric_engine import GeometricEngine
from autoabsmap.generator_engine.mask_vectorize import pixel_slots_to_overlay_fc
from autoabsmap.generator_engine.learning_artifacts import CropLearningArtifacts
from autoabsmap.generator_engine.prior import build_geometric_prior_from_detection_and_roi
from autoabsmap.generator_engine.stage_artifacts import ArtifactDumper
from autoabsmap.generator_engine.stages import (
    ProgressCallback,
    crop_to_roi_bounds,
    detect,
    detections_to_pixel_slots,
    export_to_geoslots,
    fetch_imagery,
    mask_outside_roi,
    roi_pixel_mask,
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
        detector: Detector,
        settings: PipelineSettings | None = None,
    ) -> None:
        self._imagery = imagery
        self._detector = detector
        self._settings = settings or PipelineSettings()

    def run(
        self,
        request: PipelineRequest,
        on_progress: ProgressCallback | None = None,
        artifacts_dir: Path | str | None = None,
        *,
        learning_sink: Callable[[CropLearningArtifacts], None] | None = None,
        imagery_override: ImageryProvider | None = None,
    ) -> PipelineResult:
        """Run the full pipeline on a single crop ROI.

        Stages: fetch_imagery → detect → geometric_engine → export.
        Emits StageProgress events via *on_progress* for SSE streaming.
        When *artifacts_dir* is set, saves debug images at each stage.

        *imagery_override* lets the caller swap the imagery source for one
        run (per-job source switching) without rebuilding the pipeline
        singleton. Falls back to the constructor-injected provider when None.
        """
        dumper = ArtifactDumper(artifacts_dir)
        target_gsd = self._settings.imagery.target_gsd_m
        imagery = imagery_override or self._imagery

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

        raster_raw = fetch_imagery(imagery, fetch_window, target_gsd, on_progress)
        raster_masked = mask_outside_roi(raster_raw, request.roi)
        raster = crop_to_roi_bounds(raster_masked, request.roi)
        logger.info(
            "ROI crop: %dx%d → %dx%d (trimmed %d%% gray margin)",
            raster_masked.width, raster_masked.height,
            raster.width, raster.height,
            int((1 - (raster.width * raster.height) / max(1, raster_masked.width * raster_masked.height)) * 100),
        )
        dumper.dump_imagery(raster, request.roi)

        roi_mask = roi_pixel_mask(raster, request.roi)

        det_result = detect(
            self._detector,
            raster,
            self._settings.detection,
            on_progress,
        )
        pixel_slots = detections_to_pixel_slots(det_result)
        dumper.dump_detections(raster, pixel_slots)

        prior, binary_roi = build_geometric_prior_from_detection_and_roi(
            pixel_slots, roi_mask, self._settings, raster.gsd_m,
        )
        logger.info(
            "Geometric prior: source=%s w=%.1fpx h=%.1fpx conf=%.2f",
            prior.source.value,
            prior.slot_width_px,
            prior.slot_height_px,
            prior.confidence,
        )

        baseline_geo = export_to_geoslots(pixel_slots, raster, on_progress)
        detection_overlay = pixel_slots_to_overlay_fc(
            pixel_slots, raster.affine, raster.crs_epsg,
        )

        if dumper.active:
            mask_vis = np.stack([binary_roi] * 3, axis=-1) if binary_roi.ndim == 2 else binary_roi
            dumper.dump_evidence(raster, mask_vis, pixel_slots, prior)

        geo_engine = GeometricEngine(self._settings.geometry)
        enriched_slots = geo_engine.process(
            list(pixel_slots),
            roi_mask,
            prior=prior,
            roi_mask=roi_mask,
            gsd_m=raster.gsd_m,
        )
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

        provider_slug = type(imagery).__name__.removesuffix("ImageryProvider").lower() or "unknown"
        run_meta = RunMeta(
            sam3_model_id=self._settings.detection.sam3_model_id,
            sam3_text_prompt=self._settings.detection.text_prompt,
            imagery_provider=provider_slug,
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
            detection_overlay_geojson=detection_overlay,
            postprocess_overlay_geojson=postprocess_overlay,
        )
