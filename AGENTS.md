# Autocalib — Agent Instructions

## Environment setup

The **single shared virtual environment** for the entire monorepo lives at `.venv/` in the repo root.

```bash
# Create (first time only)
python3.11 -m venv .venv

# Activate
source .venv/bin/activate

# Install all deps (root + local packages in editable mode)
pip install -r requirements.txt
pip install -e ./calib-gen
pip install -e ./pairing   # once pyproject.toml is added
```

> The `.venv/` directory is git-ignored. Never commit it.

## Running the stack

```bash
./run.sh
```

`run.sh` does the following automatically:
1. Checks that `.venv/` exists and activates it.
2. Loads `.env` from the repo root (backend settings, API keys).
3. Kills any stale processes on ports `8000` and `5173`.
4. Starts the **FastAPI backend** (`uvicorn`) on `http://localhost:8000` with hot-reload.
5. Starts the **Vite frontend** on `http://localhost:5173`.

Press `Ctrl+C` to stop all services cleanly.

**Requirements:** `.venv/` must be created and populated before running (see above). A `.env` file at the root is optional but expected in production.

---

## Repo layout

```
autocalib/
  autoabsmap/              # Geo slot generation engine (Python package)
  autoabsmap-api/          # FastAPI service — thin HTTP wrapper
  autoabsmap-frontend/     # React + Vite operator POC
  calib-gen/               # Camera calib bbox generation (Python package)
  pairing/                 # Geo slot ↔ camera bbox matching
  tests/golden/            # Parity / golden outputs
  absolutemap-gen/         # R&D archive — read-only, never import in new code
  run.sh                   # Stack launcher (see above)
  requirements.txt         # Shared pip deps
  .venv/                   # Shared virtual env (git-ignored)
```

Per-package architecture specs: [`autoabsmap/plan_architecture.md`](autoabsmap/plan_architecture.md), [`autoabsmap-api/plan_architecture.md`](autoabsmap-api/plan_architecture.md), [`autoabsmap-frontend/plan_architecture.md`](autoabsmap-frontend/plan_architecture.md), [`calib-gen/plan_architecture.md`](calib-gen/plan_architecture.md), [`pairing/plan_architecture.md`](pairing/plan_architecture.md).

Product / UX specs: [`calib-gen/docs/calib_generator.md`](calib-gen/docs/calib_generator.md), [`pairing/docs/doc.md`](pairing/docs/doc.md).

## Dependency graph

```
autoabsmap  ←  calib_gen  ←  pairing
    ↓
autoabsmap-api
    ↓
autoabsmap-frontend
```

- **`autoabsmap`** — foundation + service engines. Never imports `calib_gen` or `pairing`.
- **`autoabsmap-api`** — thin HTTP wrapper over `autoabsmap` engines. No ML logic.
- **`autoabsmap-frontend`** — POC UI; talks only to `autoabsmap-api`.
- **`calib_gen`** — camera calib bboxes; no dependency on `autoabsmap` or `pairing`.
- **`pairing`** — may import `autoabsmap.export.models.GeoSlot`; consumes calib output from `calib_gen`.

## Package overview

### `autoabsmap/`
Clean Python package. **Foundation layers** (config, io, imagery, ml, export) provide shared infrastructure. **Service engines:**
- `generator_engine/` — Core AI pipeline (detection + segmentation + geometric postprocessing)
- `reprocessing_helper/` — Auto-fill missed areas from reference slot + scope
- `alignment_tool/` — RowStraightener "mise au carré"
- `learning_loop/` — Session capture + dataset builder + model benchmark

### `autoabsmap-api/`
FastAPI service. Routes map 1:1 to service engines. Handles job lifecycle, SSE streaming, multi-crop orchestration.

### `autoabsmap-frontend/`
React 18 + Vite + Redux Toolkit + Mapbox GL JS (POC). Feature modules are map-renderer agnostic via `IMapProvider`.

### `calib-gen/`
Camera calibration bbox generation. Core stack-align / shrink pipeline. No dependency on `autoabsmap` or `pairing`.

### `pairing/`
Geo slot ↔ camera bbox matching. R&D scripts in `pairing/pairing-rd/`.

---

## Code conventions

### Python

- Python 3.11+, `snake_case` variables/functions, `PascalCase` classes, `UPPER_CASE` constants.
- Type hints on all public functions. Pydantic `BaseModel` for all data crossing layer boundaries.
- `logging.getLogger(__name__)` everywhere. Zero `print()` calls.
- Protocols for ML backends (`Segmenter`, `Detector`) and imagery (`ImageryProvider`). Pipeline is fully agnostic.
- `GeometrySettings` holds all tunable numbers with defaults.
- Docstrings on all public functions: explain *why*, not *how*.

### TypeScript (`autoabsmap-frontend/`)

- React 18 + TypeScript strict mode.
- Redux Toolkit for state. One slice: `autoabsmap-slice.ts`.
- Feature modules in `src/features/` — each self-contained folder.
- `IMapProvider` interface for all map interactions.

---

## Key architecture rules

- **CRS gates:** WGS84 at API boundaries only. Pipeline works in the raster's native metric CRS. Reprojection at two gates only: inbound (`ImageryProvider`) and outbound (`export/geojson.py`).
- **`GeoRasterSlice` carries its CRS:** `crs_epsg`, `affine`, `gsd_m` (computed from affine, not configured).
- **Multi-crop merge:** first-crop-wins, IoU > 0.5 threshold. No averaging.
- **Slot ID:** `autoabsmap` generates ephemeral UUIDs per run. Stable identity is owned by the B2B/Firestore save path. `calib_gen` and `pairing` consume stable keys; they do not mint them.
- **Session retention:** heavy artifacts (`.npy`, GeoTIFF) on VM disk, purged monthly after retraining. Lightweight outputs kept long-term.
- **RowStraightener V1:** two anchors on one row segment; straight-line alignment. Curved rows deferred to V2.
- **Service engine isolation:** each engine has a single public entry point. Foundation layers never import from engines.
- **No circular dependencies:** `autoabsmap ← calib_gen ← pairing`. Each goes one way only.

## Do not

- Import anything from `absolutemap-gen/` in new code.
- Add `print()` statements — use `logging`.
- Create parallel GeoJSON schemas — single schema v1 in `export/geojson.py`.
- Hardcode imagery provider logic in the pipeline — inject via Protocol.
- Reproject mid-pipeline — only at the two CRS gates.
