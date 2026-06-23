"""Resolve autocalib client labels to backend-b2b Firestore client ids."""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path

__all__ = [
    "is_b2b_firestore_client_id",
    "load_client_id_map",
    "resolve_b2b_client_id",
]

logger = logging.getLogger(__name__)

# Cocopilot / B2B use Firestore document ids (e.g. CdzMnD6isCm4JPsVRbhk), not city display names.
_B2B_CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9]{15,30}$")


def is_b2b_firestore_client_id(client_id: str) -> bool:
    """True when *client_id* looks like a B2B/Firestore client document id."""
    return bool(_B2B_CLIENT_ID_RE.fullmatch(client_id.strip()))


def _client_id_map_file_candidates() -> list[Path]:
    paths: list[Path] = []
    env_file = os.environ.get("B2B_CLIENT_ID_MAP_FILE", "").strip()
    if env_file:
        paths.append(Path(env_file))
    paths.append(Path("/app/config/b2b_client_id_map.json"))
    repo_root = Path(__file__).resolve().parents[2]
    paths.append(repo_root / "autocalib-api" / "config" / "b2b_client_id_map.json")
    return paths


def _load_client_id_map_file(path: Path) -> dict[str, str]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Could not load B2B client map file %s: %s", path, exc)
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items()}


def load_client_id_map() -> dict[str, str]:
    """Ops display name → Firestore id (committed JSON file, then ``B2B_CLIENT_ID_MAP`` env)."""
    merged: dict[str, str] = {}
    for path in _client_id_map_file_candidates():
        if path.is_file():
            merged.update(_load_client_id_map_file(path))

    raw = os.environ.get("B2B_CLIENT_ID_MAP", "").strip()
    if raw:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("B2B_CLIENT_ID_MAP is not valid JSON — ignoring")
        else:
            if isinstance(data, dict):
                merged.update({str(k): str(v) for k, v in data.items()})
    return merged


def _normalize_name(name: str) -> str:
    collapsed = re.sub(r"[\s_-]+", " ", name.strip())
    return collapsed.casefold()


def _env_client_id_index() -> dict[str, str]:
    """Normalized ops label → Firestore id from ``B2B_CLIENT_ID_MAP``."""
    index: dict[str, str] = {}
    for display, b2b_id in load_client_id_map().items():
        if not is_b2b_firestore_client_id(b2b_id):
            continue
        raw = display.strip()
        if not raw:
            continue
        aliases = {
            _normalize_name(raw),
            _normalize_name(raw.replace(" ", "_")),
            _normalize_name(raw.replace("_", " ")),
        }
        for key in aliases:
            if key:
                index[key] = b2b_id.strip()
    return index


def resolve_b2b_client_id(display_or_id: str) -> tuple[str | None, str | None]:
    """Map autocalib ``context.client`` to the id expected by ``POST /geography/slots``.

    Returns ``(b2b_client_id, warning)``. When the label is an ops city name with no
    B2B registration, ``b2b_client_id`` is ``None`` and slots are created unallocated
    (unsigned in Cocopilot until assigned to a cocospot).
    """
    raw = display_or_id.strip()
    if not raw:
        return None, None

    if is_b2b_firestore_client_id(raw):
        return raw, None

    env_map = load_client_id_map()
    mapped = env_map.get(raw) or _env_client_id_index().get(_normalize_name(raw))
    if mapped and is_b2b_firestore_client_id(mapped):
        return mapped, None

    logger.info(
        "Client %r has no B2B Firestore id — slots will save as unallocated (unsigned)",
        raw,
    )
    return None, None
