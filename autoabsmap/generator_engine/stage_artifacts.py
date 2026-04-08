"""Debug artifact writer — saves stage-by-stage images like the R&D pipeline.

Layout per job:
    artifacts/{job_id}/stages/
        00_imagery/       crop_rgb.png, meta.json
        01_segmentation/  mask_raw.png, mask_refined.png, overlay_segmentation.png
        02_detection/     overlay_detections.png, detections.json
        03_postprocess/   overlay_postprocess.png, stats.json
        04_export/        slots_wgs84.geojson

All writes are optional — if ``out_dir`` is None the dumper is a no-op.
"""

from __future__ import annotations

import json
import logging
import math
from pathlib import Path
from typing import Any

import cv2
import numpy as np

logger = logging.getLogger(__name__)

__all__ = ["ArtifactDumper"]


_COLORS = {
    "yolo": (0, 255, 0),
    "gap_fill": (255, 165, 0),
    "extension": (255, 255, 0),
    "recovery": (180, 0, 255),
    "dedup": (100, 100, 100),
}


def _obb_corners(cx: float, cy: float, w: float, h: float, angle: float) -> np.ndarray:
    """Return 4 OBB corners as int32 array for cv2.polylines.

    Uses R&D convention: height along (cos a, sin a), width perpendicular.
    """
    h_vec = np.array([math.cos(angle), math.sin(angle)]) * (h / 2.0)
    w_vec = np.array([-math.sin(angle), math.cos(angle)]) * (w / 2.0)
    c = np.array([cx, cy])
    return np.int32([c + h_vec + w_vec, c - h_vec + w_vec,
                     c - h_vec - w_vec, c + h_vec - w_vec])


def _draw_obbs(
    canvas: np.ndarray,
    slots: list[Any],
    color: tuple[int, int, int] = (0, 255, 0),
    thickness: int = 2,
) -> np.ndarray:
    for s in slots:
        pts = _obb_corners(s.center_x, s.center_y, s.width, s.height, s.angle_rad)
        cv2.polylines(canvas, [pts], isClosed=True, color=color, thickness=thickness)
        cx, cy = int(s.center_x), int(s.center_y)
        cv2.circle(canvas, (cx, cy), 3, color, -1)
    return canvas


