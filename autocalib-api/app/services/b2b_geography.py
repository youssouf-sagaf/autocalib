"""HTTP client and sync for backend-b2b ``/geography/slots``."""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx
from geojson_pydantic import Polygon as GeoJSONPolygon

from autoabsmap.export.b2b_client import is_b2b_firestore_client_id
from autoabsmap.export.b2b_delta import (
    B2bSyncPlan,
    compute_b2b_delta_dirty,
    filter_prod_slots_for_client,
    filter_prod_slots_for_client_id,
)
from autoabsmap.export.b2b_slots import (
    geoslots_to_b2b_delete_payload,
    geoslots_to_b2b_post_payload,
    geoslots_to_b2b_put_payload,
)
from autoabsmap.export.models import GeoSlot
from app.services.b2b_http import HTTP_TIMEOUT, get_b2b_http_client
from app.services.b2b_slots_cache import GLOBAL_SCOPE, b2b_slots_cache

logger = logging.getLogger(__name__)

DEFAULT_B2B_BASE_URL = "https://backend-b2b.prod.cocoparks.io/api/v1"
B2B_POST_BATCH_SIZE = 20
# Smaller default than 50 — prod B2B often 500s on large PUT batches (Supabase/Firestore).
B2B_PUT_BATCH_SIZE = int(os.environ.get("B2B_PUT_BATCH_SIZE", "20"))
_B2B_PUT_RETRYABLE_STATUS = frozenset({500, 502, 503, 504})

# Re-export for callers that imported HTTP_TIMEOUT from this module.
__all__ = [
    "B2bGeographyClient",
    "HTTP_TIMEOUT",
    "SaveSlotsResult",
    "b2b_base_url",
    "b2b_enabled",
    "save_client_slots_dirty",
]


def b2b_enabled() -> bool:
    return os.environ.get("B2B_ENABLED", "true").lower() not in ("0", "false", "no")


def b2b_base_url() -> str:
    return os.environ.get("B2B_BASE_URL", DEFAULT_B2B_BASE_URL).rstrip("/")


def _raise_b2b_error(
    resp: httpx.Response,
    method: str,
    count: int,
    *,
    slot_ids: list[str] | None = None,
) -> None:
    """Surface B2B response body in exceptions (500s are opaque otherwise)."""
    try:
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        body = (resp.text or "").strip()[:800]
        detail = f"B2B {method} geography/slots ({count} entries) → HTTP {resp.status_code}"
        if slot_ids:
            preview = ", ".join(slot_ids[:5])
            suffix = "…" if len(slot_ids) > 5 else ""
            detail = f"{detail} [ids: {preview}{suffix}]"
        if body:
            detail = f"{detail}: {body}"
        raise RuntimeError(detail) from exc


def _b2b_put_missing_prod_row(resp: httpx.Response) -> bool:
    """True when B2B/PostgREST failed because the slot row is gone (stale catalog)."""
    if resp.status_code not in (404, 500):
        return False
    text = (resp.text or "").lower()
    return any(
        token in text
        for token in (
            "pgrst116",
            "0 rows",
            "no rows",
            "not found",
            "results contain 0 rows",
        )
    )


