# Absmap — Service-Oriented Modular Architecture

## Context & Constraints

- **Existing R&D pipeline** (`autocalib/absolutemap-gen/src/absolutemap_gen/`): kept as reference/archive. **Not imported by anything new.** A clean `autoabsmap` package replaces it.
- **New clean package** (`autocalib/autoabsmap/`): production-ready rewrite. **Foundation layers** (config, io, imagery, ml, export) provide shared infrastructure. **Service engines** (generator, reprocessing, alignment, learning loop) are first-level modules with clear inputs/outputs — each one maps directly to a named project block. This is what `autoabsmap-api` imports.
- **Cocopilot-FE** (`Cocopilot-FE/src`): React 18 + TS + Vite + Redux Toolkit + Google Maps. Existing `absoluteMapInternal` page (to be replaced).
- **B2B API** (`user-interface-data-system/backend-b2b`): FastAPI, `POST/GET/PUT /geography/slots` → Firestore → Cloud Functions duplicate to `on_street/slots_static` + `slots_dynamic`. No change needed.
- **Goal**: POC fast with **Mapbox GL JS** as the display renderer, then swap to Google Maps on Cocopilot-FE integration. **Zero business logic rewrite.** The `IMapProvider` interface is the only renderer contract.
- **Imagery for ML**: completely separate from the display map. The `ImageryProvider` protocol (Mapbox Static, IGN WMTS, GeoTIFF, …) fetches high-resolution rasters on job launch — never tied to map scrolling.

---

## Project Blocks Overview

The system decomposes into **7 named project blocks**. Each block is a distinct functional unit with defined inputs, outputs, and ownership. The 4 backend blocks appear as **first-level modules** inside `autoabsmap/`; the 3 frontend blocks are feature modules in the React app.

| # | Block | Difficulty | Nature | Backend module |
|---|---|---|---|---|
| 1 | **ROI Registrator** | 3/10 | Front / mapping | *(frontend only — API receives ROI polygons)* |
| 2 | **Bilateral Map Syncher** | 3/10 | Front / mapping | *(frontend only — `dual-map/` feature)* |
| 3 | **Autoabsmap Generator Engine** (High Brain) | 9/10 | AI engine | `autoabsmap/generator_engine/` |
| 4 | **Systematic Engine Retraining Loop** | 10/10 | Data + ML ops | `autoabsmap/learning_loop/` |
| 5 | **Abs Map Lightning Edition Module** | 6/10 | Mapping + UX | *(frontend `editing/` feature — API provides edit endpoints + EditEvent logging)* |
| 6 | **Absmap Generator Reprocessing Helper** | 7/10 | AI + front | `autoabsmap/reprocessing_helper/` |
| 7 | **Alignment "mise au carré" Automation Tool** | 7/10 | Maths / algo + front | `autoabsmap/alignment_tool/` |

---

## Architecture Diagram

```mermaid
flowchart TD
    subgraph poc [POC — autoabsmap-frontend + autoabsmap-api]
        UI_POC["Absmap FE (React + IMapProvider)"]
        API_POC["autoabsmap-api (FastAPI standalone)"]
        Orch["MultiCropOrchestrator"]
        Pkg["autoabsmap (clean Python package)"]
        UI_POC -->|"REST/SSE"| API_POC
        API_POC --> Orch
        Orch --> Pkg
    end

    subgraph integration [Cocopilot-FE integration]
        UI_INT["Absmap FE (same components, GoogleMapsProvider)"]
        B2B["backend-b2b (FastAPI)"]
        Firestore["Firestore geography/slots"]
        CF["Cloud Functions on_street sync"]
        UI_INT -->|"axios + JWT"| B2B
        B2B --> Firestore
        Firestore --> CF
    end

    API_POC -->|"PUT /geography/slots (same contract)"| B2B

    subgraph autoabsmap_pkg [autoabsmap package — foundation + service engines]

        subgraph foundation [Foundation — shared infrastructure]
            config["config/ settings"]
            io_layer["io/ GeoRasterSlice read/write"]
            imagery["imagery/ ImageryProvider protocol + impls"]
            ml["ml/ Segmenter + Detector protocols + impls"]
            export_layer["export/ GeoJSON single schema"]
            config --> io_layer
            config --> imagery
            config --> ml
        end

        subgraph engines [Service Engines — project blocks]
            gen["⭐ generator_engine/ Pipeline + GeometricEngine"]
            reproc["⭐ reprocessing_helper/ Auto-fill from ref slot + scope"]
            align["⭐ alignment_tool/ RowStraightener (two-anchor row strip)"]
            loop_eng["⭐ learning_loop/ Capture + dataset builder + benchmark"]
        end

        io_layer --> gen
        imagery --> gen
        ml --> gen
        gen --> export_layer
        gen --> reproc
        gen --> align
        gen --> loop_eng
        reproc --> loop_eng
        align --> loop_eng
    end

    Pkg --> autoabsmap_pkg
    RD["absolutemap-gen/src/absolutemap_gen/ (R&D archive — read only)"]
```

---

## Module Breakdown

---

### 0. `autoabsmap` — the clean Python package

**Location:** `autocalib/autoabsmap/`

This is the **central rewrite**. The R&D archive (`absolutemap-gen/src/absolutemap_gen/`) is kept as reference but nothing new imports it. All ML, geometry, and export logic lives here.

**Why a rewrite (key R&D blockers found):**

- `config.py`: two sources of truth for detection thresholds; default IGN radius is 128 m in code, 32 m in comments; checkpoint path hardcoded under `artifacts/`
- `pipeline.py`: `print()` logging throughout; duplicate `_pixel_geom_to_wgs84` vs `export_geojson` version; `result_on_mask` parameter is dead code; no structured error handling mid-run
- `geometric_engine.py`: ~8 magic numbers (angles, IoU fractions, step counts) not configurable; synthetic spots incorrectly skew occupancy stats
- `export_geojson.py`: two incompatible GeoJSON schemas (pipeline v2 vs snapped v1); `write_geojson_feature_collection` is non-atomic; `snap_validate` import fails if module absent
- `artifacts_io.py`: Git subprocess in library code; duplicate `write_rgb_geotiff` name conflicts with `mapbox_static.write_rgb_geotiff` (different signatures)
- `ign_ortho.py`: SSL `CERT_NONE` fallback; no HTTP retry/backoff
- `detection.py`: `assert` in library hot path; `result_on_mask` ignored

**Parity validation — R&D → autoabsmap rewrite:**

The rewrite is module-by-module, each validated against the R&D pipeline before moving on. A small golden-file suite (`tests/golden/`) captures R&D outputs on 5–10 representative GeoTIFFs before any rewrite begins.

| Order | Module | Parity check |
|---|---|---|
| 1 | `io/` (GeoTIFF read) | Byte-identical raster loads |
| 2 | `ml/segmentation` | Pixel-identical masks (same model, same input) |
| 3 | `ml/detection` | Identical YOLO outputs (same checkpoint) |
| 4 | `generator_engine/geometric_engine` | Golden-file comparison: slot count delta, matched-pair IoU, unmatched slots |
| 5 | `export/geojson` | Schema-identical GeoJSON output |
| 6 | `generator_engine/runner` | End-to-end golden-file match |

