"""Shared XYZ slippy-map tile fetcher used by IGN and OSM providers.

Both providers serve 256-px Web Mercator tiles addressed by integer
``(z, x, y)``. The math (zoom selection, tile range for an ROI, stitching,
crop, GSD) is identical — only the per-tile URL and HTTP headers differ.
"""

from __future__ import annotations

import logging
import math
import time
import urllib.error
import urllib.request
from io import BytesIO
from typing import Callable

import numpy as np
from geojson_pydantic import Polygon as GeoJSONPolygon
from PIL import Image
from rasterio.crs import CRS
from rasterio.transform import from_bounds as affine_from_bounds

from autoabsmap.io.geotiff import BBox, GeoRasterSlice, compute_gsd_m

logger = logging.getLogger(__name__)

__all__ = ["TileFetcher", "fetch_xyz_geotiff", "http_get_with_retry"]

_TILE_SIZE = 256
_EARTH_CIRCUMFERENCE_M = 40_075_016.686

TileFetcher = Callable[[int, int, int], bytes]
"""Callable signature: ``fetcher(zoom, tile_x, tile_y) -> raw_bytes``."""


def _zoom_for_gsd(lat: float, target_gsd_m: float) -> float:
    return math.log2(
        _EARTH_CIRCUMFERENCE_M * math.cos(math.radians(lat))
        / (_TILE_SIZE * target_gsd_m)
    )


def _lonlat_to_tile_xy(lon: float, lat: float, zoom: int) -> tuple[float, float]:
    n = 2.0 ** zoom
    x = (lon + 180.0) / 360.0 * n
    lat_rad = math.radians(lat)
    y = (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n
    return x, y


def _tile_xy_to_lonlat(x: float, y: float, zoom: int) -> tuple[float, float]:
    n = 2.0 ** zoom
    lon = x / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1.0 - 2.0 * y / n)))
    return lon, math.degrees(lat_rad)


def fetch_xyz_geotiff(
    roi: GeoJSONPolygon,
    target_gsd_m: float,
    fetcher: TileFetcher,
    *,
    max_zoom: int,
    provider_name: str = "xyz",
) -> GeoRasterSlice:
    """Stitch 256-px XYZ tiles covering *roi* into a single GeoRasterSlice."""
    coords = roi.coordinates[0]
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    west, east = min(lons), max(lons)
    south, north = min(lats), max(lats)
    center_lat = (south + north) / 2.0

    ideal_zoom = _zoom_for_gsd(center_lat, target_gsd_m)
    zoom = max(0, min(max_zoom, math.ceil(ideal_zoom)))

    x_west, y_north = _lonlat_to_tile_xy(west, north, zoom)
    x_east, y_south = _lonlat_to_tile_xy(east, south, zoom)
    tx0, ty0 = math.floor(x_west), math.floor(y_north)
    tx1, ty1 = math.floor(x_east), math.floor(y_south)
    cols = tx1 - tx0 + 1
    rows = ty1 - ty0 + 1

    canvas = np.zeros((rows * _TILE_SIZE, cols * _TILE_SIZE, 3), dtype=np.uint8)
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            raw = fetcher(zoom, tx, ty)
            tile_img = Image.open(BytesIO(raw)).convert("RGB")
            arr = np.asarray(tile_img, dtype=np.uint8)
            r0 = (ty - ty0) * _TILE_SIZE
            c0 = (tx - tx0) * _TILE_SIZE
            canvas[r0:r0 + _TILE_SIZE, c0:c0 + _TILE_SIZE] = arr

    px_west = (x_west - tx0) * _TILE_SIZE
    px_north = (y_north - ty0) * _TILE_SIZE
    px_east = (x_east - tx0) * _TILE_SIZE
    px_south = (y_south - ty0) * _TILE_SIZE
    col0 = max(0, int(math.floor(px_west)))
    col1 = min(canvas.shape[1], int(math.ceil(px_east)))
    row0 = max(0, int(math.floor(px_north)))
    row1 = min(canvas.shape[0], int(math.ceil(px_south)))
    col1 = max(col1, col0 + 1)
    row1 = max(row1, row0 + 1)
    cropped = canvas[row0:row1, col0:col1]

    actual_w, actual_n = _tile_xy_to_lonlat(
        tx0 + col0 / _TILE_SIZE, ty0 + row0 / _TILE_SIZE, zoom,
    )
    actual_e, actual_s = _tile_xy_to_lonlat(
        tx0 + col1 / _TILE_SIZE, ty0 + row1 / _TILE_SIZE, zoom,
    )

    h, w = cropped.shape[:2]
    transform = affine_from_bounds(actual_w, actual_s, actual_e, actual_n, w, h)
    crs = CRS.from_epsg(4326)
    gsd = compute_gsd_m(transform, crs, lat_hint=center_lat)

    logger.info(
        "%s fetch: %dx%d px, zoom=%d, GSD=%.4f m/px, tiles=%dx%d, "
        "bounds=[%.6f,%.6f,%.6f,%.6f]",
        provider_name, w, h, zoom, gsd, cols, rows,
        actual_w, actual_s, actual_e, actual_n,
    )

    bounds = BBox(west=actual_w, south=actual_s, east=actual_e, north=actual_n)
    return GeoRasterSlice(
        pixels=cropped,
        crs_epsg=4326,
        affine=tuple(transform)[:6],
        bounds_native=bounds,
        bounds_wgs84=bounds,
        gsd_m=gsd,
    )


def http_get_with_retry(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout_s: float = 30.0,
    max_retries: int = 3,
    backoff_s: float = 0.5,
) -> bytes:
    """GET *url* with exponential-backoff retries on transient errors."""
    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers or {})
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                return resp.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            last_exc = exc
            if attempt < max_retries:
                wait = backoff_s * (2 ** attempt)
                logger.warning(
                    "HTTP request failed (attempt %d/%d), retrying in %.1fs: %s",
                    attempt + 1, max_retries + 1, wait, exc,
                )
                time.sleep(wait)
    raise RuntimeError(
        f"HTTP download failed after {max_retries + 1} attempts: {url}"
    ) from last_exc
