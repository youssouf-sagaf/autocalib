"""IGN Géoplateforme WMS-Raster: BD ORTHO orthophoto download and georeferenced GeoTIFF output.

Uses the free, open-access WMS-Raster service at ``https://data.geopf.fr/wms-r``
(no API key required).  BD ORTHO provides ~20 cm/pixel native resolution over
metropolitan France and overseas territories.

Reference:
    https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/diffusion/wms-raster/
"""

from __future__ import annotations

import math
import ssl
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import BinaryIO

import numpy as np
from PIL import Image
from rasterio.transform import from_bounds as affine_from_bounds

from absolutemap_gen.mapbox_static import image_bytes_to_rgb_chw, write_rgb_geotiff

WMS_R_ENDPOINT = "https://data.geopf.fr/wms-r"
ORTHO_LAYER = "ORTHOIMAGERY.ORTHOPHOTOS"
DEFAULT_IMAGE_FORMAT = "image/jpeg"
DEFAULT_CRS = "EPSG:4326"
DEFAULT_IMAGE_WIDTH = 1280
DEFAULT_IMAGE_HEIGHT = 1280

DEFAULT_WEST = 2.2893
DEFAULT_SOUTH = 48.8901
DEFAULT_EAST = 2.2913
DEFAULT_NORTH = 48.8913

__all__ = [
    "build_wms_getmap_url",
    "fetch_ign_ortho_to_geotiff",
    "fetch_ign_ortho_center_to_geotiff",
    "geographic_bounds_for_center_radius",
    "download_wms_image",
]


def build_wms_getmap_url(
    west: float,
    south: float,
    east: float,
    north: float,
    width: int,
    height: int,
    *,
    layer: str = ORTHO_LAYER,
    image_format: str = DEFAULT_IMAGE_FORMAT,
    crs: str = DEFAULT_CRS,
) -> str:
    """Build a WMS 1.3.0 GetMap URL for the Géoplateforme WMS-Raster service.

    WMS 1.3.0 with CRS=EPSG:4326 uses axis order latitude,longitude
    so BBOX is ``south,west,north,east``.
    """
    params = {
        "SERVICE": "WMS",
        "VERSION": "1.3.0",
        "REQUEST": "GetMap",
        "LAYERS": layer,
        "CRS": crs,
        "BBOX": f"{south},{west},{north},{east}",
        "WIDTH": str(width),
        "HEIGHT": str(height),
        "FORMAT": image_format,
        "STYLES": "",
    }
    return f"{WMS_R_ENDPOINT}?{urllib.parse.urlencode(params)}"


def geographic_bounds_for_center_radius(
    lon: float,
    lat: float,
    radius_m: float,
) -> tuple[float, float, float, float]:
    """Compute WGS84 bounds (west, south, east, north) for a square centered at *lon*, *lat*.

    *radius_m* is the half-side of the square in metres.  The conversion uses
    the local metric scale of WGS84 degrees at the given latitude.
    """
    meters_per_deg_lat = 111_320.0
    meters_per_deg_lon = 111_320.0 * math.cos(math.radians(lat))
    dlat = radius_m / meters_per_deg_lat
    dlon = radius_m / max(meters_per_deg_lon, 1.0)
    return (lon - dlon, lat - dlat, lon + dlon, lat + dlat)


def _build_ssl_context() -> ssl.SSLContext:
    """Build an SSL context for the Géoplateforme.

    The IGN server (``data.geopf.fr``) has an incomplete certificate chain —
    it omits the "Certigna Services CA" intermediate.  We first try with
    ``certifi`` and system defaults; if that fails we fall back to an
    unverified context (safe here: the endpoint is a known French government
    service with a fixed URL).
    """
    ctx = ssl.create_default_context()
    try:
        import certifi
        ctx.load_verify_locations(certifi.where())
    except (ImportError, OSError):
        pass
    return ctx


