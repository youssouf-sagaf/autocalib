"""Flask backend for the Parking Slot Detection Viewer."""

import io
import json
import os
from pathlib import Path

import numpy as np
from flask import Flask, abort, jsonify, request, send_file
from PIL import Image

app = Flask(__name__)

_ARTIFACTS_ROOT = Path(__file__).resolve().parent.parent / "artifacts"

_SOURCE_DIRS: dict[str, Path] = {
    "mapbox": _ARTIFACTS_ROOT / "run_output",
    "ign": _ARTIFACTS_ROOT / "run_output_ign",
}

_DEFAULT_SOURCE = "mapbox"


def _get_mapbox_token() -> str:
    return os.environ.get("MAPBOX_ACCESS_TOKEN", "")

IMAGE_STAGE_MAP = {
    "original": "stages/01_preprocess/rgb_normalized.png",
    "detection": "stages/03_detection/overlay_detections.png",
    "postprocess": "stages/04_postprocess/overlay_postprocess.png",
}

_IMAGE_STAGES = ("original", "segmentation", "detection", "postprocess")


def _segmentation_overlay_response(run_dir: Path):
    """Serve precomputed overlay or build it from rgb_normalized + mask_refined."""
    prebuilt = run_dir / "stages/02_segmentation/overlay_segmentation.png"
    if prebuilt.is_file():
        return send_file(prebuilt, mimetype="image/png", max_age=3600)
    orig = run_dir / "stages/01_preprocess/rgb_normalized.png"
    mask_path = run_dir / "stages/02_segmentation/mask_refined.png"
    if not orig.is_file() or not mask_path.is_file():
        abort(
            404,
            description="Segmentation overlay not found (need overlay_segmentation.png or "
            "rgb_normalized.png + mask_refined.png).",
        )
    rgb = np.array(Image.open(orig).convert("RGB"))
    mask_l = np.array(Image.open(mask_path).convert("L"))
    if rgb.shape[:2] != mask_l.shape:
        abort(404, description="rgb_normalized and mask_refined size mismatch.")
    alpha = 0.45
    tint = np.array([0, 220, 120], dtype=np.float32)
    base = rgb.astype(np.float32)
    blended = base * (1.0 - alpha) + tint * alpha
    parkable = (mask_l > 0)[..., np.newaxis]
    out = np.where(parkable, blended, base)
    out_u8 = np.clip(out, 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(out_u8, mode="RGB").save(buf, format="PNG")
    buf.seek(0)
    return send_file(buf, mimetype="image/png", max_age=3600)


def _scan_run_dirs(artifacts_dir: Path) -> list[str]:
    """Return sorted list of run directory names that contain a manifest."""
    if not artifacts_dir.is_dir():
        return []
    return sorted(
        d.name
        for d in artifacts_dir.iterdir()
        if d.is_dir() and (d / "manifest.json").exists()
    )


_RUN_CACHE: dict[str, list[str]] = {
    src: _scan_run_dirs(path) for src, path in _SOURCE_DIRS.items()
}


def _resolve_source() -> str:
    """Read ``?source=`` query param (default: mapbox)."""
    src = request.args.get("source", _DEFAULT_SOURCE).strip().lower()
    if src not in _SOURCE_DIRS:
        abort(400, description=f"Unknown source '{src}'. Use: {list(_SOURCE_DIRS)}")
    return src


def _validate_run(name: str, source: str | None = None) -> Path:
    """Validate run name for the given source and return its path, or abort 404."""
    if source is None:
        source = _resolve_source()
    runs = _RUN_CACHE.get(source, [])
    if name not in runs:
        abort(404, description=f"Run '{name}' not found in source '{source}'")
    return _SOURCE_DIRS[source] / name


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


@app.route("/api/sources")
def list_sources():
    sources = []
    for src in _SOURCE_DIRS:
        runs = _RUN_CACHE.get(src, [])
        sources.append({"name": src, "count": len(runs)})
    return jsonify({"sources": sources, "default": _DEFAULT_SOURCE})


@app.route("/api/runs")
def list_runs():
    source = _resolve_source()
    runs = _RUN_CACHE.get(source, [])
    return jsonify({"runs": runs, "count": len(runs), "source": source})


@app.route("/api/runs/<name>")
def get_run(name):
    source = _resolve_source()
    run_dir = _validate_run(name, source)
    runs = _RUN_CACHE.get(source, [])

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

    run_index = runs.index(name)
    return jsonify({
        "name": name,
        "source": source,
        "index": run_index,
        "total": len(runs),
        "parking_zone": parking_zone,
        "slots": slots,
        "num_slots": len(slots),
        "num_occupied": sum(1 for s in slots if s["status"] == "occupied"),
        "num_empty": sum(1 for s in slots if s["status"] == "empty"),
        "mapbox_token": _get_mapbox_token(),
    })


@app.route("/api/runs/<name>/image/<stage>")
def get_image(name, stage):
    source = _resolve_source()
    run_dir = _validate_run(name, source)
    if stage not in _IMAGE_STAGES:
        abort(400, description=f"Unknown stage '{stage}'. Use: {list(_IMAGE_STAGES)}")
    if stage == "segmentation":
        return _segmentation_overlay_response(run_dir)
    rel_path = IMAGE_STAGE_MAP[stage]
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
    for src, runs in _RUN_CACHE.items():
        print(f"  [{src}] {len(runs)} pipeline runs in {_SOURCE_DIRS[src]}")
    print(f"Mapbox token: {'set' if token else 'not set'}")
    app.run(debug=True, port=5050)
