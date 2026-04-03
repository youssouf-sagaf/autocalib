"""MultiCropOrchestrator — loop crops, stream progress, merge + deduplicate.

Merge rule (architecture doc): first-crop-wins, IoU > 0.5 → discard new slot.
No averaging, no confidence tie-break.
"""

from __future__ import annotations

import logging
from typing import Callable

from shapely.geometry import Polygon as ShapelyPolygon

from absmap.export.models import GeoSlot
from absmap.pipeline.models import PipelineRequest, PipelineResult, StageProgress
from absmap.pipeline.runner import ParkingSlotPipeline
from app.models import CropRequest, JobResult, OrchestratorProgress

logger = logging.getLogger(__name__)

__all__ = ["MultiCropOrchestrator"]

OrchestratorProgressCallback = Callable[[OrchestratorProgress], None]

MERGE_IOU_THRESHOLD = 0.5


def _geoslot_shapely(slot: GeoSlot) -> ShapelyPolygon:
    """Convert a GeoSlot polygon to Shapely for IoU computation."""
    coords = slot.polygon.coordinates[0]
    return ShapelyPolygon([(c[0], c[1]) for c in coords])


def _iou(poly_a: ShapelyPolygon, poly_b: ShapelyPolygon) -> float:
    """Intersection over Union between two polygons."""
    if not poly_a.is_valid or not poly_b.is_valid:
        return 0.0
    intersection = poly_a.intersection(poly_b).area
    union = poly_a.union(poly_b).area
    if union == 0:
        return 0.0
    return intersection / union


def _merge_slots(
    existing: list[GeoSlot],
    new_slots: list[GeoSlot],
    iou_threshold: float = MERGE_IOU_THRESHOLD,
) -> list[GeoSlot]:
    """Add new slots to the existing list, discarding duplicates (first-crop-wins)."""
    existing_polys = [_geoslot_shapely(s) for s in existing]

    for slot in new_slots:
        slot_poly = _geoslot_shapely(slot)
        is_duplicate = any(
            _iou(slot_poly, ep) > iou_threshold
            for ep in existing_polys
        )
        if not is_duplicate:
            existing.append(slot)
            existing_polys.append(slot_poly)

    return existing


class MultiCropOrchestrator:
    """Orchestrates N crop pipeline runs sequentially, then merges results.

    Wraps the per-crop StageProgress into OrchestratorProgress (adds
    crop_index / crop_total) before forwarding to the SSE callback.
    """

    def __init__(self, pipeline: ParkingSlotPipeline) -> None:
        self._pipeline = pipeline

    async def run(
        self,
        crops: list[CropRequest],
        job_id: str,
        on_progress: OrchestratorProgressCallback | None = None,
    ) -> JobResult:
        """Run all crops and merge results."""
        crop_total = len(crops)
        crop_results: list[PipelineResult] = []
        merged_slots: list[GeoSlot] = []
        merged_baselines: list[GeoSlot] = []

        for idx, crop in enumerate(crops):
            logger.info("Processing crop %d/%d for job %s", idx + 1, crop_total, job_id)

            def _wrap_progress(sp: StageProgress, _idx: int = idx) -> None:
                if on_progress:
                    on_progress(OrchestratorProgress(
                        crop_index=_idx,
                        crop_total=crop_total,
                        stage=sp.stage,
                        percent=sp.percent,
                    ))

            request = PipelineRequest(roi=crop.polygon, hints=crop.hints)

            import asyncio
            result = await asyncio.to_thread(
                self._pipeline.run, request, _wrap_progress,
            )

            crop_results.append(result)
            merged_slots = _merge_slots(merged_slots, result.slots)
            merged_baselines = _merge_slots(merged_baselines, result.baseline_slots)

        logger.info(
            "Job %s complete: %d crops → %d merged slots",
            job_id, crop_total, len(merged_slots),
        )

        return JobResult(
            job_id=job_id,
            slots=merged_slots,
            baseline_slots=merged_baselines,
            crop_results=crop_results,
        )
