"""MapboxImageryProvider — Mapbox Static Images API with retry/backoff.

Uses Web Mercator math to compute the *actual* geographic bounds of the
returned image, which differ from the requested bbox because the Static
API picks a center + zoom that *contains* the bbox, then renders at fixed
pixel dimensions — aspect-ratio padding shifts the true extent.
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


def _world_px(zoom: float) -> float:
    """Full Web Mercator world width in pixels at *zoom* (Mapbox 512-px tiles)."""
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


def _actual_bounds_for_bbox_request(
    west: float, south: float, east: float, north: float,
    img_w: int, img_h: int,
) -> tuple[float, float, float, float]:
    """Replicate the Mapbox Static API auto-fit logic.

    The API converts the requested bbox to Web Mercator, picks the
    fractional zoom that fits the bbox into the image dimensions, then
    renders at the bbox center + that zoom.  The *actual* image extent
    depends on the chosen zoom and the projection, so it rarely matches
    the requested bbox exactly.
    """
    tl_x0, tl_y0 = _lonlat_to_mercator_px(west, north, 0)
    br_x0, br_y0 = _lonlat_to_mercator_px(east, south, 0)
    bbox_w0 = abs(br_x0 - tl_x0)
    bbox_h0 = abs(br_y0 - tl_y0)

    if bbox_w0 <= 0 or bbox_h0 <= 0:
        return west, south, east, north

    zoom_x = math.log2(img_w / bbox_w0) if bbox_w0 > 0 else 22
    zoom_y = math.log2(img_h / bbox_h0) if bbox_h0 > 0 else 22
    zoom = min(zoom_x, zoom_y)

    center_lon = (west + east) / 2.0
    center_lat = (south + north) / 2.0
    cx, cy = _lonlat_to_mercator_px(center_lon, center_lat, zoom)

    actual_west, actual_north = _mercator_px_to_lonlat(
        cx - img_w / 2.0, cy - img_h / 2.0, zoom,
    )
    actual_east, actual_south = _mercator_px_to_lonlat(
        cx + img_w / 2.0, cy + img_h / 2.0, zoom,
    )
    return actual_west, actual_south, actual_east, actual_north


class MapboxImageryProvider:
    """Fetch satellite imagery from the Mapbox Static Images API.

    Implements the ``ImageryProvider`` protocol.  Adds retry with exponential
    backoff (the R&D code had none) and keeps the access token out of logs.
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

        s = self._settings
        img_w, img_h = self._image_size_for_gsd(
            west, south, east, north, target_gsd_m,
            s.default_image_width, s.default_image_height,
        )

        url = self._build_url(west, south, east, north, img_w, img_h)
        raw = self._download_with_retry(url)

        img = Image.open(BytesIO(raw)).convert("RGB")
        rgb_hwc = np.asarray(img, dtype=np.uint8)
        h, w = rgb_hwc.shape[:2]

        actual_w, actual_s, actual_e, actual_n = _actual_bounds_for_bbox_request(
            west, south, east, north, w, h,
        )

        transform = affine_from_bounds(actual_w, actual_s, actual_e, actual_n, w, h)
        crs = CRS.from_epsg(4326)
        gsd = compute_gsd_m(transform, crs, lat_hint=(actual_s + actual_n) / 2.0)

        logger.info(
            "Mapbox fetch: %dx%d px, GSD=%.4f m/px, "
            "requested bbox=[%.6f,%.6f,%.6f,%.6f] → actual=[%.6f,%.6f,%.6f,%.6f]",
            w, h, gsd,
            west, south, east, north,
            actual_w, actual_s, actual_e, actual_n,
        )

        return GeoRasterSlice(
            pixels=rgb_hwc,
            crs_epsg=4326,
            affine=tuple(transform)[:6],
            bounds_native=BBox(west=actual_w, south=actual_s, east=actual_e, north=actual_n),
            bounds_wgs84=BBox(west=actual_w, south=actual_s, east=actual_e, north=actual_n),
            gsd_m=gsd,
        )

    @staticmethod
    def _image_size_for_gsd(
        west: float, south: float, east: float, north: float,
        target_gsd_m: float,
        default_w: int, default_h: int,
    ) -> tuple[int, int]:
        """Compute image dimensions to achieve *target_gsd_m* for the bbox.

        The Mapbox Static API caps images at 1280×1280.  If the ROI requires
        more pixels than that, we clamp and log a warning — the caller
        (multi-crop orchestrator) should tile large ROIs in future.
        """
        max_dim = 1280

        mid_lat = (south + north) / 2.0
        m_per_deg_lon = 111_320.0 * math.cos(math.radians(mid_lat))
        m_per_deg_lat = 111_320.0

        ground_w = (east - west) * m_per_deg_lon
        ground_h = (north - south) * m_per_deg_lat

        needed_w = max(256, int(math.ceil(ground_w / target_gsd_m)))
        needed_h = max(256, int(math.ceil(ground_h / target_gsd_m)))

        img_w = min(needed_w, max_dim)
        img_h = min(needed_h, max_dim)

        if needed_w > max_dim or needed_h > max_dim:
            effective_gsd = max(ground_w / img_w, ground_h / img_h)
            logger.warning(
                "ROI too large for target GSD %.3f m/px: need %dx%d px, "
                "clamped to %dx%d (effective GSD ≈ %.3f m/px). "
                "Draw a smaller ROI (~%.0fm × %.0fm) for best results.",
                target_gsd_m, needed_w, needed_h, img_w, img_h,
                effective_gsd,
                max_dim * target_gsd_m, max_dim * target_gsd_m,
            )

        return img_w, img_h

    def _build_url(
        self,
        west: float,
        south: float,
        east: float,
        north: float,
        width: int,
        height: int,
    ) -> str:
        s = self._settings
        bbox = f"[{west},{south},{east},{north}]"
        path = f"/styles/v1/{s.mapbox_style_owner}/{s.mapbox_style_id}/static/{bbox}/{width}x{height}"
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
