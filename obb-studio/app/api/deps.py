"""FastAPI dependencies."""

from __future__ import annotations

from functools import lru_cache

from app.config.settings import Settings, get_settings
from app.dataset.store import DatasetStore


@lru_cache
def get_cached_settings() -> Settings:
    return get_settings()


def get_store() -> DatasetStore:
    settings = get_cached_settings()
    data_dir = settings.resolve_data_dir()
    store = DatasetStore(data_dir / "obb_studio.db")
    store.init_db()
    return store
