# Absolute Map generation cockpit — product engineering

This document captures **Absolutemap** product-engineering intent: a map-first workflow to register regions of interest (ROIs), run automated parking slot detection (YOLO), segmentation (SegFormer) + post-processing, review results on a **dual synchronized map**, and edit efficiently before saving. 

---

## Goals

- **End-to-end productivity**: manual steps must feel lighter than today’s Absolute Map workflow, not heavier.
- **Scalability**: the same absolute map tool should be usable by trained operators (e.g. cities client) with keyboard-first ergonomics.
- **Honest human-in-the-loop**: AI and CV will not reach 100% coverage; **fast correction** is a first-class module, not an afterthought.
- **Learning loop**: record base runs, reprocessing, and manual edits so future models and metrics can improve (format TBD).

---

## High-level user journey

The mockup implies roughly less than 15 lightweight steps if ergonomics are right; each step should be **fast and obvious** (shortcuts, minimal menus).

### 1. Scroll and see existing slots present

The operator navigates the basemap at an appropriate zoom. **Already-mapped areas** stay visible so they are not reworked by mistake.

![Scroll with existing Absolute Map visible](images/Maquette%20Sagaf%20-%20incl%20Autocalib%20-%20scrolling%20existing%20map%20visible.jpg)

### 2. ROI registration

- Activate **ROI registration mode** (keyboard shortcut and/or click).
- Define the ROI as a **region on the map** with real coordinates (e.g. lat/lng of corners, or polygon).

![ROI registered](images/Maquette%20Sagaf%20-%20incl%20Autocalib%20-%20ROI%20registered.jpg)

### 3. Optional context inputs (“stabiloting”)

Before or after launch, the operator may **trace a quick closed shape** (rough polygon or circle) for hints (e.g. occluded areas, “deeper” zones). Behind segmentation, these regions can also act as an **additional mask** (extra constraint or focus for the model).

- **A** + hold + drag: one gesture closes the shape — one hint class (lasso-style).
- **B** + hold + drag: same — second hint class (e.g. different semantics).

These must stay **fast freehand markup**, not precise multi-click polygon editors.

### 4. Launch automation (“Abs map automation”)

Pipeline: **Detection* + *SegFormer + automated post-processing** → provisional slot geometry and centroids, then georeferencing back to the map.

![Auto Absolute Map generator engine](images/Maquette%20Sagaf%20-%20incl%20Autocalib%20-%20autoabsmap%20generate%20engine.jpg)

### 5. Dual-map review (synchronized)

- **Left**: basemap **without** parking overlay (clean reference).
- **Right**: same view **with** detections (b-boxes, centroids / dots).
- **Synchronized pan and zoom** on both maps so the operator compares without toggling.
- **Scroll / wheel** on either map updates **both** views together (same center and zoom).

![Two-map synchronized scrolling](images/Maquette%20Sagaf%20-%20incl%20Autocalib%20-%20two%20map%20sync%20scrolling.jpg)

Toolbox and modes sit alongside the maps (add, delete, copy, reprocess, alignment, etc.).

![Map sync with tooling](images/Maquette%20Sagaf%20-%20incl%20Autocalib%20-%20map%20synch%20with%20tooling.jpg)

### 6. Lightning edition — add, remove, modify

Target edits (shortcut legends):

- **Add (A)** — missing slots: hold **A**, click to place.
- **Remove / delete (D)** — false detections: click each b-box to remove.
- **Modify (M)** — slot geometry: orientation, alignment, fine adjustments.
- **Copy (C)** — duplicate a reference b-box and place it (avoid slow right-click copy/paste flows).
- **Reprocess (R)** — after drawing a **round** or region around a missed pocket, **auto-add** from one example (pattern completion in that area).


Ergonomics called out in workshops:

![Auto-add after one example + round](images/Maquette%20Sagaf%20-%20incl%20Autocalib%20-%20auto%20add%20missed%20bbox%20after%20adding%20one%20example.jpg)

**Bulk delete** (scribble “everything inside this lasso”) was identified as important when many bad boxes appear (e.g. boats in a marina); today’s per-click delete does not scale.

![Blocked deletion — delete many b-boxes](images/Maquette%20Sagaf%20-%20incl%20Autocalib%20-%20blocked%20deletion%20to%20delete%20more%20bboxes.jpg)

### 7. Alignment automation (“mise au carré”)

Along a row, b-boxes should share a **consistent angle** and **alignment**. Intended interaction sketch:

- The user turns on **Row Straightening** and clicks **one slot** on the row they want to fix (the **selected slot**).
- The system **infers the full row** from neighboring slots (same line / corridor), highlights every slot in that row, and proposes a coherent alignment.
- The operator may fine-tune (e.g. scroll wheel), then **validates** or cancels.

### 8. Save

Persist **all elements**: b-boxes **and** centroids (dots) into the Absolute Map product data.

![Save b-boxes and dots](images/Maquette%20Sagaf%20-%20incl%20Autocalib%20-%20save%20bboxes%20%2B%20dots.jpg)

---

## Extension — Unified Formalization CV/AI engine

### What is the retraining loop?

This loop is a single product-and-CV system with four steps:

1. **Automated baseline run**: ROI -> Detection (YOLO-OBB) -> Segmentation (SegFormer) -> Post-processing.
2. **Fast human refinement**: add, delete, modify, reprocess, and align to produce the operational final map.
3. **Structured learning capture and persistence**: record **and store durably** the full trace—not only the delta vs. the final map. Persist separate **layers** (e.g. **base** automation output, **reprocessed** steps, **manual** edits) plus event-level logs so they can be replayed, audited, and exported into training datasets and weakness reports later.
4. **Offline CV improvement + revalidation**: retrain segmentation and detection, then retest on historical corrected cases before promotion.

