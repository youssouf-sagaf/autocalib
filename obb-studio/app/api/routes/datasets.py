from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_store
from app.dataset.store import DatasetStore
from app.dataset.yolo_export import export_yolo_obb_snapshot

router = APIRouter(prefix="/datasets", tags=["datasets"])


class CreateDatasetBody(BaseModel):
    name: str
    tile_ids: list[str]


@router.get("")
def list_datasets(store: DatasetStore = Depends(get_store)):
    return store.list_datasets()


@router.post("")
def create_dataset(body: CreateDatasetBody, store: DatasetStore = Depends(get_store)):
    return store.create_dataset(body.name, body.tile_ids)


@router.post("/{dataset_id}/export/yolo")
def export_yolo(dataset_id: str, store: DatasetStore = Depends(get_store)):
    try:
        return export_yolo_obb_snapshot(dataset_id, store=store)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
