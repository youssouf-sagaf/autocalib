"""Mapbox Static Images API: URL construction, download, and georeferenced GeoTIFF output."""

from __future__ import annotations

import math
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import BinaryIO

import numpy as np
import rasterio
from dotenv import load_dotenv
from PIL import Image
from rasterio.transform import from_bounds as affine_from_bounds

# Default smoke test: bbox WGS84 (west, south, east, north), size, style id (Mapbox path segment).
DEFAULT_WEST = 2.0316
DEFAULT_SOUTH = 49.049
DEFAULT_EAST = 2.0327
DEFAULT_NORTH = 49.0497
DEFAULT_IMAGE_WIDTH = 1000
DEFAULT_IMAGE_HEIGHT = 1000
DEFAULT_STYLE_OWNER = "mapbox"
DEFAULT_STYLE_ID = "satellite-v9"
DEFAULT_OUTPUT_RELATIVE = Path("artifacts/mapbox_smoke_1000x1000.tif")

_ENV_FILENAME = ".env"


def absolutemap_gen_root() -> Path:
    """Project root directory (`absolutemap-gen/`) containing `.env` and `artifacts/`."""
    return Path(__file__).resolve().parents[2]


def load_project_dotenv() -> None:
    """Load key=value pairs from `.env` at the project root (does not override existing env)."""
    env_path = absolutemap_gen_root() / _ENV_FILENAME
    if env_path.is_file():
        load_dotenv(env_path, override=False)


def require_mapbox_token() -> str:
    """Return ``MAPBOX_ACCESS_TOKEN`` or raise if unset after loading `.env`."""
    load_project_dotenv()
    token = os.environ.get("MAPBOX_ACCESS_TOKEN", "").strip()
    if not token:
        raise RuntimeError(
            "MAPBOX_ACCESS_TOKEN is not set. Add it to absolutemap-gen/.env "
            "or export it in your environment."
        )
    return token


def build_static_image_url(
    west: float,
    south: float,
    east: float,
    north: float,
    width: int,
    height: int,
    access_token: str,
    *,
    style_owner: str = DEFAULT_STYLE_OWNER,
    style_id: str = DEFAULT_STYLE_ID,
    attribution: bool = True,
    logo: bool = True,
) -> str:
    """Build a Mapbox Static Images API URL (bbox path, token in query only)."""
    bbox = f"[{west},{south},{east},{north}]"
    path = f"/styles/v1/{style_owner}/{style_id}/static/{bbox}/{width}x{height}"
    query = urllib.parse.urlencode(
        {
            "attribution": str(attribution).lower(),
            "logo": str(logo).lower(),
            "access_token": access_token,
        }
    )
    return f"https://api.mapbox.com{path}?{query}"


def build_static_image_url_center_zoom(
    lon: float,
    lat: float,
    zoom: float,
    width: int,
    height: int,
    access_token: str,
    *,
    style_owner: str = DEFAULT_STYLE_OWNER,
    style_id: str = DEFAULT_STYLE_ID,
    attribution: bool = True,
    logo: bool = True,
) -> str:
    """Build a Static Images API URL centered at ``lon``, ``lat`` with Web Mercator ``zoom``."""
    z = round(float(zoom), 2)
    center = f"{lon},{lat},{z}"
    path = f"/styles/v1/{style_owner}/{style_id}/static/{center}/{width}x{height}"
    query = urllib.parse.urlencode(
        {
            "attribution": str(attribution).lower(),
            "logo": str(logo).lower(),
            "access_token": access_token,
        }
    )
    return f"https://api.mapbox.com{path}?{query}"


def _web_mercator_world_width_px(zoom: float) -> float:
    """Width of the Web Mercator world in pixels at ``zoom`` (Mapbox GL 512px tiles)."""
    return 512.0 * (2.0 ** zoom)


def lonlat_to_global_mercator_px(lon: float, lat: float, zoom: float) -> tuple[float, float]:
    """WGS84 to global Web Mercator pixel coords (x east, y south) at ``zoom``."""
    wpx = _web_mercator_world_width_px(zoom)
    x = (lon + 180.0) / 360.0 * wpx
    lat_rad = math.radians(lat)
    y = (0.5 - math.log(math.tan(math.pi / 4 + lat_rad / 2)) / (2 * math.pi)) * wpx
    return x, y


def global_mercator_px_to_lonlat(x: float, y: float, zoom: float) -> tuple[float, float]:
    """Global Web Mercator pixel to WGS84 degrees (lon, lat)."""
    wpx = _web_mercator_world_width_px(zoom)
    lon = x / wpx * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1.0 - 2.0 * y / wpx)))
    return lon, math.degrees(lat_rad)


def geographic_bounds_for_static_center_zoom(
    lon: float,
    lat: float,
    zoom: float,
    width: int,
    height: int,
) -> tuple[float, float, float, float]:
    """
    WGS84 bounds (west, south, east, north) for a north-up static image at ``lon``, ``lat``, ``zoom``.

    Matches the viewport of ``/{lon},{lat},{zoom}/{width}x{height}`` on the Static Images API.
    """
    z = float(zoom)
    cx, cy = lonlat_to_global_mercator_px(lon, lat, z)
    tl_x = cx - width / 2.0
    tl_y = cy - height / 2.0
    corners_lonlat = [
        global_mercator_px_to_lonlat(tl_x + dx, tl_y + dy, z)
        for dx, dy in ((0, 0), (width, 0), (width, height), (0, height))
    ]
    lons = [c[0] for c in corners_lonlat]
    lats = [c[1] for c in corners_lonlat]
    west, east = min(lons), max(lons)
    south, north = min(lats), max(lats)
    return west, south, east, north


