"""MapboxImageryProvider — Mapbox Static Images API (center+zoom mode).

Uses the deterministic ``/{lon},{lat},{zoom}/{width}x{height}`` URL form
so the zoom level is explicit and the geographic bounds can be computed
exactly from the Web Mercator math — no guessing what the API auto-fit
chose.

The bbox auto-fit mode (``/[bbox]/{w}x{h}``) floors the zoom to an
integer, which causes a ~2× scale error when the ideal zoom is just
below an integer boundary (e.g. 19.99 → 19).  Center+zoom avoids this
entirely.
"""

from __future__ import annotations

import logging
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from io import BytesIO

import numpy as np
from geojson_pydantic import Polygon as GeoJSONPolygon
from PIL import Image
from rasterio.crs import CRS
from rasterio.transform import from_bounds as affine_from_bounds

from autoabsmap.config.settings import ImagerySettings
from autoabsmap.io.geotiff import BBox, GeoRasterSlice, compute_gsd_m

logger = logging.getLogger(__name__)

__all__ = ["MapboxImageryProvider"]

_TILE_SIZE = 512.0
_EARTH_CIRCUMFERENCE_M = 40_075_016.686
_MAX_DIM = 1280
_MIN_DIM = 256


# ── Web Mercator helpers ──────────────────────────────────────────────────

def _world_px(zoom: float) -> float:
    """Full Web Mercator world width in pixels at *zoom* (512-px tiles)."""
    return _TILE_SIZE * (2.0 ** zoom)


def _lonlat_to_mercator_px(
    lon: float, lat: float, zoom: float,
) -> tuple[float, float]:
    """WGS-84 → global Web Mercator pixel (x east, y south)."""
    wpx = _world_px(zoom)
    x = (lon + 180.0) / 360.0 * wpx
    lat_rad = math.radians(lat)
    y = (0.5 - math.log(math.tan(math.pi / 4 + lat_rad / 2)) / (2 * math.pi)) * wpx
    return x, y


def _mercator_px_to_lonlat(
    x: float, y: float, zoom: float,
) -> tuple[float, float]:
    """Global Web Mercator pixel → WGS-84 (lon, lat)."""
    wpx = _world_px(zoom)
    lon = x / wpx * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1.0 - 2.0 * y / wpx)))
    return lon, math.degrees(lat_rad)


def _zoom_for_gsd(lat: float, target_gsd_m: float) -> float:
    """Zoom level at which one Mercator pixel ≈ *target_gsd_m* metres."""
    return math.log2(
        _EARTH_CIRCUMFERENCE_M * math.cos(math.radians(lat))
        / (_TILE_SIZE * target_gsd_m)
    )


def _bounds_for_center_zoom(
    center_lon: float, center_lat: float,
    zoom: float,
    img_w: int, img_h: int,
) -> tuple[float, float, float, float]:
    """Deterministic WGS-84 bounds for a center+zoom static image."""
    cx, cy = _lonlat_to_mercator_px(center_lon, center_lat, zoom)
    west, north = _mercator_px_to_lonlat(cx - img_w / 2.0, cy - img_h / 2.0, zoom)
    east, south = _mercator_px_to_lonlat(cx + img_w / 2.0, cy + img_h / 2.0, zoom)
    return west, south, east, north


# ── Provider ──────────────────────────────────────────────────────────────