Golden-file structure:

```
tests/golden/
  case_001/
    input.tif                     # or a reference pointer (large files not in git)
    segmentation_mask.npy         # R&D SegFormer output
    detections_raw.json           # R&D YOLO-OBB before GeometricEngine
    detections_post.json          # R&D after GeometricEngine (the one that matters)
    export.geojson                # R&D final GeoJSON
    meta.json                     # model versions, config, slot count
  case_002/
    ...
```

The comparison harness flags any case where slot count changes >5 % or mean matched-pair IoU drops below threshold. This is parity testing (old code vs new code), not accuracy benchmarking — no ground truth needed.

`GeometrySettings` defaults are extracted from the R&D `geometric_engine.py` values before rewriting, so the clean code starts with identical behavior.

During the rewrite period, `absolutemap-gen` stays runnable as a shadow pipeline: if an operator reports odd results, re-run the same input through R&D and diff.

**Package structure — foundation + service engines:**

The package has two tiers. **Foundation layers** provide shared infrastructure (config, I/O, imagery, ML, export). **Service engines** are the named project blocks — each is a first-level module with clear inputs/outputs, designed as an isolable unit (think: "if I hosted this on a separate VM, what goes in, what comes out?").

Foundation layers only import from other foundation layers. Service engines import from foundation and (selectively) from each other. No circular dependencies.

```
autocalib/autoabsmap/
  __init__.py
  pyproject.toml

  # ═══ FOUNDATION — shared infrastructure ═══

  config/
    __init__.py
    settings.py              # Pydantic BaseSettings: SegFormer, YOLO, imagery, geometry, pipeline

  io/
    __init__.py
    geotiff.py               # GeoRasterSlice (pixels + crs_epsg + affine + gsd_m), read/crop
    atomic.py                # write_json_atomic, write_geotiff (single impl, no duplicates)

  imagery/
    __init__.py
    protocols.py             # ImageryProvider protocol (fetch_geotiff(roi) → GeoRasterSlice)
    mapbox.py                # MapboxImageryProvider — retry/backoff, clean token handling
    ign.py                   # IGNImageryProvider — no SSL workaround in prod
    geotiff_file.py          # GeoTiffFileProvider — local file, for offline testing / replay

  ml/
    __init__.py
    protocols.py             # Segmenter protocol, Detector protocol (injectable / testable)
    models.py                # SegmentationOutput, DetectionResult (Pydantic)
    segmentation.py          # SegFormerSegmenter implements Segmenter
    detection.py             # YoloObbDetector implements Detector

  export/
    __init__.py
    models.py                # GeoSlot (Pydantic) — WGS84 slot with provenance fields
    geojson.py               # single GeoJSON schema v1, atomic write

  # ═══ SERVICE ENGINES — project blocks, first-level ═══

  generator_engine/          # ★ Block 3 — Autoabsmap Generator Engine (High Brain)
    __init__.py
    models.py                # PipelineRequest, PipelineResult, StageProgress, PixelSlot, SlotSource
    runner.py                # ParkingSlotPipeline(imagery, segmenter, detector).run(request)
    stages.py                # pure functions: fetch_imagery, segment, detect, enrich
    geometric_engine.py      # GeometricEngine — row extension, gap fill, postprocessing
    postprocess.py           # mask morphology / polygon simplification

  reprocessing_helper/       # ★ Block 6 — Absmap Generator Reprocessing Helper
    __init__.py
    models.py                # ReprocessRequest(ref_slot, scope, mask), ReprocessResult
    reprocessor.py           # ReprocessingHelper.reprocess() → proposed slots

  alignment_tool/            # ★ Block 7 — Alignment "mise au carré" Automation Tool
    __init__.py
    straightener.py          # RowStraightener.straighten(anchor_a, anchor_b, all_slots) → corrected GeoSlot[]
                             # No engine-local models.py: slots are export.models.GeoSlot; POST body = StraightenRequest in autoabsmap-api

  learning_loop/             # ★ Block 4 — Systematic Engine Retraining Loop
    __init__.py
    models.py                # SessionTrace, DeltaSummary, DifficultyTag, EditEvent, RunMeta
    capture.py               # SessionStore.save(trace) — filesystem for POC, Firestore later
    dataset_builder.py       # Sessions → training-ready data (seg + det signals separated)
    benchmark.py             # Retest candidate models on historical corrected cases → KPI report
```

**Dependency graph between service engines:**

```
generator_engine  ←── reprocessing_helper   (reprocessor uses GeometricEngine for gap fill)
generator_engine  ←── alignment_tool        (straightener operates on slots produced by pipeline)
generator_engine  ←── learning_loop         (capture stores pipeline outputs as baseline)
reprocessing_helper ←── learning_loop       (capture logs reprocessing steps)
alignment_tool    ←── learning_loop         (capture logs alignment events)
```

Arrows mean "imports from". No engine imports from `learning_loop` — data flows in one direction toward capture.

**Key design rules:**

- Every module uses `logging.getLogger(__name__)` — zero `print()` calls
- All data crossing a module boundary is a **Pydantic model** (validated, serializable, documented)
- `Segmenter`, `Detector`, and `ImageryProvider` are **Protocols** — `ParkingSlotPipeline` is fully agnostic about imagery source, ML backends, and hardware
- **The pipeline has no concept of "Mapbox" or "IGN"**: the concrete `ImageryProvider` is injected at construction — `ParkingSlotPipeline(imagery=provider, segmenter=..., detector=...)`. Adding a new imagery source requires zero pipeline changes
- `GeometrySettings` exposes all tunable numbers: `angle_tolerance_deg`, `dt_threshold_fraction`, `iou_dedup_threshold`, `max_gap_fill_steps`, etc.
- A single `GeoJSON schema v1` in `export/geojson.py` — no parallel schemas
- Each service engine has a **single public entry point**: `ParkingSlotPipeline.run()`, `ReprocessingHelper.reprocess()`, `RowStraightener.straighten()`, `SessionStore.save()`

**`PipelineRequest` / `PipelineResult` — single crop, pure unit (`generator_engine/models.py`):**

```python
# ParkingSlotPipeline operates on ONE crop at a time.
# It knows nothing about which imagery provider fetches the raster,
# and nothing about the other crops in the job.
class PipelineRequest(BaseModel):
    roi: GeoJSONPolygon           # one rectangle drawn by the user
    hints: HintMasks | None = None

class StageProgress(BaseModel):
    # autoabsmap package only knows about its own single crop run — no crop_index here.
    # The MultiCropOrchestrator in autoabsmap-api wraps this into an OrchestratorProgress
    # that adds crop_index / crop_total before forwarding to SSE.
    stage: str                    # e.g. "fetch_imagery", "segment", "detect"
    percent: int                  # 0–100 within this crop

class PipelineResult(BaseModel):
    slots: list[GeoSlot]
    baseline_slots: list[GeoSlot] # snapshot before GeometricEngine (for learning loop diff)
    seg_mask: np.ndarray | None   # retained for reprocessing_helper (per-crop mask)
    run_meta: RunMeta             # model versions, roi, gsd_m — no source coupling
```

