"""Fetch ROI imagery, tile, and persist PNG/JPEG + DB row."""

from __future__ import annotations

import logging
import uuid
from typing import Any

import cv2
import numpy as np
from geojson_pydantic import Polygon as GeoJSONPolygon
from PIL import Image

from autoabsmap.config.settings import ImagerySettings

from app.config.settings import Settings, get_settings
from app.crop_engine.imagery_factory import get_imagery_provider
from app.crop_engine.paths import (
    crop_file_stem,
    crop_image_name,
    crop_timestamp,
)
from app.crop_engine.tiler import split_into_tiles
from app.dataset.store import DatasetStore

logger = logging.getLogger(__name__)


def _resize_to_gsd(rgb: np.ndarray, current_gsd: float, target_gsd: float) -> np.ndarray:
    if target_gsd <= 0 or current_gsd <= 0:
        return rgb
    scale = current_gsd / target_gsd
    if abs(scale - 1.0) < 0.02:
        return rgb
    h, w = rgb.shape[:2]
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    return cv2.resize(rgb, (new_w, new_h), interpolation=cv2.INTER_AREA)


def _save_image(image: Image.Image, path: str, fmt: str) -> None:
    if fmt == "jpeg":
        image.save(path, format="JPEG", quality=92)
    else:
        image.save(path, format="PNG")


def fetch_tile_for_roi(
    roi_polygon: dict[str, Any] | GeoJSONPolygon,
    source: str,
    target_gsd: float,
    batch_id: str | None = None,
    *,
    settings: Settings | None = None,
    store: DatasetStore | None = None,
) -> list[dict[str, Any]]:
    """Download imagery for *roi_polygon*, split if needed, persist as ``data/{timestamp}.png``."""
    settings = settings or get_settings()
    data_dir = settings.resolve_data_dir()
    db_path = data_dir / "obb_studio.db"
    store = store or DatasetStore(db_path)
    store.init_db()
    image_ext = settings.crop_image_format

    if isinstance(roi_polygon, dict):
        roi = GeoJSONPolygon.model_validate(roi_polygon)
    else:
        roi = roi_polygon

    imagery_settings = ImagerySettings()
    provider = get_imagery_provider(source, imagery_settings)  # type: ignore[arg-type]

    slice_ = provider.fetch_geotiff(roi, target_gsd)
    rgb = np.asarray(slice_.pixels[..., :3], dtype=np.uint8)
    rgb = _resize_to_gsd(rgb, slice_.gsd_m, target_gsd)

    batch_ts = batch_id or crop_timestamp()

    tiles = split_into_tiles(
        rgb,
        tile_size_px=settings.tile_size_px,
        overlap_ratio=settings.tile_overlap_ratio,
    )

    created: list[dict[str, Any]] = []
    total = len(tiles)
    for index, (tile_rgb, offset_x, offset_y, tile_meta) in enumerate(tiles):
        stem = crop_file_stem(batch_ts, index, total)
        image_name = crop_image_name(stem, image_ext)
        image_path_abs = data_dir / image_name

        _save_image(Image.fromarray(tile_rgb), str(image_path_abs), image_ext)

        tile_id = str(uuid.uuid4())
        meta = {
            "crop_id": batch_ts,
            "stem": stem,
            "image": image_name,
            "tile_id": tile_id,
            "source": source,
            "target_gsd_m": target_gsd,
            "fetched_gsd_m": slice_.gsd_m,
            "bounds_wgs84": slice_.bounds_wgs84.model_dump(),
            "offset_x": offset_x,
            "offset_y": offset_y,
            "width_px": int(tile_rgb.shape[1]),
            "height_px": int(tile_rgb.shape[0]),
            "tile_meta": tile_meta,
            "roi": roi.model_dump(),
        }

        row = store.create_tile(
            session_id=batch_ts,
            source=source,
            width_px=int(tile_rgb.shape[1]),
            height_px=int(tile_rgb.shape[0]),
            image_path=image_name,
            offset_x=offset_x,
            offset_y=offset_y,
            meta=meta,
            tile_id=tile_id,
        )
        created.append(row)
        logger.info("Persisted tile %s (%s)", tile_id, image_path_abs)

    return created
