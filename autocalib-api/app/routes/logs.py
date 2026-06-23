"""Frontend log sink — receives batched log lines from the browser.

POST /api/v1/logs -> writes to logs/front.log
"""

from __future__ import annotations

import logging

from fastapi import APIRouter
from pydantic import BaseModel

logger = logging.getLogger("app.frontend")

router = APIRouter(prefix="/api/v1", tags=["logs"])


class LogBatch(BaseModel):
    lines: list[str]


@router.post("/logs", status_code=204)
async def receive_logs(batch: LogBatch) -> None:
    """Write frontend log lines to the front logger (→ front.log)."""
    for line in batch.lines:
        logger.info(line)
