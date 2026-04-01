#!/usr/bin/env python3
"""
Batch-run the Koutaki-style pipeline on Mapbox static tiles from
artifacts/mapbox_detection_dataset (dataset_manifest.json).

Runs in-process so YOLO weights are loaded once, then reused for all tiles.
Vehicle detection: Ultralytics YOLO-OBB (default yolo26m-obb.pt), DOTA vehicle classes.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path


def meters_per_pixel_from_manifest_entry(entry: dict) -> float:
    """Approximate ground sampling distance (m/px) from WGS84 bbox and tile size."""
    lat_rad = math.radians(float(entry["center_lat"]))
    west = float(entry["bbox_west"])
    south = float(entry["bbox_south"])
    east = float(entry["bbox_east"])
    north = float(entry["bbox_north"])
    w_px = int(entry["width_px"])
    h_px = int(entry["height_px"])
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * math.cos(lat_rad)
    width_m = (east - west) * m_per_deg_lon
    height_m = (north - south) * m_per_deg_lat
    return 0.5 * (width_m / w_px + height_m / h_px)


def _load_extract_module():
    pipeline = Path(__file__).resolve().parent / "extract_parking_structure_geotiff.py"
    name = "koutaki_extract"
    spec = importlib.util.spec_from_file_location(name, pipeline)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {pipeline}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        default=Path("artifacts/mapbox_detection_dataset"),
        help="Folder containing dataset_manifest.json and *.tif (or *.png).",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("tests/koutaki_2016_parking_extraction/runs_mapbox"),
        help="Per-id outputs go under <output-root>/<id>/.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process only the first N manifest entries (for smoke tests).",
    )
    parser.add_argument(
        "--format",
        choices=("png", "tif"),
        default="png",
        help="Image files to use from the manifest (default: png).",
    )
    parser.add_argument(
        "--yolo-weights",
        type=str,
        default="yolo26m-obb.pt",
        help="Ultralytics weights path or hub name (default: yolo26m-obb.pt).",
    )
    args = parser.parse_args()
    dataset_dir = args.dataset_dir.resolve()
    manifest_path = dataset_dir / "dataset_manifest.json"
    if not manifest_path.is_file():
        sys.stderr.write(f"Missing manifest: {manifest_path}\n")
        sys.exit(1)

    mod = _load_extract_module()

    entries: list[dict] = json.loads(manifest_path.read_text(encoding="utf-8"))
    if args.limit is not None:
        entries = entries[: args.limit]

    args.output_root.mkdir(parents=True, exist_ok=True)
    summary = []

    for entry in entries:
        eid = entry["id"]
        image_path = dataset_dir / (entry["png"] if args.format == "png" else entry["tif"])
        if not image_path.is_file():
            sys.stderr.write(f"Skip {eid}: missing {image_path}\n")
            summary.append({"id": eid, "status": "missing_image", "path": str(image_path)})
            continue

        mpp = meters_per_pixel_from_manifest_entry(entry)
        wgs84 = (
            [entry["bbox_west"], entry["bbox_south"], entry["bbox_east"], entry["bbox_north"]]
            if args.format == "png"
            else None
        )

        config = mod.PipelineConfig(
            input_geotiff=str(image_path),
            output_dir=str(args.output_root / eid),
            pixel_size_m=mpp,
            wgs84_bounds=wgs84,
            yolo_weights=args.yolo_weights,
        )

        print("Running:", eid, "->", config.output_dir, flush=True)
        try:
            mod.run_pipeline(config)
            summary.append({"id": eid, "status": "ok", "returncode": 0})
        except Exception as e:
            sys.stderr.write(f"Error {eid}: {e}\n")
            summary.append({"id": eid, "status": "error", "error": str(e), "returncode": 1})

    (args.output_root.resolve() / "batch_summary.json").write_text(
        json.dumps(summary, indent=2),
        encoding="utf-8",
    )
    failed = sum(1 for s in summary if s.get("returncode", 0) != 0)
    missing = sum(1 for s in summary if s.get("status") == "missing_image")
    if failed or missing:
        sys.exit(1)


if __name__ == "__main__":
    main()
