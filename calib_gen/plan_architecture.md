# `calib_gen` — package architecture

**Operator API:** [`../autocalib-api/plan_architecture.md`](../autocalib-api/plan_architecture.md)

**Operator UI (Calib workspace):** [`../autocalib-frontend/plan_architecture.md`](../autocalib-frontend/plan_architecture.md)

**Pairing (consumes calib bboxes):** [`../pairing/plan_architecture.md`](../pairing/plan_architecture.md)

> **Repo paths:** the operator SPA is **[`autocalib-frontend/`](../autocalib-frontend/plan_architecture.md)** at the monorepo root. The legacy folder name `autoabsmap-frontend/` is obsolete — all doc links must use `autocalib-frontend/`.

---

## Context

- **Production package (target):** `autocalib/calib_gen/` — **flat layout** (same convention as `autoabsmap` and `pairing`). **Foundation** + **service engines**, same discipline as [`autoabsmap`](../autoabsmap/plan_architecture.md): Protocols for ML backends, Pydantic at boundaries, `logging` only, no `print()`.
- **R&D reference:** [`calib_gen_rd/`](calib_gen_rd/) — parity / golden tests only; **do not import** from `calib_gen_rd` in new production code.

**Dependency rule:** `calib_gen` does **not** import `autoabsmap` or `pairing`. After a **synthetic vehicle** commit, **rerunning** the bbox calib pipeline is orchestrated by **`autocalib-api`** or the client, not by a circular package import.

---

## Product blocks → Python modules

| Priority | Block | Nature | Module |
|----------|--------|--------|--------|
| 10/10 | **Bbox calib generator engine** | CV + geometry + image processing | `bbox_calib_engine/` |
| 9/10 | **Synthetic vehicle filler engine** (“empty slot filler”) | AI + CV | `synthetic_filler_engine/` |

**Foundation:** `config/`, `io/` (frame sequences, **carousel** slots 1…10 + **AVG** composite), `models/`, `ml/` (`Detector`, optional `Inpainter` Protocol), `geometry/` (anchors, fusion helpers).

---

## Bbox calib generator — pipeline (core, with integrated deduplication)

1. **Frame selection** — rank frames by occupancy proxy; use the **top 10** occupied frames.
2. **YOLO detection** — run detections on the 10-frame set; persist raw outputs for debugging.
3. **Cleaning / quality filter** — keep bbox sizes near the **local standard-size cluster**; drop tiny / van-like outliers.
4. **Zone filter** — keep candidates in the dedup target zone (near image center by config).
5. **Anchor extraction** — use bottom-center per detection bbox as a stable parking-space proxy.
6. **Local center estimation** — offset model from anchor toward parking center (tunable `GeometrySettings`).
7. **Center deduplication** — bbox crop visual similarity + cross-image consistency to group repeated physical spaces.
8. **Robust fusion across 10 frames** — aggregate corrected center/bbox candidates with **median**.
9. **Best bbox selection** — keep one stable bbox per physical parking space from fused candidates.
10. **Calib bbox generation** — final rectangles built around fused centers using row-consistent aspect/size rules or local statistics.

Public entry: `BBoxCalibPipeline.run(request) -> BBoxCalibResult`.

---

## Synthetic vehicle filler engine

User marks empty area (polygon / point) → model proposes mask → **inpaint** vehicle → **preview** → accept/adjust → **commit** (new raster + provenance). `Inpainter` is a **Protocol** (SAM / diffusion / remote API).

---

## UI mapping (Calib workspace mockup)

| UI control | Backend |
|------------|---------|
| Confidence threshold | Detector score filter (request param) |
| GENERATE CALIB BBOX | `bbox_calib_engine` |
| EMPTY SLOT FILLER | `synthetic_filler_engine` |
| LOCK / BULK DELETE / MULTI RESIZE | Editor state |

**Carousel:** frames **1…10** + **AVG** — first-class in `io/` and `BBoxCalibRequest` (`AggregationMode`).

---

## Package tree (target)

```
calib_gen/
  pyproject.toml
  __init__.py            # package root (import name calib_gen)
  config/
  io/
  models/
  ml/
  geometry/
  bbox_calib_engine/
  synthetic_filler_engine/
  calib_gen_rd/          # R&D — not part of the installable package
  docs/
```

---

## Related

- **HTTP:** [`../autocalib-api/plan_architecture.md`](../autocalib-api/plan_architecture.md)
- **Operator UI:** [`../autocalib-frontend/plan_architecture.md`](../autocalib-frontend/plan_architecture.md)
- Product / UX notes: [`docs/calib_generator.md`](docs/calib_generator.md)

Pourquoi R&D script/notebook d'abord
Intégration frontend — En passant par le front tu dois wirer API routes + Redux + rendu canvas + debug intégration EN PLUS du pipeline CV. C'est 5x plus lent.
Inspection visuelle — Chaque étape (YOLO detections, cleaning, anchors, fusion) a besoin de matplotlib overlays pour valider visuellement. Impossible via le frontend.
Itération rapide — Tu modifies un seuil, tu relances une cellule. Pas besoin de recharger uvicorn + vite.
Pattern existant — pairing_rd/ et absolutemap_rd/ suivent exactement cette approche. calib_gen_rd/ est déjà prévu et gitignored.
Plan concret pour aller vite
Phase 1 — Data bootstrap (30 min)
Récupérer les 10 images les plus occupées pour un device test.

Bucket S3: cocospot-images
Key pattern: {client}/{device_id}/{filename}.jpg (ex: AMP/device_0000000026044be5/...)
Date dans le filename: _{Month-DD-YYYY}-
Filtrer jour uniquement (réutiliser la logique day_night_classifier.py)
Le .pem = SSH vers la VM qui a les credentials AWS
Phase 2 — Pipeline R&D step-by-step
Un script Python dans calib_gen/calib_gen_rd/ avec ces étapes séquentielles:

Step	Ce que tu fais	Output visuel
1. Frame selection
Trier par nb de véhicules (proxy occupancy via YOLO count)
Top 10 frames annotées
2. YOLO detection
ultralytics.YOLO standard (pas OBB, bbox classique suffit ici)
Bboxes overlayées sur chaque frame
3. Cleaning
Filtrer par taille: garder le cluster "véhicule standard", drop outliers (tiny/vans)
Histogramme des tailles + bboxes filtrées
4. Zone filter
Garder les bboxes dans la zone d'intérêt (configurable)
Masque zone + bboxes retenues
5. Anchor extraction
Bottom-center de chaque bbox
Points overlayés sur image
6. Local center estimation
Offset anchor → center estimé
Vecteurs anchor→center
7. Cross-image dedup
Similarité visuelle des crops + consistance cross-frames
Groupes de bboxes identifiées comme même place
8. Median fusion
Agréger les centers/bboxes candidates
Points fusionnés vs individuels
9. Calib bbox generation
Rectangles finaux autour des centers fusionnés
Résultat final overlayé
Phase 3 — Port vers production
Une fois que ça marche sur 3-5 devices, porter dans calib_gen/bbox_calib_engine/ avec Pydantic models, Protocol pour le detector, logging, etc.