"""Download device images from S3.

Filters by date, age, and daytime on S3 keys before downloading
so only relevant images hit the local disk. Downloads run in parallel
since boto3 low-level S3 clients are thread-safe.
"""

from __future__ import annotations

import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from calib_gen.config.settings import CalibSettings

logger = logging.getLogger(__name__)

DOWNLOAD_PARALLELISM = 10

MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

_TS_PATTERN = re.compile(
    r"(\d{1,2}):(\d{2}):(\d{2})(AM|PM)-UTCZ", re.IGNORECASE,
)


def download_device_images(
    device_id: str,
    client: str,
    dest_dir: Path,
    settings: CalibSettings,
    *,
    target_date: str | None = None,
) -> Path:
    """Download ``.jpg`` images for *device_id* from S3 into *dest_dir*.

    Listing + filtering runs sequentially (cheap, ~1-2s for ~1k keys),
    then the actual downloads run in a thread pool of
    ``DOWNLOAD_PARALLELISM`` workers — typical cold-cache speedup is
    ~6-8× for a device with ~300 frames. Returns *dest_dir*.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)

    s3 = _create_s3_client(settings)
    prefix = f"{client}/{device_id}/"
    date_fragment = _date_to_s3_fragment(target_date) if target_date else None
    cutoff_date = datetime.utcnow() - timedelta(days=settings.max_age_days)

    paginator = s3.get_paginator("list_objects_v2")
    pages = paginator.paginate(Bucket=settings.s3_bucket, Prefix=prefix)

    pending: list[tuple[str, Path]] = []
    total_listed = filtered_out = skipped = 0
    for page in pages:
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if not key.lower().endswith(".jpg"):
                continue
            total_listed += 1

            if date_fragment and date_fragment not in key:
                filtered_out += 1
                continue

            key_date = _extract_date_obj_from_key(key)
            if key_date and key_date < cutoff_date:
                filtered_out += 1
                continue

            if settings.daytime_only and not _is_daytime_key(key, settings):
                filtered_out += 1
                continue

            local_path = dest_dir / Path(key).name
            if local_path.exists():
                skipped += 1
                continue

            pending.append((key, local_path))

    downloaded, failed = _download_in_parallel(s3, settings.s3_bucket, pending)

    logger.info(
        "S3 download: %d listed, %d filtered, %d downloaded (%d failed), "
        "%d cached → %s",
        total_listed, filtered_out, downloaded, failed, skipped, dest_dir,
    )
    return dest_dir


def _download_in_parallel(
    s3_client,
    bucket: str,
    items: list[tuple[str, Path]],
) -> tuple[int, int]:
    """Download *items* concurrently. Returns (downloaded, failed)."""
    if not items:
        return 0, 0

    workers = min(DOWNLOAD_PARALLELISM, len(items))

    def _one(key: str, local_path: Path) -> bool:
        try:
            s3_client.download_file(bucket, key, str(local_path))
            return True
        except Exception as exc:
            logger.warning("S3 download failed for %s: %s", key, exc)
            # Best-effort cleanup of partial file written by boto3
            try:
                if local_path.exists():
                    local_path.unlink()
            except OSError:
                pass
            return False

    downloaded = failed = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = [ex.submit(_one, key, path) for key, path in items]
        for fut in as_completed(futures):
            if fut.result():
                downloaded += 1
            else:
                failed += 1
    return downloaded, failed


def list_s3_dates(
    device_id: str,
    client: str,
    settings: CalibSettings,
) -> list[str]:
    """List distinct dates available on S3 for a device."""
    s3 = _create_s3_client(settings)
    prefix = f"{client}/{device_id}/"
    paginator = s3.get_paginator("list_objects_v2")
    pages = paginator.paginate(Bucket=settings.s3_bucket, Prefix=prefix)

    dates: set[str] = set()
    for page in pages:
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.lower().endswith(".jpg"):
                d = _extract_date_from_key(key)
                if d:
                    dates.add(d)
    return sorted(dates)


# ── Internals ────────────────────────────────────────────────────────


def _create_s3_client(settings: CalibSettings):
    import boto3
    from botocore.config import Config as BotoConfig

    access_key = os.getenv("AWS_ACCESS_KEY_ID")
    secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
    if not access_key or not secret_key:
        raise EnvironmentError(
            "AWS credentials not found. "
            "Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY."
        )
    return boto3.client(
        "s3",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=settings.aws_region,
        config=BotoConfig(retries={"max_attempts": 3}),
    )


def _date_to_s3_fragment(date_str: str) -> str:
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    month_name = MONTH_NAMES[dt.month - 1]
    return f"_{month_name}-{dt.day:02d}-{dt.year}-"


def _extract_date_obj_from_key(key: str) -> Optional[datetime]:
    pattern = r"_([A-Za-z]+)-(\d{1,2})-(\d{4})-"
    m = re.search(pattern, key)
    if not m:
        return None
    month_map = {n.lower(): i + 1 for i, n in enumerate(MONTH_NAMES)}
    month = month_map.get(m.group(1).lower())
    if month is None:
        return None
    try:
        return datetime(int(m.group(3)), month, int(m.group(2)))
    except ValueError:
        return None


def _is_daytime_key(key: str, settings: CalibSettings) -> bool:
    m = _TS_PATTERN.search(key)
    if m is None:
        return True
    hour = int(m.group(1))
    am_pm = m.group(4).upper()
    if am_pm == "PM" and hour != 12:
        hour += 12
    elif am_pm == "AM" and hour == 12:
        hour = 0
    return settings.day_start_utc <= hour < settings.day_end_utc


def _extract_date_from_key(key: str) -> Optional[str]:
    pattern = r"_([A-Za-z]+)-(\d{1,2})-(\d{4})-"
    m = re.search(pattern, key)
    if not m:
        return None
    month_map = {n.lower(): i + 1 for i, n in enumerate(MONTH_NAMES)}
    month = month_map.get(m.group(1).lower())
    if month is None:
        return None
    return f"{m.group(3)}-{month:02d}-{int(m.group(2)):02d}"
