"""Application settings (Pydantic Settings)."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.training.constants import DEFAULT_YOLO_OBB_MODEL

ImagerySource = Literal[
    "mapbox",
    "ign-current",
    "ign-pleiades-2026",
]


class Settings(BaseSettings):
    """OBB Studio configuration."""

    model_config = SettingsConfigDict(
        env_prefix="OBB_STUDIO_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    data_dir: Path = Field(default=Path("data"))
    primary_gsd_m: float = 0.05
    tile_size_px: int = 1024
    tile_overlap_ratio: float = 0.2
    api_port: int = 8100
    default_imagery_source: ImagerySource = "ign-current"
    crop_image_format: Literal["png", "jpeg"] = "png"
    train_val_ratio: float = 0.85
    train_val_seed: int = 42
    default_yolo_model: str = DEFAULT_YOLO_OBB_MODEL
    cors_origins: list[str] = Field(default_factory=lambda: ["*"])

    # Passed through to autoabsmap ImagerySettings via environment (IMAGERY_*).
    mapbox_access_token: str = Field(default="", validation_alias="IMAGERY_MAPBOX_ACCESS_TOKEN")

    def resolve_data_dir(self, base: Path | None = None) -> Path:
        root = base or Path(__file__).resolve().parents[2]
        path = self.data_dir if self.data_dir.is_absolute() else root / self.data_dir
        path.mkdir(parents=True, exist_ok=True)
        return path


def get_settings() -> Settings:
    return Settings()
