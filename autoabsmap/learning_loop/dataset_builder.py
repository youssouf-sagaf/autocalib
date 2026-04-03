"""DatasetBuilder — transforms captured sessions into training-ready datasets.

Separates SegFormer signals from YOLO-OBB signals because their
learning paths are distinct.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from pydantic import BaseModel

logger = logging.getLogger(__name__)

__all__ = ["SegmentationTrainingSet", "DetectionTrainingSet", "DatasetBuilder"]


class SegmentationTrainingSet(BaseModel):
    """Training-ready dataset for SegFormer retraining."""

    samples: list[dict[str, Any]]
    session_count: int


class DetectionTrainingSet(BaseModel):
    """Training-ready dataset for YOLO-OBB retraining."""

    samples: list[dict[str, Any]]
    session_count: int


class DatasetBuilder:
    """Build training datasets from captured operator sessions."""

    def build_segmentation_dataset(
        self, sessions: list[Path],
    ) -> SegmentationTrainingSet:
        """From sessions: extract seg masks, manual additions in mask-excluded
        areas (FN evidence), manual deletions in mask-included areas (FP evidence),
        difficulty tags for hard-case curriculum.
        """
        # TODO: implement
        logger.warning("DatasetBuilder.build_segmentation_dataset() not yet implemented")
        return SegmentationTrainingSet(samples=[], session_count=len(sessions))

    def build_detection_dataset(
        self, sessions: list[Path],
    ) -> DetectionTrainingSet:
        """From sessions: extract missed detections (manual adds -> FN),
        false detections (manual deletes -> FP + hard negatives),
        geometry corrections (center/angle/size edits -> OBB regression targets),
        source attribution for error localization by generation path.
        """
        # TODO: implement
        logger.warning("DatasetBuilder.build_detection_dataset() not yet implemented")
        return DetectionTrainingSet(samples=[], session_count=len(sessions))
