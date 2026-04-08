"""MultiCropOrchestrator — loop crops, stream progress, merge + deduplicate.

Merge rule (architecture doc): first-crop-wins, IoU > 0.5 → discard new slot.
No averaging, no confidence tie-break.

Auto-tiling: large ROIs are split into overlapping sub-tiles so each tile
stays within the 1280 px limit at the target GSD (~64 m × 64 m at 0.05 m/px).
"""

from __future__ import annotations

import asyncio
import logging
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from geojson_pydantic import Polygon as GeoJSONPolygon
from shapely.geometry import Polygon as ShapelyPolygon
from shapely.geometry import box as shapely_box

from autoabsmap.export.models import GeoSlot
from autoabsmap.generator_engine.models import PipelineRequest, PipelineResult, StageProgress
from autoabsmap.generator_engine.runner import ParkingSlotPipeline
from app.models import CropRequest, JobResult, OrchestratorProgress

logger = logging.getLogger(__name__)

__all__ = ["MultiCropOrchestrator"]

OrchestratorProgressCallback = Callable[[OrchestratorProgress], None]

MERGE_IOU_THRESHOLD = 0.5
MAX_TILE_PX = 1280
TILE_OVERLAP_M = 10.0


# ── Geometry helpers ──────────────────────────────────────────────────────

def _geoslot_shapely(slot: GeoSlot) -> ShapelyPolygon:
    """Convert a GeoSlot polygon to Shapely for IoU computation."""
    coords = slot.polygon.coordinates[0]
    return ShapelyPolygon([(c[0], c[1]) for c in coords])


def _iou(poly_a: ShapelyPolygon, poly_b: ShapelyPolygon) -> float:
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


# ── ROI tiling helpers ─────────────────────────────────────────────────────

def _geojson_polygon_to_shapely(poly: GeoJSONPolygon) -> ShapelyPolygon:
    coords = poly.coordinates[0]
    return ShapelyPolygon([(c[0], c[1]) for c in coords])


def _clip_roi_to_tile(
    roi: GeoJSONPolygon,
    west: float,
    south: float,
    east: float,
    north: float,
) -> GeoJSONPolygon | None:
    """Clip a ROI polygon to a tile rectangle.

    This keeps the true semantic ROI boundary when we fetch imagery using a
    rectangular window.
    """
    roi_shape = _geojson_polygon_to_shapely(roi)
    tile_shape = shapely_box(west, south, east, north)
    inter = roi_shape.intersection(tile_shape)
    if inter.is_empty:
        return None

    if inter.geom_type == "Polygon":
        poly = inter
    elif inter.geom_type == "MultiPolygon":
        poly = max(inter.geoms, key=lambda g: g.area, default=None)
        if poly is None:
            return None
    else:
        # LineString/Point intersections are not useful for the pipeline.
        return None

    ring = [(float(x), float(y)) for x, y in poly.exterior.coords]
    if len(ring) < 4:
        return None
    if ring[0] != ring[-1]:
        ring.append(ring[0])

    return GeoJSONPolygon(
        type="Polygon",
        coordinates=[[list(p) for p in ring]],
    )


@dataclass(frozen=True)
class _TiledCrop:
    """Internal per-tile request.

    - fetch_window: rectangle window used to fetch imagery
    - roi: true ROI polygon used for masking/clipping
    """

    fetch_window: GeoJSONPolygon | None
    roi: GeoJSONPolygon
    hints: object | None


# ── Auto-tiling ───────────────────────────────────────────────────────────

def _tile_crop(crop: CropRequest, target_gsd_m: float) -> list[_TiledCrop]:
    """Split a crop ROI into overlapping tiles if it exceeds the ML sweet spot.

    Each tile covers at most ``MAX_TILE_PX * target_gsd_m`` metres per side
    (default ≈ 64 m at 0.05 m/px).  Tiles overlap by ``TILE_OVERLAP_M`` to
    avoid cutting parking rows at tile seams.  The merge step deduplicates.

    If the ROI fits in a single tile, returns a one-element list (no split).
    """
    coords = crop.polygon.coordinates[0]
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    west, east = min(lons), max(lons)
    south, north = min(lats), max(lats)

    mid_lat = (south + north) / 2.0
    m_per_deg_lon = 111_320.0 * math.cos(math.radians(mid_lat))
    m_per_deg_lat = 111_320.0

    ground_w = (east - west) * m_per_deg_lon
    ground_h = (north - south) * m_per_deg_lat

    tile_ground = MAX_TILE_PX * target_gsd_m
    if ground_w <= tile_ground and ground_h <= tile_ground:
        return [_TiledCrop(fetch_window=None, roi=crop.polygon, hints=crop.hints)]

    step_m = tile_ground - TILE_OVERLAP_M
    step_lon = step_m / m_per_deg_lon
    step_lat = step_m / m_per_deg_lat
    tile_lon = tile_ground / m_per_deg_lon
    tile_lat = tile_ground / m_per_deg_lat

    n_x = max(1, math.ceil((east - west - TILE_OVERLAP_M / m_per_deg_lon) / step_lon))
    n_y = max(1, math.ceil((north - south - TILE_OVERLAP_M / m_per_deg_lat) / step_lat))

    tiles: list[_TiledCrop] = []
    for iy in range(n_y):
        for ix in range(n_x):
            t_west = west + ix * step_lon
            t_south = south + iy * step_lat
            t_east = min(t_west + tile_lon, east + tile_lon * 0.01)
            t_north = min(t_south + tile_lat, north + tile_lat * 0.01)

            fetch_window = GeoJSONPolygon(
                type="Polygon",
                coordinates=[[
                    [t_west, t_south],
                    [t_east, t_south],
                    [t_east, t_north],
                    [t_west, t_north],
                    [t_west, t_south],
                ]],
            )

            roi_clipped = _clip_roi_to_tile(crop.polygon, t_west, t_south, t_east, t_north)
            if roi_clipped is None:
                continue
            tiles.append(_TiledCrop(fetch_window=fetch_window, roi=roi_clipped, hints=crop.hints))

    logger.info(
        "Auto-tiled ROI (%.0f×%.0fm) into %d tiles of ~%.0f×%.0fm with %.0fm overlap",
        ground_w, ground_h, len(tiles), tile_ground, tile_ground, TILE_OVERLAP_M,
    )
    return tiles