async def _put_chunk_resilient(
    http: httpx.AsyncClient,
    url: str,
    chunk: dict[str, dict[str, Any]],
    label: str,
    skipped: list[str],
    *,
    depth: int = 0,
) -> None:
    """PUT one chunk; on retryable 5xx with multiple entries, halve and retry."""
    if not chunk:
        return
    resp = await http.put(url, json=chunk)
    if resp.status_code < 400:
        return
    if _b2b_put_missing_prod_row(resp):
        for slot_id in chunk:
            if slot_id not in skipped:
                skipped.append(slot_id)
        logger.warning(
            "B2B PUT %s skipped %d stale prod row(s): %s",
            label,
            len(chunk),
            ", ".join(list(chunk.keys())[:3]),
        )
        return
    if (
        resp.status_code in _B2B_PUT_RETRYABLE_STATUS
        and len(chunk) > 1
        and depth < 8
    ):
        keys = list(chunk.keys())
        mid = max(1, len(keys) // 2)
        left = {k: chunk[k] for k in keys[:mid]}
        right = {k: chunk[k] for k in keys[mid:]}
        logger.warning(
            "B2B PUT %s failed (HTTP %s, %d entries) — splitting into %d + %d",
            label,
            resp.status_code,
            len(chunk),
            len(left),
            len(right),
        )
        await _put_chunk_resilient(
            http, url, left, f"{label}.1", skipped, depth=depth + 1,
        )
        await _put_chunk_resilient(
            http, url, right, f"{label}.2", skipped, depth=depth + 1,
        )
        return
    _raise_b2b_error(
        resp,
        label,
        len(chunk),
        slot_ids=list(chunk.keys()),
    )


def _parse_b2b_slots_response(data: Any) -> list[dict[str, Any]]:
    """Normalize B2B slot list payloads (``results`` wrapper or bare array)."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        results = data.get("results")
        if isinstance(results, list):
            return results
    logger.warning("Unexpected B2B slots response shape: %s", type(data))
    return []


class B2bGeographyClient:
    """Thin wrapper over B2B geography and client slot endpoints (no auth)."""

    def __init__(self, base_url: str | None = None) -> None:
        self._base = (base_url or b2b_base_url()).rstrip("/")

    async def get_all_slots_static(self, *, force_refresh: bool = False) -> list[dict[str, Any]]:
        """Fetch full catalog (cached TTL) — demo cities / unallocated overlay only."""

        async def _fetch() -> list[dict[str, Any]]:
            url = f"{self._base}/geography/slots"
            resp = await get_b2b_http_client().get(url)
            resp.raise_for_status()
            return _parse_b2b_slots_response(resp.json())

        return await b2b_slots_cache.get_records(
            _fetch,
            scope=GLOBAL_SCOPE,
            force_refresh=force_refresh,
        )

    async def get_client_slots_static(
        self,
        b2b_client_id: str,
        *,
        force_refresh: bool = False,
    ) -> list[dict[str, Any]]:
        """Fetch slots for one B2B client (~KB vs full geography catalog)."""

        client_id = b2b_client_id.strip()

        async def _fetch() -> list[dict[str, Any]]:
            url = f"{self._base}/clients/{client_id}/slots"
            resp = await get_b2b_http_client().get(
                url,
                params={"check_event": "false"},
            )
            resp.raise_for_status()
            return _parse_b2b_slots_response(resp.json())

        return await b2b_slots_cache.get_records(
            _fetch,
            scope=client_id,
            force_refresh=force_refresh,
        )

    async def get_slots_for_client(
        self,
        b2b_client_id: str,
        crop_polygons: list[GeoJSONPolygon] | None = None,
        *,
        force_refresh: bool = False,
    ) -> list[GeoSlot]:
        """Prod slots for one client. Registered B2B ids: full client catalog (no crop)."""
        client_id = b2b_client_id.strip()
        crops = crop_polygons or []
        if is_b2b_firestore_client_id(client_id):
            records = await self.get_client_slots_static(
                client_id,
                force_refresh=force_refresh,
            )
            return filter_prod_slots_for_client_id(records, client_id)
        records = await self.get_all_slots_static(force_refresh=force_refresh)
        return filter_prod_slots_for_client(records, client_id, crops)

    async def put_slots_once(
        self,
        payload: dict[str, dict[str, Any]],
        *,
        b2b_client_id: str | None = None,
    ) -> list[str]:
        """Single PUT for geography/slots (no batching)."""
        if not payload:
            return []
        url = f"{self._base}/geography/slots"
        http = get_b2b_http_client()
        skipped: list[str] = []
        await _put_chunk_resilient(http, url, payload, "PUT", skipped)
        cid = (b2b_client_id or "").strip()
        if cid and is_b2b_firestore_client_id(cid):
            b2b_slots_cache.invalidate(cid)
        else:
            b2b_slots_cache.invalidate()
        return skipped

    async def post_slots_once(
        self,
        payload: dict[str, dict[str, Any]],
        *,
        b2b_client_id: str | None = None,
    ) -> None:
        """Single POST for geography/slots (no batching)."""
        if not payload:
            return
        url = f"{self._base}/geography/slots"
        http = get_b2b_http_client()
        resp = await http.post(url, json=payload)
        _raise_b2b_error(resp, "POST", len(payload))
        cid = (b2b_client_id or "").strip()
        if cid and is_b2b_firestore_client_id(cid):
            b2b_slots_cache.invalidate(cid)
        else:
            b2b_slots_cache.invalidate()

    async def put_slots(
        self,
        payload: dict[str, dict[str, Any]],
        *,
        b2b_client_id: str | None = None,
    ) -> list[str]:
        """PUT updates/deletes; return slot_ids skipped (missing prod rows)."""
        if not payload:
            return []
        url = f"{self._base}/geography/slots"
        items = list(payload.items())
        http = get_b2b_http_client()
        skipped: list[str] = []
        batch_total = (len(items) + B2B_PUT_BATCH_SIZE - 1) // B2B_PUT_BATCH_SIZE
        for start in range(0, len(items), B2B_PUT_BATCH_SIZE):
            chunk = dict(items[start : start + B2B_PUT_BATCH_SIZE])
            batch_no = start // B2B_PUT_BATCH_SIZE + 1
            await _put_chunk_resilient(
                http,
                url,
                chunk,
                f"PUT batch {batch_no}/{batch_total}",
                skipped,
            )
        cid = (b2b_client_id or "").strip()
        if cid and is_b2b_firestore_client_id(cid):
            b2b_slots_cache.invalidate(cid)
        else:
            b2b_slots_cache.invalidate()
        return skipped

    async def post_slots(
        self,
        payload: dict[str, dict[str, Any]],
        *,
        b2b_client_id: str | None = None,
    ) -> None:
        if not payload:
            return
        url = f"{self._base}/geography/slots"
        items = list(payload.items())
        http = get_b2b_http_client()
        for start in range(0, len(items), B2B_POST_BATCH_SIZE):
            chunk = dict(items[start : start + B2B_POST_BATCH_SIZE])
            resp = await http.post(url, json=chunk)
            batch_no = start // B2B_POST_BATCH_SIZE + 1
            _raise_b2b_error(resp, f"POST batch {batch_no}", len(chunk))
        cid = (b2b_client_id or "").strip()
        if cid and is_b2b_firestore_client_id(cid):
            b2b_slots_cache.invalidate(cid)
        else:
            b2b_slots_cache.invalidate()


@dataclass(frozen=True)
class SaveSlotsResult:
    """Synchronous slots:save response payload."""

    results: list[dict[str, Any]]
    save_summary: dict[str, int]
    warning: str | None = None


async def save_client_slots_dirty(
    dirty_slots: list[GeoSlot],
    client_id: str | None,
    deleted_prod_ids: list[str],
    *,
    client_display_name: str | None = None,
    b2b: B2bGeographyClient | None = None,
) -> SaveSlotsResult:
    """Synchronous dirty save: GET → diff → PUT → POST → re-GET overlay."""
    from app.services.b2b_clients import resolve_b2b_client_id_for_sync

    t0 = time.monotonic()
    b2b_client_id, client_warning = await resolve_b2b_client_id_for_sync(
        client_id,
        client_display_name,
    )
    resolved_id = b2b_client_id or (client_id or client_display_name or "").strip()
    client = b2b or B2bGeographyClient()

    if not dirty_slots and not deleted_prod_ids:
        prod_slots = await client.get_slots_for_client(resolved_id, force_refresh=False)
        results = [s.model_dump() for s in prod_slots]
        logger.info(
            "B2B save short-circuit client=%r: 0 changes (%.0f ms)",
            resolved_id,
            (time.monotonic() - t0) * 1000,
        )
        return SaveSlotsResult(
            results=results,
            save_summary={"created": 0, "updated": 0, "deleted": 0, "total_slots": len(results)},
            warning=client_warning,
        )

    prod_slots = await client.get_slots_for_client(resolved_id, force_refresh=False)
    prod_before_ids = {s.slot_id for s in prod_slots}
    plan = compute_b2b_delta_dirty(dirty_slots, prod_slots, deleted_prod_ids)

    put_updates = geoslots_to_b2b_put_payload(plan.updates)
    put_deletes = geoslots_to_b2b_delete_payload(plan.deletes)
    put_payload = {**put_updates, **put_deletes}
    for k in [k for k in put_payload if k not in prod_before_ids]:
        put_payload.pop(k, None)

    if plan.creates and not b2b_client_id:
        logger.warning(
            "B2B save: %d create(s) without b2b client_id — label=%r",
            len(plan.creates),
            client_display_name,
        )

    skipped_puts = await client.put_slots_once(put_payload, b2b_client_id=b2b_client_id)
    put_warning: str | None = None
    if skipped_puts:
        put_warning = f"Skipped {len(skipped_puts)} stale prod slot(s) on PUT"
        logger.warning(put_warning)

    await client.post_slots_once(
        geoslots_to_b2b_post_payload(plan.creates, b2b_client_id),
        b2b_client_id=b2b_client_id,
    )

    if b2b_client_id and is_b2b_firestore_client_id(b2b_client_id):
        b2b_slots_cache.invalidate(b2b_client_id)
    else:
        b2b_slots_cache.invalidate()

    overlay_slots = await client.get_slots_for_client(resolved_id, force_refresh=True)
    results = [s.model_dump() for s in overlay_slots]
    summary = {
        "created": len(plan.creates),
        "updated": len(plan.updates),
        "deleted": len(plan.deletes),
        "total_slots": len(results),
    }
    warnings = [w for w in (client_warning, put_warning) if w]
    elapsed_ms = (time.monotonic() - t0) * 1000
    logger.info(
        "B2B save client=%r: %d POST, %d PUT (%d update, %d delete) — %d slots overlay (%.0f ms)",
        resolved_id,
        len(plan.creates),
        len(put_payload),
        len(plan.updates),
        len(plan.deletes),
        len(results),
        elapsed_ms,
    )
    return SaveSlotsResult(
        results=results,
        save_summary=summary,
        warning=" ".join(warnings) if warnings else None,
    )
