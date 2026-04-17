# `pairing` — package architecture

**Monorepo index:** [`../plan_architecture.md`](../plan_architecture.md)

---

## Role

Match each **absolute map slot** (`GeoSlot`, WGS84) to the corresponding **camera calibration bbox** (normalized image coordinates). This is geo space ↔ image space pairing (homography, zone pairing, hybrid operator flow).

**May import** `autoabsmap.export.models.GeoSlot`. **Does not** own `slot_id` generation — only consumes stable IDs from Firestore / B2B.

---

## Layout

| Path | Purpose |
|------|---------|
| `docs/doc.md` | Pairing approaches, hybrid workflow, homography notes |
| `pairing-rd/` | R&D image-side detectors (lines, grid, VLM) — **not** production pairing |
| *(future)* `pairing/` package | Production code when implemented |

---

## Dependencies

```
autoabsmap  ←  calib_gen  ←  pairing
```

- Import **`GeoSlot`** and related types from **`autoabsmap`** only.
- Consume **calib bboxes** from **`calib_gen`** (or HTTP API that wraps it).
- **`autoabsmap`** never imports `pairing` or `calib_gen`.

---

## Specification

Algorithm and UX details: **`docs/doc.md`**.

---

## Related

- **Calib:** [`../calib_gen/plan_architecture.md`](../calib_gen/plan_architecture.md), [`../calib_gen/docs/calib_generator.md`](../calib_gen/docs/calib_generator.md)
- **Absolute map engine:** [`../autoabsmap/plan_architecture.md`](../autoabsmap/plan_architecture.md)
