"""Parking slot extraction pipeline: segmentation → YOLO-OBB detection → geometric post-processing → GeoJSON export."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Literal

import numpy as np
from PIL import Image
from rasterio.crs import CRS
from rasterio.transform import Affine
from shapely import affinity
from shapely.geometry import Polygon, box as shapely_box, mapping as shapely_mapping
from shapely.geometry.base import BaseGeometry

from absolutemap_gen.artifacts_io import (
    STAGE_DETECTION,
    STAGE_POSTPROCESS,
    RunContext,
    write_json_atomic,
    write_rgb_geotiff,
)
from absolutemap_gen.config import (
    DetectionSettings,
    SegmentationSettings,
    detection_settings_from_env,
    segmentation_settings_from_env,
)
from absolutemap_gen.detection import (
    SpotDetectionResult,
    YoloObbSpotDetector,
    annotate_spot_detections_overlay,
    spot_detections_to_serializable_dict,
)
from absolutemap_gen.geometric_engine import GeometricEngine
from absolutemap_gen.export_geojson import (
    feature_collection,
    shapely_to_geojson_feature,
    transform_geometry_pixels_to_wgs84,
)
from absolutemap_gen.io_geotiff import (
    GeoRasterSlice,
    compute_gsd_meters,
    crop_geotiff_by_bounds,
    crop_geotiff_by_pixels,
    read_geotiff_rgb,
)
from absolutemap_gen.preprocess import rgb_hwc_percentile_stretch
from absolutemap_gen.segmentation import (
    SegFormerParkableSegmenter,
    overlay_parkable_mask_on_rgb,
    refined_mask_to_multipolygon,
)


def _load_geotiff_slice(
    geotiff_path: Path,
    *,
    bbox: tuple[float, float, float, float] | None,
    window: tuple[int, int, int, int] | None,
) -> tuple[GeoRasterSlice, Literal["full", "bbox", "window"], dict[str, Any]]:
    """Return cropped or full raster slice and crop metadata for the manifest."""
    path = geotiff_path.resolve()
    if bbox is not None and window is not None:
        raise ValueError("Pass at most one of bbox or window")
    if bbox is not None:
        west, south, east, north = bbox
        params = {"west": west, "south": south, "east": east, "north": north}
        return crop_geotiff_by_bounds(path, bbox), "bbox", params
    if window is not None:
        col_off, row_off, width, height = window
        params = {"col_off": col_off, "row_off": row_off, "width": width, "height": height}
        return (
            crop_geotiff_by_pixels(path, col_off=col_off, row_off=row_off, width=width, height=height),
            "window",
            params,
        )
    rgb, transform, crs, nodata = read_geotiff_rgb(path)
    h, w = int(rgb.shape[0]), int(rgb.shape[1])
    slice_ = GeoRasterSlice(rgb=rgb, transform=transform, crs=crs, width=w, height=h, nodata=nodata)
    return slice_, "full", {}


def _oriented_rect(cx: float, cy: float, w: float, h: float, angle_rad: float) -> Polygon:
    """Build a rotated rectangle in pixel space from center, size, and angle."""
    hw = max(w, 1e-3) * 0.5
    hh = max(h, 1e-3) * 0.5
    rect = shapely_box(-hw, -hh, hw, hh)
    rect = affinity.rotate(rect, math.degrees(angle_rad), origin=(0.0, 0.0))
    rect = affinity.translate(rect, xoff=cx, yoff=cy)
    if not rect.is_valid:
        rect = rect.buffer(0)
    return rect


def _pixel_geom_to_wgs84(geom: BaseGeometry, transform: Affine, crs: CRS) -> BaseGeometry:
    """Apply pixel-to-world affine then reproject to EPSG:4326."""
    from pyproj import Transformer
    from shapely.ops import transform as shapely_coord_transform

    def _affine(x: float, y: float) -> tuple[float, float]:
        return transform * (x, y)

    in_crs = shapely_coord_transform(_affine, geom)
    if not in_crs.is_valid:
        in_crs = in_crs.buffer(0)

    if crs.to_epsg() == 4326:
        return in_crs

    proj = Transformer.from_crs(crs, CRS.from_epsg(4326), always_xy=True)

    def _to_wgs(x: float, y: float) -> tuple[float, float]:
        lon, lat = proj.transform(x, y)
        return float(lon), float(lat)

    out = shapely_coord_transform(_to_wgs, in_crs)
    return out if out.is_valid else out.buffer(0)


def _build_spot_geojson_features(
    spots: SpotDetectionResult,
    transform: Affine,
    crs: CRS,
) -> list[dict[str, Any]]:
    """Convert OBB spot detections to WGS84 GeoJSON features."""
    features: list[dict[str, Any]] = []
    for i, s in enumerate(spots.spots, start=1):
        footprint_px = _oriented_rect(s.center_x, s.center_y, s.width, s.height, s.angle_rad)
        geom_wgs = _pixel_geom_to_wgs84(footprint_px, transform, crs)
        features.append({
            "type": "Feature",
            "geometry": shapely_mapping(geom_wgs),
            "properties": {
                "slot_id": i,
                "status": "occupied" if s.occupied else "free",
                "confidence": round(float(s.confidence), 4),
                "class_id": s.class_id,
                "source": s.source,
                "center_px": [round(s.center_x, 2), round(s.center_y, 2)],
                "angle_rad": round(s.angle_rad, 4),
                "width_px": round(s.width, 2),
                "height_px": round(s.height, 2),
            },
        })
    return features


_SOURCE_COLORS: dict[str, tuple[int, int, int]] = {
    "row_extension": (255, 0, 255),
    "gap_fill": (255, 0, 255),
    "mask_recovery": (255, 165, 0),
}


def _annotate_enriched_overlay(
    rgb_hwc: np.ndarray,
    result: SpotDetectionResult,
) -> np.ndarray:
    """Draw oriented spot rectangles color-coded by source on an RGB image copy.

    Colors: green/yellow = YOLO (occupied/empty), magenta = row extension / gap fill,
    orange = mask recovery.
    """
    import cv2

    canvas = rgb_hwc.copy()
    for s in result.spots:
        if s.source == "yolo":
            color = (0, 255, 0) if s.class_id == 1 else (255, 255, 0)
        else:
            color = _SOURCE_COLORS.get(s.source, (200, 200, 200))
        corners = s.corners
        pts = np.array(
            [[int(round(x)), int(round(y))] for x, y in corners],
            dtype=np.int32,
        ).reshape((-1, 1, 2))
        cv2.polylines(canvas, [pts], True, color, 2, cv2.LINE_AA)
        cv2.circle(
            canvas,
            (int(round(s.center_x)), int(round(s.center_y))),
            3, color, -1, cv2.LINE_AA,
        )
    return canvas


def run_parking_pipeline(
    ctx: RunContext,
    geotiff_path: Path,
    *,
    bbox: tuple[float, float, float, float] | None = None,
    window: tuple[int, int, int, int] | None = None,
    seg_settings: SegmentationSettings | None = None,
    det_settings: DetectionSettings | None = None,
    cli_args: dict[str, Any] | None = None,
) -> Path:
    """Execute the parking slot extraction pipeline.

    Stages:
      00_gis_input     → load / crop GeoTIFF
      01_preprocess    → percentile stretch for display
      02_segmentation  → SegFormer binary parkable mask
      03_detection     → YOLO-OBB oriented parking spot detection
      04_postprocess   → geometric enrichment (gap fill, row extension, mask recovery)
      05_export        → WGS84 GeoJSON with slot footprints

    """
    out = ctx.out_dir.resolve()
    out.mkdir(parents=True, exist_ok=True)
    slice_, crop_mode, crop_params = _load_geotiff_slice(geotiff_path, bbox=bbox, window=window)
    rgb = slice_.rgb
    h, w = int(rgb.shape[0]), int(rgb.shape[1])
    transform = slice_.transform
    crs = slice_.crs

    ctx.initialize_manifest(
        input_geotiff=geotiff_path,
        cli_args=dict(cli_args or {}),
        crop_mode=crop_mode,
        crop_params=crop_params,
    )

    seg_settings = seg_settings or segmentation_settings_from_env(require_checkpoint=True)
    det_settings = det_settings or detection_settings_from_env(require_weights=True)

    stages = ctx.write_stage_artifacts
    if stages:
        ctx.stages_root.mkdir(parents=True, exist_ok=True)

    def stage(slug: str) -> Path:
        p = ctx.stage_dir(slug)
        p.mkdir(parents=True, exist_ok=True)
        return p

    # ── 00 GIS input ──────────────────────────────────────────────────────────
    gsd_m = compute_gsd_meters(transform, crs)
    if gsd_m is not None:
        print(f"[00_gis_input] {w}x{h}px, GSD ~{gsd_m:.3f} m/px")

    if stages:
        s0 = stage("00_gis_input")
        write_rgb_geotiff(s0 / "crop_rgb.tif", slice_.rgb, transform=slice_.transform, crs=crs)
        extra_meta = {}
        if gsd_m is not None:
            extra_meta["gsd_meters"] = round(gsd_m, 6)
        ctx.write_gis_input_meta(
            source_path=geotiff_path,
            transform=transform,
            crs=crs,
            width=slice_.width,
            height=slice_.height,
            nodata=slice_.nodata,
            extra=extra_meta or None,
        )
    ctx.record_stage(
        "00_gis_input",
        artifacts=(["crop_rgb.tif", "meta.json"] if stages else []),
    )

    # ── 01 preprocess ─────────────────────────────────────────────────────────
    stretched = rgb_hwc_percentile_stretch(rgb)
    if stages:
        s1 = stage("01_preprocess")
        Image.fromarray(stretched, mode="RGB").save(s1 / "rgb_normalized.png")
        stats = {
            "stage": "01_preprocess",
            "schema_version": 1,
            "percentile_low": 2.0,
            "percentile_high": 98.0,
            "mean_uint8": float(np.mean(rgb)),
        }
        write_json_atomic(s1 / "stats.json", stats)
    ctx.record_stage(
        "01_preprocess",
        artifacts=(["rgb_normalized.png", "stats.json"] if stages else []),
    )

    # ── 02 segmentation ──────────────────────────────────────────────────────
    segmenter = SegFormerParkableSegmenter(seg_settings)
    seg_out = segmenter.predict(rgb)
    if stages:
        s2 = stage("02_segmentation")
        Image.fromarray(seg_out.mask_raw, mode="L").save(s2 / "mask_raw.png")
        Image.fromarray(seg_out.mask_refined, mode="L").save(s2 / "mask_refined.png")
        seg_overlay = overlay_parkable_mask_on_rgb(stretched, seg_out.mask_refined)
        Image.fromarray(seg_overlay, mode="RGB").save(s2 / "overlay_segmentation.png")
        mp = refined_mask_to_multipolygon(seg_out.mask_refined)
        if mp is not None and not mp.is_empty and crs is not None:
            mp_wgs = transform_geometry_pixels_to_wgs84(mp, transform, crs)
            parkable_fc = feature_collection(
                [shapely_to_geojson_feature(mp_wgs, {"layer": "parkable"})]
            )
        else:
            parkable_fc = feature_collection([])
        write_json_atomic(s2 / "parkable.geojson", parkable_fc)
    ctx.record_stage(
        "02_segmentation",
        artifacts=(
            [
                "mask_raw.png",
                "mask_refined.png",
                "overlay_segmentation.png",
                "parkable.geojson",
            ]
            if stages
            else []
        ),
    )

    # ── 03 detection (YOLO-OBB parking spots) ────────────────────────────────
    detector = YoloObbSpotDetector(det_settings)

    # Run YOLO without mask filtering — the geometric engine needs ALL
    # detections for proper row clustering (matching Daniel's approach).
    # Spots outside the mask still help form rows and guide extensions;
    # they are removed later by dedup_and_validate.
    spot_result_all = detector.predict(rgb)

    # Mask-filtered view used for stage 03 display and metrics.
    mask = seg_out.mask_refined
    filtered_spots = [
        s for s in spot_result_all.spots
        if (0 <= int(round(s.center_y)) < h
            and 0 <= int(round(s.center_x)) < w
            and mask[int(round(s.center_y)), int(round(s.center_x))] > 0)
    ]
    spot_result = SpotDetectionResult(
        spots=filtered_spots,
        image_height=spot_result_all.image_height,
        image_width=spot_result_all.image_width,
        class_names=spot_result_all.class_names,
    )

    if stages:
        s3 = stage("03_detection")
        write_json_atomic(
            s3 / "detections.json",
            spot_detections_to_serializable_dict(spot_result),
        )
        write_json_atomic(
            s3 / "detections_raw.json",
            spot_detections_to_serializable_dict(spot_result_all),
        )
        overlay = annotate_spot_detections_overlay(
            rgb, spot_result_all, result_on_mask=spot_result,
        )
        ctx.write_stage_png(STAGE_DETECTION, "overlay_detections.png", overlay)
    ctx.record_stage(
        "03_detection",
        artifacts=(["detections.json", "detections_raw.json", "overlay_detections.png"] if stages else []),
    )
    print(
        f"[03_detection] {len(spot_result_all.spots)} YOLO raw → "
        f"{len(spot_result.spots)} on-mask "
        f"({spot_result.num_occupied} occupied, {spot_result.num_empty} empty)"
    )

    # ── 04 postprocess (geometric enrichment) ─────────────────────────────────
    # Geometric engine uses the refined SegFormer mask (morphology, hole fill,
    # simplification — see SegFormerParkableSegmenter / postprocess_parkable_mask).
    geo_mask = seg_out.mask_refined
    geo_mask_source = "segformer"

    engine = GeometricEngine()
    enriched_result = engine.enrich(spot_result_all, geo_mask)

    num_yolo = sum(1 for s in enriched_result.spots if s.source == "yolo")
    num_extended = sum(1 for s in enriched_result.spots if s.source == "row_extension")
    num_gap = sum(1 for s in enriched_result.spots if s.source == "gap_fill")
    num_recovered = sum(1 for s in enriched_result.spots if s.source == "mask_recovery")

    if stages:
        s4 = stage("04_postprocess")
        write_json_atomic(
            s4 / "enriched_detections.json",
            spot_detections_to_serializable_dict(enriched_result),
        )
        enriched_overlay = _annotate_enriched_overlay(rgb, enriched_result)
        ctx.write_stage_png(STAGE_POSTPROCESS, "overlay_postprocess.png", enriched_overlay)
        write_json_atomic(s4 / "stats.json", {
            "stage": "04_postprocess",
            "schema_version": 1,
            "mask_source": geo_mask_source,
            "total_spots": len(enriched_result.spots),
            "yolo_original": num_yolo,
            "row_extension": num_extended,
            "gap_fill": num_gap,
            "mask_recovery": num_recovered,
        })
    ctx.record_stage(
        "04_postprocess",
        artifacts=(
            ["enriched_detections.json", "overlay_postprocess.png", "stats.json"]
            if stages else []
        ),
    )
    print(
        f"[04_postprocess] {len(enriched_result.spots)} total spots "
        f"(YOLO: {num_yolo}, extensions: {num_extended}, "
        f"gap fills: {num_gap}, mask recovery: {num_recovered})"
    )

    # ── 05 export (WGS84 GeoJSON) ────────────────────────────────────────────
    if crs is None:
        export_doc: dict[str, Any] = {
            "type": "FeatureCollection",
            "name": "parking_slots_wgs84",
            "schema_version": 2,
            "stage": "05_export",
            "features": [],
            "error": "Input raster has no CRS; cannot export WGS84 footprints.",
        }
    else:
        features = _build_spot_geojson_features(enriched_result, transform, crs)
        export_doc = {
            "type": "FeatureCollection",
            "name": "parking_slots_wgs84",
            "schema_version": 2,
            "stage": "05_export",
            "num_slots": len(enriched_result.spots),
            "num_occupied": enriched_result.num_occupied,
            "num_empty": enriched_result.num_empty,
            "features": features,
        }

    if stages:
        s5 = stage("05_export")
        write_json_atomic(s5 / "slots_wgs84.geojson", export_doc)
    root_export = out / "slots_wgs84.geojson"
    write_json_atomic(root_export, export_doc)
    ctx.record_stage(
        "05_export",
        artifacts=(["slots_wgs84.geojson", root_export.name] if stages else [root_export.name]),
    )

    ctx.finalize()
    return out
