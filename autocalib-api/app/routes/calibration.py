"""Device calibration endpoints — proxy cocospot static_data (Cocopilot contract).

GET  /api/v1/devices/{device_id}/calibration       -> bboxes + slots from B2B
POST /api/v1/devices/{device_id}/calibration       -> merge + write B2B static_data
GET  /api/v1/devices/{device_id}/calibration/image -> last_processed_image proxy
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.calib_models import CalibrationSaveRequest, DeviceCalibrationResponse
from app.services.b2b_geography import b2b_enabled
from app.services.cocospot_calibration import (
    fetch_calibration_image,
    fetch_device_calibration,
    save_device_calibration,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/devices", tags=["calibration"])


@router.get("/{device_id}/calibration", response_model=DeviceCalibrationResponse)
async def get_device_calibration(device_id: str) -> DeviceCalibrationResponse:
    """Load calibration bboxes and paired slots from cocospot static_data."""
    if not b2b_enabled():
        raise HTTPException(status_code=503, detail="B2B sync disabled (B2B_ENABLED=false)")
    try:
        return await fetch_device_calibration(device_id)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail=f"No static_data for device {device_id}") from exc
        logger.exception("B2B GET static_data failed for %s", device_id)
        raise HTTPException(
            status_code=502,
            detail=f"B2B unavailable: HTTP {exc.response.status_code}",
        ) from exc
    except Exception as exc:
        logger.exception("Failed to load calibration for %s", device_id)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/{device_id}/calibration")
async def post_device_calibration(
    device_id: str,
    request: CalibrationSaveRequest,
) -> dict:
    """Save calibration to cocospot static_data (merge like Cocopilot-FE)."""
    if not b2b_enabled():
        raise HTTPException(status_code=503, detail="B2B sync disabled (B2B_ENABLED=false)")
    try:
        result = await save_device_calibration(device_id, request)
        return {"ok": True, "device_id": device_id, "result": result}
    except httpx.HTTPStatusError as exc:
        logger.exception("B2B POST static_data failed for %s", device_id)
        raise HTTPException(
            status_code=502,
            detail=f"B2B unavailable: HTTP {exc.response.status_code}",
        ) from exc
    except Exception as exc:
        logger.exception("Failed to save calibration for %s", device_id)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/{device_id}/calibration/image")
async def get_device_calibration_image(
    device_id: str,
    draw: bool = Query(True, description="Request bbox overlay on the image (B2B default)."),
) -> dict:
    """Proxy cocospot last_processed_image for calib / pairing carousel."""
    if not b2b_enabled():
        raise HTTPException(status_code=503, detail="B2B sync disabled (B2B_ENABLED=false)")
    try:
        return await fetch_calibration_image(device_id, draw=draw)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail=f"No image for device {device_id}") from exc
        logger.exception("B2B GET last_processed_image failed for %s", device_id)
        raise HTTPException(
            status_code=502,
            detail=f"B2B unavailable: HTTP {exc.response.status_code}",
        ) from exc
    except Exception as exc:
        logger.exception("Failed to load calibration image for %s", device_id)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
