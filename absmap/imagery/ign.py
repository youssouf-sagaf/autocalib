"""IGNImageryProvider — Géoplateforme WMS-Raster (BD ORTHO, free access).

Removes the R&D ``ssl.CERT_NONE`` fallback for production.  The SSL chain
issue on ``data.geopf.fr`` is documented; if it recurs, the operator should
install ``certifi`` or set ``IGN_ALLOW_UNVERIFIED_SSL=true`` explicitly.
"""

from __future__ import annotations

import logging
import math
import ssl
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

WMS_R_ENDPOINT = "https://data.geopf.fr/wms-r"

__all__ = ["IGNImageryProvider"]


class IGNImageryProvider:
    """Fetch BD ORTHO orthophoto imagery from the IGN Géoplateforme.

    Implements the ``ImageryProvider`` protocol.  No API key required.
    """

    def __init__(self, settings: ImagerySettings) -> None:
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
        url = self._build_wms_url(west, south, east, north, s.default_image_width, s.default_image_height)
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

    def _build_wms_url(
        self,
        west: float,
        south: float,
        east: float,
        north: float,
        width: int,
        height: int,
    ) -> str:
        s = self._settings
        params = {
            "SERVICE": "WMS",
            "VERSION": "1.3.0",
            "REQUEST": "GetMap",
            "LAYERS": s.ign_layer,
            "CRS": "EPSG:4326",
            "BBOX": f"{south},{west},{north},{east}",
            "WIDTH": str(width),
            "HEIGHT": str(height),
            "FORMAT": s.ign_image_format,
            "STYLES": "",
        }
        return f"{WMS_R_ENDPOINT}?{urllib.parse.urlencode(params)}"

    def _download_with_retry(self, url: str) -> bytes:
        s = self._settings
        last_exc: Exception | None = None
        ctx = ssl.create_default_context()
        try:
            import certifi
            ctx.load_verify_locations(certifi.where())
        except (ImportError, OSError):
            pass

        for attempt in range(s.ign_max_retries + 1):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "absmap/1.0"})
                with urllib.request.urlopen(req, timeout=s.ign_timeout_s, context=ctx) as resp:
                    content_type = resp.headers.get("Content-Type", "")
                    data = resp.read()
                if "xml" in content_type.lower() or data[:5] == b"<?xml":
                    snippet = data.decode("utf-8", errors="replace")[:500]
                    raise RuntimeError(f"IGN WMS returned XML error:\n{snippet}")
                return data
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, RuntimeError) as exc:
                last_exc = exc
                if attempt < s.ign_max_retries:
                    wait = s.ign_retry_backoff_s * (2 ** attempt)
                    logger.warning(
                        "IGN request failed (attempt %d/%d), retrying in %.1fs: %s",
                        attempt + 1, s.ign_max_retries + 1, wait, exc,
                    )
                    time.sleep(wait)

        raise RuntimeError(f"IGN download failed after {s.ign_max_retries + 1} attempts") from last_exc
