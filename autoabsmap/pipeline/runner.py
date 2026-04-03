"""ParkingSlotPipeline — the single public entry point for the API layer.

Composes stages sequentially on ONE crop.  Multi-crop orchestration
and SSE streaming are the API layer's concern.
"""

from __future__ import annotations

import logging
from typing import Callable

from autoabsmap.config.settings import PipelineSettings
from autoabsmap.export.models import GeoSlot
from autoabsmap.imagery.protocols import ImageryProvider
from autoabsmap.ml.protocols import Detector, Segmenter
from autoabsmap.pipeline.models import PipelineRequest, PipelineResult, RunMeta, StageProgress
from autoabsmap.pipeline.stages import (
    ProgressCallback,
    detect,
    detections_to_pixel_slots,
    export_to_geoslots,
    fetch_imagery,
    segment,
)

logger = logging.getLogger(__name__)

__all__ = ["ParkingSlotPipeline"]


class ParkingSlotPipeline:
    """Stateless pipeline for one crop — injectable imagery + ML backends.

    The pipeline has no concept of "Mapbox" or "IGN": the concrete
    ImageryProvider is injected at construction.
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
    ) -> PipelineResult:
        """Run the full pipeline on a single crop ROI.

        Stages: fetch_imagery → segment → detect → (geometry TBD) → export.
        Emits StageProgress events via *on_progress* for SSE streaming.
        """
        target_gsd = self._settings.imagery.target_gsd_m

        raster = fetch_imagery(self._imagery, request.roi, target_gsd, on_progress)
        seg_output = segment(self._segmenter, raster, on_progress)
        det_result = detect(self._detector, raster, seg_output, on_progress)

        pixel_slots = detections_to_pixel_slots(det_result)

        baseline_geo = export_to_geoslots(pixel_slots, raster, on_progress)

        # TODO: GeometricEngine post-processing (gap fill, row extension,
        #       mask recovery) will be inserted here once geometry/engine.py is built.
        #       For now, final = baseline (raw detection output).
        final_geo = list(baseline_geo)

        run_meta = RunMeta(
            segformer_checkpoint=self._settings.segmentation.segformer_checkpoint_dir,
            yolo_weights=self._settings.detection.yolo_weights_path,
            imagery_provider=self._settings.imagery.source.value,
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
        )
