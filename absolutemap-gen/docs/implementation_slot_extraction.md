# Post-Processing Layer — Filling Missed Parking Spot Detections

> A geometric post-processing module that sits **above** the existing U-Net segmentation and YOLO-OBB detection stages.  
> Its job: recover parking spots the YOLO model missed — especially empty slots, street parking, and low-contrast areas.

---

## 1. Problem Statement

The current pipeline produces two reliable outputs:

| Stage | Output | Quality |
|-------|--------|---------|
| **U-Net segmentation** | Binary parkable mask (1280×1280) | Good — covers most parkable areas |
| **YOLO-OBB detection** | Oriented bounding boxes with `empty_slot` / `occupied_slot` class | Good on occupied spots, **misses many empty spots** |

**The gap:** on a typical image, YOLO detects ~60% of annotated spots. The miss rate is worst on:
- Empty slots (no vehicle = less visual signal)
- Street-side linear parking (narrow mask, few detections)
- Images with few or no vehicles (0020, 0021 have zero detections)

**Goal of this layer:** use the **geometry learned from detected spots** combined with the **mask shape** to infer where the missing slots are.

### Quantified miss rates (current model)

| Image | GT | YOLO | Missed |
|-------|----|------|--------|
| 0000_chambly | 84 | 49 | +35 |
| 0001_place_sardagarigag | 57 | 29 | +28 |
| 0006_livry_anatole_france | 20 | 3 | +17 |
| 0012_avenue_jean_lolive | 19 | 2 | +17 |
| 0019_la_rochelle_rue_moulin | 34 | 4 | +30 |
| 0020_levallois_rue_trebois | 22 | 0 | +22 |
| 0021_levallois_rue_gabrielle_peri | 19 | 0 | +19 |

---

## 2. Inputs & Outputs

### Inputs (all produced by the existing pipeline)

```
inputs/
├── rgb_normalized.png          # 01_preprocess output
├── mask_refined.png            # 02_segmentation output (binary, uint8)
└── detections.json             # 03_detection output (list of SpotDetection OBBs)
```

Each detection in `detections.json` has:
```json
{
  "center_xy": [416.94, 728.04],
  "width": 47.78,
  "height": 100.9,
  "angle_rad": 0.4434,
  "confidence": 0.9743,
  "class_id": 1,
  "occupied": true
}
```

Convention: `width` = shorter side (slot width ≈ 2.5m), `height` = longer side (slot depth ≈ 5m). `angle_rad` is the rotation of the OBB.

### Output

Same format as `detections.json` but enriched:
```json
{
  "spots": [
    { "...original YOLO detection...", "source": "yolo" },
    { "...inferred spot...", "source": "postprocess", "confidence": 0.7 }
  ]
}
```

---

## 3. Architecture Overview

```
 ┌─────────────────────┐     ┌──────────────────────┐
 │  mask_refined.png   │     │   detections.json    │
 │  (binary mask)      │     │   (YOLO-OBB spots)   │
 └─────────┬───────────┘     └──────────┬───────────┘
           │                            │
           ▼                            ▼
   ┌───────────────────────────────────────────────┐
   │  Stage A — Spot Clustering & Row Estimation   │
   │  Group detections into rows, estimate local   │
   │  spacing (wp) and orientation (θ) per row     │
   └───────────────────┬───────────────────────────┘
                       │
                       ▼
   ┌───────────────────────────────────────────────┐
   │  Stage B — Gap Filling Along Detected Rows    │
   │  Extend each row bidirectionally while the    │
   │  mask allows, placing spots at wp intervals   │
   └───────────────────┬───────────────────────────┘
                       │
                       ▼
   ┌───────────────────────────────────────────────┐
   │  Stage C — Uncovered Mask Region Recovery     │
   │  Find mask regions with no detections at all, │
   │  estimate geometry from mask shape (PCA),     │
   │  and fill with default-spaced slots           │
   └───────────────────┬───────────────────────────┘
                       │
                       ▼
   ┌───────────────────────────────────────────────┐
   │  Stage D — Deduplication & Validation         │
   │  Merge overlapping slots, remove spots that   │
   │  fall outside the mask, assign final scores   │
   └───────────────────┬───────────────────────────┘
                       │
                       ▼
                 enriched spots
```

