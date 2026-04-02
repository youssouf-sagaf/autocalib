---
name: absmap-pipeline-run
description: >-
  Run the absmap parking slot pipeline end-to-end on a GeoTIFF or ROI.
  Use when the user wants to run the pipeline, test a detection, debug
  pipeline output, or process a parking lot image.
---

# Absmap Pipeline Run

Run `ParkingSlotPipeline` end-to-end on a single crop or multi-crop job, inspect results.

## Quick run — single crop from a local GeoTIFF

```python
from absmap.config.settings import AbsmapSettings
from absmap.io.geotiff import GeoRasterSlice
from absmap.imagery.geotiff_file import GeoTiffFileProvider
from absmap.ml.segmentation import SegFormerSegmenter
from absmap.ml.detection import YoloObbDetector
from absmap.pipeline.runner import ParkingSlotPipeline
from absmap.pipeline.models import PipelineRequest

settings = AbsmapSettings()

pipeline = ParkingSlotPipeline(
    imagery=GeoTiffFileProvider(path="<path_to_geotiff>"),
    segmenter=SegFormerSegmenter(settings.segformer),
    detector=YoloObbDetector(settings.yolo),
)

request = PipelineRequest(roi=<geojson_polygon>)
result = pipeline.run(request, on_progress=lambda p: print(f"{p.stage} {p.percent}%"))

print(f"Slots detected: {len(result.slots)}")
```

## Quick run — from ROI with imagery provider

```python
from absmap.imagery.mapbox import MapboxImageryProvider

provider = MapboxImageryProvider(token=settings.imagery.mapbox_token)

pipeline = ParkingSlotPipeline(
    imagery=provider,
    segmenter=SegFormerSegmenter(settings.segformer),
    detector=YoloObbDetector(settings.yolo),
)

request = PipelineRequest(roi={
    "type": "Polygon",
    "coordinates": [[[lng1, lat1], [lng2, lat2], [lng3, lat3], [lng4, lat4], [lng1, lat1]]]
})
result = pipeline.run(request)
```

## Inspect results

After a run, check these things:

### 1. Slot count and source distribution

```python
from collections import Counter
sources = Counter(s.source for s in result.slots)
print(f"Total: {len(result.slots)}")
for source, count in sources.most_common():
    print(f"  {source}: {count}")
```

### 2. GeoJSON export

```python
from absmap.export.geojson import write_geojson
write_geojson(result.slots, "output.geojson")
```

### 3. Baseline vs final (for learning loop)

```python
print(f"Baseline slots: {len(result.baseline_slots)}")
print(f"Post-engine slots: {len(result.slots)}")
delta = len(result.slots) - len(result.baseline_slots)
print(f"GeometricEngine delta: {delta:+d}")
```

### 4. CRS check

```python
# Verify the raster CRS was handled correctly
print(f"Raster CRS: EPSG:{result.run_meta.crs_epsg}")
print(f"Actual GSD: {result.run_meta.gsd_m:.3f} m/px")
```

## Multi-crop via absmap-api

```bash
curl -X POST http://localhost:8000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{"crops": [{"polygon": <geojson>}, {"polygon": <geojson>}]}'
```

Then stream progress:
```bash
curl -N http://localhost:8000/api/v1/jobs/<job_id>
```

## Common issues

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| 0 slots detected | Bad imagery (clouds, snow, wrong area) | Check raster visually, verify ROI coordinates |
| Slots offset on map | CRS mismatch | Check `GeoRasterSlice.crs_epsg` matches provider |
| Very slow | Large ROI on CPU | Reduce ROI size or check `target_gsd_m` (lower = more pixels) |
| OOM | Model + large raster | Reduce crop size, check `gsd_m` isn't too fine |
