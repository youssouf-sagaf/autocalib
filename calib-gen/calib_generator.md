# Calib Generator — implementation reference

This document consolidates product intent, pipeline modules, and UX for the calibration bbox workflow. Use it during implementation of the calib-gen UI and backend.

---

## 1. What is a calib bbox?

A **calib bbox** is a small rectangle centered on a parking space in the camera image. At runtime, production vehicle detections are compared to it (typically **IoU**): if a detection overlaps the calib bbox, the slot is **occupied**; otherwise **vacant**.

| Property | Default | Notes |
|----------|---------|--------|
| Size | **5×5 px** (fixed) | Operator can override per device |
| Position | Stable **center** per physical slot | Derived from a stack of ~10 “most occupied” images |
| Coordinates | Normalized in device `static_data` | Same contract as existing Firestore calibration |

---

## 2. Input: YOLO on 10 images

- Run YOLO on the **last 10 most occupied** frames (or equivalent selection).
- Raw outputs: noisy, shifted between frames; possible duplicates near the **dual-lens center seam**; edge bboxes often truncated or out of scope.

---

## 3. Pipeline order (mandatory)

```
YOLO Detection (×10 images)
         ↓
  [GENERATE BBOXES]  ← single main button (modules bundled below)
         ↓
  [SCOPE FILTER]     ← optional, separate button
         ↓
  Manual edits       ← ADD / MOVE / REMOVE / LOCK (existing UX)
         ↓
  [EMPTY SLOT FILLER] ← optional, separate button
         ↓
  Validate / persist
```

**Rules:**

- Do **not** dedup before stack alignment (you would dedupe noise).
- Do **not** run empty-slot filler before dedup is resolved (avoid filling duplicates).
- Do **not** shrink to final calib size until alignment + filtering + dedup are done (you need full bboxes for quality signals).

---

## 4. Modules

### 4.1 Bbox Generator — 7/10  
**CV + statistics + geometry + image processing**

**Button:** `[GENERATE BBOXES]`

Single click runs, in order:

1. **Stack alignment** — cluster detections across the 10 images per physical spot; **RANSAC** for inliers + **median** center (robust to bad parking); **mode** for typical vehicle footprint size where needed.
2. **Noise filter** — YOLO class whitelist (`car` / `truck` / `van` only); aspect-ratio band; reject outliers (moving vehicles, small bikes, misclassified pedestrians, shadows, neighbor roofs intruding into the slot) — align with row/neighbor heuristics where useful.
3. **Center dedup** — repeated spots near image center → **one** bbox per physical space (zone filter → visual similarity → cross-image consistency → keep largest / most stable bbox).
4. **Center shrink** — replace each validated vehicle bbox with the **small fixed-size** calib rectangle at the stable center (default 5×5 px, overridable).

**Product one-liner:**

> Transforms 10 raw YOLO runs into a clean set of small calibration rectangles for runtime IoU occupancy checks.

---

### 4.2 Scope Filter Engine — 4/10  
**CV + product logic**

**Button:** `[SCOPE FILTER]`

- Drop bboxes on **image edges** that are too small / truncated (often covered by another device or end of useful FOV).
- Suggest when a slot is **better monitored** on another device (size, angle, occlusion) so the operator can reassign or drop.
- Operator remains in the loop for final scope.

---

### 4.3 Empty Slot Filler Engine — 7/10  
**CV + LLM + UX**

**Button:** `[EMPTY SLOT FILLER]`

- **Ground marking detection** is **included** here (not a separate module): suggest regions where painted lines imply an empty slot never seen occupied in the 10 images.
- Operator selects a zone; system can **inpaint a synthetic vehicle** (e.g. LLM) and **re-run detection** to obtain a bbox, then operator validates.
- Does **not** include “row extrapolation engine” as a standalone module (explicitly out of scope for v1 per product decision).

---

## 5. Operator flow (summary)

1. **`[GENERATE BBOXES]`** — primary path (~80% of devices); includes center dedup.
2. **`[SCOPE FILTER]`** — when edges / multi-device ambiguity matter.
3. **Manual edits** — fine-tune.
4. **`[EMPTY SLOT FILLER]`** — holes / never-occupied slots with marking hints.
5. **Validate** — write calib to device / backend.

---

## 6. Carousel UX (10-image stack)

### 6.1 Layout

```
┌──────────────────────────────────────────────────────────────┐
│                    Main camera view + overlays                │
├──────────────────────────────────────────────────────────────┤
│ [◀]  [1][2][3][4][5][6][7][8][9][10]  [AVG]  [▶]              │
│      thumbnail strip                                          │
└──────────────────────────────────────────────────────────────┘
```

- Carousel **below** the main image (full width for the viewer).
- **11 thumbnails:** 10 frames + **AVG** (stack summary view).

### 6.2 Default view

- **AVG** selected by default: stable bboxes over a averaged / composite view so operators work on a single “summary” frame most of the time.

### 6.3 Thumbnail badges

- Per-thumb **detection count** (e.g. `12`).
- **Warning** if count diverges strongly from the stack median (rain, occlusion, artifact).

### 6.4 Navigation

- **Click** thumb → show that frame.
- **Arrow keys** / `[◀][▶]` → prev/next.
- **1–0** → jump to frame index (map 10 to `0` if desired).
- **`A`** → back to **AVG**.
- **Hover preview** (~300 ms): temporarily show that frame on the main canvas without changing the “locked” selection (quick scan).

### 6.5 Overlay modes (toggle)

| Mode | Behavior |
|------|----------|
| **STABLE** (default) | Show **final stack-aligned** calib/vehicle bboxes; same geometry while scrubbing frames. |
| **RAW** | Show **YOLO boxes for the current frame only** (investigate per-image noise). |
| **GHOST** | Stable boxes **solid**; current frame raw boxes **dashed** — see misalignment per frame. |

### 6.6 Bbox tooltip (STABLE)

On hover of a stable bbox:

- `Detected in N/10 images`
- Optional: expand to per-frame ✓/✗; click weak frame → jump + switch toward RAW.

### 6.7 “Go to weak”

- **`[GO TO WEAK]`** jumps to the frame with the lowest detection count (or next flagged frame) to speed review.

### 6.8 Carousel size

- **Compact** default (e.g. ~80 px thumb height).
- **Expand** toggle for larger thumbs + readable timestamps.

---

## 7. Implementation priorities (carousel)

| Priority | Feature |
|----------|---------|
| P0 | Strip: 10 + AVG; click + keyboard nav |
| P0 | STABLE / RAW / GHOST toggle |
| P0 | Hover preview without committing selection |
| P1 | Per-thumb detection count + divergence warning |
| P1 | Stable-bbox tooltip `N/10` + drill-down |
| P1 | `GO TO WEAK` |
| P2 | Expand/collapse carousel |
| P2 | Optional filter by occupancy tier (if selection policy allows) |

---

## 8. Cross-links

- Pairing (map ↔ camera): see `pairing/docs/doc.md`.
- Runtime calib contract: `scripts/calib_bbox_centers.py` (`calibration.bboxes` keyed by `slot_id`, normalized coords).

---

## 9. Open implementation notes

- **LLM inpainting** for Empty Slot Filler: define max resolution, latency budget, and fallback if model unavailable.
- **Device-specific** calib rectangle size override must persist beside normalized centers.
- **Multi-device suggestions** in Scope Filter need a data source (overlap matrix, quality scores) — specify in API when available.
