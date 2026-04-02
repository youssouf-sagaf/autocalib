# autocalib

**autocalib** is the Cocoparks monorepo for the automatic calibration of parking lots. It covers the full pipeline from aerial satellite imagery to a production-ready absolute map of parking slots, and from camera images to per-slot bounding boxes — enabling the automated pairing of geographic slots with camera views.

The system is designed around three sequential capabilities:

1. **Absolute map generation** (`absmap`) — detect and geolocate every parking slot in a zone using satellite/aerial imagery, YOLO-OBB detection, and SegFormer segmentation. Produces a GeoJSON absolute map of slot OBBs in WGS84.
2. **Calibration generation** (`calib-gen`) — given a camera image of a parking lot, generate the bounding boxes (bboxes) that correspond to each parking slot as seen by that camera.
3. **Pairing** (`pairing`) — couple each absolute map slot (`GeoSlot`) with its corresponding camera bbox, enabling fully automated camera calibration.

---

## Monorepo structure

```
autocalib/
  absmap/                  # Clean Python package — absolute map generation engine
                           # Layered architecture: config → io → imagery → ml → geometry → export → pipeline → session
                           # [STATUS: in development]

  absmap-api/              # FastAPI standalone service — HTTP wrapper over absmap
                           # Multi-crop job orchestration, SSE progress streaming, session persistence
                           # [STATUS: in development]

  absmap-frontend/         # React + Vite operator tool — draw crops, review detections, edit, save
                           # Map-renderer agnostic (IMapProvider interface), Redux state, learning loop
                           # [STATUS: in development]

  absolutemap-gen/         # R&D archive — original geo-AI pipeline (YOLO-OBB + SegFormer)
                           # Kept as reference. Not imported by any new code.
                           # [STATUS: read-only archive]

  calib-gen/               # Camera bbox generation
                           # [STATUS: future]

  pairing/                 # Geo slot ↔ camera bbox matching
                           # [STATUS: future]

  models/                  # Shared ML model weights (YOLO, SegFormer checkpoints)
  papers/                  # Research references
  scripts/                 # Utility scripts
```

---

## Architecture

The full system design — including the `absmap` Python package layered structure, multi-crop pipeline, imagery provider protocol, learning loop persistence, KPI framework, and Cocopilot-FE integration path — is documented in:

**[absmap_architecture.md](absmap_architecture.md)**

---

## Module overview

### `absmap` — absolute map generation engine

The production-ready rewrite of the R&D pipeline. Key design decisions:

- **Imagery-agnostic**: the `ImageryProvider` protocol accepts any source (Mapbox Static API, IGN WMTS, local GeoTIFF, …). The pipeline never knows which provider is used.
- **ML-agnostic**: `Segmenter` and `Detector` are Protocols — SegFormer and YOLO-OBB are concrete implementations, swappable without touching the pipeline.
- **Multi-crop**: the pipeline operates on one crop at a time (`ParkingSlotPipeline.run(request)`). The `MultiCropOrchestrator` in `absmap-api` coordinates N crops drawn by the operator.
- **Learning loop**: every pipeline run produces separate layers (raw segmentation mask, raw detections, post-processed output) stored per-crop for CV model improvement.

### `absmap-api` — FastAPI service

Thin HTTP wrapper over `absmap`. Manages job lifecycle, multi-crop orchestration, SSE progress streaming, and session persistence. The operator tool (`absmap-frontend`) talks exclusively to this API.

Key endpoints: `POST /jobs`, `GET /jobs/{id}`, `POST /jobs/{id}/reprocess`, `POST /jobs/{id}/straighten`, `POST /sessions/{id}/save`.

### `absmap-frontend` — operator tool

React + Vite web app for the full operator workflow:

1. Navigate the basemap — existing validated slots are displayed as a read-only overlay
2. Draw N crop rectangles over the parking zone while scrolling
3. Launch the pipeline → watch per-crop progress via SSE
4. Review detections on a dual synchronized map
5. Edit: Add (A), Delete (D), Bulk delete, Copy (C), Modify (M), Reprocess (R), Row Straighten
6. Tag difficulty (occlusion, shadow, weak markings, clutter)
7. Save — persists to Firestore and stores the full session trace for the learning loop

All map interaction goes through `IMapProvider` — the POC uses a tile-based renderer of choice; the Cocopilot-FE integration swaps in `GoogleMapsMapProvider` with zero business logic change.

### `absolutemap-gen` — R&D archive

The original research pipeline. Contains the SegFormer training scripts, the Flask viewer POC, experiments, and the engineering spec that drove the `absmap` rewrite. **Read only — nothing new imports from this package.**

See [`absolutemap-gen/README.md`](absolutemap-gen/README.md) for setup instructions if you need to run the original R&D code.

### `calib-gen` — camera bbox generation *(future)*

Given a camera image of a parking lot, produce the bounding boxes corresponding to each slot as seen by that camera. Will import `absmap.export.models.GeoSlot` as an upstream dependency.

### `pairing` — geo slot ↔ camera bbox matching *(future)*

The core of autocalib: match each `GeoSlot` from the absolute map with its corresponding camera bbox from `calib-gen`. Dependency chain: `absmap ← calib-gen ← pairing`.

---

## Learning loop

The system is built around a human-in-the-loop improvement cycle:

1. **Automated baseline** — pipeline produces raw segmentation + detection + post-processed output
2. **Human refinement** — operator edits via the absmap tool
3. **Structured capture** — full session trace stored: per-crop intermediate layers, timestamped edit events, object lineage, difficulty tags, global delta summary, operator time
4. **Offline CV improvement** — retrain SegFormer and YOLO-OBB on the captured signal, benchmark on historical corrected sessions, promote only if manual effort KPI improves

Primary KPI: **reduction of manual operator effort per session** (additions + deletions + modifications + reprocess calls + align calls).

---

## Development setup

Each module has its own `README.md` and `pyproject.toml` / `package.json`. Start from the module you are working on:

```bash
# Python packages (absmap, absmap-api, absolutemap-gen)
pyenv install 3.12.8          # once per machine
cd <module>/
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# Frontend (absmap-frontend)
cd absmap-frontend/
npm install
npm run dev
```

Required environment variables (set in `.env`, never commit):

| Variable | Used by | Description |
|---|---|---|
| `MAPBOX_TOKEN` | `absmap-api` | Mapbox Static API token (if using Mapbox imagery provider) |
| `IGN_API_KEY` | `absmap-api` | IGN WMTS key (if using IGN imagery provider) |
| `FIREBASE_CREDENTIALS` | `absmap-api` | Path to Firebase service account JSON |

---

## Status

| Module | Status |
|---|---|
| `absmap` | In development |
| `absmap-api` | In development |
| `absmap-frontend` | In development |
| `absolutemap-gen` | R&D archive (read-only) |
| `calib-gen` | Future |
| `pairing` | Future |
