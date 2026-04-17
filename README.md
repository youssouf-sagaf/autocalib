# autocalib

**autocalib** is the Cocoparks monorepo for the automatic calibration of parking lots. It covers the full pipeline from aerial satellite imagery to a production-ready absolute map of parking slots, and from camera images to per-slot bounding boxes — enabling the automated pairing of geographic slots with camera views.

The system is designed around three sequential capabilities:

1. **Absolute map generation** (`autoabsmap`) — detect and geolocate every parking slot in a zone using satellite/aerial imagery, YOLO-OBB detection, and SegFormer segmentation. Produces a GeoJSON absolute map of slot OBBs in WGS84.
2. **Calibration generation** (`calib_gen`) — given a camera image of a parking lot, generate the bounding boxes (bboxes) that correspond to each parking slot as seen by that camera.
3. **Pairing** (`pairing`) — couple each absolute map slot (`GeoSlot`) with its corresponding camera bbox, enabling fully automated camera calibration.

---

## Monorepo structure

```
autocalib/
  autoabsmap/                  # Clean Python package — absolute map generation engine
                           # Layered architecture: config → io → imagery → ml → geometry → export → pipeline → session
                           # [STATUS: in development]

  autoabsmap-api/              # FastAPI standalone service — HTTP wrapper over autoabsmap
                           # Multi-crop job orchestration, SSE progress streaming, session persistence
                           # [STATUS: in development]

  autoabsmap-frontend/         # React + Vite operator tool — draw crops, review detections, edit, save
                           # Map-renderer agnostic (IMapProvider interface), Redux state, learning loop
                           # [STATUS: in development]

  absolutemap-gen/         # R&D archive — original geo-AI pipeline (YOLO-OBB + SegFormer)
                           # Kept as reference. Not imported by any new code.
                           # [STATUS: read-only archive]

  calib_gen/               # Camera calib: docs/, calib_gen/ (package), calib_gen-rd/ (R&D)
                           # [STATUS: scaffold + spec]

  pairing/                 # Geo slot ↔ camera bbox matching (see pairing/docs/)
                           # [STATUS: R&D under pairing/pairing-rd/]

  models/                  # Shared ML model weights (YOLO, SegFormer checkpoints)
  papers/                  # Research references
  scripts/                 # Utility scripts
```

---

## Architecture

The full system design — including the `autoabsmap` Python package layered structure, multi-crop pipeline, imagery provider protocol, learning loop persistence, KPI framework, and Cocopilot-FE integration path — is documented in:

**[plan_architecture.md](plan_architecture.md)** (index) — per-module specs in each package’s `plan_architecture.md`

---

## Module overview

### `autoabsmap` — absolute map generation engine

The production-ready rewrite of the R&D pipeline. Key design decisions:

- **Imagery-agnostic**: the `ImageryProvider` protocol decouples the pipeline from the image source. The current implementation is `MapboxImageryProvider`; the pipeline never knows which provider is used.
- **ML-agnostic**: `Segmenter` and `Detector` are Protocols — SegFormer and YOLO-OBB are concrete implementations, swappable without touching the pipeline.
- **Multi-crop**: the pipeline operates on one crop at a time (`ParkingSlotPipeline.run(request)`). The `MultiCropOrchestrator` in `autoabsmap-api` coordinates N crops drawn by the operator.
- **Learning loop**: every pipeline run produces separate layers (raw segmentation mask, raw detections, post-processed output) stored per-crop for CV model improvement.

### `autoabsmap-api` — FastAPI service

Thin HTTP wrapper over `autoabsmap`. Manages job lifecycle, multi-crop orchestration, SSE progress streaming, and session persistence. The operator tool (`autoabsmap-frontend`) talks exclusively to this API.

Key endpoints: `POST /jobs`, `GET /jobs/{id}`, `POST /jobs/{id}/reprocess`, `POST /jobs/{id}/straighten`, `POST /sessions/{id}/save`.

### `autoabsmap-frontend` — operator tool

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

The original research pipeline. Contains the SegFormer training scripts, the Flask viewer POC, experiments, and the engineering spec that drove the `autoabsmap` rewrite. **Read only — nothing new imports from this package.**

See [`absolutemap-gen/README.md`](absolutemap-gen/README.md) for setup instructions if you need to run the original R&D code.

### `calib_gen` — camera bbox generation *(scaffold)*

Python package for calibration bbox generation (stack alignment, dedup, scope filter, empty-slot filler). Spec: [`calib_gen/docs/calib_generator.md`](calib_gen/docs/calib_generator.md). Does not import `autoabsmap` or `pairing`.

### `pairing` — geo slot ↔ camera bbox matching *(in progress)*

Match each `GeoSlot` from the absolute map with its corresponding camera bbox from `calib_gen`. Spec: [`pairing/docs/doc.md`](pairing/docs/doc.md). Dependency chain: `autoabsmap ← calib_gen ← pairing`. R&D prototypes live in `pairing/pairing-rd/`.

---

## Learning loop

The system is built around a human-in-the-loop improvement cycle:

1. **Automated baseline** — pipeline produces raw segmentation + detection + post-processed output
2. **Human refinement** — operator edits via the autoabsmap tool
3. **Structured capture** — full session trace stored: per-crop intermediate layers, timestamped edit events, object lineage, difficulty tags, global delta summary, operator time
4. **Offline CV improvement** — retrain SegFormer and YOLO-OBB on the captured signal, benchmark on historical corrected sessions, promote only if manual effort KPI improves

Primary KPI: **reduction of manual operator effort per session** (additions + deletions + modifications + reprocess calls + align calls).

---

## Development setup

Each module has its own `README.md` and `pyproject.toml` / `package.json`. Start from the module you are working on:

```bash
# Python packages (autoabsmap, autoabsmap-api, absolutemap-gen)
pyenv install 3.12.8          # once per machine
cd <module>/
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# Frontend (autoabsmap-frontend)
cd autoabsmap-frontend/
npm install
npm run dev
```

Required environment variables (set in `.env`, never commit):

| Variable | Used by | Description |
|---|---|---|
| `IMAGERY_MAPBOX_ACCESS_TOKEN` | `autoabsmap-api` | Mapbox Static API token |
| `FIREBASE_CREDENTIALS` | `autoabsmap-api` | Path to Firebase service account JSON |

---

## Status

| Module | Status |
|---|---|
| `autoabsmap` | In development |
| `autoabsmap-api` | In development |
| `autoabsmap-frontend` | In development |
| `absolutemap-gen` | R&D archive (read-only) |
| `calib_gen` | Scaffold + spec |
| `pairing` | Docs + R&D (`pairing-rd`) |
