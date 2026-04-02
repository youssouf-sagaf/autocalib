# Absolute Map generation cockpit — product engineering (mockup)

This document captures **Autocalib / Absolute Map** product-engineering intent: a map-first workflow to register regions of interest (ROIs), run automated slot detection (SegFormer + post-processing), review results on a **dual synchronized map**, and edit efficiently before saving. It is written for engineering and design alignment; it is not an implementation spec.

---

## Goals

- **End-to-end productivity**: manual steps must feel lighter than today’s Absolute Map workflow, not heavier.
- **Scalability**: the same cockpit should be usable by trained operators (e.g. cities) with keyboard-first ergonomics.
- **Honest human-in-the-loop**: the model will not reach 100% coverage; **fast correction** is a first-class module, not an afterthought.
- **Learning loop**: record base runs, reprocessing, and manual edits so future models and metrics can improve (format TBD).

---

## High-level user journey

The mockup implies roughly **10–15** lightweight steps if ergonomics are right; each step should be **fast and obvious** (shortcuts, minimal menus).

### 1. Scroll and see existing Absolute Map

The operator navigates the basemap at an appropriate zoom. **Already-mapped areas** stay visible so they are not reworked by mistake.

![Scroll with existing Absolute Map visible](images/Maquette%20Sagaf%20-%20incl%20Autocalib%20-%20scrolling%20existing%20map%20visible.jpg)

### 2. ROI registration

- Activate **ROI registration mode** (keyboard shortcut and/or click).
- Define the ROI as a **region on the map** with real coordinates (e.g. lat/lng of corners, or polygon).

![ROI registered](images/Maquette%20Sagaf%20-%20incl%20Autocalib%20-%20ROI%20registered.jpg)

### 3. Optional context inputs (“stabiloting”)

Before or after launch, the operator may **scribble** rough hints (e.g. occluded areas, “deeper” zones):

- **A** + hold, click, draw — one class of hint.
- **B** + hold, click, draw — another class (e.g. different semantics).

These should stay **quick sketch interactions**, not multi-click polygon editors.

### 4. Launch automation (“Abs map automation”)

Pipeline: **SegFormer + automated post-processing** → provisional slot geometry and centroids, then georeferencing back to the map.

![Auto Absolute Map generator engine](images/Maquette%20Sagaf%20-%20incl%20Autocalib%20-%20autoabsmap%20generate%20engine.jpg)

### 5. Dual-map review (synchronized)

- **Left**: basemap **without** parking overlay (clean reference).
- **Right**: same view **with** detections (b-boxes, centroids / dots).
- **Synchronized pan and zoom** on both maps so the operator compares without toggling.

![Two-map synchronized scrolling](images/Maquette%20Sagaf%20-%20incl%20Autocalib%20-%20two%20map%20sync%20scrolling.jpg)

Toolbox and modes sit alongside the maps (add, delete, copy, reprocess, alignment, etc.).

![Map sync with tooling](images/Maquette%20Sagaf%20-%20incl%20Autocalib%20-%20map%20synch%20with%20tooling.jpg)

### 6. Lightning edition — add, remove, modify

Target edits:

- **Add** missing slots.
- **Remove** false detections.
- **Modify** slot geometry: orientation, alignment, fine adjustments.

Ergonomics called out in workshops:

- **D** — delete mode: click to remove b-boxes.
- **Add** — hold **A**, click to add (mode indicator in UI).
- **Copy** — duplicate a reference b-box and place it (avoid slow right-click copy/paste flows).
- **Reprocess (R)** — after drawing a **round** or region around a missed pocket, **auto-add** from one example (pattern completion in that area).

![Auto-add after one example + round](images/Maquette%20Sagaf%20-%20incl%20Autocalib%20-%20auto%20add%20missed%20bbox%20after%20adding%20one%20example.jpg)

**Bulk delete** (scribble “everything inside this lasso”) was identified as important when many bad boxes appear (e.g. boats in a marina); today’s per-click delete does not scale.