class MapboxImageryProvider:
    """Fetch satellite imagery from the Mapbox Static Images API.

    Uses center+zoom URL mode for deterministic georeferencing.
    Adds retry with exponential backoff and keeps the access token out of logs.
    """

    def __init__(self, settings: ImagerySettings) -> None:
        if not settings.mapbox_access_token:
            raise ValueError(
                "IMAGERY_MAPBOX_ACCESS_TOKEN is not set. "
                "Add it to the environment or .env file."
            )
        self._settings = settings

    def fetch_geotiff(
        self,
        roi: GeoJSONPolygon,
        target_gsd_m: float,
    ) -> GeoRasterSlice:
        coords = roi.coordinates[0]
        lons = [c[0] for c in coords]
        lats = [c[1] for c in coords]
        west, east = min(lons), max(lons)
        south, north = min(lats), max(lats)

        center_lon = (west + east) / 2.0
        center_lat = (south + north) / 2.0

        zoom = _zoom_for_gsd(center_lat, target_gsd_m)
        zoom = math.floor(zoom * 100) / 100.0

        img_w, img_h = self._image_size_for_bbox(
            west, south, east, north, zoom,
        )

        url = self._build_url(center_lon, center_lat, zoom, img_w, img_h)
        raw = self._download_with_retry(url)

        img = Image.open(BytesIO(raw)).convert("RGB")
        rgb_hwc = np.asarray(img, dtype=np.uint8)
        h, w = rgb_hwc.shape[:2]

        actual_w, actual_s, actual_e, actual_n = _bounds_for_center_zoom(
            center_lon, center_lat, zoom, w, h,
        )

        transform = affine_from_bounds(actual_w, actual_s, actual_e, actual_n, w, h)
        crs = CRS.from_epsg(4326)
        gsd = compute_gsd_m(transform, crs, lat_hint=center_lat)

        logger.info(
            "Mapbox fetch: %dx%d px, zoom=%.2f, GSD=%.4f m/px, "
            "bounds=[%.6f,%.6f,%.6f,%.6f]",
            w, h, zoom, gsd,
            actual_w, actual_s, actual_e, actual_n,
        )

        bounds = BBox(west=actual_w, south=actual_s, east=actual_e, north=actual_n)
        return GeoRasterSlice(
            pixels=rgb_hwc,
            crs_epsg=4326,
            affine=tuple(transform)[:6],
            bounds_native=bounds,
            bounds_wgs84=bounds,
            gsd_m=gsd,
        )

    @staticmethod
    def _image_size_for_bbox(
        west: float, south: float, east: float, north: float,
        zoom: float,
    ) -> tuple[int, int]:
        """Pixel dimensions needed to cover *bbox* at *zoom*, clamped to API limits."""
        wpx = _world_px(zoom)
        merc_w = (east - west) / 360.0 * wpx

        y_n = (
            0.5 - math.log(math.tan(math.pi / 4 + math.radians(north) / 2))
            / (2 * math.pi)
        ) * wpx
        y_s = (
            0.5 - math.log(math.tan(math.pi / 4 + math.radians(south) / 2))
            / (2 * math.pi)
        ) * wpx
        merc_h = abs(y_s - y_n)

        needed_w = max(_MIN_DIM, int(math.ceil(merc_w)))
        needed_h = max(_MIN_DIM, int(math.ceil(merc_h)))

        if needed_w <= _MAX_DIM and needed_h <= _MAX_DIM:
            return needed_w, needed_h

        scale = min(_MAX_DIM / needed_w, _MAX_DIM / needed_h)
        img_w = max(_MIN_DIM, int(needed_w * scale))
        img_h = max(_MIN_DIM, int(needed_h * scale))

        mid_lat = (south + north) / 2.0
        m_per_deg_lon = 111_320.0 * math.cos(math.radians(mid_lat))
        ground_w = (east - west) * m_per_deg_lon
        ground_h = (north - south) * 111_320.0
        effective_gsd = max(ground_w / img_w, ground_h / img_h)
        logger.warning(
            "ROI too large for zoom %.2f: need %dx%d px, "
            "clamped to %dx%d (effective GSD ≈ %.3f m/px). "
            "The auto-tiler should have split this ROI.",
            zoom, needed_w, needed_h, img_w, img_h, effective_gsd,
        )
        return img_w, img_h

    def _build_url(
        self,
        lon: float, lat: float,
        zoom: float,
        width: int, height: int,
    ) -> str:
        s = self._settings
        z = round(zoom, 2)
        center = f"{lon},{lat},{z}"
        path = (
            f"/styles/v1/{s.mapbox_style_owner}/{s.mapbox_style_id}"
            f"/static/{center}/{width}x{height}"
        )
        query = urllib.parse.urlencode({
            "attribution": "false",
            "logo": "false",
            "access_token": s.mapbox_access_token,
        })
        return f"https://api.mapbox.com{path}?{query}"

    def _download_with_retry(self, url: str) -> bytes:
        s = self._settings
        last_exc: Exception | None = None

        for attempt in range(s.mapbox_max_retries + 1):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "autoabsmap/1.0"})
                with urllib.request.urlopen(req, timeout=s.mapbox_timeout_s) as resp:
                    return resp.read()
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
                last_exc = exc
                if attempt < s.mapbox_max_retries:
                    wait = s.mapbox_retry_backoff_s * (2 ** attempt)
                    logger.warning(
                        "Mapbox request failed (attempt %d/%d), retrying in %.1fs: %s",
                        attempt + 1, s.mapbox_max_retries + 1, wait, exc,
                    )
                    time.sleep(wait)

        raise RuntimeError(f"Mapbox download failed after {s.mapbox_max_retries + 1} attempts") from last_exc
