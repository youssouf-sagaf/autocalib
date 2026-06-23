"""Calib preview proxy — forwards to cv-backend (COCOPARKS_PROD_URL).

GET  /api/v1/devices/{device_id}/calib-preview
POST /api/v1/devices/{device_id}/calib-preview/refresh
GET  /api/v1/devices/{device_id}/last-pic/object?object_key=...
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from app.services.cocoparks_calib_preview import (
    fetch_calib_preview,
    fetch_last_pic_object,
    post_calib_preview_refresh,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/devices", tags=["calib-preview"])


@router.get("/{device_id}/calib-preview")
async def get_calib_preview(device_id: str) -> JSONResponse:
    """Return cached calib preview (top occupied last_pic + YOLO detections)."""
    try:
        status, body = await fetch_calib_preview(device_id)
        return JSONResponse(status_code=status, content=body)
    except httpx.HTTPError as exc:
        logger.exception("cv-backend GET calib-preview failed for %s", device_id)
        raise HTTPException(status_code=502, detail=f"cv-backend unavailable: {exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/{device_id}/calib-preview/refresh")
async def refresh_calib_preview(device_id: str) -> JSONResponse:
    """Trigger async YOLO scan over daytime last_pic images."""
    try:
        status, body = await post_calib_preview_refresh(device_id)
        # cv-backend 409 = in-memory lock held; GET may still show idle — tell FE to poll.
        if status == 409:
            detail = body.get("detail") if isinstance(body, dict) else None
            return JSONResponse(
                status_code=202,
                content={
                    "job_id": None,
                    "status": "already_running",
                    "already_running": True,
                    "detail": detail or "refresh already in progress for this device",
                },
            )
        return JSONResponse(status_code=status, content=body)
    except httpx.HTTPError as exc:
        logger.exception("cv-backend POST calib-preview/refresh failed for %s", device_id)
        raise HTTPException(status_code=502, detail=f"cv-backend unavailable: {exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/{device_id}/last-pic/object")
async def get_last_pic_object(
    device_id: str,
    object_key: str = Query(..., description="Storage object key (last_pic/{did}/…)."),
) -> JSONResponse:
    """Download a last_pic JPEG by object key (for calib-preview UI)."""
    try:
        status, body = await fetch_last_pic_object(device_id, object_key)
        return JSONResponse(status_code=status, content=body)
    except httpx.HTTPError as exc:
        logger.exception("cv-backend GET last-pic/object failed for %s", device_id)
        raise HTTPException(status_code=502, detail=f"cv-backend unavailable: {exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
