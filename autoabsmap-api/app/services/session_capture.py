"""Shared SessionStore instance for learning-loop capture (same root as save route)."""

from __future__ import annotations

from pathlib import Path

from autoabsmap.learning_loop.capture import SessionStore

SESSION_STORE_DIR = Path("sessions")
learning_session_store = SessionStore(SESSION_STORE_DIR)
