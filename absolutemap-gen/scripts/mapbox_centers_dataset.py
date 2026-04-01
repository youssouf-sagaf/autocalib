#!/usr/bin/env python3
"""
Download Mapbox Static satellite PNG + EPSG:4326 GeoTIFF for fixed parking / POI centers.

Uses the Static Images API center+zoom URL (same building blocks as
:func:`absolutemap_gen.mapbox_static.fetch_static_center_zoom_to_geotiff`).

Set OUTPUT_DIR and MAP_ZOOM below, then run:  python scripts/mapbox_centers_dataset.py
 
Uses MAPBOX_ACCESS_TOKEN from the environment or absolutemap-gen/.env.

Coordinates below are stored as (label, latitude, longitude) in the usual atlas order.
"""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
_SRC = _REPO_ROOT / "src"
if _SRC.is_dir():
    sys.path.insert(0, str(_SRC))

from absolutemap_gen.mapbox_static import (  # noqa: E402
    DEFAULT_STYLE_ID,
    DEFAULT_STYLE_OWNER,
    build_static_image_url_center_zoom,
    geographic_bounds_for_static_center_zoom,
    download_static_image,
    image_bytes_to_rgb_chw,
    require_mapbox_token,
    write_rgb_geotiff,
)

# ---------------------------------------------------------------------------
# Configure output only (edit this path if needed)
# ---------------------------------------------------------------------------
OUTPUT_DIR = _REPO_ROOT / "artifacts" / "mapbox_detection_dataset"

# Max pixel size for Mapbox Static raster (API limit) — unchanged when raising zoom.
IMAGE_WIDTH = 1280
IMAGE_HEIGHT = 1280

# Web Mercator zoom: higher => smaller ground footprint, same pixel resolution; POI stays image center.
# Parkings are centered; less margin at the edges is acceptable.
MAP_ZOOM = 20.0

SLEEP_S = 0.35

STYLE_OWNER = DEFAULT_STYLE_OWNER
STYLE_ID = DEFAULT_STYLE_ID
ATTRIBUTION = True
LOGO = True

# (label, latitude, longitude) — values copied from your list; Sardagarigag corrected to Réunion S.
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
    ("saint_denis_rue_danis", -21.056954566879146, 55.70958970218223)
]


def safe_address_stem(label: str) -> str:
    """Turn a location label into a safe filename segment (after the numeric index)."""
    raw = label.strip()
    if not raw:
        raise ValueError("location label must be non-empty")
    safe = re.sub(r'[<>:"/\\|?*\x00]', "_", raw)
    safe = re.sub(r"\s+", "_", safe)
    safe = safe.strip(" ._")
    if not safe:
        raise ValueError(f"label yields empty filename segment: {label!r}")
    return safe


def main() -> int:
    if IMAGE_WIDTH > 1280 or IMAGE_HEIGHT > 1280:
        print(
            "Warning: Mapbox Static raster is limited to 1280x1280; "
            "requests may fail or be capped.",
            file=sys.stderr,
        )

    token = require_mapbox_token()
    out_dir = OUTPUT_DIR.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest: list[dict] = []
    n = len(LOCATIONS)

    for idx, (label, lat, lon) in enumerate(LOCATIONS):
        west, south, east, north = geographic_bounds_for_static_center_zoom(
            lon, lat, MAP_ZOOM, IMAGE_WIDTH, IMAGE_HEIGHT
        )
        base = f"{idx:04d}_{safe_address_stem(label)}"
        png_path = out_dir / f"{base}.png"
        tif_path = out_dir / f"{base}.tif"

        url = build_static_image_url_center_zoom(
            lon,
            lat,
            MAP_ZOOM,
            IMAGE_WIDTH,
            IMAGE_HEIGHT,
            token,
            style_owner=STYLE_OWNER,
            style_id=STYLE_ID,
            attribution=ATTRIBUTION,
            logo=LOGO,
        )
        raw = download_static_image(url)
        png_path.write_bytes(raw)

        rgb_chw, h, w = image_bytes_to_rgb_chw(raw)
        if h != IMAGE_HEIGHT or w != IMAGE_WIDTH:
            raise RuntimeError(
                f"{base} {label}: decoded {w}x{h}, expected {IMAGE_WIDTH}x{IMAGE_HEIGHT}"
            )
        write_rgb_geotiff(tif_path, rgb_chw, west, south, east, north, crs="EPSG:4326")

        manifest.append(
            {
                "id": base,
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
                "style_owner": STYLE_OWNER,
                "style_id": STYLE_ID,
                "png": str(png_path.relative_to(out_dir)),
                "tif": str(tif_path.relative_to(out_dir)),
            }
        )
        print(f"[{idx + 1}/{n}] {label} -> {png_path.name} + {tif_path.name}")
        if idx < n - 1 and SLEEP_S > 0:
            time.sleep(SLEEP_S)

    manifest_path = out_dir / "dataset_manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Wrote manifest: {manifest_path} ({len(manifest)} samples)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
