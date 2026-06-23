"""Request / result / progress models for the bbox calib engine.

These are the Pydantic boundary objects — the API layer sends a
``BBoxCalibRequest`` and receives a ``BBoxCalibResult``.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from calib_gen.models.fusion import CalibBbox


class BBoxCalibRequest(BaseModel):
    """Input contract for the bbox calib engine."""

    device_id: str
    client: str
    target_date: Optional[str] = None
    images_dir: Optional[str] = None
    confidence_threshold: Optional[float] = None
    top_n_frames: Optional[int] = None


class StageProgress(BaseModel):
    """Progress event emitted by the engine at each pipeline stage."""

    stage: str
    percent: int = Field(ge=0, le=100)


class BBoxCalibResult(BaseModel):
    """Output contract for the bbox calib engine."""

    device_id: str
    calib_bboxes: list[CalibBbox]
    frame_count: int
    total_detections: int
    selected_frame_paths: list[str] = Field(default_factory=list)
