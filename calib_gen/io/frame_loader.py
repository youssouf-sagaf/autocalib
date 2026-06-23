"""Local frame loading and filename-based filters (daytime, age)."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from pathlib import Path

from calib_gen.config.settings import CalibSettings

logger = logging.getLogger(__name__)

_TS_PATTERN = re.compile(
    r"(\d{1,2}):(\d{2}):(\d{2})(AM|PM)-UTCZ", re.IGNORECASE,
)
_DATE_RE = re.compile(r"_([A-Za-z]+)-(\d{1,2})-(\d{4})-")

_MONTH_MAP = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}


def is_daytime(path: Path, settings: CalibSettings) -> bool:
    """Return True if the filename timestamp falls within the configured day window."""
    m = _TS_PATTERN.search(path.name)
    if m is None:
        return True
    hour = int(m.group(1))
    am_pm = m.group(4).upper()
    if am_pm == "PM" and hour != 12:
        hour += 12
    elif am_pm == "AM" and hour == 12:
        hour = 0
    return settings.day_start_utc <= hour < settings.day_end_utc


def load_and_filter_paths(
    images_dir: Path,
    settings: CalibSettings,
) -> list[Path]:
    """Glob ``*.jpg`` in *images_dir*, apply daytime + max-age filters."""
    all_jpgs = sorted(images_dir.glob("*.jpg"))
    logger.info("Found %d .jpg files in %s", len(all_jpgs), images_dir)

    cutoff = datetime.utcnow() - timedelta(days=settings.max_age_days)
    filtered: list[Path] = []

    for p in all_jpgs:
        if settings.daytime_only and not is_daytime(p, settings):
            continue

        m = _DATE_RE.search(p.name)
        if m:
            month = _MONTH_MAP.get(m.group(1).lower())
            if month:
                try:
                    file_date = datetime(int(m.group(3)), month, int(m.group(2)))
                    if file_date < cutoff:
                        continue
                except ValueError:
                    pass
        filtered.append(p)

    logger.info(
        "After filters (daytime=%s, max_age=%dd): %d → %d images",
        settings.daytime_only, settings.max_age_days, len(all_jpgs), len(filtered),
    )
    return filtered
