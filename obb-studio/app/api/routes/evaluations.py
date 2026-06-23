from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.evaluation.benchmark import run_validation

router = APIRouter(prefix="/evaluations", tags=["evaluations"])


class EvalRequest(BaseModel):
    weights: str
    data_yaml: str
    imgsz: int = 1024
    device: str = ""


@router.post("/val")
def validate(body: EvalRequest):
    weights = Path(body.weights)
    data_yaml = Path(body.data_yaml)
    if not weights.is_file():
        raise HTTPException(status_code=400, detail=f"Weights not found: {weights}")
    if not data_yaml.is_file():
        raise HTTPException(status_code=400, detail=f"data.yaml not found: {data_yaml}")
    return run_validation(weights, data_yaml, imgsz=body.imgsz, device=body.device)
