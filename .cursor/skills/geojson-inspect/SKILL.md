---
name: geojson-inspect
description: >-
  Inspect, validate, and summarize GeoJSON slot files from the absmap pipeline.
  Use when the user wants to check a GeoJSON export, debug slot geometry,
  validate schema, or compare two GeoJSON files.
---

# GeoJSON Inspect

Validate and analyze GeoJSON files produced by the absmap pipeline.

## Quick validation

```python
import json

with open("<file>.geojson") as f:
    data = json.load(f)

features = data["features"]
print(f"Features: {len(features)}")
```

### Schema check (v1)

Every feature must have these properties:

```python
REQUIRED_PROPS = {"slot_id", "center", "source", "confidence", "status"}

for i, f in enumerate(features):
    props = set(f["properties"].keys())
    missing = REQUIRED_PROPS - props
    if missing:
        print(f"Feature {i}: missing {missing}")
```

### Source distribution

```python
from collections import Counter
sources = Counter(f["properties"]["source"] for f in features)
for source, count in sources.most_common():
    print(f"  {source}: {count}")
```

Valid sources: `yolo`, `row_extension`, `gap_fill`, `mask_recovery`, `auto_reprocess`, `manual`.

### Geometry validation

```python
for i, f in enumerate(features):
    coords = f["geometry"]["coordinates"][0]

    # Polygon must be closed
    if coords[0] != coords[-1]:
        print(f"Feature {i}: polygon not closed")

    # OBB should have exactly 5 points (4 corners + closing)
    if len(coords) != 5:
        print(f"Feature {i}: expected 5 coords (OBB), got {len(coords)}")

    # Coordinates should be in WGS84 range
    for lng, lat in coords:
        if not (-180 <= lng <= 180 and -90 <= lat <= 90):
            print(f"Feature {i}: coords out of WGS84 range: [{lng}, {lat}]")
```

### Confidence and status distribution

```python
import statistics

confidences = [f["properties"]["confidence"] for f in features]
print(f"Confidence: min={min(confidences):.2f} max={max(confidences):.2f} "
      f"mean={statistics.mean(confidences):.2f}")

statuses = Counter(f["properties"]["status"] for f in features)
print(f"Status: {dict(statuses)}")
```

### Angle distribution (detect orientation clusters)

```python
import math

def obb_angle(coords):
    """Angle of the first edge of the OBB in degrees."""
    dx = coords[1][0] - coords[0][0]
    dy = coords[1][1] - coords[0][1]
    return math.degrees(math.atan2(dy, dx)) % 180

angles = [obb_angle(f["geometry"]["coordinates"][0]) for f in features]
print(f"Angle range: {min(angles):.1f}° – {max(angles):.1f}°")
```

## Compare two GeoJSON files

Useful for baseline vs final, or old model vs new model.

```python
def load_slots(path):
    with open(path) as f:
        return {feat["properties"]["slot_id"]: feat for feat in json.load(f)["features"]}

old = load_slots("baseline.geojson")
new = load_slots("final.geojson")

added = set(new) - set(old)
removed = set(old) - set(new)
kept = set(old) & set(new)

print(f"Added: {len(added)}, Removed: {len(removed)}, Kept: {len(kept)}")
```

## Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Missing `source` field | Old schema or export bug | Check `export/geojson.py` uses schema v1 |
| Coordinates near (0, 0) | CRS not converted to WGS84 | Check outbound CRS gate in `export/geojson.py` |
| Duplicate `slot_id` | Merge/dedup not applied | Check `MultiCropOrchestrator.merge_and_dedup` |
| Non-OBB polygons (≠5 points) | Geometry simplification bug | Check `geometry/postprocess.py` |
