from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.deps import get_store
from app.config.settings import ImagerySource
from app.crop_engine.ingest import fetch_tile_for_roi
from app.dataset.store import DatasetStore

router = APIRouter(prefix="/crops", tags=["crops"])


class FetchRoiRequest(BaseModel):
    roi_polygon: dict[str, Any]
    source: ImagerySource = "ign-current"
    target_gsd: float = Field(default=0.05, gt=0)


@router.post("/fetch")
def fetch_roi(body: FetchRoiRequest, store: DatasetStore = Depends(get_store)):
    tiles = fetch_tile_for_roi(
        body.roi_polygon,
        body.source,
        body.target_gsd,
        store=store,
    )
    crop_id = tiles[0]["session_id"] if tiles else None
    return {"crop_id": crop_id, "tiles": tiles}