**`JobRequest` / `JobResult` — multi-crop, owned by `autoabsmap-api`:**

```python
# These models live in autoabsmap-api, not in the autoabsmap package.
# The API layer is responsible for orchestrating N crops and merging results.
class CropRequest(BaseModel):
    roi: GeoJSONPolygon
    hints: HintMasks | None = None

class JobRequest(BaseModel):
    crops: list[CropRequest]      # N rectangles drawn by the user while scrolling

class OrchestratorProgress(BaseModel):
    # autoabsmap-api wrapper — adds crop context around the pure StageProgress from autoabsmap
    crop_index: int               # which crop is currently running (0-based)
    crop_total: int               # total number of crops in this job
    stage: str                    # forwarded from StageProgress
    percent: int                  # forwarded from StageProgress

class JobResult(BaseModel):
    job_id: str
    slots: list[GeoSlot]          # merged + deduplicated across all crops
    baseline_slots: list[GeoSlot]
    crop_results: list[PipelineResult]  # per-crop detail (for debugging / learning loop)
```

**How imagery selection and multi-crop orchestration work in the service layer:**

```python
# autoabsmap-api / services / pipeline_service.py

# The ImageryProvider is injected — the pipeline never knows which source is used.
# Provider choice is a config/environment decision, not an architecture decision.
provider = build_imagery_provider(settings)  # returns MapboxImageryProvider, IGNImageryProvider,
                                             # GeoTiffFileProvider, etc. — all implement the same Protocol

pipeline = ParkingSlotPipeline(
    imagery=provider,
    segmenter=SegFormerSegmenter(settings.segformer),
    detector=YoloObbDetector(settings.yolo),
)

# MultiCropOrchestrator loops over crops, streams progress, then merges
orchestrator = MultiCropOrchestrator(pipeline)
job_result = await orchestrator.run(job_request, on_progress=emit_sse)
```

---

### 0b. `alignment_tool/` — RowStraightener algorithm (Block 7)

**Location:** `autoabsmap/alignment_tool/straightener.py`

**V1 model — two anchors on a straight segment:** the operator picks **any two slots on the same row** (not necessarily the row ends). The **row axis** is the directed line through their **centroids** in a local metric frame (WGS84 inputs are converted with a cos(lat) scale so “distance” and corridors are approximate metres near the anchors).

**Trigger:** second anchor chosen → `RowStraightener.straighten(anchor_slot_id_a, anchor_slot_id_b, all_slots)` → returns a corrected `list[GeoSlot]` for every slot accepted into that row strip (or `[]` if the call is invalid / no row members).

**Tuning** (`AlignmentSettings` in `config/settings.py`, env prefix `ALIGN_`):
- `corridor_width_factor` — half-width of the perpendicular **corridor** = factor × `max(width_anchor_a, width_anchor_b)` in local metres.
- `angle_tolerance_deg` — max angle mismatch between a candidate slot’s OBB axis and the row axis, accepting **either** principal direction (**modulo 90°**) so short/long edge ambiguity from detection does not drop valid slots.

**Step 1 — Local geometry per slot**
For each slot, project centroid and polygon into local (x, y) metres; derive OBB width, height, and principal angle (wrapped to (−π/2, π/2]).

**Step 2 — Row axis and collection**
- `row_angle = atan2(B − A)` from the two anchor centroids (after rejecting identical ids, missing anchors, or anchors closer than ~5 cm).
- **Segment window:** project centroids onto the axis through the **midpoint of A and B**. Keep slots whose along-axis coordinate lies between the anchors **plus padding** `max(0.5× average_anchor_width, 0.12× |AB|)` (handles pitch jitter and slight mis-clicks).
- **Corridor band:** perpendicular distance from that midpoint axis ≤ corridor half-width.
- **Angle gate:** `_slot_axis_aligns_with_row` — slot angle matches `row_angle` or `row_angle ± 90°` within `angle_tolerance_deg`.
- **Anchors always included** even if their own OBB angles disagree slightly with AB (they are forced into the member set before scanning `all_slots`).

**Step 3 — Correction (straight line, no spacing smoothing)**
- Single shared orientation: everyone gets `row_angle`.
- Each centroid is **projected onto** the row line through the **mean centroid** of row members (removes lateral wobble along that line).
- **Width/height** are preserved in the sense of footprint size: if the stored OBB matched the row via the **orthogonal** direction (common with quad ordering), **w and h are swapped** before rebuild so the long side stays along the row.

**Not in V1:** global “straighten whole map”; segmentation-mask-boundary stop (only slot list is available); **curved rows as one fit** — a curved row still needs several straighten passes on sub-segments or manual edits (same product stance as before).

**Edge cases**

| Case | Behavior |
|---|---|
| Same anchor twice / anchor not in `all_slots` | Empty list; logged. |
| Anchors extremely close | Empty list. |
| Fewer than two slots after collection | Empty list (no partial apply). |
| Inclined / worldwide scene | Local metric uses ref at midpoint of anchors; adequate for parking-lot scale. |
| T-junction / wrong second anchor | Narrow corridor + segment window usually limit picks; operator picks another second anchor or undoes (frontend: one `align` `EditEvent` per successful call). |

```python
class RowStraightener:
    def straighten(
        self,
        anchor_slot_id_a: str,
        anchor_slot_id_b: str,
        all_slots: list[GeoSlot],
    ) -> list[GeoSlot]:
        """
        Collect slots on the strip between two anchors; align to axis AB.
        Footprint area preserved; w/h may swap to align long side with row.
        """
```

The HTTP layer still returns **`proposed_slots`** (same JSON field name as other engines). The POC frontend applies them **immediately** on success and records a single **`align`** `EditEvent` in `editHistory` (undo/redo via **Z** / slice redo), with no map preview step.

---

### 0c. `reprocessing_helper/` — auto-fill from reference slot (Block 6)

**Location:** `autoabsmap/reprocessing_helper/`

When the Generator Engine misses an entire pocket (no detections), per-click manual Add is too slow. The Reprocessing Helper takes **one correct slot** (orientation, size, spacing) and a **scoped region**, then auto-fills the missed area using the segmentation mask and geometric row extension.

**Inputs/Outputs:**

```python
class ReprocessRequest(BaseModel):
    reference_slot: GeoSlot           # one slot placed by the operator (pattern)
    scope_polygon: GeoJSONPolygon     # round/lasso region delimiting where to fill
    existing_slots: list[GeoSlot]     # current slots in the area (avoid duplicates)
    seg_mask: np.ndarray | None       # segmentation mask from the pipeline run (if retained)

class ReprocessResult(BaseModel):
    proposed_slots: list[GeoSlot]     # new slots to add (source: 'auto_reprocess')
```

