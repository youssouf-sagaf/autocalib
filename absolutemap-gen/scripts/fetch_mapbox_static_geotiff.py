#!/usr/bin/env python3
"""Download a Mapbox Static satellite image and save it as a georeferenced GeoTIFF (EPSG:4326)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
_SRC = _REPO_ROOT / "src"
if _SRC.is_dir():
    sys.path.insert(0, str(_SRC))

from absolutemap_gen.mapbox_static import (  # noqa: E402
    DEFAULT_EAST,
    DEFAULT_IMAGE_HEIGHT,
    DEFAULT_IMAGE_WIDTH,
    DEFAULT_NORTH,
    DEFAULT_OUTPUT_RELATIVE,
    DEFAULT_SOUTH,
    DEFAULT_STYLE_ID,
    DEFAULT_STYLE_OWNER,
    DEFAULT_WEST,
    fetch_static_bbox_to_geotiff,
)


def _parse_bbox(s: str) -> tuple[float, float, float, float]:
    parts = [p.strip() for p in s.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("bbox must be west,south,east,north (four comma-separated numbers)")
    try:
        return tuple(float(p) for p in parts)  # type: ignore[return-value]
    except ValueError as exc:
        raise argparse.ArgumentTypeError("bbox values must be floats") from exc


def main() -> int:
    default_out = _REPO_ROOT / DEFAULT_OUTPUT_RELATIVE
    parser = argparse.ArgumentParser(
        description="Fetch Mapbox Static Images API raster and write EPSG:4326 GeoTIFF."
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=default_out,
        help=f"Output GeoTIFF path (default: {default_out})",
    )
    parser.add_argument(
        "--bbox",
        type=_parse_bbox,
        default=(DEFAULT_WEST, DEFAULT_SOUTH, DEFAULT_EAST, DEFAULT_NORTH),
        metavar="W,S,E,N",
        help=f"WGS84 bbox west,south,east,north (default: {DEFAULT_WEST},{DEFAULT_SOUTH},{DEFAULT_EAST},{DEFAULT_NORTH})",
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
    parser.add_argument(
        "--style-owner",
        default=DEFAULT_STYLE_OWNER,
        help=f"Mapbox style owner (default: {DEFAULT_STYLE_OWNER})",
    )
    parser.add_argument(
        "--style-id",
        default=DEFAULT_STYLE_ID,
        help=f"Mapbox style id (default: {DEFAULT_STYLE_ID})",
    )
    parser.add_argument(
        "--no-attribution",
        action="store_true",
        help="Set attribution=false on the API request",
    )
    parser.add_argument(
        "--no-logo",
        action="store_true",
        help="Set logo=false on the API request",
    )
    args = parser.parse_args()
    west, south, east, north = args.bbox

    path = fetch_static_bbox_to_geotiff(
        args.out,
        west=west,
        south=south,
        east=east,
        north=north,
        width=args.width,
        height=args.height,
        style_owner=args.style_owner,
        style_id=args.style_id,
        attribution=not args.no_attribution,
        logo=not args.no_logo,
    )
    print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


