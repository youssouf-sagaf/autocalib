# pairing

**Geo slot ↔ camera bbox matching** — links each `GeoSlot` (WGS84) from the absolute map to the corresponding calibration bbox in the camera image.

## Layout

| Path | Purpose |
|------|---------|
| **`plan_architecture.md`** | Package role, dependencies, layout (monorepo index: parent `plan_architecture.md`) |
| **`docs/doc.md`** | Pairing approaches, hybrid workflow, homography notes |
| **`pairing-rd/`** | R&D scripts (line/grid slot detectors, VLM experiments) — not production pairing |

## Dependencies

```
autoabsmap  ←  calib_gen  ←  pairing
```

Pairing may import `autoabsmap.export.models.GeoSlot`. It consumes calib bboxes from `calib_gen` (or the API). See [`calib_gen/docs/calib_generator.md`](../calib_gen/docs/calib_generator.md).

## Status

Product pairing logic and service TBD; R&D prototypes live under `pairing-rd/`.
