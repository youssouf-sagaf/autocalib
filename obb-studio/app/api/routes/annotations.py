from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.annotations.models import ObbAnnotation
from app.annotations.validators import validate_annotations
from app.api.deps import get_store
from app.dataset.store import DatasetStore

router = APIRouter(prefix="/annotations", tags=["annotations"])


class AnnotationsPayload(BaseModel):
    annotations: list[ObbAnnotation]


@router.put("/{tile_id}")
def upsert_annotations(
    tile_id: str,
    body: AnnotationsPayload,
    store: DatasetStore = Depends(get_store),
):
    if not store.get_tile(tile_id):
        raise HTTPException(status_code=404, detail="Tile not found")
    errors = validate_annotations(body.annotations)
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    payload = [a.model_dump() for a in body.annotations]
    store.upsert_annotations(tile_id, payload)
    return {"tile_id": tile_id, "count": len(payload)}


class TileFlagBody(BaseModel):
    flag: str
    value: str


@router.post("/{tile_id}/flags")
def set_flag(tile_id: str, body: TileFlagBody, store: DatasetStore = Depends(get_store)):
    if not store.get_tile(tile_id):
        raise HTTPException(status_code=404, detail="Tile not found")
    store.set_tile_flag(tile_id, body.flag, body.value)
    return {"tile_id": tile_id, "flag": body.flag, "value": body.value}
