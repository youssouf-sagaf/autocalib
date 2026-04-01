"""Run directory layout: ``manifest.json`` and ``stages/{order}_{slug}/``.

Stage folders hold PNG overlays, GeoTIFF rasters (when georeferencing matters), and JSON
sidecars. JSON sidecars from :meth:`RunContext.write_stage_json` use a stable envelope:
``schema_version``, ``stage`` (directory id), and ``data`` (payload).

The parking pipeline also writes some stage JSON (e.g. GeoJSON) via :func:`write_json_atomic`
with their own embedded ``schema_version`` / ``stage`` fields where noted in each stage.
"""

from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

import numpy as np
import rasterio
from PIL import Image
from rasterio.crs import CRS
from rasterio.transform import Affine

from absolutemap_gen.config import PACKAGE_ROOT

__all__ = [
    "MANIFEST_SCHEMA_VERSION",
    "STAGE_JSON_SCHEMA_VERSION",
    "StageSpec",
    "PipelineStage",
    "STAGE_GIS_INPUT",
    "STAGE_PREPROCESS",
    "STAGE_SEGMENTATION",
    "STAGE_DETECTION",
    "STAGE_POSTPROCESS",
    "STAGE_EXPORT",
    "ORDERED_STAGES",
    "ALL_PIPELINE_STAGES",
    "STAGE_BY_SLUG",
    "RunContext",
    "RunArtifacts",
    "affine_to_list",
    "affine_to_coeff_list",
    "try_git_head_short",
    "wrap_stage_document",
    "write_stage_json_file",
    "write_json_atomic",
    "write_rgb_geotiff",
    "write_initial_manifest",
    "finalize_manifest",
]

MANIFEST_SCHEMA_VERSION = "1"
STAGE_JSON_SCHEMA_VERSION = "1"


@dataclass(frozen=True, slots=True)
class StageSpec:
    """One pipeline step; on disk: ``stages/{order:02d}_{slug}/``."""

    order: int
    slug: str

    @property
    def dirname(self) -> str:
        """Directory name under ``stages/`` (e.g. ``03_detection``)."""
        return f"{self.order:02d}_{self.slug}"


PipelineStage = StageSpec

STAGE_GIS_INPUT = StageSpec(0, "gis_input")
STAGE_PREPROCESS = StageSpec(1, "preprocess")
STAGE_SEGMENTATION = StageSpec(2, "segmentation")
STAGE_DETECTION = StageSpec(3, "detection")
STAGE_POSTPROCESS = StageSpec(4, "postprocess")
STAGE_EXPORT = StageSpec(5, "export")

ORDERED_STAGES: tuple[StageSpec, ...] = (
    STAGE_GIS_INPUT,
    STAGE_PREPROCESS,
    STAGE_SEGMENTATION,
    STAGE_DETECTION,
    STAGE_POSTPROCESS,
    STAGE_EXPORT,
)

ALL_PIPELINE_STAGES = ORDERED_STAGES
STAGE_BY_SLUG: dict[str, StageSpec] = {s.slug: s for s in ORDERED_STAGES}


def try_git_head_short(*, repo_root: Path | None = None) -> str | None:
    """Return abbreviated ``git`` commit hash for ``repo_root``, or None if unavailable."""
    root = repo_root or PACKAGE_ROOT
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    out = (proc.stdout or "").strip()
    return out or None


def affine_to_list(transform: Affine) -> list[float]:
    """Serialize a rasterio affine as ``[a, b, c, d, e, f]`` (GDAL order)."""
    return [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f]


affine_to_coeff_list = affine_to_list


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def wrap_stage_document(stage: StageSpec, data: Any) -> dict[str, Any]:
    """Build ``{schema_version, stage, data}`` for a stage JSON sidecar."""
    return {
        "schema_version": STAGE_JSON_SCHEMA_VERSION,
        "stage": stage.dirname,
        "data": data,
    }


def write_stage_json_file(path: Path, document: Mapping[str, Any]) -> None:
    """Write JSON with UTF-8 and stable indentation."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2, allow_nan=False), encoding="utf-8")


def write_json_atomic(path: Path, obj: Any) -> None:
    """Write JSON atomically (temp file + replace) under ``path``."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(obj, indent=2, allow_nan=False)
    tmp = path.with_name(f"{path.name}.tmp.{os.getpid()}")
    try:
        tmp.write_text(payload, encoding="utf-8")
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def write_rgb_geotiff(
    path: Path,
    rgb_hwc: np.ndarray,
    *,
    transform: Affine,
    crs: CRS | None,
) -> None:
    """Write RGB uint8 (H, W, 3) as a GeoTIFF with georeferencing."""
    if rgb_hwc.ndim != 3 or rgb_hwc.shape[2] != 3:
        raise ValueError("rgb_hwc must have shape (H, W, 3)")
    if rgb_hwc.dtype != np.uint8:
        raise ValueError("rgb_hwc must be uint8")
    height, width = int(rgb_hwc.shape[0]), int(rgb_hwc.shape[1])
    path.parent.mkdir(parents=True, exist_ok=True)
    profile: dict[str, Any] = {
        "driver": "GTiff",
        "width": width,
        "height": height,
        "count": 3,
        "dtype": "uint8",
        "transform": transform,
        "photometric": "RGB",
    }
    if crs is not None:
        profile["crs"] = crs
    chw = np.transpose(rgb_hwc, (2, 0, 1))
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(chw)


