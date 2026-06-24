"""Lazy Firebase Admin initialization for auth handoff (custom tokens)."""

from __future__ import annotations

import json
import logging
import os

import firebase_admin
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials

logger = logging.getLogger(__name__)

_initialized = False


def firebase_admin_enabled() -> bool:
    if os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip():
        return True
    if os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip():
        return True
    return False


def _ensure_initialized() -> None:
    global _initialized
    if _initialized:
        return
    if firebase_admin._apps:
        _initialized = True
        return

    json_str = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    if json_str:
        cred = credentials.Certificate(json.loads(json_str))
        firebase_admin.initialize_app(cred)
        logger.info("Firebase Admin initialized from FIREBASE_SERVICE_ACCOUNT_JSON")
    else:
        firebase_admin.initialize_app()
        logger.info("Firebase Admin initialized from application default credentials")

    _initialized = True


def verify_firebase_id_token(id_token: str) -> dict:
    """Verify a Cocopilot Firebase ID token and return decoded claims."""
    _ensure_initialized()
    return firebase_auth.verify_id_token(id_token)


def create_firebase_custom_token(uid: str) -> str:
    """Mint a Firebase custom token for Autocalib sign-in."""
    _ensure_initialized()
    token = firebase_auth.create_custom_token(uid.strip())
    if isinstance(token, bytes):
        return token.decode("utf-8")
    return str(token)