**Algorithm:**

1. **Extract geometry from reference slot** — orientation angle, width, length, and spacing (estimated from nearest existing neighbor if available).
2. **Clip the scope** — intersect the scope polygon with the segmentation mask (if available). This restricts auto-fill to driveable/parkable surface only.
3. **Row extension** — from the reference slot, walk in both directions along the estimated row axis (`GeometricEngine` — independent of the two-anchor `RowStraightener`). Place new slots at regular pitch intervals while inside the clipped scope.
4. **Gap fill** — if the scope contains adjacent rows (detected via perpendicular offset from the reference), extend into those rows too.
5. **Dedup** — discard any proposed slot with IoU > 0.5 against `existing_slots`.
6. **Return proposals** — the operator reviews (confirm all / cherry-pick / cancel).

The Reprocessing Helper **composes** the `GeometricEngine` from `generator_engine/` — it does not duplicate row-extension logic. It adds the scope-clipping and reference-slot-guided entry point on top.

---

### 1. `autoabsmap-api` — FastAPI standalone service

**Location:** `autocalib/autoabsmap-api/`

Thin HTTP wrapper over `autoabsmap` service engines. **No ML logic lives here** — it only manages job lifecycle, SSE streaming, and routes each request to the right engine.

**Endpoints — mapped to service engines:**

| Endpoint | Verb | Service engine | Description |
|---|---|---|---|
| `/api/v1/jobs` | POST | `generator_engine` | Submit `crops: [{roi, hints?}, ...]` → returns `job_id` |
| `/api/v1/jobs/{job_id}` | GET | `generator_engine` | Poll status: `pending \| running \| done \| failed` |
| `/api/v1/jobs/{job_id}/result` | GET | `generator_engine` | Merged GeoJSON FeatureCollection + per-crop detail |
| `/api/v1/jobs/{job_id}/reprocess` | POST | `reprocessing_helper` | Reference slot + scope polygon → proposed slots |
| `/api/v1/jobs/{job_id}/straighten` | POST | `alignment_tool` | `slot_id_a`, `slot_id_b` (same row segment) → `proposed_slots[]` (corrected geometries for that strip) |
| `/api/v1/sessions/{session_id}/save` | POST | `learning_loop` | Final slots + edit trace + difficulty tags → capture + forward to B2B |

**Key data contracts (TypeScript — shared across POC and Cocopilot-FE):**

```typescript
// The frontend sends N crops (rectangles drawn while scrolling the parking lot).
// No imagery_source: the API service decides which provider to use from its own config.
interface CropRequest {
  polygon: GeoJSON.Polygon;           // one rectangle drawn by the user
  hints?: { class_a?: GeoJSON.Polygon; class_b?: GeoJSON.Polygon };
}

interface JobRequest {
  crops: CropRequest[];               // N rectangles — one per scroll zone
}

interface Slot {
  slot_id: string;
  center: [number, number];           // [lng, lat]
  polygon: GeoJSON.Polygon;           // OBB corners
  source: 'yolo' | 'row_extension' | 'gap_fill' | 'mask_recovery' | 'manual' | 'auto_reprocess';
  confidence: number;
  status: 'empty' | 'occupied' | 'unknown';
}

interface EditEvent {
  type: 'add' | 'delete' | 'modify' | 'reprocess' | 'align';
  timestamp: number;
  slot_ids: string[];
  before: Slot[];
  after: Slot[];
}

interface PipelineJob {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  // OrchestratorProgress — assembled by autoabsmap-api, not by the autoabsmap package
  progress?: {
    crop_index: number;   // which crop is currently running (0-based), added by orchestrator
    crop_total: number;   // total crops in this job, added by orchestrator
    stage: string;        // forwarded from autoabsmap StageProgress
    percent: number;      // forwarded from autoabsmap StageProgress
  };
}
```

**File structure:**

```
autoabsmap-api/
  app/
    main.py
    routes/
      jobs.py                   # POST/GET /jobs — generator_engine orchestration
      reprocess.py              # POST /jobs/{id}/reprocess — reprocessing_helper
      straighten.py             # POST /jobs/{id}/straighten — alignment_tool
      sessions.py               # POST /sessions/{id}/save — learning_loop capture
    services/
      pipeline_service.py       # builds ImageryProvider + ParkingSlotPipeline from config
      orchestrator.py           # MultiCropOrchestrator: loop crops → merge → deduplicate (see merge rule below)
      job_store.py              # in-memory dict for POC (swappable to Redis/Firestore)
      imagery_factory.py        # build_imagery_provider(settings) — returns correct impl
  requirements.txt
  Dockerfile
```

Each route file is a thin adapter: deserialize request → call the corresponding `autoabsmap` service engine → serialize response. No business logic in the API layer.

**Merge rule (rare case — overlapping crops):**

In practice crops rarely overlap: the operator draws adjacent rectangles while scrolling. But when two crops do overlap, the orchestrator must not produce duplicate slots. The rule is simple:

1. Process crops in draw order (first drawn = first processed).
2. After each crop, add its slots to a running result list.
3. Before adding a slot from crop N, check IoU against all existing slots in the result list. If IoU > `merge_iou_threshold` (default 0.5) with any existing slot, **keep the existing one and discard the new one** (first-crop-wins).
4. No averaging, no confidence tie-break — the operator will correct anything wrong in the editing phase anyway.

This keeps the logic trivial and predictable. Edge-case slots at crop boundaries may be slightly mispositioned; the operator sees them and nudges if needed.

> Models (ROI, Slot, EditEvent, PipelineJob) are imported directly from `autoabsmap` service engine models — no duplication.

---

### 1b. Imagery strategy — two separate systems

There are two image systems in play. They are **completely independent**:

| | Display map | ML raster |
|---|---|---|
| **What** | Background tiles for the user to navigate | High-res aerial image fed to the pipeline |
| **Who fetches** | Map renderer (browser, natively) | `ImageryProvider` (server-side, on job launch) |
| **When** | Continuously as the user scrolls/pans | Once per crop, when the user launches the job |
| **Format** | XYZ/WMTS tiles (PNG) | GeoTIFF in memory (`GeoRasterSlice`) |
| **Agnosticism** | `IMapProvider` interface | `ImageryProvider` Protocol |

The `ImageryProvider` protocol in `autoabsmap/imagery/protocols.py`:

```python
class ImageryProvider(Protocol):
    def fetch_geotiff(self, roi: GeoJSONPolygon, target_gsd_m: float) -> GeoRasterSlice:
        """
        Fetch a high-resolution raster for the given ROI.
        - roi is in WGS84 (EPSG:4326).
        - The provider reprojects to its native metric CRS internally.
        - Concrete implementations may subdivide the ROI into tiles and stitch them —
          the pipeline always receives a single GeoRasterSlice.
        - target_gsd_m is a hint (e.g. 0.15 for Mapbox, 0.20 for IGN);
          actual GSD is in the returned GeoRasterSlice.gsd_m.
        """
        ...
```