def download_static_image(url: str, *, timeout_s: float = 60.0) -> bytes:
    """GET the static image; raises on HTTP errors."""
    request = urllib.request.Request(url, headers={"User-Agent": "absolutemap-gen/0.1"})
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Mapbox Static API HTTP {exc.code}: {body}") from exc


def image_bytes_to_rgb_chw(image_bytes: bytes) -> tuple[np.ndarray, int, int]:
    """Decode PNG/JPEG bytes to a uint8 array shaped (3, height, width)."""
    from io import BytesIO

    with Image.open(BytesIO(image_bytes)) as img:
        rgb = img.convert("RGB")
        width, height = rgb.size
        arr = np.asarray(rgb, dtype=np.uint8)
    # HWC -> CHW
    chw = np.moveaxis(arr, 2, 0)
    return chw, height, width


def write_rgb_geotiff(
    dest: str | Path | BinaryIO,
    rgb_chw: np.ndarray,
    west: float,
    south: float,
    east: float,
    north: float,
    *,
    crs: str = "EPSG:4326",
) -> None:
    """Write a 3-band uint8 GeoTIFF with CRS and affine from geographic bounds."""
    if rgb_chw.ndim != 3 or rgb_chw.shape[0] != 3:
        raise ValueError("rgb_chw must have shape (3, height, width)")
    _, height, width = rgb_chw.shape
    transform = affine_from_bounds(west, south, east, north, width, height)
    profile = {
        "driver": "GTiff",
        "dtype": "uint8",
        "count": 3,
        "width": width,
        "height": height,
        "crs": crs,
        "transform": transform,
    }
    with rasterio.open(dest, "w", **profile) as dst:
        dst.write(rgb_chw)


def fetch_static_bbox_to_geotiff(
    output_path: str | Path,
    west: float = DEFAULT_WEST,
    south: float = DEFAULT_SOUTH,
    east: float = DEFAULT_EAST,
    north: float = DEFAULT_NORTH,
    width: int = DEFAULT_IMAGE_WIDTH,
    height: int = DEFAULT_IMAGE_HEIGHT,
    *,
    access_token: str | None = None,
    style_owner: str = DEFAULT_STYLE_OWNER,
    style_id: str = DEFAULT_STYLE_ID,
    attribution: bool = True,
    logo: bool = True,
    timeout_s: float = 60.0,
) -> Path:
    """
    Download a Mapbox static satellite image for the bbox and write an EPSG:4326 GeoTIFF.

    If ``access_token`` is None, ``MAPBOX_ACCESS_TOKEN`` is read from the environment
    (after loading project `.env`).
    """
    out = Path(output_path)
    if access_token is not None:
        token = access_token.strip()
        if not token:
            raise ValueError("access_token must be non-empty when provided")
    else:
        token = require_mapbox_token()
    url = build_static_image_url(
        west,
        south,
        east,
        north,
        width,
        height,
        token,
        style_owner=style_owner,
        style_id=style_id,
        attribution=attribution,
        logo=logo,
    )
    raw = download_static_image(url, timeout_s=timeout_s)
    rgb_chw, h, w = image_bytes_to_rgb_chw(raw)
    if h != height or w != width:
        raise RuntimeError(
            f"Decoded image size {w}x{h} does not match requested {width}x{height}"
        )
    out.parent.mkdir(parents=True, exist_ok=True)
    write_rgb_geotiff(out, rgb_chw, west, south, east, north, crs="EPSG:4326")
    return out.resolve()


def fetch_static_center_zoom_to_geotiff(
    output_path: str | Path,
    lon: float,
    lat: float,
    zoom: float,
    width: int = DEFAULT_IMAGE_WIDTH,
    height: int = DEFAULT_IMAGE_HEIGHT,
    *,
    access_token: str | None = None,
    style_owner: str = DEFAULT_STYLE_OWNER,
    style_id: str = DEFAULT_STYLE_ID,
    attribution: bool = True,
    logo: bool = True,
    timeout_s: float = 60.0,
) -> Path:
    """
    Download a Mapbox static image centered at ``lon``, ``lat`` with ``zoom`` and write EPSG:4326 GeoTIFF.

    Same pipeline as :func:`fetch_static_bbox_to_geotiff`, but uses the center+zoom URL form.
    """
    out = Path(output_path)
    if access_token is not None:
        token = access_token.strip()
        if not token:
            raise ValueError("access_token must be non-empty when provided")
    else:
        token = require_mapbox_token()
    west, south, east, north = geographic_bounds_for_static_center_zoom(
        lon, lat, zoom, width, height
    )
    url = build_static_image_url_center_zoom(
        lon,
        lat,
        zoom,
        width,
        height,
        token,
        style_owner=style_owner,
        style_id=style_id,
        attribution=attribution,
        logo=logo,
    )
    raw = download_static_image(url, timeout_s=timeout_s)
    rgb_chw, h, w = image_bytes_to_rgb_chw(raw)
    if h != height or w != width:
        raise RuntimeError(
            f"Decoded image size {w}x{h} does not match requested {width}x{height}"
        )
    out.parent.mkdir(parents=True, exist_ok=True)
    write_rgb_geotiff(out, rgb_chw, west, south, east, north, crs="EPSG:4326")
    return out.resolve()