def _stage_slug(stage: str | StageSpec) -> str:
    return stage if isinstance(stage, str) else stage.dirname


def _resolve_stage(stage: str | StageSpec) -> StageSpec:
    if isinstance(stage, StageSpec):
        return stage
    for spec in ORDERED_STAGES:
        if spec.dirname == stage:
            return spec
    raise ValueError(f"Unknown pipeline stage: {stage!r}")


@dataclass
class RunContext:
    """One pipeline run: ``manifest.json`` and ``stages/{order}_{slug}/``."""

    out_dir: Path
    write_stage_artifacts: bool
    _manifest: dict[str, Any] | None = field(default=None, repr=False)

    def __init__(
        self,
        out_dir: Path | str,
        *,
        write_stage_artifacts: bool = True,
    ) -> None:
        self.out_dir = Path(out_dir).expanduser().resolve()
        self.write_stage_artifacts = write_stage_artifacts
        self._manifest = None
        self.out_dir.mkdir(parents=True, exist_ok=True)
        if write_stage_artifacts:
            self.stages_root.mkdir(parents=True, exist_ok=True)

    @classmethod
    def create(
        cls,
        out_dir: Path | str,
        *,
        write_stage_artifacts: bool = True,
        input_geotiff: Path | str | None = None,
        bounds: tuple[float, float, float, float] | None = None,
        window_pixels: Mapping[str, int] | None = None,
        cli_args: Mapping[str, Any] | None = None,
        git_revision: str | None = None,
    ) -> RunContext:
        """Create a run directory and write an initial manifest (for tests / standalone runs)."""
        ctx = cls(out_dir, write_stage_artifacts=write_stage_artifacts)
        resolved_input = (
            str(Path(input_geotiff).expanduser().resolve()) if input_geotiff is not None else None
        )
        rev = git_revision if git_revision is not None else try_git_head_short()
        ctx._manifest = {
            "schema_version": MANIFEST_SCHEMA_VERSION,
            "started_at": _utc_now_iso(),
            "completed_at": None,
            "write_stage_artifacts": write_stage_artifacts,
            "input_geotiff": resolved_input,
            "bounds": list(bounds) if bounds is not None else None,
            "window_pixels": dict(window_pixels) if window_pixels is not None else None,
            "cli_args": dict(cli_args) if cli_args is not None else {},
            "git_revision": rev,
            "stages_executed": [],
        }
        ctx._persist_manifest()
        return ctx

    @property
    def manifest_path(self) -> Path:
        return self.out_dir / "manifest.json"

    @property
    def stages_root(self) -> Path:
        return self.out_dir / "stages"

    def initialize_manifest(
        self,
        *,
        input_geotiff: Path | str,
        cli_args: Mapping[str, Any],
        crop_mode: str,
        crop_params: Mapping[str, Any],
    ) -> None:
        """Write the initial ``manifest.json`` before pipeline stages run."""
        self._manifest = {
            "schema_version": MANIFEST_SCHEMA_VERSION,
            "started_at": _utc_now_iso(),
            "completed_at": None,
            "write_stage_artifacts": self.write_stage_artifacts,
            "input_geotiff": str(Path(input_geotiff).resolve()),
            "cli_args": dict(cli_args),
            "crop": {"mode": crop_mode, "params": dict(crop_params)},
            "git_revision": try_git_head_short(),
            "stages_executed": [],
        }
        self._persist_manifest()

    def stage_dir(self, stage: str | StageSpec) -> Path:
        """Path ``out_dir/stages/{order}_{slug}/`` (directories created when writing files)."""
        return self.stages_root / _stage_slug(stage)

    def _persist_manifest(self) -> None:
        if self._manifest is None:
            return
        write_json_atomic(self.manifest_path, self._manifest)

    @property
    def executed_stages(self) -> list[str]:
        """Stage directory ids completed so far (for logging and tests)."""
        if self._manifest is None:
            return []
        raw = self._manifest.get("stages_executed", [])
        out: list[str] = []
        for item in raw:
            if isinstance(item, str):
                out.append(item)
            elif isinstance(item, Mapping) and "stage" in item:
                out.append(str(item["stage"]))
        return out

    def record_stage(
        self,
        stage: str | StageSpec,
        *,
        artifacts: list[str] | None = None,
    ) -> None:
        """Append a completed stage to ``manifest.json`` and flush."""
        if self._manifest is None:
            raise RuntimeError("Call initialize_manifest() before record_stage().")
        slug = _stage_slug(stage)
        entry: dict[str, Any] = {
            "stage": slug,
            "finished_at": _utc_now_iso(),
        }
        if artifacts is not None:
            entry["artifacts"] = list(artifacts)
        cast = self._manifest["stages_executed"]
        assert isinstance(cast, list)
        cast.append(entry)
        self._persist_manifest()

    def finalize(self) -> None:
        """Set ``completed_at`` and write ``manifest.json``."""
        if self._manifest is None:
            return
        self._manifest["completed_at"] = _utc_now_iso()
        self._persist_manifest()

    def update_manifest(self, **extra: Any) -> None:
        """Merge top-level keys into the manifest (e.g. extra metadata)."""
        if self._manifest is None:
            raise RuntimeError("Call initialize_manifest() before update_manifest().")
        for key, value in extra.items():
            self._manifest[key] = value
        self._persist_manifest()

    def write_stage_json(
        self,
        stage: str | StageSpec,
        filename: str,
        data: Any,
    ) -> Path | None:
        """Write a JSON sidecar with ``schema_version``, ``stage``, and ``data``."""
        if not self.write_stage_artifacts:
            return None
        spec = _resolve_stage(stage)
        path = self.stage_dir(spec) / filename
        write_stage_json_file(path, wrap_stage_document(spec, data))
        return path

    def write_stage_text(self, stage: str | StageSpec, filename: str, text: str) -> Path | None:
        if not self.write_stage_artifacts:
            return None
        path = self.stage_dir(stage) / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def write_stage_png(self, stage: str | StageSpec, filename: str, rgb_hwc: np.ndarray) -> Path | None:
        """Save uint8 RGB (H, W, 3) as PNG."""
        if not self.write_stage_artifacts:
            return None
        if rgb_hwc.ndim != 3 or rgb_hwc.shape[2] != 3:
            raise ValueError("rgb_hwc must have shape (H, W, 3)")
        if rgb_hwc.dtype != np.uint8:
            raise ValueError("rgb_hwc must be uint8")
        path = self.stage_dir(stage) / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(rgb_hwc, mode="RGB").save(path)
        return path

    def write_stage_geotiff_rgb(
        self,
        stage: str | StageSpec,
        filename: str,
        rgb_hwc: np.ndarray,
        *,
        transform: Affine,
        crs: CRS | None,
    ) -> Path | None:
        """Write a 3-band uint8 GeoTIFF from (H, W, 3) RGB."""
        if not self.write_stage_artifacts:
            return None
        path = self.stage_dir(stage) / filename
        write_rgb_geotiff(path, rgb_hwc, transform=transform, crs=crs)
        return path

    def write_gis_input_meta(
        self,
        *,
        source_path: Path | str,
        transform: Affine,
        crs: CRS | None,
        width: int,
        height: int,
        nodata: float | None = None,
        extra: Mapping[str, Any] | None = None,
    ) -> Path | None:
        """Write ``00_gis_input/meta.json`` (CRS, affine, dimensions, source path)."""
        epsg = crs.to_epsg() if crs else None
        body: dict[str, Any] = {
            "source_path": str(Path(source_path).expanduser().resolve()),
            "crs_wkt": crs.to_wkt() if crs else None,
            "crs_epsg": epsg,
            "transform_affine": affine_to_list(transform),
            "width": int(width),
            "height": int(height),
            "nodata": nodata,
        }
        if extra:
            body["extra"] = dict(extra)
        return self.write_stage_json(STAGE_GIS_INPUT, "meta.json", body)

    def write_gis_meta_json(
        self,
        *,
        source_path: Path | str,
        transform: Affine,
        crs: CRS | None,
        width: int,
        height: int,
        nodata: float | None = None,
        extra: Mapping[str, Any] | None = None,
    ) -> Path | None:
        """Alias of :meth:`write_gis_input_meta` for backward compatibility."""
        return self.write_gis_input_meta(
            source_path=source_path,
            transform=transform,
            crs=crs,
            width=width,
            height=height,
            nodata=nodata,
            extra=extra,
        )


RunArtifacts = RunContext


def write_initial_manifest(
    manifest_path: Path,
    *,
    geotiff_path: Path,
    cli_args: dict[str, Any],
    crop_mode: str,
    crop_params: dict[str, Any],
    write_stage_artifacts: bool = True,
) -> None:
    """Bootstrap ``manifest.json`` at ``manifest_path`` (legacy helper)."""
    out_dir = manifest_path.parent
    ctx = RunContext(out_dir, write_stage_artifacts=write_stage_artifacts)
    ctx.initialize_manifest(
        input_geotiff=geotiff_path,
        cli_args=cli_args,
        crop_mode=crop_mode,
        crop_params=crop_params,
    )


def finalize_manifest(manifest_path: Path, executed_stages: list[str]) -> None:
    """Merge ``executed_stages`` and ``completed_at`` into an existing manifest (legacy helper)."""
    path = Path(manifest_path)
    if not path.is_file():
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    data["stages_executed"] = list(executed_stages)
    data["completed_at"] = _utc_now_iso()
    write_json_atomic(path, data)