Concrete providers (all implementing the same protocol, all injectible):

```
autoabsmap/imagery/
  protocols.py           # ImageryProvider Protocol
  mapbox.py              # MapboxImageryProvider — Static API, tiles → mosaic if ROI large
  ign.py                 # IGNImageryProvider    — WMTS tiles, no SSL workaround in prod
  geotiff_file.py        # GeoTiffFileProvider   — local file, for offline testing / replay
```

**Adding a new provider** (Google Aerial, S3 bucket, …) requires zero changes to the pipeline or the API orchestrator — only a new file in `autoabsmap/imagery/` and a line in `imagery_factory.py`.

---

### 1c. CRS convention and pixel ↔ world alignment

Three coordinate systems coexist at runtime. Each has a clear role; the boundaries between them must be enforced, not assumed.

| Layer | CRS | Why |
|---|---|---|
| **Frontend / API contracts** | WGS84 (EPSG:4326, degrees) | GeoJSON standard, map renderers expect it |
| **ML raster (internal)** | Metric projection — provider-native (Web Mercator EPSG:3857 for Mapbox, Lambert-93 EPSG:2154 for IGN, UTM zone for others) | `gsd_m` only makes sense in a metric CRS; keeps pixel ↔ metre relationship exact |
| **Pipeline geometry** | Same metric CRS as the raster | Segmentation masks, OBB pixel coords, and GeometricEngine all operate in pixel space derived from the raster's affine transform |

**Rules:**

1. **`GeoRasterSlice` carries its CRS explicitly.** The model stores the EPSG code and the affine transform (origin, pixel size, rotation). No implicit assumption.
2. **Reprojection happens at two well-defined gates:**
   - **Inbound:** the `ImageryProvider` receives the ROI in WGS84, reprojects it to its native CRS internally, fetches tiles, and returns a `GeoRasterSlice` in the provider's metric CRS.
   - **Outbound:** `export/geojson.py` converts pixel-space OBBs → WGS84 `GeoSlot` using the raster's affine + CRS→WGS84 transform. This is the **only** place where metric → WGS84 conversion happens for slot geometry.
3. **The pipeline never reprojects mid-run.** Between fetch and export, everything stays in pixel / metric space. No intermediate WGS84 round-trip (which would introduce floating-point drift).
4. **`gsd_m` is a target, not a guarantee.** The actual GSD comes from the returned raster's affine transform. The pipeline reads it from `GeoRasterSlice.gsd_m` (computed, not configured) so that downstream geometry is always consistent with the real pixel size.

**Updated `GeoRasterSlice` (in `autoabsmap/io/geotiff.py`):**

```python
class GeoRasterSlice(BaseModel):
    pixels: np.ndarray                  # H × W × C (RGB or RGBA)
    crs_epsg: int                       # e.g. 3857, 2154, 32631
    affine: Affine                      # rasterio-style affine (origin + pixel size)
    bounds_native: BBox                 # bounding box in native CRS (metres)
    bounds_wgs84: BBox                  # bounding box in WGS84 (for API / display)
    gsd_m: float                        # actual ground sample distance (from affine, not from config)
```

**Updated `ImageryProvider` protocol:**

```python
class ImageryProvider(Protocol):
    def fetch_geotiff(self, roi: GeoJSONPolygon, target_gsd_m: float) -> GeoRasterSlice:
        """
        Fetch a high-resolution raster for the given ROI.
        - roi is in WGS84 (EPSG:4326).
        - The provider reprojects to its native metric CRS internally.
        - Returns a GeoRasterSlice whose crs_epsg and affine are authoritative.
        - target_gsd_m is a hint; actual GSD is in the returned slice.
        """
        ...
```

This guarantees that the display map (WGS84 tiles in the browser), the ML raster (metric pixels on the server), and the exported OBBs (WGS84 GeoJSON) stay aligned — with no silent drift from uncontrolled reprojection.

---

### 2. `autoabsmap-frontend` — React + Vite (POC, Mapbox GL JS)

**Location:** `autocalib/autoabsmap-frontend/`

**Key architectural decision:** All feature modules are **map-renderer agnostic**. They communicate with the map through an `IMapProvider` interface. POC uses **Mapbox GL JS** (`react-map-gl` + `mapbox-gl-draw`); integration swaps to `GoogleMapsMapProvider` — **zero business logic rewrite**. The app is called **autoabsmap** in the UI.

**ML imagery** is fetched by the `ImageryProvider` (server-side) only when the user launches a job — completely independent of map scrolling.

---

#### 2a. Cocoparks branding

The POC follows the **Cocoparks design system** from Cocopilot-FE to ensure visual consistency at integration time.

| Token | Value | Notes |
|---|---|---|
| **Primary** | `#967adc` | Cocoparks purple |
| **Secondary** | `#55595c` | Gray |
| **Success** | `#37bc9b` | |
| **Info** | `#3bafda` | |
| **Warning** | `#f6bb42` | |
| **Danger** | `#da4453` | |
| **Font primary** | **Open Sans** | Body text |
| **Font secondary** | **Muli** | UI / monospace elements |
| **Logo** | `logo-small.png` (navbar), `coco-logo.png` (splash/login) | From `Cocopilot-FE/src/assets/logos/` |

Slot-layer colors reuse the `SLOT_COLORS` palette from `Cocopilot-FE/src/utils/constants/colors.ts` (purple track family: `#522ead`, `#bcaae9`).

---

#### 2b. UI layout & flow — single map → dual map toggle

The app has **two layout modes**. The operator switches between them with a **"Dual Map" toggle button** in the toolbar.

**Mode 1 — Single full-page map (default on load)**

The map takes the entire viewport. This is the working mode for:
- Viewing existing slots (muted overlay from Firestore)
- ROI registration (drawing N crop rectangles while scrolling)
- Optional hint drawing (freehand class A/B)
- Launching the pipeline (progress bar overlay / side panel)

The dual-map toggle button is visible but inactive until results exist.

**Mode 2 — Dual synchronized map (toggle on)**

Activated by clicking the **"Dual Map"** button (enabled once `slots.length > 0`). The viewport splits 50/50:
- **Left**: clean basemap (no detections — visual reference)
- **Right**: basemap + detected OBBs / centroids
- **Synchronized** pan and zoom on both panels

All editing tools (Add, Delete, Bulk Delete, Copy, Modify, Reprocess, Row Straighten) operate on the right map. The left map is read-only reference.

Clicking the toggle again collapses back to single map (right map becomes full-page with all layers visible). The operator can switch freely at any time during the editing phase.

**Layout component hierarchy:**

```
<AppShell>                         ← navbar (Cocoparks logo + app name) + toolbar
  <MapLayout dualMap={dualMapActive}>
    {dualMapActive
      ? <DualMapLayout>            ← 50/50 split, synced pan/zoom
          <MapPanel side="left" />   ← clean basemap
          <MapPanel side="right" />  ← basemap + slot layers + edit tools
        </DualMapLayout>
      : <SingleMapLayout>          ← full-page map with all layers
          <MapPanel />
        </SingleMapLayout>
    }
  </MapLayout>
  <Toolbar />                      ← ROI draw, hints, pipeline trigger, dual-map toggle, editing tools
</AppShell>
```

