# `autocalib-api` — HTTP operator service architecture

**Folder name:** `autocalib-api` (folder reflects the full autocalib operator stack).

**Engine details (absolute map):** [`../autoabsmap/plan_architecture.md`](../autoabsmap/plan_architecture.md)

**Calib generation:** [`../calib_gen/plan_architecture.md`](../calib_gen/plan_architecture.md)

**Pairing:** [`../pairing/plan_architecture.md`](../pairing/plan_architecture.md)

**Frontend:** [`../autocalib-frontend/plan_architecture.md`](../autocalib-frontend/plan_architecture.md)

---

## Role

`autocalib-api` is the **single FastAPI service** for the autocalib operator stack. Route handlers stay **thin**: deserialize → call the appropriate Python package (`autoabsmap`, later `calib_gen`, `pairing`) → serialize. **No ML logic** in the API layer.

**Why one service (v1):** one `run.sh` process, one `VITE_API_URL`, shared CORS and deployment. Split into a second HTTP service only if GPU workloads, image size, or team ownership force a separate container (see split criteria in monorepo `AGENTS.md` discussion).

---

## URL namespaces

| Prefix | Subsystem | Status |
|--------|-----------|--------|
| `/api/v1/jobs`, `/api/v1/clients/…` | Absolute map (`autoabsmap`) | **Implemented** |
| `/api/v1/calib/…` | Camera calib bbox (`calib_gen`) | **Implemented** |
| `/api/v1/pairings/…` | Slot ↔ calib bbox (`pairing`) | **Implemented** |
| `/api/v1/clients`, `/api/v1/logs` | Device directory / client logging | **Implemented** |

**Canonical paths:** Absolute map uses **`/api/v1/jobs`** and **`/api/v1/clients/{id}/slots/save`** (synchronous dirty B2B save). Legacy **`…/slots/sync`** returns **410 Gone**. **`calib_gen`** and **`pairing`** use their own prefixes under **`/api/v1/`**. There is no parallel **`/api/v1/absmap/…`** hierarchy and no redirect layer.

---

## Implemented endpoints — `autoabsmap`

| Endpoint | Verb | Service engine | Description |
|----------|------|------------------|-------------|
| `/api/v1/jobs` | POST | `generator_engine` | Submit `crops: [{roi, hints?}, ...]` → returns `job_id` |
| `/api/v1/jobs/{job_id}` | GET | `generator_engine` | Poll status: `pending \| running \| done \| failed` |
| `/api/v1/jobs/{job_id}/result` | GET | `generator_engine` | Merged GeoJSON FeatureCollection + per-crop detail |
| `/api/v1/jobs/{job_id}/reprocess` | POST | `reprocessing_helper` | Reference slot + scope polygon → proposed slots |
| `/api/v1/jobs/{job_id}/straighten` | POST | `alignment_tool` | `slot_id_a`, `slot_id_b` → `proposed_slots[]` |
| `/api/v1/clients/{client_id}/slots/save` | POST | `b2b_geography` | Synchronous dirty B2B save → `{ results, save_summary }`; learning-loop sidecar via `job_id` + `edit_events` |
| `/api/v1/clients/{client_id}/slots/sync` | POST | — | **410 Gone** — use `slots/save` |
| `/api/v1/clients/{client_id}/slots/sync/{sync_id}` | GET | — | **410 Gone** |
| `/api/v1/clients/{client_id}/reference-slots` | GET | `b2b_geography` | Prod overlay slots (client id or geo filter) |
| `/api/v1/clients` | GET | `b2b_clients` | Client roster (B2B + ops merge); `uid` scopes access |
| `/api/v1/clients/{client_id}/devices` | GET | `cocoparks_api_client` | Cocospots for ops city (`display_name` when id is Firestore) |

---

## Implemented endpoints — `calib_gen`

| Endpoint | Verb | Description |
|----------|------|-------------|
| `/api/v1/calib/jobs` | POST | Submit bbox calib job (device + client) → `job_id` |
| `/api/v1/calib/jobs/{id}` | GET | Poll status + progress (**debug only** — UI uses SSE `/stream`) |
| `/api/v1/calib/jobs/{id}/result` | GET | Calib bboxes + frame metadata when done |
| `/api/v1/calib/jobs/{id}/stream` | GET | SSE progress stream |
| `/api/v1/calib/jobs/{id}/frames/{frame_index}` | GET | Decoded frame image for the carousel |

Handlers import **`calib_gen`** for these routes.

---

## Future / optional — `calib_gen`

| Endpoint | Verb | Description |
|----------|------|-------------|
| `/api/v1/calib/dedup-center` | POST | Run center deduplication on current bboxes |
| `/api/v1/calib/synthetic/preview` | POST | Inpaint preview (optional stream) |

---

## Implemented endpoints — `pairing`

| Endpoint | Verb | Description |
|----------|------|-------------|
| `/api/v1/pairings/{device_id}` | POST | Persist links + zones (replaces prior set for device) |
| `/api/v1/pairings/{device_id}` | GET | Load saved pairing set (404 if none) |

---

## Future pairing routes (examples)

| Endpoint | Verb | Description |
|----------|------|-------------|
| `/api/v1/pairing/session` | GET/PUT | Load/save pairing session for a site |
| `/api/v1/pairing/manual` | POST | Confirm single pair or unpair |
| `/api/v1/pairing/zones/suggest` | POST | Zone polygon pair → preview links |
| `/api/v1/pairing/zones/confirm` | POST | Persist suggested pairs |
| `/api/v1/pairing/zones/unpair` | POST | Unpair all inside selected zone |

---

