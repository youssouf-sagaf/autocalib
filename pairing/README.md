# pairing

**Geo slot ↔ camera bbox matching** — links each `GeoSlot` (WGS84) from the absolute map to the corresponding calibration bbox in the camera image.

## Layout

| Path | Purpose |
|------|---------|
| **`plan_architecture.md`** | Package role, dependencies, layout (monorepo index: parent `plan_architecture.md`) |
| **`docs/doc.md`** | Pairing approaches, hybrid workflow, homography notes |
| **`models/`** | Pydantic wire types (`PairingLinkRecord`, `PairingZoneRecord`, `PairingSet`) |
| **`pairing_store/`** | File-backed `PairingStore` — one JSON per device |
| **`pairings/`** | Runtime drafts (`<device_id>.json`), created by the API on save |
| **`zone_geometry/` / `zone_matcher/` / `zone_unpair/` / `manual/`** | Reserved scaffolds — geometry currently lives in the frontend |
| **`pairing_rd/`** | R&D scripts (line/grid slot detectors, VLM experiments) — not production pairing |

## Dependencies

```
autoabsmap  ←  calib_gen  ←  pairing
```

Pairing may import `autoabsmap.export.models.GeoSlot`. It consumes calib bboxes from `calib_gen` (or the API). See [`calib_gen/docs/calib_generator.md`](../calib_gen/docs/calib_generator.md).

## Status

**MVP persistence layer wired:** `models/` + `pairing_store/` + the API routes
`POST /api/v1/pairings/{device_id}` and `GET /api/v1/pairings/{device_id}`
(`autocalib-api/app/routes/pairing.py`). Geometry — point-in-polygon, zone
matching, suggestion ordering — still runs in the frontend; the backend only
persists the committed result. Auto-suggest / manual / unpair Python engines
remain to be implemented.
