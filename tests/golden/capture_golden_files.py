"""
Capture golden files for parity tests.

Supports:

1. **New layout** — one ``autoabsmap`` pipeline run directory (as produced when
   ``artifacts_dir`` is set on ``ParkingSlotPipeline.run``), e.g.
   ``autoabsmap/artifacts/<job_id>/stages/`` with ``00_imagery``, ``01_segmentation``, …

2. **Legacy layout** — R&D ``absolutemap-gen/artifacts/run_output/<run_name>/`` (original script).

Writes into ``tests/golden/case_*/``:

- ``segmentation_mask_raw.npy`` / ``segmentation_mask_refined.npy`` (uint8 H×W)
- ``detections_raw.json`` (from ``02_detection/detections.json`` if present)
- ``export.geojson`` (from ``05_export/slots_wgs84.geojson`` or legacy paths)
- ``meta.json``

Usage::

    python tests/golden/capture_golden_files.py
    python tests/golden/capture_golden_files.py --from-run /path/to/autoabsmap/artifacts/job/stages
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
LEGACY_RUN_OUTPUT = REPO_ROOT / "absolutemap-gen" / "artifacts" / "run_output"
LEGACY_GEOTIFF_DIR = REPO_ROOT / "absolutemap-gen" / "artifacts" / "mapbox_detection_dataset"
GOLDEN_DIR = REPO_ROOT / "tests" / "golden"

CASES = {
    "case_001": "0000_chambly",
    "case_002": "0002_rue_jean_chatel",
    "case_003": "0005_parking_tour_d_auvergne",
    "case_004": "0009_parking_gare_de_cergy",
    "case_005": "0014_fontaine_pajot_la_rochelle",
    "case_006": "0022_chu_limoge_marcland",
    "case_007": "0025_levallois_bd_emile_victor",
}


def png_to_npy(png_path: Path) -> np.ndarray:
    img = Image.open(png_path).convert("L")
    return np.array(img, dtype=np.uint8)


def build_meta(case_name: str, run_dir: Path, manifest: dict, geojson: dict) -> dict:
    gis_meta_path = run_dir / "stages" / "00_imagery" / "meta.json"
    if not gis_meta_path.exists():
        gis_meta_path = run_dir / "stages" / "00_gis_input" / "meta.json"
    gis_meta = json.loads(gis_meta_path.read_text()) if gis_meta_path.exists() else {}

    return {
        "case_name": case_name,
        "source_run": run_dir.name,
        "git_revision": manifest.get("git_revision", "unknown"),
        "num_slots": geojson.get("num_slots", 0),
        "num_occupied": geojson.get("num_occupied", 0),
        "num_empty": geojson.get("num_empty", 0),
        "gis": gis_meta,
        "captured_from": str(run_dir),
        "layout": "autoabsmap_stages" if (run_dir / "stages" / "00_imagery").exists() else "legacy",
    }


def capture_from_autoabsmap_stages(stages_root: Path, case_id: str, case_dir: Path) -> None:
    """Copy artifacts from ``.../stages`` (parent of ``00_imagery``) into *case_dir*."""
    run_dir = stages_root.parent if stages_root.name == "stages" else stages_root
    stages = stages_root if stages_root.name == "stages" else run_dir / "stages"

    case_dir.mkdir(parents=True, exist_ok=True)

    raw_mask = stages / "01_segmentation" / "mask_raw.png"
    refined_mask = stages / "01_segmentation" / "mask_refined.png"
    clipped = stages / "01_segmentation" / "mask_clipped_roi.png"
    if raw_mask.exists():
        np.save(case_dir / "segmentation_mask_raw.npy", png_to_npy(raw_mask))
        print(f"  {case_id}: segmentation_mask_raw.npy ✓")
    if refined_mask.exists():
        np.save(case_dir / "segmentation_mask_refined.npy", png_to_npy(refined_mask))
        print(f"  {case_id}: segmentation_mask_refined.npy ✓")
    elif clipped.exists():
        np.save(case_dir / "segmentation_mask_refined.npy", png_to_npy(clipped))
        print(f"  {case_id}: segmentation_mask_refined.npy (from mask_clipped_roi) ✓")

    det = stages / "02_detection" / "detections.json"
    if det.exists():
        shutil.copy2(det, case_dir / "detections_raw.json")
        print(f"  {case_id}: detections_raw.json ✓")

    export = stages / "05_export" / "slots_wgs84.geojson"
    if not export.exists():
        export = run_dir / "slots_wgs84.geojson"
    if export.exists():
        shutil.copy2(export, case_dir / "export.geojson")
        print(f"  {case_id}: export.geojson ✓")

    manifest_path = run_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    geojson = json.loads(export.read_text()) if export.exists() else {}
    meta = build_meta(case_id, run_dir, manifest, geojson)
    (case_dir / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"  {case_id}: meta.json ✓")


def capture_case_legacy(case_id: str, run_name: str) -> None:
    run_dir = LEGACY_RUN_OUTPUT / run_name
    if not run_dir.exists():
        print(f"  SKIP {case_id}: run dir not found: {run_dir}")
        return

    case_dir = GOLDEN_DIR / case_id
    case_dir.mkdir(parents=True, exist_ok=True)

    geotiff_name = f"{run_name}.tif"
    geotiff_path = LEGACY_GEOTIFF_DIR / geotiff_name
    if geotiff_path.exists():
        ref = {"type": "geotiff_ref", "path": str(geotiff_path), "filename": geotiff_name}
        (case_dir / "input_ref.json").write_text(json.dumps(ref, indent=2) + "\n")
        print(f"  {case_id}: input_ref.json ✓")
    else:
        crop_tif = run_dir / "stages" / "00_gis_input" / "crop_rgb.tif"
        if crop_tif.exists():
            ref = {"type": "geotiff_ref", "path": str(crop_tif), "filename": crop_tif.name}
            (case_dir / "input_ref.json").write_text(json.dumps(ref, indent=2) + "\n")
            print(f"  {case_id}: input_ref.json (from crop) ✓")

    mask_raw = run_dir / "stages" / "02_segmentation" / "mask_raw.png"
    mask_refined = run_dir / "stages" / "02_segmentation" / "mask_refined.png"
    if mask_raw.exists():
        np.save(case_dir / "segmentation_mask_raw.npy", png_to_npy(mask_raw))
        print(f"  {case_id}: segmentation_mask_raw.npy ✓")
    if mask_refined.exists():
        np.save(case_dir / "segmentation_mask_refined.npy", png_to_npy(mask_refined))
        print(f"  {case_id}: segmentation_mask_refined.npy ✓")

    det_raw = run_dir / "stages" / "03_detection" / "detections_raw.json"
    if det_raw.exists():
        shutil.copy2(det_raw, case_dir / "detections_raw.json")
        print(f"  {case_id}: detections_raw.json ✓")

    det_post = run_dir / "stages" / "04_postprocess" / "enriched_detections.json"
    if det_post.exists():
        shutil.copy2(det_post, case_dir / "detections_post.json")
        print(f"  {case_id}: detections_post.json ✓")

    export = run_dir / "slots_wgs84.geojson"
    if export.exists():
        shutil.copy2(export, case_dir / "export.geojson")
        print(f"  {case_id}: export.geojson ✓")

    manifest_path = run_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    geojson = json.loads(export.read_text()) if export.exists() else {}
    meta = build_meta(case_id, run_dir, manifest, geojson)
    meta["layout"] = "legacy"
    (case_dir / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"  {case_id}: meta.json ✓")


def main() -> None:
    parser = argparse.ArgumentParser(description="Capture tests/golden parity fixtures.")
    parser.add_argument(
        "--from-run",
        type=Path,
        default=None,
        help="Path to pipeline ``stages`` folder or its parent artifacts directory",
    )
    parser.add_argument(
        "--case-id",
        type=str,
        default=None,
        help="When using --from-run for a single crop, target case_### folder name",
    )
    args = parser.parse_args()

    if args.from_run is not None:
        root = args.from_run.resolve()
        cid = args.case_id or "case_custom"
        capture_from_autoabsmap_stages(root, cid, GOLDEN_DIR / cid)
        print("Done (single run).")
        return

    print(f"Capturing golden files from: {LEGACY_RUN_OUTPUT}")
    print(f"Output to: {GOLDEN_DIR}\n")

    for case_id, run_name in CASES.items():
        print(f"[{case_id}] {run_name}")
        capture_case_legacy(case_id, run_name)
        print()

    print("Done.")


if __name__ == "__main__":
    main()