![Blocked deletion — delete many b-boxes](images/Maquette%20Sagaf%20-%20incl%20Autocalib%20-%20blocked%20deletion%20to%20delete%20more%20bboxes.jpg)

### 7. Alignment automation (“mise au carré”)

Along a row, b-boxes should share a **consistent angle** and **alignment**. Intended interaction sketch:

- Hover near centroids / line structure.
- System **detects a line** from neighboring points, **selects b-boxes** on that line.
- Operator adjusts (e.g. scroll wheel) to **rotate** coherently, then validates.

This is a **refinement** step separate from raw add/delete.

### 8. Save

Persist **all elements**: b-boxes **and** centroids (dots) into the Absolute Map product data.

![Save b-boxes and dots](images/Maquette%20Sagaf%20-%20incl%20Autocalib%20-%20save%20bboxes%20%2B%20dots.jpg)

---

## Functional modules (from mockup notes + workshop)

Rough **difficulty / focus** (1–10) as captured in the maquette text — for prioritization, not estimates.

| Module | Score | Focus |
|--------|------:|--------|
| **ROI registrator** | 3 | Front / mapping — scroll, register ROIs, show already-mapped areas |
| **Bilateral map syncher** | 3 | Front / mapping — dual map, synced pan/zoom |
| **Auto Abs map generator engine** | 9 | AI — SegFormer + post-processing, georeferencing |
| **Absolute Map lightning edition module** | 6 | Mapping + product / UX — add, delete, copy, modes |
| **Abs map generator reprocessing helper** | 7 | AI input quality + front — example-based reprocess / auto-add |
| **Alignment automation tool** | 7 | Math / CV + front — line detection, group rotate / align |
| **Systematic engine retraining loop** | 10 | Data format + process — what to log, how to measure new models |

---

## Data and learning (to formalize)

The mockup calls for explicit **layers** or traces:

- **Base** automation output.
- **Reprocessed** steps.
- **Manual** additions and corrections.

Downstream idea: a **weakness report** (machine-consumable) comparing before/after so new models can be **retested on former cases** and manual effort quantified.

**Open engineering items** (from the same notes):

1. **Retraining loop**: schema for what is stored during/after manual work; metrics to assess updated models.
2. **Alignment**: write the geometric method first, then implement the tool.
3. **Architecture**: modular design and **interfaces per module**, then a fast POC (e.g. ROI → dual map → edit → reprocess → align → save).

---

## Map stack (discussion context)

Workshops mention staying **in a Maps experience** (not only static screenshots): the pipeline can **fetch crops** from registered ROIs and write back **lat/lng**. Satellite providers (e.g. Mapbox, IGN, Google-style stacks) were discussed for imagery consistency and possible multi-temporal views — to be validated separately.

---

## Source artifacts in this folder

| File | Role |
|------|------|
| `Maquette Sagaf - incl Autocalib.txt` | Short module list, scores, shortcut sketch, flow bullets |
| `images/*.jpg` | Screen-style mockups for each major step |
| `implementation_slot_extraction.md`, `plan_extraction_centres_places.md` | Related technical notes (slot extraction / centers) |

---

## Image index

| Image | Topic |
|-------|--------|
| `images/Maquette Sagaf - incl Autocalib - scrolling existing map visible.jpg` | Scroll; existing map visible |
| `images/Maquette Sagaf - incl Autocalib - ROI registered.jpg` | ROI registration |
| `images/Maquette Sagaf - incl Autocalib - autoabsmap generate engine.jpg` | Launch automation engine |
| `images/Maquette Sagaf - incl Autocalib - two map sync scrolling.jpg` | Dual map, sync navigation |
| `images/Maquette Sagaf - incl Autocalib - map synch with tooling.jpg` | Tooling next to synced maps |
| `images/Maquette Sagaf - incl Autocalib - auto add missed bbox after adding one example.jpg` | Example + round → auto-add |
| `images/Maquette Sagaf - incl Autocalib - blocked deletion to delete more bboxes.jpg` | Bulk deletion need |
| `images/Maquette Sagaf - incl Autocalib - save bboxes + dots.jpg` | Final save (b-boxes + centroids) |
