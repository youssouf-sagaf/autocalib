"""Client + device discovery endpoints.

GET /api/v1/clients                    -> B2B client roster (fast)
GET /api/v1/clients/{client_id}/devices -> cocospots ops inventory (on demand)
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel

from geojson_pydantic import Polygon as GeoJSONPolygon

from autoabsmap.export.b2b_client import is_b2b_firestore_client_id
from autoabsmap.export.b2b_delta import (
    b2b_static_record_to_geoslot,
    center_in_crop_union,
)

from app.models import SaveSummary, SlotsSaveRequest
from app.services.b2b_clients import fetch_b2b_client_roster
from app.services.b2b_geography import B2bGeographyClient, b2b_enabled, save_client_slots_dirty
from app.services.learning_capture import capture_learning_trace_from_save_request
from app.services.cocoparks_api_client import (
    CocoparksApiError,
    get_client,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/clients", tags=["clients"])

DEFAULT_LIFECYCLE = "production"

# Upstream inventory carries template / placeholder rows we shouldn't surface.
_PLACEHOLDER_DIDS = {"", "device_id", "$device_id"}
_PLACEHOLDER_CITIES = {"", "-", "no-city", "not_attributed", "not-attributed"}


class ClientLocationSummary(BaseModel):
    lat: float
    lng: float


class ClientSummary(BaseModel):
    """``client_id`` is the B2B Firestore id; ``display_name`` is the Cocopilot label."""

    client_id: str
    display_name: str
    device_count: int
    location: ClientLocationSummary | None = None
    zoom_level: int | None = None


class DeviceSummary(BaseModel):
    device_id: str
    display_name: str
    client_id: str
    lifecycle: str
    short_name: str


@router.get("", response_model=list[ClientSummary])
async def list_clients(
    lifecycle: str = Query(
        DEFAULT_LIFECYCLE,
        description="Reserved for legacy fallback; ignored when B2B roster is available.",
    ),
    refresh: bool = Query(
        False,
        description=(
            "If true, bypass the in-process B2B roster cache (~10 min) and refetch "
            "from backend-b2b GET /clients."
        ),
    ),
    uid: str = Query(
        "",
        description=(
            "Cocopilot Firebase user id — scopes B2B GET /clients to this user's access. "
            "Falls back to B2B_STAFF_UID when omitted."
        ),
    ),
) -> list[ClientSummary]:
    """B2B roster merged with cocospots ops cities (device counts + unmapped sites)."""
    scoped_uid = uid.strip()
    roster = await fetch_b2b_client_roster(force_refresh=refresh, uid=scoped_uid or None)

    if scoped_uid:
        if not roster:
            return []
        try:
            ops = await _list_clients_from_ops_inventory(
                lifecycle=lifecycle,
                force_refresh=refresh,
            )
        except HTTPException:
            return [_client_summary_from_roster_entry(row, device_count=0) for row in roster]
        allowed = {_normalize_client_label(row["display_name"]) for row in roster}
        ops_filtered = [
            c for c in ops if _normalize_client_label(c.display_name) in allowed
        ]
        return _merge_b2b_roster_with_ops(roster, ops_filtered)

    try:
        ops = await _list_clients_from_ops_inventory(
            lifecycle=lifecycle,
            force_refresh=refresh,
        )
    except HTTPException:
        if roster:
            logger.warning("Cocospots inventory unavailable — returning B2B roster only")
            return [_client_summary_from_roster_entry(row, device_count=0) for row in roster]
        raise

    if not roster:
        logger.warning(
            "B2B client roster empty (set B2B_STAFF_UID or commit b2b_client_id_map.json) — "
            "returning ops inventory only",
        )
        return ops

    return _merge_b2b_roster_with_ops(roster, ops)


@router.get("/{client_id}/devices", response_model=list[DeviceSummary])
async def list_devices_for_client(
    client_id: str,
    display_name: str = Query(
        "",
        description="Ops inventory city label (required when client_id is a B2B Firestore id).",
    ),
    lifecycle: str = Query(DEFAULT_LIFECYCLE),
    refresh: bool = Query(
        False,
        description=(
            "If true, bypass the autocalib in-process inventory cache and fetch "
            "fresh cocospots from the Cocoparks ops API before filtering."
        ),
    ),
) -> list[DeviceSummary]:
    """Return devices for the ops city matching ``display_name`` (or legacy ``client_id``)."""
    from app.services.b2b_clients import (
        get_b2b_client_name_index,
        resolve_b2b_client_id_for_display_name,
    )

    city = _resolve_ops_city(client_id, display_name)
    name_index = await get_b2b_client_name_index(force_refresh=refresh)
    target_b2b_id, target_city_norm = _resolve_target_client_for_devices(
        client_id,
        display_name,
        name_index,
    )
    devices = await _safe_list_devices(force_refresh=refresh)
    matched = [
        DeviceSummary(
            device_id=str(row.get("did") or ""),
            display_name=str(row.get("display_name") or row.get("did") or ""),
            client_id=client_id,
            lifecycle=str(row.get("lifecycle") or ""),
            short_name=_short_name(row),
        )
        for row in devices
        if _matches_lifecycle(row, lifecycle)
        and _is_real_device(row)
        and _device_matches_client_request(
            _ops_city_for(row),
            target_b2b_id=target_b2b_id,
            target_city_norm=target_city_norm,
            name_index=name_index,
        )
    ]
    matched.sort(key=lambda d: d.display_name.lower())
    logger.info(
        "Devices for %r (path id %r, b2b %r): %d cocospot(s) after lifecycle=%r filter",
        city,
        client_id,
        target_b2b_id or None,
        len(matched),
        lifecycle,
    )
    return matched


@router.get("/{client_id}/reference-slots")
async def list_reference_slots(
    client_id: str,
    display_name: str = Query("", description="Ops city label when client_id is not a B2B id."),
    crop_lat: float | None = Query(None, description="Crop center lat (with crop_lng/radius for geo filter)."),
    crop_lng: float | None = Query(None, description="Crop center lng."),
    crop_radius_m: float = Query(400.0, description="Radius (m) around crop center when no B2B client id."),
) -> dict:
    """Prod absolute-map slots for overlay.

    With a registered B2B client id: filter by ``client_id``.
    Otherwise (demo cities): return unallocated prod slots near the crop center so
  autocalib can show prior saves that were POSTed without ``client_id``.
    """
    t0 = time.perf_counter()
    if not b2b_enabled():
        return {"results": []}

    from app.services.b2b_clients import resolve_b2b_client_id_for_sync

    b2b_id = client_id.strip()
    if not is_b2b_firestore_client_id(b2b_id):
        t_resolve = time.perf_counter()
        resolved, _ = await resolve_b2b_client_id_for_sync(
            client_id,
            display_name or None,
        )
        b2b_id = resolved or ""
        resolve_ms = (time.perf_counter() - t_resolve) * 1000
    else:
        resolve_ms = 0.0

    b2b_client = B2bGeographyClient()
    slots: list[dict] = []
    if b2b_id:
        try:
            t_fetch = time.perf_counter()
            geo_slots = await b2b_client.get_slots_for_client(b2b_id, [])
            slots = [s.model_dump() for s in geo_slots]
            fetch_ms = (time.perf_counter() - t_fetch) * 1000
            logger.info(
                "Reference slots B2B id=%r: resolve=%.0fms fetch=%.0fms total=%.0fms count=%d",
                b2b_id,
                resolve_ms,
                fetch_ms,
                (time.perf_counter() - t0) * 1000,
                len(slots),
            )
        except Exception as exc:
            logger.exception("B2B GET geography/slots failed")
            raise HTTPException(status_code=502, detail=f"B2B unavailable: {exc}") from exc
        return {"results": slots}

    try:
        t_fetch = time.perf_counter()
        records = await b2b_client.get_all_slots_static()
        fetch_ms = (time.perf_counter() - t_fetch) * 1000
    except Exception as exc:
        logger.exception("B2B GET geography/slots failed")
        raise HTTPException(status_code=502, detail=f"B2B unavailable: {exc}") from exc

    if crop_lat is None or crop_lng is None:
        return {"results": []}

    # Approximate degree radius from metres (metric CRS gate not needed at this scale).
    radius_deg = crop_radius_m / 111_320.0
    crop_poly = GeoJSONPolygon(
        type="Polygon",
        coordinates=[[
            [crop_lng - radius_deg, crop_lat - radius_deg],
            [crop_lng + radius_deg, crop_lat - radius_deg],
            [crop_lng + radius_deg, crop_lat + radius_deg],
            [crop_lng - radius_deg, crop_lat + radius_deg],
            [crop_lng - radius_deg, crop_lat - radius_deg],
        ]],
    )
    t_filter = time.perf_counter()
    for record in records:
        slot = b2b_static_record_to_geoslot(record)
        if slot is None:
            continue
        if not center_in_crop_union(slot.center, [crop_poly]):
            continue
        slots.append(slot.model_dump())
    filter_ms = (time.perf_counter() - t_filter) * 1000
    logger.info(
        "Reference slots (geo): resolve=%.0fms fetch=%.0fms filter=%.0fms total=%.0fms "
        "→ %d within %.0fm of (%.5f, %.5f) from %d records",
        resolve_ms,
        fetch_ms,
        filter_ms,
        (time.perf_counter() - t0) * 1000,
        len(slots),
        crop_radius_m,
        crop_lat,
        crop_lng,
        len(records),
    )
    return {"results": slots}


@router.post("/{client_id}/slots/save")
async def save_client_slots(
    client_id: str,
    request: SlotsSaveRequest,
    background_tasks: BackgroundTasks,
    display_name: str = Query("", description="Ops city label when client_id is not a B2B id."),
) -> dict:
    """Synchronous dirty B2B save — returns full prod overlay + save_summary."""
    if not b2b_enabled():
        raise HTTPException(status_code=503, detail="B2B sync is disabled (B2B_ENABLED=false)")

    b2b_client_id = client_id.strip()
    if not is_b2b_firestore_client_id(b2b_client_id):
        from app.services.b2b_clients import resolve_b2b_client_id_for_sync

        resolved, _ = await resolve_b2b_client_id_for_sync(
            client_id,
            request.client_display_name or display_name or None,
        )
        b2b_client_id = resolved or client_id.strip()

    label = request.client_display_name or display_name or ""
    try:
        outcome = await save_client_slots_dirty(
            request.slots,
            client_id,
            request.deleted_prod_ids,
            client_display_name=label or None,
        )
    except Exception as exc:
        logger.exception("B2B slots:save failed for %r", client_id)
        raise HTTPException(status_code=502, detail=f"B2B save failed: {exc}") from exc

    if request.job_id and request.edit_events:
        background_tasks.add_task(
            capture_learning_trace_from_save_request,
            request.job_id,
            request,
        )

    return {
        "ok": True,
        "client_id": b2b_client_id or client_id,
        "results": outcome.results,
        "save_summary": SaveSummary(**outcome.save_summary).model_dump(),
        "warning": outcome.warning,
    }


@router.post("/{client_id}/slots/sync")
async def sync_client_slots(client_id: str) -> dict:
    """Removed — use ``POST …/slots/save`` (synchronous dirty save)."""
    raise HTTPException(
        status_code=410,
        detail="Deprecated — use POST /api/v1/clients/{client_id}/slots/save",
    )


@router.get("/{client_id}/slots/sync/{sync_id}")
async def get_client_slots_sync_status(client_id: str, sync_id: str) -> dict:
    """Removed — ``POST …/slots/save`` is synchronous; polling is no longer supported."""
    raise HTTPException(
        status_code=410,
        detail="Deprecated — use POST /api/v1/clients/{client_id}/slots/save",
    )


# ── Helpers ──────────────────────────────────────────────────────────


def _location_from_roster_entry(entry: Any) -> ClientLocationSummary | None:
    loc = entry.get("location")
    if not isinstance(loc, dict):
        return None
    try:
        lat = float(loc.get("lat") or 0)
        lng = float(loc.get("lng") or 0)
    except (TypeError, ValueError):
        return None
    if lat == 0 and lng == 0:
        return None
    return ClientLocationSummary(lat=lat, lng=lng)


def _client_summary_from_roster_entry(
    entry: Any,
    *,
    device_count: int,
) -> ClientSummary:
    return ClientSummary(
        client_id=str(entry.get("client_id") or "").strip(),
        display_name=str(entry.get("display_name") or "").strip(),
        device_count=device_count,
        location=_location_from_roster_entry(entry),
        zoom_level=entry.get("zoom_level"),
    )


def _normalize_client_label(name: str) -> str:
    """Match ops labels and B2B display names (spaces vs underscores, case)."""
    import re

    collapsed = re.sub(r"[\s_-]+", " ", name.strip())
    return collapsed.casefold()


def _merge_b2b_roster_with_ops(
    roster: list[Any],
    ops: list[ClientSummary],
) -> list[ClientSummary]:
    """Union of B2B Firestore clients and ops-only cities (with device counts)."""
    merged: dict[str, ClientSummary] = {}

    for row in ops:
        name = row.display_name.strip()
        if not name:
            continue
        key = _normalize_client_label(name)
        prev = merged.get(key)
        if prev:
            merged[key] = ClientSummary(
                client_id=prev.client_id or row.client_id,
                display_name=prev.display_name,
                device_count=prev.device_count + row.device_count,
                location=prev.location or row.location,
                zoom_level=prev.zoom_level if prev.zoom_level is not None else row.zoom_level,
            )
        else:
            merged[key] = row

    for entry in roster:
        cid = str(entry.get("client_id") or "").strip()
        name = str(entry.get("display_name") or "").strip()
        if not name:
            continue
        key = _normalize_client_label(name)
        prev = merged.get(key)
        b2b_location = _location_from_roster_entry(entry)
        b2b_zoom = entry.get("zoom_level")
        merged[key] = ClientSummary(
            client_id=cid,
            display_name=name,
            device_count=prev.device_count if prev else 0,
            location=b2b_location or (prev.location if prev else None),
            zoom_level=b2b_zoom if b2b_zoom is not None else (prev.zoom_level if prev else None),
        )

    return sorted(merged.values(), key=lambda c: c.display_name.casefold())


async def _list_clients_from_ops_inventory(
    *,
    lifecycle: str,
    force_refresh: bool,
) -> list[ClientSummary]:
    """Legacy path: derive city labels from the full cocospots status export."""
    from app.services.b2b_clients import (
        get_b2b_client_name_index,
        resolve_b2b_client_id_for_display_name,
    )

    devices = await _safe_list_devices(force_refresh=force_refresh)
    b2b_index = await get_b2b_client_name_index(force_refresh=force_refresh)
    counts: dict[str, int] = {}
    for row in devices:
        if not _matches_lifecycle(row, lifecycle):
            continue
        if not _is_real_device(row):
            continue
        city = _ops_city_for(row)
        if city.lower() in _PLACEHOLDER_CITIES:
            continue
        counts[city] = counts.get(city, 0) + 1

    return sorted(
        (
            ClientSummary(
                client_id=resolve_b2b_client_id_for_display_name(name, b2b_index),
                display_name=name,
                device_count=count,
            )
            for name, count in counts.items()
        ),
        key=lambda c: c.display_name.lower(),
    )


async def _safe_list_devices(*, force_refresh: bool = False) -> list[dict[str, Any]]:
    try:
        return await get_client().list_devices(force=force_refresh)
    except CocoparksApiError as exc:
        logger.error("Cocoparks ops API unavailable: %s", exc)
        raise HTTPException(
            status_code=503,
            detail=f"Cocoparks ops API unavailable: {exc}",
        ) from exc


def _resolve_ops_city(client_id: str, display_name: str) -> str:
    """City label used in the ops inventory (always ``display_name`` when provided)."""
    city = display_name.strip()
    if city:
        return city
    return client_id.strip()


def _resolve_target_client_for_devices(
    client_id: str,
    display_name: str,
    name_index: dict[str, str],
) -> tuple[str, str]:
    """Return ``(target_b2b_id, normalized_city_label)`` for device inventory filtering."""
    from app.services.b2b_clients import resolve_b2b_client_id_for_display_name

    city = _resolve_ops_city(client_id, display_name)
    target_b2b_id = ""
    cid = client_id.strip()
    if is_b2b_firestore_client_id(cid):
        target_b2b_id = cid
    if not target_b2b_id and city:
        target_b2b_id = resolve_b2b_client_id_for_display_name(city, name_index)
    target_city_norm = _normalize_client_label(city) if city else ""
    return target_b2b_id, target_city_norm


def _device_matches_client_request(
    ops_city: str,
    *,
    target_b2b_id: str,
    target_city_norm: str,
    name_index: dict[str, str],
) -> bool:
    """Match ops inventory rows to a B2B client id and/or normalized city label."""
    from app.services.b2b_clients import resolve_b2b_client_id_for_display_name

    if target_b2b_id:
        row_b2b_id = resolve_b2b_client_id_for_display_name(ops_city, name_index)
        if row_b2b_id and row_b2b_id == target_b2b_id:
            return True
    if target_city_norm:
        return _normalize_client_label(ops_city) == target_city_norm
    return False


def _matches_lifecycle(row: dict[str, Any], lifecycle: str) -> bool:
    if not lifecycle:
        return True
    return str(row.get("lifecycle") or "").lower() == lifecycle.lower()


def _is_real_device(row: dict[str, Any]) -> bool:
    did = str(row.get("did") or "").strip().lower()
    if not did or did in _PLACEHOLDER_DIDS:
        return False
    if did.startswith("$"):
        return False
    return True


def _ops_city_for(row: dict[str, Any]) -> str:
    """Determine the client (city) for a row.

    Levallois devices store their tag in ``display_name`` rather than ``city``
    in the upstream inventory, so we fall back to the prefix when ``city`` is
    missing.
    """
    city = str(row.get("city") or "").strip()
    if city:
        return city
    display_name = str(row.get("display_name") or "")
    if display_name:
        return display_name.split("_")[0]
    return ""


def _short_name(row: dict[str, Any]) -> str:
    display = str(row.get("display_name") or "")
    if not display:
        return str(row.get("did") or "")
    parts = display.split("_")
    return parts[-1] if len(parts) > 1 else display
