#!/usr/bin/env python3
"""Run the parking GeoTIFF pipeline on a single file or every .tif in a folder.

Defaults:
    --input  artifacts/mapbox_detection_dataset
    --out    artifacts/run_output

Use ``--source`` to switch between image providers without specifying paths:
    --source mapbox   (default)  artifacts/mapbox_detection_dataset → artifacts/run_output
    --source ign                 artifacts/ign_detection_dataset   → artifacts/run_output_ign
    --source all                 runs both sequentially

When ``--input`` is a directory the script processes each ``*.tif`` found
inside it and writes per-file results under ``<out>/<stem>/``.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
_SRC = _REPO_ROOT / "src"
if _SRC.is_dir():
    sys.path.insert(0, str(_SRC))

from absolutemap_gen.artifacts_io import RunContext  # noqa: E402
from absolutemap_gen.config import load_dotenv_if_present  # noqa: E402
from absolutemap_gen.pipeline import run_parking_pipeline  # noqa: E402

_SOURCE_PRESETS: dict[str, tuple[str, str]] = {
    "mapbox": ("artifacts/mapbox_detection_dataset", "artifacts/run_output"),
    "ign": ("artifacts/ign_detection_dataset", "artifacts/run_output_ign"),
}


def _parse_bbox(s: str) -> tuple[float, float, float, float]:
    parts = [p.strip() for p in s.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("bbox must be west,south,east,north (four comma-separated numbers)")
    try:
        return tuple(float(p) for p in parts)  # type: ignore[return-value]
    except ValueError as exc:
        raise argparse.ArgumentTypeError("bbox values must be floats") from exc


def _parse_window(s: str) -> tuple[int, int, int, int]:
    parts = [p.strip() for p in s.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError(
            "window must be col_off,row_off,width,height (four comma-separated integers)"
        )
    try:
        return tuple(int(p) for p in parts)  # type: ignore[return-value]
    except ValueError as exc:
        raise argparse.ArgumentTypeError("window values must be integers") from exc


def _run_single(geotiff: Path, out_dir: Path, args: argparse.Namespace) -> None:
    """Process one GeoTIFF and write artifacts into *out_dir*."""
    ctx = RunContext(out_dir=out_dir.resolve(), write_stage_artifacts=not args.no_stage_artifacts)
    cli_snapshot = {
        "geotiff": str(geotiff),
        "out": str(ctx.out_dir),
        "bbox": list(args.bbox) if args.bbox is not None else None,
        "window": list(args.window) if args.window is not None else None,
        "no_stage_artifacts": bool(args.no_stage_artifacts),
    }
    run_parking_pipeline(
        ctx,
        geotiff,
        bbox=args.bbox,
        window=args.window,
        cli_args=cli_snapshot,
    )


def _run_batch(
    input_path: Path, out_root: Path, args: argparse.Namespace, label: str = "",
) -> int:
    """Process a single file or every .tif in a directory. Returns 0 on success."""
    input_path = input_path.resolve()

    if input_path.is_file():
        tif_files = [input_path]
    elif input_path.is_dir():
        tif_files = sorted(input_path.glob("*.tif"))
        if not tif_files:
            print(f"No .tif files found in {input_path}", file=sys.stderr)
            return 2
    else:
        print(f"Input path not found: {input_path}", file=sys.stderr)
        return 2

    out_root = out_root.resolve()
    total = len(tif_files)
    tag = f"[{label}] " if label else ""

    for idx, tif in enumerate(tif_files, 1):
        stem = tif.stem
        file_out = out_root / stem if total > 1 else out_root
        print(f"\n{tag}[{idx}/{total}] {tif.name} → {file_out}")
        try:
            _run_single(tif, file_out, args)
            print(f"  ✓ done")
        except Exception as exc:
            print(f"  ✗ failed: {exc}", file=sys.stderr)

    print(f"\n{tag}All done — results in {out_root}")
    return 0


def main() -> int:
    load_dotenv_if_present()
    parser = argparse.ArgumentParser(
        description="Run absolutemap-gen on a GeoTIFF (or a folder of GeoTIFFs).",
    )
    parser.add_argument(
        "--source",
        choices=["mapbox", "ign", "all"],
        default="mapbox",
        help="Image source preset. 'all' runs both mapbox and ign sequentially (default: mapbox)",
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=None,
        help="Override: single .tif file or directory of .tif files",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Override: output root directory",
    )
    parser.add_argument(
        "--bbox",
        type=_parse_bbox,
        default=None,
        metavar="W,S,E,N",
        help="Crop to bounds in raster CRS: west,south,east,north",
    )
    parser.add_argument(
        "--window",
        type=_parse_window,
        default=None,
        metavar="COL,ROW,W,H",
        help="Crop by pixel window: col_off,row_off,width,height",
    )
    parser.add_argument(
        "--no-stage-artifacts",
        action="store_true",
        help="Skip stages/* intermediates; still writes manifest.json and slots_wgs84.geojson",
    )
    args = parser.parse_args()

    sources = list(_SOURCE_PRESETS) if args.source == "all" else [args.source]
    worst_rc = 0

    for src in sources:
        default_input, default_out = _SOURCE_PRESETS[src]
        input_path = Path(args.input) if args.input else Path(default_input)
        out_root = Path(args.out) if args.out else Path(default_out)

        print(f"\n{'=' * 60}")
        print(f"  Source: {src}   input={input_path}   out={out_root}")
        print(f"{'=' * 60}")

        rc = _run_batch(input_path, out_root, args, label=src)
        worst_rc = max(worst_rc, rc)

    return worst_rc


if __name__ == "__main__":
    raise SystemExit(main())