# ── Orchestrator ──────────────────────────────────────────────────────────

class MultiCropOrchestrator:
    """Orchestrates N crop pipeline runs sequentially, then merges results.

    Large ROIs are auto-tiled before running so each tile gets the correct
    GSD for the ML models.  Wraps per-crop StageProgress into
    OrchestratorProgress (adds crop_index / crop_total) for SSE.
    """

    def __init__(self, pipeline: ParkingSlotPipeline) -> None:
        self._pipeline = pipeline

    async def run(
        self,
        crops: list[CropRequest],
        job_id: str,
        on_progress: OrchestratorProgressCallback | None = None,
    ) -> JobResult:
        settings = self._pipeline._settings
        target_gsd = settings.imagery.target_gsd_m

        artifacts_base: Path | None = None
        if settings.debug_artifacts:
            import autoabsmap
            pkg_root = Path(autoabsmap.__file__).resolve().parent
            artifacts_base = pkg_root / "artifacts" / job_id

        all_tiles: list[_TiledCrop] = []
        for crop in crops:
            all_tiles.extend(_tile_crop(crop, target_gsd))

        crop_total = len(all_tiles)
        if crop_total > len(crops):
            logger.info(
                "Job %s: %d user crop(s) expanded to %d tiles",
                job_id, len(crops), crop_total,
            )

        crop_results: list[PipelineResult] = []
        merged_slots: list[GeoSlot] = []
        merged_baselines: list[GeoSlot] = []
        merged_mask_features: list[dict] = []
        merged_detection_features: list[dict] = []
        merged_postprocess_features: list[dict] = []

        for idx, tile in enumerate(all_tiles):
            logger.info("Processing tile %d/%d for job %s", idx + 1, crop_total, job_id)

            tile_artifacts = (
                artifacts_base / f"tile_{idx:02d}" if artifacts_base else None
            )

            def _wrap_progress(sp: StageProgress, _idx: int = idx) -> None:
                if on_progress:
                    on_progress(OrchestratorProgress(
                        crop_index=_idx,
                        crop_total=crop_total,
                        stage=sp.stage,
                        percent=sp.percent,
                    ))

            request = PipelineRequest(
                roi=tile.roi,
                fetch_window=tile.fetch_window,
                hints=tile.hints,  # type: ignore[arg-type]
            )
            result = await asyncio.to_thread(
                self._pipeline.run, request, _wrap_progress, tile_artifacts,
            )

            crop_results.append(result)
            merged_slots = _merge_slots(merged_slots, result.slots)
            merged_baselines = _merge_slots(merged_baselines, result.baseline_slots)
            if result.mask_polygons_geojson:
                merged_mask_features.extend(
                    result.mask_polygons_geojson.get("features", [])
                )
            if result.detection_overlay_geojson:
                merged_detection_features.extend(
                    result.detection_overlay_geojson.get("features", [])
                )
            if result.postprocess_overlay_geojson:
                merged_postprocess_features.extend(
                    result.postprocess_overlay_geojson.get("features", [])
                )

        logger.info(
            "Job %s complete: %d tile(s) → %d merged slots",
            job_id, crop_total, len(merged_slots),
        )

        def _to_fc(feats: list[dict]) -> dict | None:
            return {"type": "FeatureCollection", "features": feats} if feats else None

        return JobResult(
            job_id=job_id,
            slots=merged_slots,
            baseline_slots=merged_baselines,
            crop_results=crop_results,
            mask_polygons=_to_fc(merged_mask_features),
            detection_overlay=_to_fc(merged_detection_features),
            postprocess_overlay=_to_fc(merged_postprocess_features),
        )