## Key data contracts (TypeScript — POC)

```typescript
interface CropRequest {
  polygon: GeoJSON.Polygon;
  hints?: { class_a?: GeoJSON.Polygon; class_b?: GeoJSON.Polygon };
}

interface JobRequest {
  crops: CropRequest[];
}

interface Slot {
  slot_id: string;
  center: [number, number];
  polygon: GeoJSON.Polygon;
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
  // OrchestratorProgress — assembled by autocalib-api, not by the autoabsmap package
  progress?: {
    crop_index: number;
    crop_total: number;
    stage: string;
    percent: number;
  };
}
```

---

## File structure

```
autocalib-api/
  app/
    main.py
    routes/
      jobs.py
      reprocess.py
      straighten.py
      clients.py
      logs.py
      # calib.py, pairing.py   # when packages are wired
    services/
      pipeline_service.py
      orchestrator.py
      job_store.py
      imagery_factory.py
      session_capture.py
      b2b_geography.py          # B2B HTTP + save_client_slots_dirty
      b2b_http.py               # shared httpx client
      b2b_slots_cache.py        # TTL cache for GET geography/slots
      b2b_clients.py            # client roster (cached 10 min)
      calib_job_store.py        # In-memory calib jobs (mirrors job_store)
  requirements.txt
  Dockerfile
  plan_architecture.md
```

---

## `JobRequest` / `JobResult` — multi-crop

These orchestration models live in **`autocalib-api`**, not in the `autoabsmap` package. See [`autoabsmap/plan_architecture.md`](../autoabsmap/plan_architecture.md) (`JobRequest` / `OrchestratorProgress` sections).

---

## Merge rule (overlapping crops)

Same as before: process crops in draw order; when adding a slot from crop N, discard if IoU > `merge_iou_threshold` (default 0.5) against an existing slot (**first-crop-wins**).

---

## Client slot save (synchronous B2B)

**Goal:** one round-trip — dirty payload only, full prod overlay in the response (no poll, no `pending_sync`).

### Save response (`POST …/clients/{id}/slots/save`)

| Field | Description |
|-------|-------------|
| `ok`, `client_id` | Acknowledgement |
| `results` | Full prod slot overlay after PUT + POST + re-GET |
| `save_summary` | `{ created, updated, deleted, total_slots }` |
| `warning` | Optional (e.g. unresolved B2B client id) — save may still succeed |

Learning-loop trace runs in a **BackgroundTasks** sidecar when `job_id` + `edit_events` are present (`capture_learning_trace_from_save_request`).

Frontend: `saveSlotsToB2b` in `autocalib-slice.ts` — replaces `state.slots` on success; `SaveFeedbackModal` for success / warning / empty / error.

### B2B performance (client-scoped GET)

Registered clients: `GET /clients/{client_id}/slots?check_event=false` instead of the **full** `GET /geography/slots` catalog. Autocalib:

1. **Caches** per scope in memory (`b2b_slots_cache`, default TTL **90 s**, env `B2B_SLOTS_CACHE_TTL_SEC`).
2. **Filters** crop union via `get_slots_for_client()` / `filter_prod_slots_for_client`.
3. **Invalidates** the client scope (or global) after PUT/POST.
4. **Reuses** a single `httpx.AsyncClient` (`b2b_http.py`).
5. **Caches** the B2B client roster 10 min (`b2b_clients.fetch_b2b_client_roster`).

`GET /api/v1/clients/{id}/reference-slots` uses the same cache (no extra B2B round-trip when cache is warm).

See also [`integration.md`](../integration.md) §7 and [`geography-slots-endpoints.md`](../geography-slots-endpoints.md).

### Env

| Variable | Default | Description |
|----------|---------|-------------|
| `B2B_ENABLED` | `true` | `false` → `POST …/slots/save` returns **503** |
| `B2B_BASE_URL` | prod URL | backend-b2b base |
| `B2B_SLOTS_CACHE_TTL_SEC` | `90` | Catalog cache TTL |
| `B2B_STAFF_UID` | — | Required for live client roster from `GET /clients` |
| `B2B_PUT_BATCH_SIZE` | `20` | Chunk size for B2B `PUT geography/slots` (halves batch on 5xx) |
| `COCOPARKS_PROD_URL` | — | Base URL for ops API (`GET …/cocopilot/get-cocospots-status`) |
| `COCOPARKS_PROD_VERIFY_SSL` | `false` | TLS verify for ops API (dev / jump-host setups) |
| `PREWARM_ML_MODELS` | `true` | Load SAM3 at uvicorn startup (`false` to skip) |

---

## Integration sequence (absolute map POC)

```mermaid
sequenceDiagram
    participant Op as Operator
    participant FE as Operator_FE
    participant API as autocalib_api
    participant Orch as MultiCropOrchestrator
    participant Gen as generator_engine
    participant Loop as learning_loop
    participant Cache as b2b_slots_cache
    participant B2B as backend_b2b

    Op->>FE: Draw crops and launch job
    FE->>API: POST /api/v1/jobs
    loop Each crop
        API->>Orch: run_crop
        Orch->>Gen: ParkingSlotPipeline.run
        API-->>FE: SSE progress
    end
    API-->>FE: JobResult

    Op->>FE: Save
    FE->>API: POST /clients/id/slots/save
    API->>Cache: get client slots
    Cache->>B2B: GET if miss
    API->>B2B: PUT + POST
    API->>Cache: invalidate
    API->>B2B: re-GET overlay
    API->>Loop: SessionStore.save sidecar (background)
    API-->>FE: 200 + results + save_summary
    Note over FE: state.slots = results; SaveFeedbackModal
```
