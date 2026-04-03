"""MapboxImageryProvider — Mapbox Static Images API with retry/backoff."""

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

from absmap.config.settings import ImagerySettings
from absmap.io.geotiff import BBox, GeoRasterSlice, compute_gsd_m

logger = logging.getLogger(__name__)

__all__ = ["MapboxImageryProvider"]


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
        url = self._build_url(west, south, east, north, s.default_image_width, s.default_image_height)
        raw = self._download_with_retry(url)

        img = Image.open(BytesIO(raw)).convert("RGB")
        rgb_hwc = np.asarray(img, dtype=np.uint8)
        h, w = rgb_hwc.shape[:2]

        transform = affine_from_bounds(west, south, east, north, w, h)
        crs = CRS.from_epsg(4326)
        gsd = compute_gsd_m(transform, crs, lat_hint=(south + north) / 2.0)

        return GeoRasterSlice(
            pixels=rgb_hwc,
            crs_epsg=4326,
            affine=tuple(transform)[:6],
            bounds_native=BBox(west=west, south=south, east=east, north=north),
            bounds_wgs84=BBox(west=west, south=south, east=east, north=north),
            gsd_m=gsd,
        )

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
                req = urllib.request.Request(url, headers={"User-Agent": "absmap/1.0"})
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
