"""Tests for run manifest and ``stages/{order}_{slug}/`` layout."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_bounds

from absolutemap_gen.artifacts_io import (
    MANIFEST_SCHEMA_VERSION,
    ORDERED_STAGES,
    STAGE_DETECTION,
    STAGE_GIS_INPUT,
    STAGE_JSON_SCHEMA_VERSION,
    RunContext,
    affine_to_list,
    wrap_stage_document,
)


def test_ordered_stage_dirnames() -> None:
    names = [s.dirname for s in ORDERED_STAGES]
    assert names[0] == "00_gis_input"
    assert names[3] == "03_detection"
    assert names[-1] == "05_export"


def test_run_context_create_manifest_and_stage_tree(tmp_path: Path) -> None:
    geotiff = tmp_path / "in.tif"
    geotiff.write_text("dummy", encoding="utf-8")
    run = RunContext.create(
        tmp_path / "run1",
        write_stage_artifacts=True,
        input_geotiff=geotiff,
        window_pixels={"col_off": 0, "row_off": 0, "width": 10, "height": 20},
        cli_args={"foo": 1},
    )
    assert run.manifest_path.is_file()
    man = json.loads(run.manifest_path.read_text(encoding="utf-8"))
    assert man["schema_version"] == MANIFEST_SCHEMA_VERSION
    assert man["write_stage_artifacts"] is True
    assert man["input_geotiff"] == str(geotiff.resolve())
    assert man["window_pixels"]["width"] == 10
    assert man["cli_args"] == {"foo": 1}
    assert man["stages_executed"] == []
    assert man["completed_at"] is None

    run.record_stage(STAGE_GIS_INPUT, artifacts=["meta.json"])
    man2 = json.loads(run.manifest_path.read_text(encoding="utf-8"))
    assert len(man2["stages_executed"]) == 1
    assert man2["stages_executed"][0]["stage"] == "00_gis_input"
    assert man2["stages_executed"][0]["artifacts"] == ["meta.json"]

    run.write_stage_json(STAGE_GIS_INPUT, "meta.json", {"note": "x"})
    meta_path = run.stage_dir(STAGE_GIS_INPUT) / "meta.json"
    assert meta_path.is_file()
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["stage"] == "00_gis_input"
    assert meta["schema_version"] == STAGE_JSON_SCHEMA_VERSION
    assert meta["data"]["note"] == "x"

    run.finalize()
    man3 = json.loads(run.manifest_path.read_text(encoding="utf-8"))
    assert man3["completed_at"] is not None


def test_no_stage_artifacts_skips_file_writes(tmp_path: Path) -> None:
    in_tif = tmp_path / "in.tif"
    in_tif.write_bytes(b"")
    run = RunContext(tmp_path / "run2", write_stage_artifacts=False)
    run.initialize_manifest(
        input_geotiff=in_tif,
        cli_args={},
        crop_mode="full",
        crop_params={},
    )
    assert run.write_stage_png(STAGE_DETECTION, "x.png", np.zeros((1, 1, 3), dtype=np.uint8)) is None
    run.record_stage(STAGE_DETECTION, artifacts=[])
    man = json.loads(run.manifest_path.read_text(encoding="utf-8"))
    assert len(man["stages_executed"]) == 1
    assert man["stages_executed"][0]["stage"] == "03_detection"
    assert man["stages_executed"][0]["artifacts"] == []
    assert not run.stages_root.exists()


def test_write_stage_geotiff_rgb_roundtrip(tmp_path: Path) -> None:
    run = RunContext(tmp_path / "run3", write_stage_artifacts=True)
    west, south, east, north = 2.0, 49.0, 2.01, 49.01
    w, h = 32, 24
    rgb = np.zeros((h, w, 3), dtype=np.uint8)
    rgb[:, :, 0] = 120
    transform = from_bounds(west, south, east, north, width=w, height=h)
    crs = CRS.from_epsg(4326)
    out = run.write_stage_geotiff_rgb(
        STAGE_GIS_INPUT,
        "crop_rgb.tif",
        rgb,
        transform=transform,
        crs=crs,
    )
    assert out is not None
    with rasterio.open(out) as src:
        assert src.count == 3
        assert src.crs == crs
        assert src.width == w and src.height == h
        arr = src.read()
    assert arr.shape == (3, h, w)


def test_affine_to_list_matches_from_bounds() -> None:
    t = from_bounds(0, 0, 100, 50, width=100, height=50)
    lst = affine_to_list(t)
    assert len(lst) == 6
    assert lst[0] == pytest.approx(t.a)


def test_wrap_stage_document() -> None:
    doc = wrap_stage_document(STAGE_DETECTION, {"k": 1})
    assert doc["stage"] == "03_detection"
    assert doc["data"]["k"] == 1


def test_write_gis_meta_json(tmp_path: Path) -> None:
    run = RunContext(tmp_path / "run4", write_stage_artifacts=True)
    src = tmp_path / "source.tif"
    src.write_bytes(b"")
    t = from_bounds(1, 2, 3, 4, width=10, height=20)
    crs = CRS.from_epsg(4326)
    path = run.write_gis_meta_json(
        source_path=src,
        transform=t,
        crs=crs,
        width=10,
        height=20,
        nodata=None,
    )
    assert path is not None
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["stage"] == "00_gis_input"
    inner = data["data"]
    assert inner["width"] == 10
    assert inner["height"] == 20
    assert len(inner["transform_affine"]) == 6
