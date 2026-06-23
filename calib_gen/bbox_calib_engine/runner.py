"""BBoxCalibEngine — single public entry point for the bbox calib pipeline.

Usage::

    engine = BBoxCalibEngine(detector=yolo, settings=settings)
    result = engine.run(request, on_progress=callback)
"""

from __future__ import annotations

import json
import logging
import tempfile
from pathlib import Path
from typing import Callable

import cv2

from calib_gen.bbox_calib_engine.models import (
    BBoxCalibRequest,
    BBoxCalibResult,
    StageProgress,
)
from calib_gen.config.settings import CalibSettings
from calib_gen.geometry.anchors import step_extract_candidates
from calib_gen.geometry.cleaning import step_clean
from calib_gen.geometry.fusion import step_dedup_fused, step_deduplicate_and_fuse
from calib_gen.geometry.shrink import step_shrink_to_calib
from calib_gen.io.frame_loader import load_and_filter_paths
from calib_gen.io.s3_loader import download_device_images
from calib_gen.ml.detector import Detector
from calib_gen.models.detection import FrameDetections, FrameResult

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[StageProgress], None]

_STAGES = [
    ("download", 5),
    ("detection", 30),
    ("frame_selection", 35),
    ("cleaning", 50),
    ("anchor_extraction", 60),
    ("fusion", 75),
    ("post_fusion_dedup", 85),
    ("shrink", 95),
    ("done", 100),
]


class BBoxCalibEngine:
    """Orchestrates the full bbox calib pipeline: S3 → detection → fusion → calib bboxes."""

    def __init__(
        self,
        detector: Detector,
        settings: CalibSettings | None = None,
    ) -> None:
        self._detector = detector
        self._settings = settings or CalibSettings()

    def run(
        self,
        request: BBoxCalibRequest,
        on_progress: ProgressCallback | None = None,
    ) -> BBoxCalibResult:
        """Execute the full pipeline and return calib bboxes."""
        settings = self._settings
        if request.top_n_frames is not None:
            settings = settings.model_copy(update={"top_n_frames": request.top_n_frames})
        if request.confidence_threshold is not None:
            settings = settings.model_copy(
                update={
                    "yolo_conf": request.confidence_threshold,
                    "sam3_threshold": request.confidence_threshold,
                },
            )

        def _emit(stage: str, percent: int) -> None:
            if on_progress:
                on_progress(StageProgress(stage=stage, percent=percent))

        # 1. Download / load frames
        _emit("download", 5)
        if request.images_dir:
            images_dir = Path(request.images_dir)
        else:
            dest = Path(tempfile.mkdtemp(prefix="calib_")) / request.device_id
            images_dir = download_device_images(
                device_id=request.device_id,
                client=request.client,
                dest_dir=dest,
                settings=settings,
                target_date=request.target_date,
            )

        image_paths = load_and_filter_paths(images_dir, settings)
        if not image_paths:
            logger.error("No images to process for %s", request.device_id)
            return BBoxCalibResult(
                device_id=request.device_id,
                calib_bboxes=[],
                frame_count=0,
                total_detections=0,
            )

        # 2. Detection (cached)
        _emit("detection", 15)
        all_detections = self._detect_all(image_paths, request.device_id, settings)

        # 3. Frame selection (top N by occupancy)
        _emit("frame_selection", 35)
        frames = self._select_top_frames(all_detections, settings)
        if not frames:
            logger.error("No frames with detections for %s", request.device_id)
            return BBoxCalibResult(
                device_id=request.device_id,
                calib_bboxes=[],
                frame_count=0,
                total_detections=0,
            )

        # 4. Cleaning
        _emit("cleaning", 50)
        frames = step_clean(frames, settings)

        # 5. Anchor extraction + center estimation
        _emit("anchor_extraction", 60)
        candidates = step_extract_candidates(frames, settings)

        # 6. Cross-frame fusion
        _emit("fusion", 75)
        fused = step_deduplicate_and_fuse(candidates, settings)

        # 7. Post-fusion dedup
        _emit("post_fusion_dedup", 85)
        fused = step_dedup_fused(fused, settings)

        # 8. Shrink to calib bboxes
        _emit("shrink", 95)
        calib_bboxes = step_shrink_to_calib(fused, settings)

        _emit("done", 100)
        total_dets = sum(len(e.detections) for e in all_detections)
        logger.info(
            "Pipeline complete for %s — %d calib bboxes from %d frames",
            request.device_id, len(calib_bboxes), len(frames),
        )
        return BBoxCalibResult(
            device_id=request.device_id,
            calib_bboxes=calib_bboxes,
            frame_count=len(frames),
            total_detections=total_dets,
            selected_frame_paths=[str(f.path) for f in frames],
        )

    # ── Detection with cache ─────────────────────────────────────────

    def _detect_all(
        self,
        image_paths: list[Path],
        device_id: str,
        settings: CalibSettings,
    ) -> list[FrameDetections]:
        """Run detector on every image. Results are cached to disk."""
        cache_path = self._detection_cache_path(device_id, settings)

        if settings.use_detection_cache and cache_path.exists():
            logger.info("Loading cached detections from %s", cache_path.name)
            return self._load_cache(cache_path)

        all_entries: list[FrameDetections] = []
        for i, path in enumerate(image_paths):
            bgr = cv2.imread(str(path))
            if bgr is None:
                logger.warning("Cannot read %s — skipping", path.name)
                continue

            detections = self._detector.detect(bgr)
            all_entries.append(FrameDetections(
                image_path=str(path),
                detections=detections,
            ))
            if (i + 1) % 10 == 0 or i + 1 == len(image_paths):
                logger.info("  Detection progress: %d/%d", i + 1, len(image_paths))

        if settings.use_detection_cache:
            self._save_cache(all_entries, cache_path)

        return all_entries

    def _detection_cache_path(self, device_id: str, settings: CalibSettings) -> Path:
        settings.cache_dir.mkdir(parents=True, exist_ok=True)
        suffix = f"yolo_conf{settings.yolo_conf}_iou{settings.yolo_iou}"
        return settings.cache_dir / f"{device_id}_{suffix}.json"

    @staticmethod
    def _save_cache(entries: list[FrameDetections], path: Path) -> None:
        data = [e.model_dump() for e in entries]
        path.write_text(json.dumps(data, indent=2))
        logger.info("Saved detection cache → %s", path.name)

    @staticmethod
    def _load_cache(path: Path) -> list[FrameDetections]:
        raw = json.loads(path.read_text())
        return [FrameDetections.model_validate(entry) for entry in raw]

    # ── Frame selection ──────────────────────────────────────────────

    @staticmethod
    def _select_top_frames(
        entries: list[FrameDetections],
        settings: CalibSettings,
    ) -> list[FrameResult]:
        """Pick the most-occupied frames and load their images."""
        ranked = sorted(entries, key=lambda e: len(e.detections), reverse=True)
        top = ranked[: settings.top_n_frames]

        results: list[FrameResult] = []
        for entry in top:
            bgr = cv2.imread(entry.image_path)
            if bgr is None:
                continue
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            results.append(FrameResult(
                path=Path(entry.image_path),
                image=rgb,
                detections=list(entry.detections),
            ))

        counts = [len(r.detections) for r in results]
        logger.info(
            "Frame selection: kept %d/%d frames — detections/frame: %s",
            len(results), len(entries), counts,
        )
        return results
