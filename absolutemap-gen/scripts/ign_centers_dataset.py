#!/usr/bin/env python3
"""
Download IGN BD ORTHO orthophotos as PNG + EPSG:4326 GeoTIFF for a list of locations.

Uses the free Géoplateforme WMS-Raster service (no API key required).
BD ORTHO provides ~20 cm/pixel native resolution over France.

Standalone script — no internal project imports needed.

Dependencies:
    pip install numpy Pillow rasterio

Run:
    python scripts/ign_centers_dataset.py
"""

from __future__ import annotations

import json
import math
import re
import ssl
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
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = SCRIPT_DIR.parent / "artifacts" / "ign_detection_dataset"

IMAGE_WIDTH = 1280
IMAGE_HEIGHT = 1280

# Half-side of the capture square in metres.
# 32 m → 64 m side → ~0.05 m/px at 1280 px, matching Mapbox zoom-20 ground coverage.
RADIUS_M = 32.0

SLEEP_S = 0.10

WMS_R_ENDPOINT = "https://data.geopf.fr/wms-r"
ORTHO_LAYER = "ORTHOIMAGERY.ORTHOPHOTOS"
DEFAULT_IMAGE_FORMAT = "image/jpeg"
DEFAULT_CRS = "EPSG:4326"

# ---------------------------------------------------------------------------
# Locations to download — (label, latitude, longitude)
# ---------------------------------------------------------------------------

LOCATIONS: list[tuple[str, float, float]] = [
    ("chambly", 49.16352811624092, 2.241322630587067),
    ("place_sardagarigag", -20.873136, 55.447630),
    ("rue_jean_chatel", -20.87931222575014, 55.44909707142626),
    ("quimper_place_de_la_resistance", 47.99374389882961, -4.104876184053002),
    ("quimper_parking_tourbie", 47.99917811330513, -4.102363590946648),
    ("parking_tour_d_auvergne", 47.99473592128397, -4.110482583615365),
    ("livry_anatole_france", 48.92486348099127, 2.5399722787789085),
    ("jacobains_sens", 48.19758723525039, 3.2791301591739703),
    ("victor_hugo_sens", 48.19569750243427, 3.2839230983753036),
    ("parking_gare_de_cergy", 49.049334499580404, 2.0321822241672045),
    ("six_les_larris_verts", 49.03584505143746, 2.090725568356908),
    ("parking_pontoise_creche_babilou", 49.03138448325379, 2.090483733087986),
    ("avenue_jean_lolive", 48.89107744764322, 2.401876933366334),
    ("enghien_les_bains", 48.970633596609495, 2.3043524429155653),
    ("fontaine_pajot_la_rochelle", 46.152741548835735, -1.1885979545864631),
    ("quai_louise_prunier_la_rochelle", 46.15237171816766, -1.1498209076877002),
    ("la_rochelle_antoine_de_sainte_exupery", 46.17809544021188, -1.1466416806837831),
    ("la_rochelle_zone_travaux", 46.179296473827954, -1.1501434323124156),
    ("la_rochelle_rue_george_gosnat", 46.17335522881548, -1.134765526232149),
    ("la_rochelle_rue_moulin", 46.17497851892526, -1.1295208694165904),
    ("levallois_rue_trebois", 48.89066342578931, 2.2903276305568663),
    ("levallois_rue_gabrielle_peri", 48.89153949853142, 2.288749827022435),
    ("chu_limoge_marcland", 45.81499024915774, 1.2372166319645759),
    ("levallois_lenouveau_paris", 48.894444292942794, 2.267189274715038),
    ("levallois_bd_binneau", 48.8945696797793, 2.2664198484817857),
    ("levallois_bd_emile_victor", 48.89485426741843, 2.265197984114785),
    ("levallois_rue_dupark", 48.893365289200794, 2.264989089826681),
    ("levallois_perronet", 48.889528090072766, 2.264273608679964),
    ("levallois_rue_volate", 48.89369849893265, 2.2884136316532295),
    ("levallois_gabrielle_peri", 48.89327984654453, 2.2866525372835707),
    ("saint_denis_pierre_lagourge", -21.053482945101003, 55.70895515837876),
    ("saint_denis_rue_danis", -21.056954566879146, 55.70958970218223),
]

# ---------------------------------------------------------------------------
# Geo helpers
# ---------------------------------------------------------------------------


