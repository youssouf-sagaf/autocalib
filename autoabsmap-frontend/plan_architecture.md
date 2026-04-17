# `autoabsmap-frontend` — POC UI architecture

**Monorepo index:** [`../plan_architecture.md`](../plan_architecture.md)

**API contract:** [`../autoabsmap-api/plan_architecture.md`](../autoabsmap-api/plan_architecture.md)

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
