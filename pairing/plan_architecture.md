# `pairing` — package architecture

**Operator API:** [`../autocalib-api/plan_architecture.md`](../autocalib-api/plan_architecture.md)

**Calib generation:** [`../calib_gen/plan_architecture.md`](../calib_gen/plan_architecture.md)

**Absolute map (GeoSlot source):** [`../autoabsmap/plan_architecture.md`](../autoabsmap/plan_architecture.md)

**Operator UI:** [`../autocalib-frontend/plan_architecture.md`](../autocalib-frontend/plan_architecture.md)

> **Repo paths:** pairing UI work lives under **`autocalib-frontend/src/features/pairing/`** (monorepo root **`autocalib-frontend/`**). Backend code lives under **`pairing/`** (flat layout — same as `autoabsmap`). Do not link to `autoabsmap-frontend/` — that name is obsolete.

---

## Role

Match each **absolute map slot** (`GeoSlot`, WGS84, stable `slot_id` from B2B/Firestore) to the corresponding **camera calibration bbox** (image space — normalized `[0,1]` or pixels; one contract must be chosen and documented in API models).

**May import** `autoabsmap.export.models.GeoSlot`. **Does not** mint stable slot IDs.

---

## Dependency graph

```
autoabsmap     calib_gen        # Python packages (repo: autoabsmap/, calib_gen/)
    ↑              ↑
    └──── pairing ─┘            # pairing may import types from autoabsmap; consumes calib bbox payloads

autocalib-api  ──HTTP──►  autoabsmap | calib_gen | pairing   # thin adapters only; lives in autocalib-api/
```

- **`pairing`** Python package may depend on **`autoabsmap`** types only.
- **`autoabsmap`** never imports `pairing` or `calib_gen`.
- **`calib_gen`** is installed from the **`calib_gen/`** repo directory (`pip install -e ./calib_gen`); naming differs from the **`pairing/`** repo layout but the dependency direction is unchanged.

---

## Project blocks (product)

| # | Block | Difficulty | Nature |
|---|--------|------------|--------|
| 1 | **Manual pairing engine** | 6/10 | CV + UX + Front |
| 2 | **Auto-suggest zone pairing engine** | 9/10 | CV + UX + Front |
| 3 | **Zone unpairing engine** | 7/10 | CV + UX + Front |

Frontend implementations live under **`autocalib-frontend/src/features/pairing/`** (see frontend plan). Backend geometry and persistence live under **`pairing/`**.

---

## 1) Manual pairing engine

**Pair**

1. Operator chooses **Pair**.
2. Select **one spot** on the map (slot).
3. Select **one calib bbox** on the camera image / carousel frame.
4. **Confirm** → pairing persisted (POST). Reject or replace policy if slot or bbox already paired (document in API; default: reject with 409).

**Unpair**

1. Operator chooses **Unpair**.
2. Click a **linked** spot or **linked** bbox → pairing **highlighted** (link + endpoints).
3. **Confirm** → pairing removed.

---

## 2) Auto-suggest zone pairing engine

**Pipeline**

1. Operator draws **image polygon** for zone *k* → compute **N_k** = number of calib bboxes **strictly inside** (define rule: e.g. bbox centroid inside polygon, or full OBB inside — pick one; centroid is cheaper).
2. Operator draws **map polygon** for zone *k* → **N_k** = slots strictly inside (same geometric rule on slot footprint).
3. If counts **match** → enable **auto-suggest** for that zone pair `(image_poly_k, map_poly_k)`.
4. **Preview:** dashed links, color per zone or per candidate; optional **reverse order** toggle if slot ordering is inverted relative to bbox ordering.
5. **Confirm:** persist bbox ↔ slot pairs for zone *k*, or **accumulate** multiple zones then **Confirm all** (single batch transaction recommended).

**Backend:** `zone_matcher.py` builds a permutation between ordered bbox list and ordered slot list; preview without persisting until confirm.

---

## 3) Zone unpairing engine

**Pipeline**

1. Operator selects **one zone** (either the image polygon for *k* or the map polygon for *k* — same zone id).
2. System finds all pairings where **calib bbox** is strictly inside image polygon *k* **and** **slot** is strictly inside map polygon *k*.
3. **Highlight** all affected pairings (links + bbox + slot).
4. **UNPAIR ZONE** → optional **Confirm** dialog → delete **all** highlighted pairings.

**Backend:** `zone_unpair.py` — query by zone id or by polygon pair, bulk delete.

---

## Python package layout (`pairing/`)

Scaffold as **packages (directories)** under the **single** import root `pairing` — add `__init__.py` and modules when implementing. Flat layout (same convention as `autoabsmap`).

```
pairing/
  pyproject.toml
  __init__.py              # single Python package root (import name pairing)
  models/                  # ✅ Pydantic wire types (PairingLinkRecord, PairingZoneRecord, PairingSet)
  pairing_store/           # ✅ File-backed PairingStore — one JSON per device
  zone_geometry/           # reserved — geometry currently in the frontend
  zone_matcher/            # reserved — auto-suggest currently in the frontend
  zone_unpair/             # reserved — bulk unpair currently in the frontend
  manual/                  # reserved — manual pair/unpair currently in the frontend
  pairing_rd/              # R&D — not part of the installable package
  docs/
```

**Current MVP:** only `models/` + `pairing_store/` are implemented. The API
routes (`POST /api/v1/pairings/{device_id}`, `GET /api/v1/pairings/{device_id}`)
persist the committed pairing set; all geometry / matching logic lives in the
frontend until validation, multi-operator races, or homography-based
auto-suggest justify a server port.

Optional facade: `PairingService` (e.g. `pairing/service.py` later) with a single entry for HTTP adapters.

---

## HTTP (via `autocalib-api`)

See [`autocalib-api/plan_architecture.md`](../autocalib-api/plan_architecture.md) — **Planned endpoints — pairing**. Request/response bodies should be Pydantic models mirroring TypeScript contracts used by the frontend.

---

## Specification notes

- Detailed algorithms and homography notes: [`docs/doc.md`](docs/doc.md) (extend as implementation progresses).
- R&D scripts remain in **`pairing_rd/`** — not imported by production `pairing`.

---

## Related

- **Operator API:** [`../autocalib-api/plan_architecture.md`](../autocalib-api/plan_architecture.md)
- **Operator UI:** [`../autocalib-frontend/plan_architecture.md`](../autocalib-frontend/plan_architecture.md)
- **Calib:** [`../calib_gen/plan_architecture.md`](../calib_gen/plan_architecture.md), [`../calib_gen/docs/calib_generator.md`](../calib_gen/docs/calib_generator.md)


-> il faut que ça soit explicite la calib et l'ordre
-> shortcut oriented productive