def geographic_bounds_for_center_radius(
    lon: float,
    lat: float,
    radius_m: float,
) -> tuple[float, float, float, float]:
    """Return WGS84 (west, south, east, north) for a square of half-side *radius_m* at (lon, lat)."""
    meters_per_deg_lat = 111_320.0
    meters_per_deg_lon = 111_320.0 * math.cos(math.radians(lat))
    dlat = radius_m / meters_per_deg_lat
    dlon = radius_m / max(meters_per_deg_lon, 1.0)
    return (lon - dlon, lat - dlat, lon + dlon, lat + dlat)


# ---------------------------------------------------------------------------
# WMS download
# ---------------------------------------------------------------------------


def build_wms_getmap_url(
    west: float,
    south: float,
    east: float,
    north: float,
    width: int,
    height: int,
) -> str:
    """Build a WMS 1.3.0 GetMap URL (axis order lat,lon for EPSG:4326)."""
    params = {
        "SERVICE": "WMS",
        "VERSION": "1.3.0",
        "REQUEST": "GetMap",
        "LAYERS": ORTHO_LAYER,
        "CRS": DEFAULT_CRS,
        "BBOX": f"{south},{west},{north},{east}",
        "WIDTH": str(width),
        "HEIGHT": str(height),
        "FORMAT": DEFAULT_IMAGE_FORMAT,
        "STYLES": "",
    }
    return f"{WMS_R_ENDPOINT}?{urllib.parse.urlencode(params)}"


def _build_ssl_context() -> ssl.SSLContext:
    """Default SSL context, optionally enriched with certifi."""
    ctx = ssl.create_default_context()
    try:
        import certifi
        ctx.load_verify_locations(certifi.where())
    except (ImportError, OSError):
        pass
    return ctx


def _build_unverified_ssl_context() -> ssl.SSLContext:
    """Fallback context that skips certificate verification (IGN incomplete chain)."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def download_wms_image(url: str, *, timeout_s: float = 90.0) -> bytes:
    """GET image bytes from the Géoplateforme WMS-Raster service."""
    request = urllib.request.Request(url, headers={"User-Agent": "ign-centers-dataset/1.0"})
    ssl_ctx = _build_ssl_context()

    try:
        with urllib.request.urlopen(request, timeout=timeout_s, context=ssl_ctx) as resp:
            content_type = resp.headers.get("Content-Type", "")
            data = resp.read()
    except urllib.error.URLError as exc:
        if "CERTIFICATE_VERIFY_FAILED" not in str(exc):
            raise RuntimeError(f"IGN WMS-Raster connection error: {exc}") from exc

        import warnings
        warnings.warn(
            "SSL verification failed for data.geopf.fr — retrying without verification.",
            stacklevel=2,
        )
        ssl_ctx = _build_unverified_ssl_context()
        request = urllib.request.Request(url, headers={"User-Agent": "ign-centers-dataset/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=timeout_s, context=ssl_ctx) as resp:
                content_type = resp.headers.get("Content-Type", "")
                data = resp.read()
        except urllib.error.HTTPError as exc2:
            body = exc2.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"IGN WMS-Raster HTTP {exc2.code}: {body}") from exc2
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"IGN WMS-Raster HTTP {exc.code}: {body}") from exc

    if "xml" in content_type.lower() or data[:5] == b"<?xml":
        snippet = data.decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"IGN WMS-Raster returned XML error:\n{snippet}")
    return data


# ---------------------------------------------------------------------------
# Image / GeoTIFF helpers
# ---------------------------------------------------------------------------


def image_bytes_to_rgb_chw(image_bytes: bytes) -> tuple[np.ndarray, int, int]:
    """Decode PNG/JPEG bytes to a uint8 array shaped (3, height, width)."""
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
    out_dir = OUTPUT_DIR.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest: list[dict] = []
    total = len(LOCATIONS)

    for idx, (label, lat, lon) in enumerate(LOCATIONS):
        west, south, east, north = geographic_bounds_for_center_radius(lon, lat, RADIUS_M)
        stem = safe_filename(label)
        png_path = out_dir / f"{stem}.png"
        tif_path = out_dir / f"{stem}.tif"

        url = build_wms_getmap_url(west, south, east, north, IMAGE_WIDTH, IMAGE_HEIGHT)

        try:
            raw = download_wms_image(url)
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
            "radius_m": RADIUS_M,
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
