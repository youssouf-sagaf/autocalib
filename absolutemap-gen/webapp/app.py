"""Flask backend for the Parking Slot Detection Viewer."""

import json
import os
from pathlib import Path

from flask import Flask, abort, jsonify, send_file

app = Flask(__name__)

ARTIFACTS_DIR = (Path(__file__).resolve().parent.parent / "artifacts" / "run_output")


def _get_mapbox_token() -> str:
    return os.environ.get("MAPBOX_ACCESS_TOKEN", "")

IMAGE_STAGE_MAP = {
    "original": "stages/01_preprocess/rgb_normalized.png",
    "detection": "stages/03_detection/overlay_detections.png",
    "mask": "stages/02_segmentation/mask_refined.png",
    "postprocess": "stages/04_postprocess/overlay_postprocess.png",
}


def _get_run_dirs():
    """Return sorted list of run directory names that contain a manifest."""
    if not ARTIFACTS_DIR.is_dir():
        return []
    return sorted(
        d.name
        for d in ARTIFACTS_DIR.iterdir()
        if d.is_dir() and (d / "manifest.json").exists()
    )


RUN_DIRS = _get_run_dirs()


def _validate_run(name: str) -> Path:
    """Validate run name and return its path, or abort 404."""
    if name not in RUN_DIRS:
        abort(404, description=f"Run '{name}' not found")
    return ARTIFACTS_DIR / name


def _compute_parking_zone(affine, width, height):
    """Compute parking zone corners and bounds from affine transform."""
    a0, a1, a2, a3, a4, a5 = affine
    corners = []
    for col, row in [(0, 0), (width, 0), (width, height), (0, height)]:
        lon = a0 * col + a1 * row + a2
        lat = a3 * col + a4 * row + a5
        corners.append([lon, lat])
    lons = [c[0] for c in corners]
    lats = [c[1] for c in corners]
    return {
        "corners": corners,
        "bounds": {
            "south": min(lats),
            "north": max(lats),
            "west": min(lons),
            "east": max(lons),
        },
    }


def _compute_centroid(polygon_coords):
    """Average of polygon ring vertices (excluding closing duplicate)."""
    ring = polygon_coords[0]
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring = ring[:-1]
    n = len(ring)
    lon = sum(pt[0] for pt in ring) / n
    lat = sum(pt[1] for pt in ring) / n
    return [lon, lat]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return app.send_static_file("../templates/index.html") if False else \
        __import__("flask").render_template("index.html")


@app.route("/api/runs")
def list_runs():
    return jsonify({"runs": RUN_DIRS, "count": len(RUN_DIRS)})


@app.route("/api/runs/<name>")
def get_run(name):
    run_dir = _validate_run(name)

    # Read meta.json for parking zone
    meta_path = run_dir / "stages" / "00_gis_input" / "meta.json"
    if not meta_path.exists():
        abort(404, description="meta.json not found")
    with open(meta_path) as f:
        meta = json.load(f)
    data = meta.get("data", meta)
    affine = data["transform_affine"]
    width = data["width"]
    height = data["height"]
    parking_zone = _compute_parking_zone(affine, width, height)

    # Read slots GeoJSON — send full polygon geometry for map rendering
    geojson_path = run_dir / "slots_wgs84.geojson"
    slots = []
    if geojson_path.exists():
        with open(geojson_path) as f:
            geojson = json.load(f)
        for feature in geojson.get("features", []):
            props = feature.get("properties", {})
            coords = feature["geometry"]["coordinates"]
            center = _compute_centroid(coords)
            slots.append({
                "slot_id": props.get("slot_id"),
                "center": center,
                "polygon": coords,
                "status": props.get("status", "unknown"),
                "confidence": props.get("confidence", 0),
                "source": props.get("source", "unknown"),
            })

    run_index = RUN_DIRS.index(name)
    return jsonify({
        "name": name,
        "index": run_index,
        "total": len(RUN_DIRS),
        "parking_zone": parking_zone,
        "slots": slots,
        "num_slots": len(slots),
        "num_occupied": sum(1 for s in slots if s["status"] == "occupied"),
        "num_empty": sum(1 for s in slots if s["status"] == "empty"),
        "mapbox_token": _get_mapbox_token(),
    })


@app.route("/api/runs/<name>/image/<stage>")
def get_image(name, stage):
    run_dir = _validate_run(name)
    rel_path = IMAGE_STAGE_MAP.get(stage)
    if rel_path is None:
        abort(400, description=f"Unknown stage '{stage}'. Use: {list(IMAGE_STAGE_MAP)}")
    image_path = run_dir / rel_path
    if not image_path.exists():
        abort(404, description=f"Image not found: {rel_path}")
    return send_file(image_path, mimetype="image/png", max_age=3600)


def _load_env():
    """Load .env from project root so MAPBOX_ACCESS_TOKEN is available."""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip())


if __name__ == "__main__":
    _load_env()

    token = _get_mapbox_token()
    print(f"Found {len(RUN_DIRS)} pipeline runs in {ARTIFACTS_DIR}")
    print(f"Mapbox token: {'set' if token else 'not set'}")
    app.run(debug=True, port=5050)
