#!/usr/bin/env python3
"""Download an IGN BD ORTHO image and save it as a georeferenced GeoTIFF (EPSG:4326).

Uses the free Géoplateforme WMS-Raster service — no API key required.

Usage examples:

    # Fetch by bounding box (west, south, east, north):
    python scripts/fetch_ign_ortho_geotiff.py --bbox 2.289,48.890,2.291,48.891

    # Fetch by centre point + radius in metres:
    python scripts/fetch_ign_ortho_geotiff.py --center 2.2903,48.8907 --radius 128
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
_SRC = _REPO_ROOT / "src"
if _SRC.is_dir():
    sys.path.insert(0, str(_SRC))

from absolutemap_gen.ign_ortho import (  # noqa: E402
    DEFAULT_IMAGE_HEIGHT,
    DEFAULT_IMAGE_WIDTH,
    DEFAULT_EAST,
    DEFAULT_NORTH,
    DEFAULT_SOUTH,
    DEFAULT_WEST,
    fetch_ign_ortho_center_to_geotiff,
    fetch_ign_ortho_to_geotiff,
)


def _parse_bbox(s: str) -> tuple[float, float, float, float]:
    parts = [p.strip() for p in s.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError(
            "bbox must be west,south,east,north (four comma-separated numbers)"
        )
    try:
        return tuple(float(p) for p in parts)  # type: ignore[return-value]
    except ValueError as exc:
        raise argparse.ArgumentTypeError("bbox values must be floats") from exc


def _parse_center(s: str) -> tuple[float, float]:
    parts = [p.strip() for p in s.split(",")]
    if len(parts) != 2:
        raise argparse.ArgumentTypeError(
            "center must be lon,lat (two comma-separated numbers)"
        )
    try:
        return tuple(float(p) for p in parts)  # type: ignore[return-value]
    except ValueError as exc:
        raise argparse.ArgumentTypeError("center values must be floats") from exc


def main() -> int:
    default_out = _REPO_ROOT / "artifacts" / "ign_ortho_smoke.tif"
    parser = argparse.ArgumentParser(
        description="Fetch IGN BD ORTHO via WMS-Raster and write an EPSG:4326 GeoTIFF.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=default_out,
        help=f"Output GeoTIFF path (default: {default_out})",
    )

    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--bbox",
        type=_parse_bbox,
        default=None,
        metavar="W,S,E,N",
        help="WGS84 bbox west,south,east,north",
    )
    group.add_argument(
        "--center",
        type=_parse_center,
        default=None,
        metavar="LON,LAT",
        help="Centre point (lon,lat) — use with --radius",
    )

    parser.add_argument(
        "--radius",
        type=float,
        default=32.0,
        help="Half-side of the capture square in metres (default: 32, matches Mapbox zoom-20 footprint)",
    )
    parser.add_argument(
        "--width",
        type=int,
        default=DEFAULT_IMAGE_WIDTH,
        help=f"Image width in pixels (default: {DEFAULT_IMAGE_WIDTH})",
    )
    parser.add_argument(
        "--height",
        type=int,
        default=DEFAULT_IMAGE_HEIGHT,
        help=f"Image height in pixels (default: {DEFAULT_IMAGE_HEIGHT})",
    )
    args = parser.parse_args()

    if args.center is not None:
        lon, lat = args.center
        print(
            f"Fetching IGN BD ORTHO: center=({lon}, {lat}), "
            f"radius={args.radius}m, {args.width}x{args.height}px"
        )
        path = fetch_ign_ortho_center_to_geotiff(
            args.out,
            lon=lon,
            lat=lat,
            radius_m=args.radius,
            width=args.width,
            height=args.height,
        )
    else:
        if args.bbox is not None:
            west, south, east, north = args.bbox
        else:
            west, south, east, north = DEFAULT_WEST, DEFAULT_SOUTH, DEFAULT_EAST, DEFAULT_NORTH
        print(
            f"Fetching IGN BD ORTHO: bbox=({west}, {south}, {east}, {north}), "
            f"{args.width}x{args.height}px"
        )
        path = fetch_ign_ortho_to_geotiff(
            args.out,
            west=west,
            south=south,
            east=east,
            north=north,
            width=args.width,
            height=args.height,
        )

    print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
