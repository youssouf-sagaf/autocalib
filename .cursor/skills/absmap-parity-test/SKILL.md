---
name: absmap-parity-test
description: >-
  Compare absmap rewrite outputs against R&D golden files module by module.
  Use when validating a rewritten module, running regression checks, or when
  the user mentions parity, golden files, or regression testing.
---

# Absmap Parity Test

Validate that the `absmap` rewrite produces equivalent results to the R&D pipeline (`absolutemap-gen`) by comparing outputs at each layer.

## Prerequisites

Golden files must exist in `tests/golden/case_NNN/` with R&D outputs captured before the rewrite. See `absmap_architecture.md` section "Parity validation."

## Workflow

### Step 1 — Identify the module under test

Ask which layer is being validated:

| Order | Module | Golden file to compare |
|-------|--------|----------------------|
| 1 | `io/` | Raster array from `input.tif` |
| 2 | `ml/segmentation` | `segmentation_mask.npy` |
| 3 | `ml/detection` | `detections_raw.json` |
| 4 | `geometry/engine` | `detections_post.json` |
| 5 | `export/geojson` | `export.geojson` |
| 6 | `pipeline/runner` | Full end-to-end match |

### Step 2 — Run the new module on golden inputs

```python
# Example for geometry/engine (module 4):
# Feed identical upstream outputs (from golden detections_raw.json)
# to the new GeometricEngine and capture output.

from absmap.geometry.engine import GeometricEngine
from absmap.config.settings import GeometrySettings

engine = GeometricEngine(GeometrySettings())
new_slots = engine.process(golden_detections)
```

### Step 3 — Compare outputs

Comparison depends on the module:

**Modules 1–3 (deterministic with same model + input):**
- Expect **exact match** (byte-identical raster, pixel-identical mask, identical detections).
- Any diff = bug in the rewrite.

**Module 4 — geometry/engine (the risky one):**
```python
# Match slots by centroid proximity (Hungarian matching)
# Report:
#   - slot_count_delta: abs(len(new) - len(golden))
#   - matched_pair_iou: mean IoU of matched slot pairs
#   - unmatched_new: new slots with no golden match (new FPs)
#   - unmatched_golden: golden slots with no new match (new FNs)
```

Thresholds:
- Slot count change > 5% → **FAIL**
- Mean matched-pair IoU < 0.85 → **FAIL**
- Any unmatched slots → **WARN** (review manually)

**Modules 5–6:**
- Schema-identical GeoJSON (same fields, same structure).
- Slot-level comparison same as module 4.

### Step 4 — Report

Print a summary per golden case:

```
=== case_001 ===
Module: geometry/engine
Slot count: golden=42, new=43 (delta=+1) ✅
Matched-pair IoU: 0.94 ✅
Unmatched new: 1 ⚠️  (review: slot at [2.3488, 48.8534])
Unmatched golden: 0 ✅
RESULT: PASS (with warnings)
```

### Step 5 — If FAIL

1. Check `GeometrySettings` defaults match R&D values exactly.
2. Diff the specific module code against R&D equivalent.
3. Run the R&D shadow pipeline on the same input and compare intermediate outputs to isolate divergence.

## Golden file structure

```
tests/golden/
  case_001/
    input.tif
    segmentation_mask.npy
    detections_raw.json
    detections_post.json
    export.geojson
    meta.json              # model versions, config, slot count
  case_002/
    ...
```

## Capturing new golden files

To capture golden outputs from the R&D pipeline:

```bash
cd absolutemap-gen
python -m absolutemap_gen.pipeline --input <geotiff> --output tests/golden/case_NNN/
```

Store `meta.json` with model versions and config used, so future runs use identical settings.