class ArtifactDumper:
    """Writes debug PNGs and JSON for each pipeline stage.

    Pass ``out_dir=None`` to disable all writes (zero overhead in production).
    """

    def __init__(self, out_dir: Path | str | None) -> None:
        if out_dir is None:
            self._root: Path | None = None
            return
        self._root = Path(out_dir)
        self._root.mkdir(parents=True, exist_ok=True)
        logger.info("Artifact dumper active → %s", self._root)

    @property
    def active(self) -> bool:
        return self._root is not None

    def _stage_dir(self, name: str) -> Path:
        assert self._root is not None
        d = self._root / "stages" / name
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _save_png(self, directory: Path, filename: str, img: np.ndarray) -> None:
        path = directory / filename
        if img.ndim == 3 and img.shape[2] == 3:
            img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
        cv2.imwrite(str(path), img)
        logger.debug("Artifact: %s", path)

    def _save_json(self, directory: Path, filename: str, obj: Any) -> None:
        path = directory / filename
        path.write_text(
            json.dumps(obj, indent=2, allow_nan=False, ensure_ascii=False),
            encoding="utf-8",
        )
        logger.debug("Artifact: %s", path)

    # ── 00 Imagery ────────────────────────────────────────────────────

    def dump_imagery(self, raster: Any, roi: Any | None = None) -> None:
        """Save the fetched RGB crop, ROI overlay, and metadata."""
        if not self.active:
            return
        d = self._stage_dir("00_imagery")
        self._save_png(d, "crop_rgb.png", raster.pixels)

        if roi is not None:
            from rasterio.transform import Affine
            overlay = raster.pixels.copy()
            aff = Affine(*raster.affine)
            inv = ~aff
            coords = roi.coordinates[0]
            pts = np.array(
                [[int(round(px)), int(round(py))]
                 for lon, lat in coords
                 for px, py in [inv * (lon, lat)]],
                dtype=np.int32,
            )
            cv2.polylines(overlay, [pts], isClosed=True, color=(0, 255, 0), thickness=2)
            for i, (px, py) in enumerate(pts):
                cv2.circle(overlay, (int(px), int(py)), 5, (255, 0, 0), -1)
                cv2.putText(overlay, str(i), (int(px) + 8, int(py) - 4),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
            self._save_png(d, "crop_with_roi.png", overlay)

            roi_coords = [{"lon": c[0], "lat": c[1]} for c in coords]
        else:
            roi_coords = None

        meta: dict[str, Any] = {
            "crs_epsg": raster.crs_epsg,
            "width": raster.width,
            "height": raster.height,
            "gsd_m": raster.gsd_m,
            "affine": list(raster.affine),
            "bounds_wgs84": raster.bounds_wgs84.model_dump(),
        }
        if roi_coords is not None:
            meta["roi_polygon"] = roi_coords
        self._save_json(d, "meta.json", meta)

    # ── 01 Segmentation ──────────────────────────────────────────────

    def dump_segmentation(
        self,
        raster: Any,
        seg_output: Any,
        clipped_mask: Any | None = None,
    ) -> None:
        """Save raw mask, refined mask, ROI-clipped mask, and overlay."""
        if not self.active:
            return
        d = self._stage_dir("01_segmentation")
        self._save_png(d, "mask_raw.png", seg_output.mask_raw)
        self._save_png(d, "mask_refined.png", seg_output.mask_refined)
        if clipped_mask is not None:
            self._save_png(d, "mask_clipped_roi.png", clipped_mask)

        use_mask = clipped_mask if clipped_mask is not None else seg_output.mask_refined
        overlay = raster.pixels.copy().astype(np.float32)
        green = np.zeros_like(overlay)
        green[:, :, 1] = 255.0
        mask_bool = use_mask > 0
        mask_3c = np.stack([mask_bool] * 3, axis=-1)
        blended = np.where(mask_3c, overlay * 0.6 + green * 0.4, overlay)
        self._save_png(d, "overlay_segmentation.png", blended.astype(np.uint8))

    # ── 02 Detection ──────────────────────────────────────────────────

    def dump_detections(self, raster: Any, pixel_slots: list[Any]) -> None:
        """Save detection OBBs drawn on the RGB image + JSON metadata."""
        if not self.active:
            return
        d = self._stage_dir("02_detection")

        overlay = raster.pixels.copy()
        _draw_obbs(overlay, pixel_slots, color=(0, 255, 0), thickness=2)
        self._save_png(d, "overlay_detections.png", overlay)

        det_list = [
            {
                "center": [s.center_x, s.center_y],
                "width": s.width,
                "height": s.height,
                "angle_rad": s.angle_rad,
                "confidence": s.confidence,
                "class_id": s.class_id,
                "source": s.source if isinstance(s.source, str) else s.source.value,
            }
            for s in pixel_slots
        ]
        self._save_json(d, "detections.json", {
            "count": len(det_list),
            "detections": det_list,
        })

    # ── 03 Postprocess ────────────────────────────────────────────────

    def dump_postprocess(
        self,
        raster: Any,
        enriched_slots: list[Any],
        baseline_count: int,
    ) -> None:
        """Save postprocess overlay with color-coded sources + stats."""
        if not self.active:
            return
        d = self._stage_dir("03_postprocess")

        overlay = raster.pixels.copy()
        for s in enriched_slots:
            src = s.source if isinstance(s.source, str) else s.source.value
            color = _COLORS.get(src, (0, 255, 0))
            _draw_obbs(overlay, [s], color=color, thickness=2)
        self._save_png(d, "overlay_postprocess.png", overlay)

        source_counts: dict[str, int] = {}
        for s in enriched_slots:
            src = s.source if isinstance(s.source, str) else s.source.value
            source_counts[src] = source_counts.get(src, 0) + 1

        self._save_json(d, "stats.json", {
            "baseline_slots": baseline_count,
            "enriched_slots": len(enriched_slots),
            "by_source": source_counts,
        })

    # ── 04 Export ─────────────────────────────────────────────────────

    def dump_export(self, geo_slots: list[Any]) -> None:
        """Save final GeoJSON (WGS84 polygons)."""
        if not self.active:
            return
        d = self._stage_dir("04_export")

        features = []
        for s in geo_slots:
            features.append({
                "type": "Feature",
                "properties": {
                    "slot_id": s.slot_id,
                    "source": s.source if isinstance(s.source, str) else s.source.value,
                    "confidence": s.confidence,
                },
                "geometry": s.polygon.model_dump() if hasattr(s.polygon, "model_dump") else s.polygon,
            })
        fc = {
            "type": "FeatureCollection",
            "features": features,
        }
        self._save_json(d, "slots_wgs84.geojson", fc)
