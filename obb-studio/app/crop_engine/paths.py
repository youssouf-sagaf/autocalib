"""On-disk layout for crop artifacts: ``data/{timestamp}.png``."""

from __future__ import annotations

from datetime import datetime, timezone


def crop_timestamp() -> str:
    """UTC stem, e.g. ``20250525T143022123Z`` (includes milliseconds)."""
    now = datetime.now(timezone.utc)
    ms = now.microsecond // 1000
    return f"{now.strftime('%Y%m%dT%H%M%S')}{ms:03d}Z"


def crop_file_stem(batch_ts: str, index: int, total: int) -> str:
    """File stem; suffix when a ROI yields multiple tiles."""
    if total <= 1:
        return batch_ts
    return f"{batch_ts}_{index:02d}"


def crop_image_name(stem: str, ext: str = "png") -> str:
    return f"{stem}.{ext.lstrip('.')}"
