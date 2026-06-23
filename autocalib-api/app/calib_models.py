"""API-layer models for the calib bbox generator.

These models live in autocalib-api, NOT in the calib_gen package.
The API layer owns the job lifecycle; the engine only knows about
BBoxCalibRequest / BBoxCalibResult.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from calib_gen.models.fusion import CalibBbox


class CalibJobRequest(BaseModel):
    """POST body to submit a calib bbox generation job."""

    device_id: str
    client: str
    target_date: Optional[str] = None
    confidence_threshold: Optional[float] = Field(
        default=None, ge=0.0, le=1.0,
        description="YOLO confidence threshold override",
    )
    top_n_frames: Optional[int] = Field(
        default=None, ge=1, le=50,
        description="Number of top frames to use",
    )


class CalibJobStatus(str, Enum):
    pending = "pending"
    running = "running"
    done = "done"
    failed = "failed"


class CalibProgress(BaseModel):
    """Progress event streamed via SSE during a calib job."""

    stage: str
    percent: int = Field(ge=0, le=100)


class CalibJob(BaseModel):
    """Job state as seen by the frontend (polling or SSE)."""

    id: str
    status: CalibJobStatus = CalibJobStatus.pending
    progress: CalibProgress | None = None
    error: str | None = None


class CalibJobResult(BaseModel):
    """Final result of a calib bbox generation job."""

    job_id: str
    device_id: str
    calib_bboxes: list[CalibBbox]
    frame_count: int
    total_detections: int


class DeviceCalibBbox(CalibBbox):
    """Calib bbox loaded from or destined for cocospot static_data."""

    slot_id: str | None = None
    rotation: float = 0.0


class DeviceCalibrationResponse(BaseModel):
    """GET /api/v1/devices/{device_id}/calibration."""

    device_id: str
    image_width: int
    image_height: int
    bboxes: list[DeviceCalibBbox]
    slots: dict[str, dict] = Field(default_factory=dict)
    street_name: str | None = None
    nb_slots: int = 0
    polygon: list | dict | None = None
    front_marker: dict | None = None


class CalibrationSlotEntry(BaseModel):
    """One paired slot entry in calibration.slots."""

    lat: float
    lng: float
    slot_type: str = "standard"


class CalibrationSaveRequest(BaseModel):
    """POST /api/v1/devices/{device_id}/calibration — Cocopilot merge semantics."""

    bboxes: list[DeviceCalibBbox]
    slots: dict[str, CalibrationSlotEntry] = Field(default_factory=dict)
    image_width: int = Field(ge=1)
    image_height: int = Field(ge=1)
    reset: bool = False
    replace_slots: bool = False
    street_name: str | None = None
    nb_slots: int | None = None
    polygon: list | dict | None = None
    front_marker: dict | None = None