The core principle is explicit: the objective is not only a better model score, but a measurable reduction of manual work in real operations. None of the learning signal above is “throwaway UI state”: it must land in **stable storage** tied to ROI, model versions, and operator session metadata.

### What must be recorded during and after manual work

#### During the session (fine-grained trace)

- Input context: ROI geometry, imagery source, zoom/context level, and model versions.
- Baseline output snapshot: segmentation result, detection result, and post-processed result before editing.
- Timestamped operator events: `add`, `delete`, `modify`, `reprocess`, `align`.
- Object lineage: whether each final slot comes from `auto`, `auto_reprocess`, or `manual`.
- Local before/after geometry for each change.

#### After validation (training-ready final snapshot)

- Final operational truth: validated and added bboxes by the operator.
- Global delta summary: number of additions, deletions, and geometric corrections.
- **Difficulty presets per zone**: the UI can offfer a short, fixed list (e.g. occlusion, shadow, weak ground markings, visual clutter) so the operator **clicks** the relevant items; optional “other” can capture edge cases.
- Training-ready packaging: supervised examples with context, not isolated boxes only.

### How this improves CV models

#### Segmentation improvement signals (SegFormer)

- Manual additions in areas excluded by the mask -> segmentation false-negative evidence.
- Manual deletions in areas included by the mask -> segmentation false-positive evidence.
- Difficulty tags -> hard-case curriculum.
- Final validated geometry -> corrected mask targets (or pseudo-mask targets) for retraining.

#### Detection improvement signals (YOLO-OBB)

- Manual additions -> missed detections (FN).
- Manual deletions -> false detections (FP) and hard negatives.
- Manual geometry edits (center/angle/size) -> OBB regression correction targets.
- Source attribution (`yolo`, `row_extension`, `gap_fill`, `mask_recovery`) -> error localization by generation path.

### What must be launched to assess new model performance

For each candidate model bundle (`new segmentation + new detection`):

- Retest on **former cases** already corrected manually.
- Compare old vs new under the same ROI and imagery conditions.
- Publish one benchmark report with product and CV metrics.

#### KPI framework (explicit)

- **Primary KPI**: reduction of manual effort.
- **Secondary KPIs required by the note**:
  - useful detection rate before editing,
  - number of manual deletions (removing spurious boxes — false-positive detections),
  - number of manual additions (slots the baseline missed — false-negative detections),
  - number of geometric corrections (orientation / alignment),
  - operator time per ROI.

### Promotion rule (go / no-go)

Promote a candidate model only if:

- the **primary KPI** shows a net reduction of manual effort,
- and **secondary KPIs** show no major operational regression.

If those conditions are not met, keep the current production bundle and continue the loop.

### Row Straightening Tool

It is a dedicated refinement step with a **single-slot trigger**: the user clicks one slot in a row, the system discovers the full row automatically, and then straightens all slots in that row.

#### UX flow

1. User activates `Straighten (Mise au carré)` mode.
2. User clicks **one slot** (the **selected slot**).
3. System highlights the discovered row.
4. User confirms or undoes.

#### Core method — Directed corridor walk

A parking row is a sequence of slots regularly spaced in one direction. The approach is **local propagation from the selected slot**.

**Step 1 — Estimate local direction.**
From the **selected slot**, look at the 4-6 nearest slots. Compute the median angle of these neighbors. This gives the initial corridor direction.

**Step 2 — Open a narrow corridor.**
Build an oriented rectangle centered on the **selected slot**, aligned with the estimated direction. The corridor width is about 1-1.5 times the slot width (physically: one parking space wide). It extends in both directions from that slot.

**Step 3 — Walk the corridor in both directions.**
Starting from the **selected slot**, step forward and backward along the corridor. At each step, accept the next slot if:
- its centroid falls inside the corridor,
- its angle is compatible with the current direction (tolerance of a few degrees),
- the spacing to the previous slot is consistent with the estimated pitch (distance between the first 2-3 slots).

**Step 4 — Stop conditions.**
Stop walking when:
- no valid slot is found within the corridor (gap too large),
- angle breaks sharply (different row orientation),
- segmentation mask boundary is reached.

**Step 5 — Apply correction.**
Once the row is collected, apply both **orientation** and **alignment** (same idea as *mise au carré*: angle + slots—and their marker centroids—on one line):

- **Orientation**: compute a target angle (e.g. median angle of all row members) and **rotate each OBB** to that angle (with safe caps if needed).
- **Alignment**: **snap slot centroids (markers / dots)** onto the fitted **row axis** so they lie on the **same straight line**, removing side-to-side “wobble”; optionally smooth **spacing along the row** so neighbor-to-neighbor distances stay coherent.
- **Footprints**: keep slot **width and length** unchanged in V1 (only center + angle move).

#### Handling curved rows

The same corridor walk handles curves through a **rolling direction update**:

- After each accepted slot, update the corridor direction with the angle of the newly added slot.
- The corridor gradually re-orients itself, following the natural curve of the row.

This covers **gently curved rows** without any change to the algorithm.

For **strongly curved rows** (tight radius), add a second pass after the walk:

- Fit a smooth curve (polynomial or B-spline) through the collected centroids.
- Project each centroid onto this curve.
- Align each slot angle to the **local tangent** of the curve at its projected position.

Result: slots follow the arc and each slot has a locally correct angle, not one fixed global angle.

