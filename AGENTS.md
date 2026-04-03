# Autocalib — Agent Instructions

## Project overview

Monorepo for automated parking slot mapping. Three packages (two new, one archive):

- `autoabsmap/` — Clean Python package. **Foundation layers** (config, io, imagery, ml, export) provide shared infrastructure. **Service engines** are first-level modules mapping to named project blocks:
  - `generator_engine/` — Core AI pipeline (Block 3: detection + segmentation + geometric postprocessing)
  - `reprocessing_helper/` — Auto-fill missed areas from reference slot + scope (Block 6)
  - `alignment_tool/` — RowStraightener "mise au carré" (Block 7)
  - `learning_loop/` — Session capture + dataset builder + model benchmark (Block 4)
- `autoabsmap-api/` — FastAPI service. Thin wrapper: routes map 1:1 to service engines. Job lifecycle, SSE streaming, multi-crop orchestration. No ML logic here.
- `autoabsmap-frontend/` — React + Vite + Redux Toolkit + Mapbox GL JS (POC). Feature modules are map-renderer agnostic via `IMapProvider`.
- `absolutemap-gen/` — R&D archive. Read-only reference. **Never import from this in new code.** Kept runnable as shadow pipeline during the rewrite for parity testing.

Architecture doc: `autoabsmap_architecture.md` (source of truth for all design decisions).

## Code conventions

### Python (`autoabsmap/`, `autoabsmap-api/`)

- Python 3.11+, snake_case variables/functions, PascalCase classes, UPPER_CASE constants.
- Type hints on all public functions. Pydantic `BaseModel` for all data crossing layer boundaries.
- `logging.getLogger(__name__)` everywhere. Zero `print()` calls.
- Protocols for ML backends (`Segmenter`, `Detector`) and imagery (`ImageryProvider`). Pipeline is fully agnostic.
- `GeometrySettings` holds all tunable numbers with defaults extracted from R&D code.
- Docstrings on all public functions: explain *why*, not *how*.

### TypeScript (`autoabsmap-frontend/`)

- React 18 + TypeScript strict mode.
- Redux Toolkit for state. One slice: `autoabsmap-slice.ts`.
- Feature modules in `src/features/` — each self-contained folder.
- `IMapProvider` interface for all map interactions. POC: `MapboxGLMapProvider`. Integration: `GoogleMapsMapProvider`.

## Key architecture rules

- **CRS gates:** WGS84 at API boundaries only. Pipeline works in the raster's native metric CRS (EPSG:3857, 2154, etc.). Reprojection at two gates only: inbound (ImageryProvider) and outbound (export/geojson.py).
- **`GeoRasterSlice` carries its CRS:** `crs_epsg`, `affine`, `gsd_m` (computed from affine, not configured).
- **Multi-crop merge:** first-crop-wins, IoU > 0.5 threshold. No averaging.
- **Slot ID:** `autoabsmap` generates ephemeral UUIDs. Stable identity is owned by the save path (B2B/Firestore spatial matching).
- **Session retention:** heavy artifacts (`.npy`, GeoTIFF) on VM disk, purged monthly after retraining. Lightweight outputs kept long-term.
- **RowStraightener V1:** straight-line only (median angle + axis snap). Curved rows deferred to V2. Always returns proposals — operator confirms or cancels.
- **Service engine isolation:** each engine (`generator_engine`, `reprocessing_helper`, `alignment_tool`, `learning_loop`) has a single public entry point, its own `models.py`, and clear inputs/outputs. Foundation layers never import from engines.

## Do not

- Import anything from `absolutemap-gen/` in new code.
- Add `print()` statements — use `logging`.
- Create parallel GeoJSON schemas — single schema v1 in `export/geojson.py`.
- Hardcode imagery provider logic in the pipeline — inject via Protocol.
- Reproject mid-pipeline — only at the two CRS gates.
