# `autoabsmap-api` — HTTP service architecture

**Monorepo index:** [`../plan_architecture.md`](../plan_architecture.md)

**Engine details:** [`../autoabsmap/plan_architecture.md`](../autoabsmap/plan_architecture.md)

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

---

## Integration sequence (Absmap POC)

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
