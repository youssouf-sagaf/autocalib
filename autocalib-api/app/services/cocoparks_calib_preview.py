"""Proxy calib-preview and last-pic endpoints to cv-backend (COCOPARKS_PROD_URL)."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

HTTP_TIMEOUT_SECONDS = 120.0


def _cv_base_url() -> str:
    base = os.getenv("COCOPARKS_PROD_URL", "").strip().rstrip("/")
    if not base:
        raise RuntimeError("COCOPARKS_PROD_URL is not set — cannot reach cv-backend")
    return base


def _verify_ssl() -> bool:
    verify_env = os.getenv("COCOPARKS_PROD_VERIFY_SSL", "false").strip().lower()
    return verify_env in ("1", "true", "yes")


async def fetch_calib_preview(device_id: str) -> tuple[int, Any]:
    """GET /{did}/calib-preview — returns (status_code, json body)."""
    url = f"{_cv_base_url()}/{device_id}/calib-preview"
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS, verify=_verify_ssl()) as client:
        resp = await client.get(url)
        return resp.status_code, resp.json() if resp.content else {}


async def post_calib_preview_refresh(device_id: str) -> tuple[int, Any]:
    """POST /{did}/calib-preview/refresh — returns (status_code, json body)."""
    url = f"{_cv_base_url()}/{device_id}/calib-preview/refresh"
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS, verify=_verify_ssl()) as client:
        resp = await client.post(url)
        if resp.content:
            try:
                body: Any = resp.json()
            except Exception:
                body = {"detail": resp.text[:500]}
        else:
            body = {}
        return resp.status_code, body


async def fetch_last_pic_object(device_id: str, object_key: str) -> tuple[int, Any]:
    """GET /{did}/last-pic/object — returns (status_code, json body)."""
    url = f"{_cv_base_url()}/{device_id}/last-pic/object"
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS, verify=_verify_ssl()) as client:
        resp = await client.get(url, params={"object_key": object_key})
        if resp.content:
            try:
                body: Any = resp.json()
            except Exception:
                body = {"detail": resp.text[:500]}
        else:
            body = {}
        return resp.status_code, body
