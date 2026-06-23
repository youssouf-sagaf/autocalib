"""B2B client registry — roster for the operator directory and id resolution."""

from __future__ import annotations

import logging
import os
import time
from typing import Any, TypedDict

from autoabsmap.export.b2b_client import is_b2b_firestore_client_id, load_client_id_map

from app.services.b2b_geography import b2b_base_url
from app.services.b2b_http import get_b2b_http_client

logger = logging.getLogger(__name__)

_CACHE_TTL_SECONDS = 600.0


class B2bClientLocation(TypedDict):
    lat: float
    lng: float


class B2bClientRosterEntry(TypedDict, total=False):
    client_id: str
    display_name: str
    location: B2bClientLocation | None
    zoom_level: int | None


_roster: list[B2bClientRosterEntry] = []
_roster_cache_at: float = 0.0
_name_to_id: dict[str, str] = {}
_index_cache_at: float = 0.0


def _normalize_name(name: str) -> str:
    """Match ops labels and B2B display names (spaces vs underscores, case)."""
    import re

    collapsed = re.sub(r"[\s_-]+", " ", name.strip())
    return collapsed.casefold()


def _label_index_keys(label: str) -> list[str]:
    """Aliases for one roster / B2B display name (spaces vs underscores, case)."""
    raw = label.strip()
    if not raw:
        return []
    keys = {_normalize_name(raw)}
    keys.add(_normalize_name(raw.replace(" ", "_")))
    keys.add(_normalize_name(raw.replace("_", " ")))
    return [k for k in keys if k]


def _parse_b2b_location(row: dict[str, Any]) -> B2bClientLocation | None:
    loc = row.get("location")
    if not isinstance(loc, dict):
        return None
    try:
        lat = float(loc.get("lat") or 0)
        lng = float(loc.get("lng") or 0)
    except (TypeError, ValueError):
        return None
    if lat == 0 and lng == 0:
        return None
    return B2bClientLocation(lat=lat, lng=lng)


def _parse_b2b_zoom_level(row: dict[str, Any]) -> int | None:
    raw = row.get("zoom_level")
    if raw is None:
        return None
    try:
        level = int(raw)
    except (TypeError, ValueError):
        return None
    return level if level > 0 else None


def _register_client_in_index(index: dict[str, str], display: str, cid: str) -> None:
    for key in _label_index_keys(display):
        index[key] = cid


def _rebuild_name_index_from_roster(roster: list[B2bClientRosterEntry]) -> dict[str, str]:
    index: dict[str, str] = {}
    for row in roster:
        _register_client_in_index(index, row["display_name"], row["client_id"])
    return index


async def _fetch_b2b_clients_from_api(uid: str | None = None) -> list[dict[str, Any]]:
    resolved_uid = (uid or "").strip() or os.environ.get("B2B_STAFF_UID", "").strip()
    if not resolved_uid:
        return []
    url = f"{b2b_base_url()}/clients"
    resp = await get_b2b_http_client().get(
        url,
        params={"uid": resolved_uid, "include_entities": "false"},
    )
    resp.raise_for_status()
    data = resp.json()
    results = data.get("results")
    if not isinstance(results, list):
        return []
    return results


def _roster_from_env_map() -> list[B2bClientRosterEntry]:
    out: list[B2bClientRosterEntry] = []
    for display, b2b_id in load_client_id_map().items():
        cid = b2b_id.strip()
        name = display.strip()
        if name and is_b2b_firestore_client_id(cid):
            out.append(
                B2bClientRosterEntry(
                    client_id=cid,
                    display_name=name,
                    location=None,
                    zoom_level=None,
                )
            )
    return out