def _build_unverified_ssl_context() -> ssl.SSLContext:
    """Fallback SSL context that skips certificate verification."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def download_wms_image(url: str, *, timeout_s: float = 90.0) -> bytes:
    """GET image bytes from the Géoplateforme WMS-Raster service."""
    request = urllib.request.Request(
        url, headers={"User-Agent": "absolutemap-gen/0.2"}
    )

    ssl_ctx = _build_ssl_context()
    try:
        with urllib.request.urlopen(request, timeout=timeout_s, context=ssl_ctx) as response:
            content_type = response.headers.get("Content-Type", "")
            data = response.read()
    except urllib.error.URLError as exc:
        if "CERTIFICATE_VERIFY_FAILED" not in str(exc):
            raise RuntimeError(f"IGN WMS-Raster connection error: {exc}") from exc

        import warnings
        warnings.warn(
            "SSL certificate verification failed for data.geopf.fr "
            "(incomplete chain — missing Certigna Services CA intermediate). "
            "Retrying without verification.",
            stacklevel=2,
        )
        ssl_ctx = _build_unverified_ssl_context()
        request = urllib.request.Request(
            url, headers={"User-Agent": "absolutemap-gen/0.2"}
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout_s, context=ssl_ctx) as response:
                content_type = response.headers.get("Content-Type", "")
                data = response.read()
        except urllib.error.HTTPError as exc2:
            body = exc2.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"IGN WMS-Raster HTTP {exc2.code}: {body}") from exc2
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(
            f"IGN WMS-Raster HTTP {exc.code}: {body}"
        ) from exc

    if "xml" in content_type.lower() or data[:5] == b"<?xml":
        snippet = data.decode("utf-8", errors="replace")[:500]
        raise RuntimeError(
            f"IGN WMS-Raster returned an XML error instead of an image:\n{snippet}"
        )
    return data


def fetch_ign_ortho_to_geotiff(
    output_path: str | Path,
    west: float = DEFAULT_WEST,
    south: float = DEFAULT_SOUTH,
    east: float = DEFAULT_EAST,
    north: float = DEFAULT_NORTH,
    width: int = DEFAULT_IMAGE_WIDTH,
    height: int = DEFAULT_IMAGE_HEIGHT,
    *,
    layer: str = ORTHO_LAYER,
    image_format: str = DEFAULT_IMAGE_FORMAT,
    timeout_s: float = 90.0,
) -> Path:
    """Download a BD ORTHO image for the bbox and write an EPSG:4326 GeoTIFF.

    No authentication is required — the Géoplateforme WMS-Raster service
    is freely accessible.
    """
    out = Path(output_path)
    url = build_wms_getmap_url(
        west, south, east, north, width, height,
        layer=layer, image_format=image_format,
    )
    raw = download_wms_image(url, timeout_s=timeout_s)
    rgb_chw, h, w = image_bytes_to_rgb_chw(raw)
    if h != height or w != width:
        raise RuntimeError(
            f"Decoded image size {w}x{h} does not match requested {width}x{height}"
        )
    out.parent.mkdir(parents=True, exist_ok=True)
    write_rgb_geotiff(out, rgb_chw, west, south, east, north, crs="EPSG:4326")
    return out.resolve()


def fetch_ign_ortho_center_to_geotiff(
    output_path: str | Path,
    lon: float,
    lat: float,
    radius_m: float = 32.0,
    width: int = DEFAULT_IMAGE_WIDTH,
    height: int = DEFAULT_IMAGE_HEIGHT,
    *,
    layer: str = ORTHO_LAYER,
    image_format: str = DEFAULT_IMAGE_FORMAT,
    timeout_s: float = 90.0,
) -> Path:
    """Download a BD ORTHO image centered at *lon*, *lat* and write an EPSG:4326 GeoTIFF.

    The image covers a square of side ``2 * radius_m`` metres, rendered
    into *width* x *height* pixels.  ``radius_m=32`` with
    ``width=height=1280`` matches the Mapbox zoom-20 ground footprint (~64 m).
    """
    west, south, east, north = geographic_bounds_for_center_radius(
        lon, lat, radius_m,
    )
    return fetch_ign_ortho_to_geotiff(
        output_path,
        west, south, east, north,
        width, height,
        layer=layer,
        image_format=image_format,
        timeout_s=timeout_s,
    )
