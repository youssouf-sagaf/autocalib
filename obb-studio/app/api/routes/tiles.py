from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_store
from app.dataset.store import DatasetStore

router = APIRouter(prefix="/tiles", tags=["tiles"])


def _with_display_name(row: dict) -> dict:
    image_path = row.get("image_path")
    if image_path:
        row = {**row, "name": Path(str(image_path)).stem}
    return row


@router.get("")
def list_tiles(session_id: str | None = None, store: DatasetStore = Depends(get_store)):
    return [_with_display_name(r) for r in store.list_tiles(session_id=session_id)]


@router.get("/{tile_id}")
def get_tile(tile_id: str, store: DatasetStore = Depends(get_store)):
    row = store.get_tile(tile_id)
    if not row:
        raise HTTPException(status_code=404, detail="Tile not found")
    flags = store.get_tile_flags(tile_id)
    anns = store.get_annotations(tile_id)
    return {**_with_display_name(row), "flags": flags, "annotations": anns}
