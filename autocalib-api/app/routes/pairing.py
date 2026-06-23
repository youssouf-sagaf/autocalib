"""Pairing JSON store — deprecated (pairing lives in ``static_data.calibration``)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from pairing.models import PairingLinkRecord, PairingZoneRecord

router = APIRouter(prefix="/api/v1/pairings", tags=["pairings"])


class SavePairingsRequest(BaseModel):
    client: str
    links: list[PairingLinkRecord] = Field(default_factory=list)
    zones: list[PairingZoneRecord] = Field(default_factory=list)


@router.post("/{device_id}")
async def save_pairings(device_id: str, request: SavePairingsRequest) -> dict:
    """Removed — use ``POST /devices/{id}/calibration``."""
    raise HTTPException(
        status_code=410,
        detail="Deprecated — use POST /api/v1/devices/{device_id}/calibration",
    )


@router.get("/{device_id}")
async def load_pairings(device_id: str) -> dict:
    """Removed — load calibration via ``GET /devices/{id}/calibration``."""
    raise HTTPException(
        status_code=410,
        detail="Deprecated — use GET /api/v1/devices/{device_id}/calibration",
    )
