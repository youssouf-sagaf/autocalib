#!/usr/bin/env python3
"""
Download Mapbox satellite orthophotos as PNG + EPSG:4326 GeoTIFF for a list of locations.

Standalone script — no internal project imports needed. Safe to share.

Dependencies:
    pip install numpy Pillow rasterio

Run:
    python mapbox_centers_dataset_standalone.py
"""

from __future__ import annotations

import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from io import BytesIO
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_bounds as affine_from_bounds

# ---------------------------------------------------------------------------
# ⚠️  PUT YOUR MAPBOX TOKEN HERE
# ---------------------------------------------------------------------------
MAPBOX_ACCESS_TOKEN = "MAPBOX_TOKEN_REDACTED"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = SCRIPT_DIR / "mapbox_detection_dataset_enghienn"

IMAGE_WIDTH = 1280
IMAGE_HEIGHT = 1280

MAP_ZOOM = 20.0

SLEEP_S = 0.35

STYLE_OWNER = "mapbox"
STYLE_ID = "satellite-v9"
ATTRIBUTION = True
LOGO = True

# ---------------------------------------------------------------------------
# Locations to download — (label, latitude, longitude)
# ---------------------------------------------------------------------------

LOCATIONS: list[tuple[str, float, float]] = [
    ("enghienn_55_rue_degaulle", 48.97038770152847, 2.306668644777429),
    ("enghienn_square_villemanssin", 48.970606890241186, 2.3043890347360163),
]

# ---------------------------------------------------------------------------
# Web Mercator helpers — compute the geographic bounds of a center+zoom tile
# ---------------------------------------------------------------------------


def _web_mercator_world_width_px(zoom: float) -> float:
    """Width of the Web Mercator world in pixels at *zoom* (Mapbox GL 512 px tiles)."""
    return 512.0 * (2.0 ** zoom)


def lonlat_to_global_mercator_px(
    lon: float, lat: float, zoom: float
) -> tuple[float, float]:
    """WGS84 → global Web Mercator pixel coords (x east, y south)."""
    wpx = _web_mercator_world_width_px(zoom)
    x = (lon + 180.0) / 360.0 * wpx
    lat_rad = math.radians(lat)
    y = (0.5 - math.log(math.tan(math.pi / 4 + lat_rad / 2)) / (2 * math.pi)) * wpx
    return x, y


def global_mercator_px_to_lonlat(
    x: float, y: float, zoom: float
) -> tuple[float, float]:
    """Global Web Mercator pixel → WGS84 degrees (lon, lat)."""
    wpx = _web_mercator_world_width_px(zoom)
    lon = x / wpx * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1.0 - 2.0 * y / wpx)))
    return lon, math.degrees(lat_rad)


def geographic_bounds_for_center_zoom(
    lon: float,
    lat: float,
    zoom: float,
    width: int,
    height: int,
) -> tuple[float, float, float, float]:
    """WGS84 bounds (west, south, east, north) for a Mapbox static image at center+zoom."""
    z = float(zoom)
    cx, cy = lonlat_to_global_mercator_px(lon, lat, z)
    tl_x = cx - width / 2.0
    tl_y = cy - height / 2.0
    corners = [
        global_mercator_px_to_lonlat(tl_x + dx, tl_y + dy, z)
        for dx, dy in ((0, 0), (width, 0), (width, height), (0, height))
    ]
    lons = [c[0] for c in corners]
    lats = [c[1] for c in corners]
    return min(lons), min(lats), max(lons), max(lats)


# ---------------------------------------------------------------------------
# Mapbox Static Images API
# ---------------------------------------------------------------------------


def build_static_image_url(
    lon: float,
    lat: float,
    zoom: float,
    width: int,
    height: int,
    access_token: str,
) -> str:
    """Build a Mapbox Static Images center+zoom URL."""
    z = round(float(zoom), 2)
    center = f"{lon},{lat},{z}"
    path = f"/styles/v1/{STYLE_OWNER}/{STYLE_ID}/static/{center}/{width}x{height}"
    query = urllib.parse.urlencode({
        "attribution": str(ATTRIBUTION).lower(),
        "logo": str(LOGO).lower(),
        "access_token": access_token,
    })
    return f"https://api.mapbox.com{path}?{query}"


