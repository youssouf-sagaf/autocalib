# calib_gen

Python package for **calibration bbox generation**: turn a stack of camera frames and YOLO detections into stable, small per-slot rectangles used at runtime for IoU-based occupancy.

## Layout

| Path | Purpose |
|------|---------|
| **`plan_architecture.md`** | Package role, dependencies, layout (monorepo index: parent `plan_architecture.md`) |
| **`docs/calib_generator.md`** | Pipeline, engines, carousel UX, implementation notes |
| **`calib_gen/`** (root) | Installable package root (`pip install -e .`) — production code (flat layout, same as `autoabsmap`) |
| **`calib_gen_rd/`** | R&D prototypes — not shipped with the package |

## Dependencies

```
autoabsmap  ←  calib_gen  ←  pairing
```

`calib_gen` does **not** import `autoabsmap` or `pairing`. Pairing consumes `GeoSlot` from `autoabsmap` and calib bboxes produced here (or via API).

## Status

Scaffold only — engines to be implemented per `docs/calib_generator.md`.
