# `calib_gen` — package architecture

**Monorepo index:** [`../plan_architecture.md`](../plan_architecture.md)

---

## Role

Generate **calibration bboxes** from a stack of camera images and YOLO detections: stable centers, center dedup, optional scope filter and empty-slot fill, then small fixed rectangles for runtime IoU occupancy checks.

**Does not** import `autoabsmap` or `pairing`. Consumes normalized bbox geometry and device metadata only.

---

## Layout

| Path | Purpose |
|------|---------|
| `calib_gen/` | Installable Python package (`pip install -e .`) |
| `docs/calib_generator.md` | Product spec: pipeline order, engines, carousel UX |
| `calib_gen-rd/` | R&D prototypes (not shipped) |

---

## Pipeline (summary)

```
YOLO (×10 images) → [GENERATE BBOXES] → [SCOPE FILTER]? → manual edits → [EMPTY SLOT FILLER]? → persist
```

See **`docs/calib_generator.md`** for module breakdown, operator flow, and implementation priorities.

---

## Dependencies

```
autoabsmap  ←  calib_gen  ←  pairing
```

- **`pairing`** consumes calib outputs and `GeoSlot` from `autoabsmap`.
- **`calib_gen`** must remain free of `GeoSlot` types until an explicit API boundary is defined (optional dev-only types later).

---

## Upstream contract (`slot_id`)

Stable `slot_id` keys in Firestore / B2B are owned by the **save path**, not by `calib_gen`. Calib persistence uses the same `calibration.bboxes` map shape as today (`scripts/calib_bbox_centers.py`). See monorepo index for the full `slot_id` rules.

---

## Related

- **Pairing:** [`../pairing/plan_architecture.md`](../pairing/plan_architecture.md)