def download_static_image(url: str, *, timeout_s: float = 60.0) -> bytes:
    """GET image bytes from the Mapbox Static Images API."""
    request = urllib.request.Request(url, headers={"User-Agent": "mapbox-dataset-dl/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Mapbox Static API HTTP {exc.code}: {body}") from exc


# ---------------------------------------------------------------------------
# Image / GeoTIFF helpers
# ---------------------------------------------------------------------------


def image_bytes_to_rgb_chw(image_bytes: bytes) -> tuple[np.ndarray, int, int]:
    """Decode PNG/JPEG bytes → uint8 array shaped (3, height, width)."""
    with Image.open(BytesIO(image_bytes)) as img:
        rgb = img.convert("RGB")
        width, height = rgb.size
        arr = np.asarray(rgb, dtype=np.uint8)
    chw = np.moveaxis(arr, 2, 0)  # HWC -> CHW
    return chw, height, width


def write_rgb_geotiff(
    dest: str | Path,
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


# ---------------------------------------------------------------------------
# Filename helpers
# ---------------------------------------------------------------------------


def safe_filename(label: str) -> str:
    """Turn a location label into a safe filename segment."""
    raw = label.strip()
    if not raw:
        raise ValueError("location label must be non-empty")
    safe = re.sub(r'[<>:"/\\|?*\x00]', "_", raw)
    safe = re.sub(r"\s+", "_", safe)
    safe = safe.strip(" ._")
    if not safe:
        raise ValueError(f"label yields empty filename segment: {label!r}")
    return safe


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    if MAPBOX_ACCESS_TOKEN == "YOUR_MAPBOX_ACCESS_TOKEN_HERE" or not MAPBOX_ACCESS_TOKEN.strip():
        print(
            "ERROR: Set your Mapbox token in MAPBOX_ACCESS_TOKEN at the top of this script.",
            file=sys.stderr,
        )
        return 1

    if IMAGE_WIDTH > 1280 or IMAGE_HEIGHT > 1280:
        print(
            "Warning: Mapbox Static raster is limited to 1280x1280; "
            "requests may fail or be capped.",
            file=sys.stderr,
        )

    out_dir = OUTPUT_DIR.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest: list[dict] = []
    total = len(LOCATIONS)

    for idx, (label, lat, lon) in enumerate(LOCATIONS):
        west, south, east, north = geographic_bounds_for_center_zoom(
            lon, lat, MAP_ZOOM, IMAGE_WIDTH, IMAGE_HEIGHT,
        )
        stem = safe_filename(label)
        png_path = out_dir / f"{stem}.png"
        tif_path = out_dir / f"{stem}.tif"

        url = build_static_image_url(
            lon, lat, MAP_ZOOM, IMAGE_WIDTH, IMAGE_HEIGHT, MAPBOX_ACCESS_TOKEN,
        )

        try:
            raw = download_static_image(url)
        except RuntimeError as exc:
            print(f"[{idx + 1}/{total}] SKIP {label}: {exc}", file=sys.stderr)
            continue

        png_path.write_bytes(raw)

        rgb_chw, h, w = image_bytes_to_rgb_chw(raw)
        if h != IMAGE_HEIGHT or w != IMAGE_WIDTH:
            raise RuntimeError(
                f"{stem}: decoded {w}x{h}, expected {IMAGE_WIDTH}x{IMAGE_HEIGHT}"
            )
        write_rgb_geotiff(tif_path, rgb_chw, west, south, east, north)

        manifest.append({
            "label": label,
            "center_lat": lat,
            "center_lon": lon,
            "map_zoom": round(float(MAP_ZOOM), 2),
            "bbox_west": west,
            "bbox_south": south,
            "bbox_east": east,
            "bbox_north": north,
            "width_px": w,
            "height_px": h,
            "png": png_path.name,
            "tif": tif_path.name,
        })
        print(f"[{idx + 1}/{total}] {label} -> {png_path.name} + {tif_path.name}")
        if idx < total - 1 and SLEEP_S > 0:
            time.sleep(SLEEP_S)

    manifest_path = out_dir / "dataset_manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8",
    )
    print(f"\nWrote manifest: {manifest_path} ({len(manifest)} samples)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