---

## 4. Stage Details

### Stage A — Spot Clustering & Row Estimation

**Goal:** Group YOLO detections into coherent "rows" (a row = a line of side-by-side parking slots sharing the same orientation).

**Algorithm:**

1. **Pairwise compatibility test**: two detections belong to the same row if:
   - Their angle difference `|θ₁ − θ₂|` < 20° (same orientation)
   - The distance between their centers, **projected onto the perpendicular axis** (depth direction), is < `0.8 × mean_height` (they're at roughly the same depth)
   - The distance between their centers, **projected onto the row axis**, is < `4 × mean_width` (not too far apart along the row)

2. **Cluster**: union-find / single-linkage on the compatibility graph. No sklearn needed.

3. **Per-row parameters** (computed from cluster members):

| Parameter | How to compute |
|-----------|---------------|
| `row_θ` | Circular mean of member angles |
| `row_wp` | Median of member `width` values |
| `row_hp` | Median of member `height` values |
| `row_center` | Centroid of member centers |
| `row_axis` | Unit vector `(cos θ, sin θ)` along the row |
| `row_normal` | Unit vector `(-sin θ, cos θ)` perpendicular |

4. **Order members** along the row axis: project each center onto `row_axis`, sort by projection value.

**Edge case — single detection:** A cluster of 1 detection still defines a row (orientation from its own angle, spacing from its own dimensions). It can be extended in Stage B.

**Edge case — zero detections:** Skip to Stage C entirely.

### Stage B — Gap Filling Along Detected Rows

**Goal:** For each row from Stage A, walk along the row axis in both directions, placing new spots at `row_wp` intervals wherever the mask supports it.

**Algorithm:**

For each row, take the two extreme spots (first and last in the sorted order):

1. **Forward extension** (from last spot along +row_axis):
   ```
   pos = last_spot_center + row_wp × row_axis
   while mask[pos] == 1 and distance_transform[pos] > 0.25 × row_hp:
       place_spot(pos, row_θ, row_wp, row_hp, source="postprocess")
       pos += row_wp × row_axis
   ```

2. **Backward extension** (from first spot along −row_axis): same logic in reverse.

3. **Internal gap filling**: walk between consecutive detected spots. If the gap between two consecutive spots along the row axis is > `1.5 × row_wp`, fill with evenly spaced spots:
   ```
   gap_length = projection_distance(spot_i, spot_j)
   n_fill = round(gap_length / row_wp) - 1
   for k in 1..n_fill:
       t = k / (n_fill + 1)
       pos = lerp(spot_i.center, spot_j.center, t)
       if mask[pos] == 1:
           place_spot(pos, row_θ, row_wp, row_hp, source="postprocess")
   ```

**Direction adaptation for curved rows:**

If the row has ≥ 3 detections and is not perfectly straight (max angular deviation > 10°), use **local PCA** at each propagation step instead of the global `row_θ`:

- At position `pos`, take mask pixels in a window of radius `0.8 × row_hp`
- Compute PCA of those pixels → dominant axis = local row direction
- Use this local direction for the next step

This handles curved street parking where the row follows the road.

**Stopping conditions:**
- Pixel falls outside the mask
- Distance transform at pixel < `0.25 × row_hp` (too close to mask edge)
- Direction change > 45° in a single step (prevents wrapping around corners)
- Max 200 steps per direction (safety limit)

### Stage C — Uncovered Mask Region Recovery

**Goal:** Handle mask regions where YOLO produced zero detections (e.g., fully empty parking rows, images 0020/0021).

**Algorithm:**

1. **Build a coverage map**: for each spot (YOLO + Stage B), mark a circle of radius `1.5 × wp` as "covered" on a boolean image.

2. **Find uncovered mask regions**: `uncovered = mask AND NOT coverage`. Extract connected components.

3. **Filter small components**: discard regions with area < `2 × wp × hp` (too small to fit a parking slot).

4. **For each uncovered region:**

   a. **Estimate orientation** via PCA of the region's pixels → dominant axis = row direction.

   b. **Estimate slot dimensions**: use the **image-wide median** of YOLO-detected slot `width` and `height`. If no detections exist in the entire image, fall back to default values (wp=8.3px, hp=16.7px for GSD=0.3m).

   c. **Pick a seed point**: the pixel in the region with the highest distance transform value (deepest inside the mask = most likely center of the parking strip).

   d. **Propagate bidirectionally** from the seed along the PCA direction, placing slots at `wp` intervals (same logic as Stage B).

   e. **Multi-row check**: if the DT value at the seed is > `0.7 × hp`, the mask is wide enough for 2 rows of back-to-back parking. Place a second row of slots offset by `±hp/2` in the perpendicular direction.

5. **Iterate** up to 3 times (each pass may leave new uncovered sub-regions that need filling in wide mask areas).

**Confidence assignment:**
- Stage B (row extension) spots: confidence = `0.75`
- Stage C iteration 1 spots: confidence = `0.65`
- Stage C iteration 2+ spots: confidence = `0.55`
- Original YOLO spots: keep their original confidence

### Stage D — Deduplication & Validation

**Goal:** Merge overlaps and remove invalid spots.

**Algorithm:**

1. **Merge all spots** (YOLO originals + Stage B + Stage C) into one list, sorted by confidence (descending).

2. **Greedy NMS**: for each spot in order, keep it only if no already-kept spot has its center within `0.5 × wp` distance.

3. **Mask validation**: discard any spot whose center falls outside the binary mask (can happen due to propagation numerical drift).

4. **Occupancy tagging**: a post-processed spot is marked `occupied=false` by default (the YOLO model didn't see a vehicle there). Original YOLO detections keep their class label.

---

## 5. Configuration

All tuneable parameters in one dataclass:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `default_wp_m` | 2.5 | Fallback slot width in meters |
| `default_hp_m` | 5.0 | Fallback slot depth in meters |
| `gsd_m` | 0.3 | Ground sampling distance (m/px) |
| `row_angle_tolerance_deg` | 20.0 | Max angle difference to join same row |
| `row_depth_factor` | 0.8 | Max perpendicular distance as fraction of hp |
| `row_gap_factor` | 4.0 | Max along-row distance as fraction of wp |
| `gap_fill_threshold` | 1.5 | Internal gaps > factor × wp get filled |
| `extension_max_steps` | 200 | Max propagation steps per direction |
| `min_dt_fraction` | 0.25 | Stop when DT < fraction × hp_px |
| `max_turn_deg` | 45.0 | Max direction change per step |
| `two_row_dt_factor` | 0.70 | DT threshold for 2-row expansion |
| `dedup_distance_fraction` | 0.5 | Merge if centers < fraction × wp_px |
| `min_region_slots` | 2.0 | Min uncovered area in slot-equivalents |
| `pca_window_factor` | 0.8 | PCA window radius as fraction of hp_px |
| `max_fill_iterations` | 3 | Max ridge-fill passes |

Derived: `wp_px = wp_m / gsd_m`, `hp_px = hp_m / gsd_m`.

---

## 6. Data Structures

### `PostProcessedSpot`

```python
@dataclass
class PostProcessedSpot:
    center_x: float        # pixel column
    center_y: float        # pixel row
    width: float           # slot width in pixels (along row axis)
    height: float          # slot depth in pixels (perpendicular)
    angle_rad: float       # row axis orientation
    confidence: float      # 0.0–1.0
    occupied: bool         # True only if from YOLO with class_id=1
    source: str            # "yolo" | "row_extension" | "gap_fill" | "mask_recovery"
    row_id: int | None     # which row cluster this belongs to (None for mask_recovery)
```

### Utility functions needed

| Function | Purpose |
|----------|---------|
| `cluster_into_rows(detections) → list[Row]` | Stage A |
| `extend_row(row, mask, dt) → list[Spot]` | Stage B forward/backward |
| `fill_row_gaps(row, mask) → list[Spot]` | Stage B internal gaps |
| `recover_uncovered_regions(mask, coverage, dt) → list[Spot]` | Stage C |
| `local_pca_direction(mask, center, radius) → (float, float)` | Direction from mask shape |
| `dedup_and_validate(spots, mask, wp_px) → list[Spot]` | Stage D |

---

## 7. Integration Point

The post-processing module plugs into the existing pipeline as a new stage **between detection and export**:

```
00_gis_input → 01_preprocess → 02_segmentation → 03_detection → 04_postprocess → 05_export
```

It reads:
- `02_segmentation/mask_refined.png`
- `03_detection/detections.json`

It writes:
- `04_postprocess/enriched_detections.json` (same schema, more spots)
- `04_postprocess/overlay_postprocess.png` (visualization)
- `04_postprocess/stats.json` (counts: yolo_original, row_extension, gap_fill, mask_recovery)

The export stage (GeoJSON) then reads `enriched_detections.json` instead of `detections.json`.

---

## 8. Visualization Spec

The overlay image should draw:

| Source | Color | Style |
|--------|-------|-------|
| YOLO original (occupied) | Red | Solid OBB + center dot |
| YOLO original (empty) | Green | Solid OBB + center dot |
| Row extension | Cyan | Dashed OBB + center dot |
| Gap fill | Yellow | Dashed OBB + center dot |
| Mask recovery | Magenta | Dashed OBB + center dot |

This makes it immediately visible which spots are real detections vs. inferred.

---

## 9. Testing Strategy

### Quantitative

For each image in the dataset, compare the post-processed output against ground truth:
- **Recall**: what fraction of GT spots have a post-processed spot within `0.5 × wp_px`?
- **Precision**: what fraction of post-processed spots match a GT spot?
- **F1**: harmonic mean

Target: raise recall from ~60% (YOLO-only) to ~85% without dropping precision below 80%.

### Visual

Use `scripts/visualize_ground_truth.py` (already exists) to compare GT overlays against post-processed overlays side by side.

### Edge cases to test explicitly

| Case | Example images | What to verify |
|------|---------------|----------------|
| Zero YOLO detections | 0020, 0021 | Stage C fills mask regions with reasonable slots |
| Very few detections (< 5) | 0006, 0012, 0013, 0017 | Stage B extends from sparse seeds, Stage C catches the rest |
| Over-detection (YOLO > GT) | 0003, 0007, 0014, 0018 | Stage D dedup doesn't make it worse |
| Curved street parking | 0000, 0001 | Local PCA tracks the curve correctly |
| Wide mask (multi-row parking lot) | 0005, 0009, 0015 | Two-row expansion fires correctly |
| Narrow mask (single-row street) | 0006, 0012 | No false two-row expansion |

---

## 10. Implementation Notes

### Distance Transform

```python
import cv2
dt = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
```

The DT value at a point = distance to the nearest mask boundary in pixels. At the center of a strip of width `W`, DT ≈ `W/2`. This is used for:
- Stopping propagation (DT too low = near edge)
- Deciding single vs. double row (DT > 0.7 × hp means wide enough for 2 rows)

### Local PCA Direction

```python
def local_pca_direction(mask: np.ndarray, cx: float, cy: float, radius: float) -> tuple[float, float]:
    """Return the dominant direction of the mask shape in a local window."""
    y_min, y_max = max(0, int(cy - radius)), min(mask.shape[0], int(cy + radius))
    x_min, x_max = max(0, int(cx - radius)), min(mask.shape[1], int(cx + radius))
    ys, xs = np.where(mask[y_min:y_max, x_min:x_max] > 0)
    if len(xs) < 3:
        return (1.0, 0.0)  # fallback: horizontal
    xs = xs.astype(np.float64) + x_min
    ys = ys.astype(np.float64) + y_min
    cov = np.cov(xs, ys)
    eigenvalues, eigenvectors = np.linalg.eigh(cov)
    principal = eigenvectors[:, np.argmax(eigenvalues)]
    return (float(principal[0]), float(principal[1]))
```

### No External Dependencies

The post-processing layer should use **only** numpy, opencv, and the Python standard library. No scikit-learn, no scipy, no shapely. This keeps the deployment footprint minimal.

---

## 11. File Placement

```
src/absolutemap_gen/
├── postprocess.py          # Stages A–D implementation
├── postprocess_config.py   # PostProcessConfig dataclass
├── pipeline.py             # Updated to call postprocess between detection and export
└── ...
```

Or as a standalone module that can be developed/tested independently:

```
scripts/run_postprocess.py   # CLI: takes mask + detections.json, outputs enriched_detections.json
```
