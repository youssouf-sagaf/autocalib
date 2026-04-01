"""Map pixel geometries with rasterio affine, reproject to WGS84, emit GeoJSON FeatureCollections."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable, Sequence

from pyproj import Transformer
from rasterio.crs import CRS
from rasterio.transform import Affine
from shapely.geometry import Polygon, mapping as shapely_mapping
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform as shapely_coord_transform

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from absolutemap_gen.snap_validate import SnappedSlot

__all__ = [
    "pixel_center_to_world_xy",
    "transform_pixel_geometry_to_crs",
    "geometry_to_wgs84",
    "feature_collection",
    "shapely_to_geojson_feature",
    "transform_geometry_pixels_to_wgs84",
    "slot_footprint_polygon_pixels",
    "snapped_slots_to_geojson_feature_collection",
    "write_geojson_feature_collection",
    "export_valid_slots_geojson",
]


def pixel_center_to_world_xy(
    col_px: float,
    row_px: float,
    transform: Affine,
    *,
    pixel_center: bool = True,
) -> tuple[float, float]:
    """Map a pixel location to projected coordinates using the raster affine.

    Rasterio convention: ``(col, row)`` with ``(0, 0)`` at the northwest corner of the
    top-left pixel. When ``pixel_center`` is True, uses ``(col + 0.5, row + 0.5)``.
    """
    dc = 0.5 if pixel_center else 0.0
    x, y = transform * (col_px + dc, row_px + dc)
    return float(x), float(y)


def transform_pixel_geometry_to_crs(geom: BaseGeometry, transform: Affine) -> BaseGeometry:
    """Apply a pixel-to-world affine to every vertex of a Shapely geometry."""

    def _affine_xy(x: float, y: float) -> tuple[float, float]:
        return transform * (x, y)

    out = shapely_coord_transform(_affine_xy, geom)
    if not out.is_valid:
        out = out.buffer(0)
    return out


def feature_collection(
    features: list[dict[str, Any]],
    *,
    name: str | None = None,
) -> dict[str, Any]:
    """Build a minimal GeoJSON FeatureCollection (coordinates must already be in WGS84)."""
    fc: dict[str, Any] = {"type": "FeatureCollection", "features": features}
    if name is not None:
        fc["name"] = name
    return fc


def shapely_to_geojson_feature(geom: BaseGeometry, properties: dict[str, Any]) -> dict[str, Any]:
    """Wrap a Shapely geometry and properties as a GeoJSON Feature."""
    return {
        "type": "Feature",
        "geometry": shapely_mapping(geom),
        "properties": properties,
    }


def transform_geometry_pixels_to_wgs84(
    geom: BaseGeometry,
    transform: Affine,
    source_crs: CRS,
) -> BaseGeometry:
    """Map pixel-space geometry to world coordinates, then reproject to WGS84."""
    in_crs = transform_pixel_geometry_to_crs(geom, transform)
    return geometry_to_wgs84(in_crs, source_crs)


def slot_footprint_polygon_pixels(
    col_px: float,
    row_px: float,
    theta_rad: float,
    stall_width_px: float,
    stall_depth_px: float,
) -> Polygon:
    """Oriented stall rectangle in pixel space (full width along row, full depth perpendicular)."""
    from absolutemap_gen.snap_validate import build_oriented_slot_footprint

    hw = max(float(stall_width_px), 1e-3) * 0.5
    hd = max(float(stall_depth_px), 1e-3) * 0.5
    return build_oriented_slot_footprint(
        col_px,
        row_px,
        theta_rad,
        half_extent_along_u=hw,
        half_extent_along_v=hd,
    )


def geometry_to_wgs84(geom: BaseGeometry, source_crs: CRS) -> BaseGeometry:
    """Reproject a projected geometry to EPSG:4326 (lon/lat, axis order x=lon, y=lat)."""
    if source_crs is None:
        raise ValueError("source_crs is required for reprojection")
    try:
        if source_crs.to_epsg() == 4326:
            return geom
    except Exception:
        pass
    transformer = Transformer.from_crs(source_crs, CRS.from_epsg(4326), always_xy=True)

    def _to_wgs84(x: float, y: float) -> tuple[float, float]:
        lon, lat = transformer.transform(x, y)
        return float(lon), float(lat)

    out = shapely_coord_transform(_to_wgs84, geom)
    if not out.is_valid:
        out = out.buffer(0)
    return out


def snapped_slots_to_geojson_feature_collection(
    slots: Sequence[SnappedSlot],
    transform: Affine,
    crs: CRS,
    *,
    include_invalid: bool = False,
) -> dict[str, Any]:
    """Build a GeoJSON FeatureCollection of slot footprints in WGS84 (RFC 7946).

    Only :attr:`SnappedSlot.valid` slots are exported unless ``include_invalid`` is True.
    Properties follow the pipeline plan: ``slot_id``, ``vlm_candidate_id``, ``status``,
    ``confidence``, and optional occupancy.
    """
    features: list[dict[str, Any]] = []
    seq = 0
    for s in slots:
        if not s.valid and not include_invalid:
            continue
        seq += 1
        geom_crs = transform_pixel_geometry_to_crs(s.footprint_px, transform)
        geom_wgs = geometry_to_wgs84(geom_crs, crs)
        status = "occupied" if s.occupied else "free"
        props: dict[str, Any] = {
            "slot_id": seq,
            "vlm_candidate_id": int(s.vlm_candidate_id),
            "status": status,
            "confidence": float(s.confidence),
            "valid": bool(s.valid),
        }
        if s.rejection_reason is not None:
            props["rejection_reason"] = s.rejection_reason
        features.append(
            {
                "type": "Feature",
                "geometry": shapely_mapping(geom_wgs),
                "properties": props,
            }
        )

    return {
        "type": "FeatureCollection",
        "name": "parking_slots_wgs84",
        "schema_version": 1,
        "stage": "08_export",
        "features": features,
    }


def write_geojson_feature_collection(
    path: str | Path,
    feature_collection: dict[str, Any],
    *,
    indent: int | None = 2,
) -> None:
    """Serialize a GeoJSON dict to UTF-8 JSON on disk."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(feature_collection, indent=indent), encoding="utf-8")


def export_valid_slots_geojson(
    slots: Iterable[SnappedSlot],
    transform: Affine,
    crs: CRS,
    out_path: str | Path,
) -> dict[str, Any]:
    """Convenience: build the WGS84 collection and write ``slots_wgs84.geojson``."""
    fc = snapped_slots_to_geojson_feature_collection(
        tuple(slots),
        transform,
        crs,
        include_invalid=False,
    )
    write_geojson_feature_collection(out_path, fc)
    return fc
