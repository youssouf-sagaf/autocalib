"""
Capture golden files from existing R&D pipeline runs.

Extracts the reference outputs at each stage from absolutemap-gen/artifacts/run_output/
and stores them in tests/golden/ in the format expected by parity tests.

Usage:
    python tests/golden/capture_golden_files.py
"""

import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

# --- Configuration -----------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
RUN_OUTPUT = REPO_ROOT / "absolutemap-gen" / "artifacts" / "run_output"
GEOTIFF_DIR = REPO_ROOT / "absolutemap-gen" / "artifacts" / "mapbox_detection_dataset"
GOLDEN_DIR = REPO_ROOT / "tests" / "golden"

# 7 representative cases: low → high density + edge case (0 slots)
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
    """Load a PNG mask and return as numpy array (H, W) uint8."""
    img = Image.open(png_path).convert("L")
    return np.array(img, dtype=np.uint8)


def build_meta(case_name: str, run_dir: Path, manifest: dict, geojson: dict) -> dict:
    """Build meta.json for a golden file case."""
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
    }


def capture_case(case_id: str, run_name: str) -> None:
    """Extract golden files for one case."""
    run_dir = RUN_OUTPUT / run_name
    if not run_dir.exists():
        print(f"  SKIP {case_id}: run dir not found: {run_dir}")
        return

    case_dir = GOLDEN_DIR / case_id
    case_dir.mkdir(parents=True, exist_ok=True)

    # --- input.tif reference pointer (large files not in git) ----------------
    geotiff_name = f"{run_name}.tif"
    geotiff_path = GEOTIFF_DIR / geotiff_name
    if geotiff_path.exists():
        ref = {"type": "geotiff_ref", "path": str(geotiff_path), "filename": geotiff_name}
        (case_dir / "input_ref.json").write_text(json.dumps(ref, indent=2) + "\n")
        print(f"  {case_id}: input_ref.json ✓")
    else:
        # Fallback: use the cropped GeoTIFF from the run
        crop_tif = run_dir / "stages" / "00_gis_input" / "crop_rgb.tif"
        if crop_tif.exists():
            ref = {"type": "geotiff_ref", "path": str(crop_tif), "filename": crop_tif.name}
            (case_dir / "input_ref.json").write_text(json.dumps(ref, indent=2) + "\n")
            print(f"  {case_id}: input_ref.json (from crop) ✓")

    # --- segmentation_mask.npy -----------------------------------------------
    mask_raw = run_dir / "stages" / "02_segmentation" / "mask_raw.png"
    mask_refined = run_dir / "stages" / "02_segmentation" / "mask_refined.png"
    if mask_raw.exists():
        np.save(case_dir / "segmentation_mask_raw.npy", png_to_npy(mask_raw))
        print(f"  {case_id}: segmentation_mask_raw.npy ✓")
    if mask_refined.exists():
        np.save(case_dir / "segmentation_mask_refined.npy", png_to_npy(mask_refined))
        print(f"  {case_id}: segmentation_mask_refined.npy ✓")

    # --- detections_raw.json (YOLO before GeometricEngine) -------------------
    det_raw = run_dir / "stages" / "03_detection" / "detections_raw.json"
    if det_raw.exists():
        shutil.copy2(det_raw, case_dir / "detections_raw.json")
        print(f"  {case_id}: detections_raw.json ✓")

    # --- detections_post.json (after GeometricEngine) ------------------------
    det_post = run_dir / "stages" / "04_postprocess" / "enriched_detections.json"
    if det_post.exists():
        shutil.copy2(det_post, case_dir / "detections_post.json")
        print(f"  {case_id}: detections_post.json ✓")

    # --- export.geojson (final output) ---------------------------------------
    export = run_dir / "slots_wgs84.geojson"
    if export.exists():
        shutil.copy2(export, case_dir / "export.geojson")
        print(f"  {case_id}: export.geojson ✓")

    # --- meta.json -----------------------------------------------------------
    manifest_path = run_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    geojson = json.loads(export.read_text()) if export.exists() else {}
    meta = build_meta(case_id, run_dir, manifest, geojson)
    (case_dir / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"  {case_id}: meta.json ✓")


def main():
    print(f"Capturing golden files from: {RUN_OUTPUT}")
    print(f"Output to: {GOLDEN_DIR}")
    print(f"Cases: {len(CASES)}\n")

    for case_id, run_name in CASES.items():
        print(f"[{case_id}] {run_name}")
        capture_case(case_id, run_name)
        print()

    print("Done.")


if __name__ == "__main__":
    main()