---

#### 2c. `IMapProvider` interface

```typescript
// src/map/MapProvider.interface.ts
interface IMapProvider {
  syncWith(other: IMapProvider): void;
  addSlotLayer(slots: Slot[], opts: SlotLayerOptions): LayerHandle;
  updateSlotLayer(handle: LayerHandle, slots: Slot[]): void;
  removeLayer(handle: LayerHandle): void;
  enableMultiRectDraw(): Promise<GeoJSON.Polygon[]>;
  enableLassoDraw(): Promise<GeoJSON.Polygon>;
  enableFreehandDraw(hintClass: 'A' | 'B'): Promise<GeoJSON.Polygon>;
  fitBounds(bounds: BBox): void;
}
// POC:         MapboxGLMapProvider implements IMapProvider (react-map-gl + mapbox-gl-draw)
// Integration: GoogleMapsMapProvider implements IMapProvider
```

---

#### 2d. Feature modules (each is a self-contained folder)

| Module | Responsibility | Key components |
|---|---|---|
| `layout/` | App shell, single/dual map toggle, toolbar container | `AppShell`, `MapLayout`, `DualMapToggle` |
| `crops/` | Draw N rectangles while scrolling, manage crop list | `CropDrawer`, `CropList`, `CropPanel` |
| `hints/` | Freehand mask hints (class A/B) per crop | `HintLayer`, `HintToolbar` |
| `pipeline/` | Trigger multi-crop job, stream per-crop progress | `PipelineTrigger`, `JobStatus` |
| `dual-map/` | Two synchronized maps (display renderer agnostic) | `DualMapLayout`, `SyncController` |
| `slot-layer/` | Render OBBs + centroids on map | `SlotLayer`, `SlotTooltip` |
| `editing/` | Add/Delete/BulkDelete/Copy/Modify | `EditingToolbox`, `BulkSelector` (lasso) |
| `reprocessing/` | Reference slot + scope → auto-fill | `ReprocessPanel`, `ScopeDrawer` |
| `row-straightener/` (hook + map/sidebar wiring) | Straighten mode: first centroid = anchor A, second = anchor B → POST straighten; apply + `align` event immediately | `useStraightenSlot`, `CropPanel`, `MapPanel` |
| `session/` | Edit history (undo/redo), dirty flag | `useEditHistory` hook |
| `save/` | Difficulty tags + final save | `SavePanel`, `DifficultyPicker` |

---

#### 2e. Redux slice — `autoabsmap-slice.ts`

```typescript
interface AbsmapState {
  // --- layout ---
  dualMapActive: boolean;       // toggled by DualMapToggle button
  // --- ROI + pipeline ---
  crops: CropRequest[];         // N rectangles drawn by the user (grows as user draws)
  job: PipelineJob | null;      // current job (multi-crop)
  // --- slots ---
  existingSlots: Slot[];        // loaded on mount — read-only reference overlay
  slots: Slot[];                // merged result across all crops (editable)
  baselineSlots: Slot[];        // immutable snapshot for diff (learning loop)
  // --- editing ---
  selection: string[];          // selected slot_ids
  editHistory: EditEvent[];     // full trace for learning loop
  editIndex: number;            // pointer for undo/redo
  isDirty: boolean;
}
```

**Toggle logic:** `toggleDualMap` action flips `dualMapActive`. The button is enabled only when `slots.length > 0` (results exist). On first result load, the UI can auto-activate dual map (configurable).

---

#### 2f. File structure

```
autoabsmap-frontend/
  src/
    map/
      MapProvider.interface.ts
      MapboxGLMapProvider.ts     # POC: Mapbox GL JS via react-map-gl + mapbox-gl-draw
      GoogleMapsMapProvider.ts   # ready for Cocopilot-FE integration
    features/
      layout/                    # app shell, single/dual toggle, toolbar
      crops/
      hints/
      pipeline/
      dual-map/
      slot-layer/
      editing/
      reprocessing/
      row-straightener/
      session/
      save/
    store/
      autoabsmap-slice.ts
      store.ts
    api/
      autoabsmap-api.ts             # typed axios client for autoabsmap-api
    theme/
      tokens.ts                     # Cocoparks colors, fonts, spacing
    App.tsx
  package.json
  vite.config.ts
```

---

### 2b. Existing slots display — step 1 of the user journey

The engineering doc is explicit: **"already-mapped areas stay visible so they are not reworked by mistake."**

When the operator loads the tool, existing validated slots from Firestore must be rendered on the map immediately — before any crop is drawn. This is a read-only overlay, not part of the current editing session.

**Data flow on load:**

```
App mount
  → GET /geography/slots?bbox={viewport_bbox}   (B2B API or autoabsmap-api proxy)
  → [GeoSlot[]] existing slots from Firestore
  → dispatch(setExistingSlots(slots))
  → IMapProvider.addSlotLayer(slots, { style: 'existing', interactive: false })
```

This adds `existingSlots: Slot[]` to the Redux slice (read-only, never part of `editHistory`):

```typescript
interface AbsmapState {
  existingSlots: Slot[];      // loaded on mount — read-only reference overlay
  crops: CropRequest[];
  job: PipelineJob | null;
  slots: Slot[];              // current session result
  // …
}
```

The display layer for existing slots uses a visually distinct style (muted color, no edit handles) so the operator can clearly differentiate them from the current session's detections.

**Contract notes:**
- The `GET /geography/slots` endpoint must match the real B2B contract (JWT auth, pagination via `?limit=` + `?offset=` or cursor, max features per response).
- **Overlap rule on save:** existing slots that fall inside a session's crop ROIs are **replaced** by the session's final slots (the operator has reviewed that zone). Slots outside the crop ROIs are untouched. This avoids duplicates without requiring global dedup.

---

### 3. Cocopilot-FE integration (later phase)

- **Replace** `src/pages/absoluteMapInternal/` with `src/pages/autoabsmap/`
- Copy `autoabsmap-frontend/src/features/` into `Cocopilot-FE/src/features/autoabsmap/`
- Instantiate `GoogleMapsMapProvider` instead of the POC renderer — all feature modules untouched
- Add `autoabsmap-slice` to the existing Redux store
- Add `autoabsmap-api.ts` to `src/api/`, pointing at the deployed `autoabsmap-api` service URL
- Keep the existing `PUT /geography/slots` save path through `backend-b2b` — no B2B changes needed

---

## Learning Loop — Block 4: `learning_loop/`

**Location:** `autoabsmap/learning_loop/`

The engineering doc is explicit: "None of the learning signal is throwaway UI state — it must land in stable storage tied to ROI, model versions, and operator session metadata."

The `learning_loop` service engine owns three responsibilities: **capture**, **dataset building**, and **benchmarking**. These map to the four steps of the loop:

1. **Automated baseline run** — `generator_engine` produces raw outputs (segmentation, detection, post-processing)
2. **Fast human refinement** — operator adds, deletes, modifies, reprocesses, aligns (Lightning Edition Module + Reprocessing Helper + Alignment Tool)
3. **Structured capture and persistence** — `learning_loop/capture.py` stores separate layers durably, not just the final diff
4. **Offline CV improvement + revalidation** — `learning_loop/dataset_builder.py` extracts training data; `learning_loop/benchmark.py` retests candidates before promotion

---

### Session storage layout

The session is stored per-job, with separate layers for each stage of the pipeline. This enables per-layer CV analysis (SegFormer signals vs YOLO-OBB signals are distinct).

**Retention policy:** session artifacts (masks, GeoTIFFs, `.npy`) are stored on the VM's local disk. After each monthly retraining cycle, processed sessions are purged. Only lightweight outputs (`final_output.geojson`, `edit_trace.ndjson`, `delta_summary.json`) are kept long-term for KPI tracking.

```
sessions/{session_id}/
  run_meta.json                       # model versions, crops rois, gsd_m, imagery_provider,
                                      # session_start_iso, session_end_iso (for operator time KPI)
  crops_geometry.geojson              # all N rectangles drawn by the user

  per_crop/{crop_index}/
    segmentation_mask.npy             # raw SegFormer output (binary mask)
    detection_raw.geojson             # YOLO-OBB raw detections before GeometricEngine
    post_processed.geojson            # GeometricEngine output (the actual baseline)

  baseline_merged.geojson             # merged + deduped across all crops (before any edit)
  edit_trace.ndjson                   # timestamped operator events (one JSON per line):
                                      #   {type, timestamp_ms, slot_ids, before[], after[]}
                                      #   type: add | delete | bulk_delete | modify | reprocess | align
  reprocessed_steps.ndjson           # one entry per reprocess call:
                                      #   {trigger_slot_id, scope_polygon, proposed[], accepted[]}
  final_output.geojson                # validated operator truth (bbox + centroid / dot)

  difficulty_tags.json                # operator assessment — fixed list:
                                      #   occlusion | shadow | weak_ground_markings |
                                      #   visual_clutter | other (free text)
  delta_summary.json                  # computed on save:
                                      #   {additions, deletions, geometric_corrections,
                                      #    reprocess_calls, align_calls, operator_time_sec}
```

**Object lineage** — every `GeoSlot.source` field uses a fixed taxonomy, critical for per-path error analysis:

| `source` value | Meaning |
|---|---|
| `yolo` | Direct YOLO-OBB detection |
| `row_extension` | GeometricEngine row fill |
| `gap_fill` | GeometricEngine gap fill |
| `mask_recovery` | Recovered from segmentation mask |
| `auto_reprocess` | Produced by the Reprocessing Helper |
| `manual` | Placed by the operator (Add tool) |

---

### Session Pydantic models (`autoabsmap/learning_loop/models.py`)

```python
class DifficultyTag(str, Enum):
    occlusion = "occlusion"
    shadow = "shadow"
    weak_ground_markings = "weak_ground_markings"
    visual_clutter = "visual_clutter"
    other = "other"

class DeltaSummary(BaseModel):
    additions: int
    deletions: int
    geometric_corrections: int
    reprocess_calls: int
    align_calls: int
    operator_time_sec: float          # session_end - session_start

class SessionTrace(BaseModel):
    session_id: str
    run_meta: RunMeta
    crops: list[GeoJSONPolygon]
    edit_events: list[EditEvent]      # full timestamped trace
    reprocessed_steps: list[ReprocessStep]
    final_slots: list[GeoSlot]
    difficulty_tags: list[DifficultyTag]
    other_difficulty_note: str | None
    delta: DeltaSummary
```

---

### CV improvement signals

The stored layers feed two separate CV improvement paths. They must be kept distinct — the learning signal for SegFormer is not the same as for YOLO-OBB.

#### SegFormer (segmentation)

| Signal | What it means |
|---|---|
| Manual additions in mask-excluded areas | False negative — segmentation missed this zone |
| Manual deletions in mask-included areas | False positive — segmentation over-covered |
| Difficulty tag `occlusion` / `shadow` | Hard-case curriculum for retraining |
| `final_output.geojson` geometry | Corrected mask targets (pseudo-mask) for retraining |

#### YOLO-OBB (detection)

| Signal | What it means |
|---|---|
| Manual additions (`source: manual`) | Missed detection (FN) |
| Manual deletions | False detection (FP) and hard negatives |
| Manual geometry edits (center/angle/size) | OBB regression correction targets |
| `source` attribution | Error localization by generation path (e.g. `row_extension` failing more than `yolo` → geometry bug, not model bug) |

---

### KPI framework

**Primary KPI — manual effort reduction** (the only promotion criterion that counts):

$$\text{effort} = \text{additions} + \text{deletions} + \text{geometric\_corrections} + \text{reprocess\_calls} + \text{align\_calls}$$

Lower is better. If a new model bundle does not reduce this number on the held-out set, it is not promoted.

**Secondary KPIs** (required for operational reporting, computed from `delta_summary.json`):

| KPI | Source field | Direction |
|---|---|---|
| Useful detection rate before editing | `1 - deletions / total_baseline_slots` | Higher is better |
| False positive rate | `deletions / total_baseline_slots` | Lower is better |
| False negative rate | `additions / total_final_slots` | Lower is better |
| Geometric correction rate | `geometric_corrections / total_final_slots` | Lower is better |
| Operator time per session | `operator_time_sec` | Lower is better |

---

### Model revalidation workflow (`learning_loop/benchmark.py`)

Before any model bundle is promoted to production, `benchmark.py` orchestrates:

1. **Retest on historical sessions** — run the candidate model on the same `crops_geometry` + `imagery_provider` conditions as past corrected sessions
2. **Compare outputs** against `baseline_merged.geojson` (old model) and `final_output.geojson` (operator truth)
3. **Compute KPI delta** — old model vs candidate on all secondary KPIs
4. **Publish benchmark report** — one report per candidate bundle with product + CV metrics

```python
class BenchmarkReport(BaseModel):
    candidate_bundle: str                # e.g. "segformer-v3 + yolo-v2.1"
    sessions_tested: int
    primary_kpi_delta: float             # negative = improvement (fewer manual actions)
    secondary_kpis: dict[str, float]     # KPI name → delta
    regression_flags: list[str]          # any KPI that got worse beyond threshold
    promoted: bool                       # go / no-go decision
```

**Promotion rule (go / no-go):**
- Promote only if the **primary KPI** (manual effort) shows a net reduction
- And **no secondary KPI** shows a major operational regression
- If not met: keep current production bundle, continue the loop

### Dataset builder (`learning_loop/dataset_builder.py`)

Transforms captured sessions into training-ready datasets. Separates SegFormer signals from YOLO-OBB signals because their learning paths are distinct.