async def fetch_b2b_client_roster(
    *,
    force_refresh: bool = False,
    uid: str | None = None,
) -> list[B2bClientRosterEntry]:
    """Client list for ``GET /api/v1/clients`` — backed by backend-b2b ``GET /clients``."""
    global _roster, _roster_cache_at, _name_to_id, _index_cache_at
    now = time.monotonic()
    roster_uid = (uid or "").strip()
    if (
        not force_refresh
        and _roster
        and now - _roster_cache_at < _CACHE_TTL_SECONDS
        and not roster_uid
    ):
        return list(_roster)

    by_id: dict[str, B2bClientRosterEntry] = {
        row["client_id"]: row for row in _roster_from_env_map()
    }

    try:
        for row in await _fetch_b2b_clients_from_api(roster_uid or None):
            cid = str(row.get("client_id") or "").strip()
            display = str(row.get("display_name") or "").strip()
            if not cid or not display or not is_b2b_firestore_client_id(cid):
                continue
            by_id[cid] = B2bClientRosterEntry(
                client_id=cid,
                display_name=display,
                location=_parse_b2b_location(row),
                zoom_level=_parse_b2b_zoom_level(row),
            )
    except Exception:
        logger.exception("B2B client roster fetch failed — using env map only")

    roster = sorted(by_id.values(), key=lambda r: r["display_name"].casefold())
    if not roster_uid:
        _roster = roster
        _roster_cache_at = now
        _name_to_id = _rebuild_name_index_from_roster(roster)
        _apply_client_id_map_aliases_to_index(_name_to_id)
        _index_cache_at = now
        logger.info("B2B client roster cached: %d client(s)", len(roster))
    else:
        logger.info("B2B client roster for uid %r: %d client(s)", roster_uid, len(roster))
    return list(roster)


def _apply_client_id_map_aliases_to_index(index: dict[str, str]) -> None:
    """Register every committed map label (AMP, La-Rochelle, …) — roster dedupes by id."""
    for display, b2b_id in load_client_id_map().items():
        cid = b2b_id.strip()
        name = display.strip()
        if name and is_b2b_firestore_client_id(cid):
            _register_client_in_index(index, name, cid)


async def get_b2b_client_name_index(*, force_refresh: bool = False) -> dict[str, str]:
    """Return normalized display label → B2B ``client_id`` (Firestore doc id)."""
    global _name_to_id, _index_cache_at
    now = time.monotonic()
    if (
        not force_refresh
        and _name_to_id
        and _roster
        and now - _index_cache_at < _CACHE_TTL_SECONDS
    ):
        return _name_to_id

    await fetch_b2b_client_roster(force_refresh=force_refresh)
    return _name_to_id


def resolve_b2b_client_id_for_display_name(
    display_name: str,
    index: dict[str, str],
) -> str:
    """Resolve a city / ops label to a B2B client id when known."""
    raw = display_name.strip()
    if not raw:
        return ""
    if is_b2b_firestore_client_id(raw):
        return raw
    return index.get(_normalize_name(raw), "")


def _sync_client_candidates(
    client_id: str | None,
    client_display_name: str | None,
) -> list[str]:
    """Distinct non-empty labels to try (Firestore id preferred first)."""
    from autoabsmap.export.b2b_client import is_b2b_firestore_client_id

    ordered: list[str] = []
    cid = (client_id or "").strip()
    name = (client_display_name or "").strip()
    if cid and is_b2b_firestore_client_id(cid):
        ordered.append(cid)
    if name and name not in ordered:
        ordered.append(name)
    if cid and cid not in ordered:
        ordered.append(cid)
    return ordered


async def resolve_b2b_client_id_for_sync(
    client_id: str | None = None,
    client_display_name: str | None = None,
) -> tuple[str | None, str | None]:
    """Resolve ops label or Firestore id for B2B geography sync (Save).

    Uses ``B2B_CLIENT_ID_MAP`` first, then the same B2B ``/clients`` registry
    as ``GET /api/v1/clients`` (requires ``B2B_STAFF_UID`` on the server).
    Tries both ``client_id`` and ``client_display_name`` when provided.
    """
    from autoabsmap.export.b2b_client import resolve_b2b_client_id

    candidates = _sync_client_candidates(client_id, client_display_name)
    if not candidates:
        return None, None

    for label in candidates:
        b2b_id, _ = resolve_b2b_client_id(label)
        if b2b_id:
            return b2b_id, None

    index = await get_b2b_client_name_index()
    for label in candidates:
        mapped = resolve_b2b_client_id_for_display_name(label, index)
        if mapped:
            return mapped, None

    primary = candidates[0]
    return (
        None,
        f"Client {primary!r} has no B2B Firestore id — slots were saved as unallocated "
        "(visible on the map near the ROI only; assign a client in Cocopilot Absolute Map).",
    )
