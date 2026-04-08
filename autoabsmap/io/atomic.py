"""Atomic file writes — single implementation, no duplicates.

All JSON writes go through this function to avoid partial files on crash
or interrupt.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

__all__ = ["write_json_atomic"]


def write_json_atomic(path: str | Path, obj: Any, *, indent: int = 2) -> None:
    """Write JSON atomically (temp file + rename)."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(obj, indent=indent, allow_nan=False, ensure_ascii=False)
    tmp = p.with_name(f"{p.name}.tmp.{os.getpid()}")
    try:
        tmp.write_text(payload, encoding="utf-8")
        tmp.replace(p)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
    logger.debug("Wrote %s (%d bytes)", p, len(payload))