```python
class DatasetBuilder:
    def build_segmentation_dataset(
        self, sessions: list[Path]
    ) -> SegmentationTrainingSet:
        """
        From sessions: extract seg masks, manual additions in mask-excluded
        areas (FN evidence), manual deletions in mask-included areas (FP evidence),
        difficulty tags for hard-case curriculum.
        """

    def build_detection_dataset(
        self, sessions: list[Path]
    ) -> DetectionTrainingSet:
        """
        From sessions: extract missed detections (manual adds → FN),
        false detections (manual deletes → FP + hard negatives),
        geometry corrections (center/angle/size edits → OBB regression targets),
        source attribution for error localization by generation path.
        """
```

---

## Monorepo layout (autocalib)

```
autocalib/
  autoabsmap/                   # NEW: clean Python package (the core engine)
  autoabsmap-api/               # NEW: FastAPI service (imports autoabsmap)
  autoabsmap-frontend/          # NEW: React POC (Mapbox GL JS)
  tests/golden/             # NEW: R&D golden outputs for parity validation (see section 0)
  absolutemap-gen/          # EXISTING: R&D archive — read-only reference (shadow pipeline during rewrite)
    src/absolutemap_gen/    #   original R&D code (not imported by new code)
    segformer/              #   SegFormer training scripts
    webapp/                 #   original Flask viewer
    docs/
    tests/
```

**Rule:** nothing outside `absolutemap-gen/` ever imports from `absolutemap_gen`. The R&D archive is a reference, not a dependency.

---

## Future modules — extensibility constraints

Two modules will follow autoabsmap in the autocalib system:

- **`calib-gen`** — generate calibration bboxes on camera images (given a camera view of a parking lot, produce the bboxes that correspond to each slot as seen by that camera)
- **`pairing`** — couple each detected absolute map slot (`GeoSlot`) with its corresponding camera bbox from calib-gen (the core of autocalib: matching geo space ↔ camera image space)

These are **not designed here**, but the current architecture must not block them. Three explicit constraints are baked in:

### 1. `slot_id` — minimal contract for the CV/AI layer

The `autoabsmap` package has one obligation: every `GeoSlot` it produces carries a `slot_id` (UUID v4), present in the GeoJSON export and every API response.

```python
class GeoSlot(BaseModel):
    slot_id: str              # UUID v4 — generated by the pipeline
    center: LngLat
    polygon: GeoJSONPolygon
    source: SlotSource
    confidence: float
    status: SlotStatus
```

That is the full responsibility of the CV/AI layer. `autoabsmap` generates **ephemeral** UUIDs — they change on every run.

**Stable identity contract (owned by the save path, not by `autoabsmap`):**

The B2B API / Firestore layer is responsible for **stable slot identity**. When the operator saves a session, the save path must:

1. **Match incoming slots to existing Firestore slots** by spatial proximity (centroid distance < threshold, e.g. 1 m) inside the session's crop ROIs.
2. **Reuse the Firestore `slot_id`** for matched slots. This stable key is what `calib-gen` and `pairing` will **read** downstream — they never generate IDs, only consume them.
3. **Assign a new Firestore `slot_id`** only for genuinely new slots (no spatial match).
4. **Delete Firestore slots** inside crop ROIs that have no match in the saved set (operator deleted them).

This logic lives entirely in `POST /sessions/{id}/save` → `PUT /geography/slots`. Zero changes to `autoabsmap` needed — it keeps producing ephemeral UUIDs, and the save path reconciles them into stable Firestore keys.

### 2. `autoabsmap` models are importable upstream — no circular deps

`calib-gen` and `pairing` will need to import `autoabsmap.export.models.GeoSlot` as a dependency. The dependency direction must stay:

```
autoabsmap  ←  calib-gen  ←  pairing
```

`autoabsmap` never imports from `calib-gen` or `pairing`. This is already enforced by the layered structure — `autoabsmap` has no knowledge of cameras or calibration.

### 3. Monorepo layout anticipates three siblings

```
autocalib/
  autoabsmap/           # geo slot generation (current)
  autoabsmap-api/       # HTTP service for autoabsmap
  autoabsmap-frontend/  # React POC for autoabsmap
  calib-gen/        # future: camera bbox generation
  pairing/          # future: geo slot ↔ camera bbox matching
  absolutemap-gen/  # R&D archive
```

Each future package will follow the same pattern: a clean Python package + a FastAPI service + frontend feature modules plugged into the same `IMapProvider` / Redux slice pattern. No structural changes to `autoabsmap` are needed to accommodate them.

---

## Integration sequence

```mermaid
sequenceDiagram
    participant Op as Operator
    participant FE as Absmap FE
    participant API as autoabsmap-api
    participant Orch as MultiCropOrchestrator
    participant Gen as generator_engine
    participant Img as ImageryProvider
    participant Reproc as reprocessing_helper
    participant Align as alignment_tool
    participant Loop as learning_loop
    participant B2B as backend-b2b

    Note over Op,B2B: Phase 1 — Pipeline run (generator_engine)
    Op->>FE: Scroll + draw rectangle 1..N + optional hints (A/B)
    Op->>FE: Launch job
    FE->>API: POST /jobs {crops: [roi1, roi2, ...roiN]}
    loop For each crop i of N
        API->>Orch: run_crop(crop_i)
        Orch->>Img: fetch_geotiff(roi_i)
        Note over Img: Provider agnostic — Mapbox / IGN / GeoTIFF / ...
        Img-->>Orch: GeoRasterSlice
        Orch->>Gen: ParkingSlotPipeline.run(crop_i_request)
        Gen-->>Orch: StageProgress {stage, percent}
        Note over Orch: Wraps into OrchestratorProgress (crop_index, crop_total)
        Orch-->>API: OrchestratorProgress
        API-->>FE: SSE progress
    end
    Orch->>Orch: merge_and_dedup(all_crop_results)
    API-->>FE: JobResult (merged slots + seg_masks retained)
    FE->>Op: Show dual-map with detections

    Note over Op,B2B: Phase 2 — Lightning Edition + Reprocessing + Alignment
    Op->>FE: Edit (add/delete/bulk_delete/copy/modify)
    Op->>FE: Reprocess missed pocket (ref slot + scope)
    FE->>API: POST /jobs/{id}/reprocess {ref_slot, scope, mask}
    API->>Reproc: ReprocessingHelper.reprocess()
    Reproc-->>API: proposed_slots
    API-->>FE: proposed_slots (operator confirms/cancels)
    Op->>FE: Straighten (two anchors on row)
    FE->>API: POST /jobs/{id}/straighten {slot_id_a, slot_id_b}
    API->>Align: RowStraightener.straighten(a, b, slots)
    Align-->>API: proposed_slots
    API-->>FE: proposed_slots (POC: applied immediately, undo Z)

    Note over Op,B2B: Phase 3 — Save (learning_loop capture)
    Op->>FE: Save + difficulty tags
    FE->>API: POST /sessions/{id}/save {slots, edit_trace, tags}
    API->>Loop: SessionStore.save(trace)
    API->>B2B: PUT /geography/slots
    B2B->>Firestore: Write slots
```
