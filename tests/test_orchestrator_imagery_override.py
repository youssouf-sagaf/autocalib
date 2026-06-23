"""End-to-end propagation: imagery_source on JobRequest must reach pipeline.run.

Stubs the imagery provider cache and the pipeline so the test stays
hermetic — what we care about is that the orchestrator forwards the right
ImageryProvider instance, not what the pipeline does with it.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from geojson_pydantic import Polygon as GeoJSONPolygon

# Make autocalib-api importable.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "autocalib-api"))

from app.models import CropRequest  # noqa: E402
from app.services import pipeline_service  # noqa: E402
from app.services.orchestrator import MultiCropOrchestrator  # noqa: E402


class _StubProvider:
    """Marker — captures the source name so the test can identify it."""

    def __init__(self, name: str) -> None:
        self.name = name

    def fetch_geotiff(self, *_a, **_kw):  # pragma: no cover — never invoked here
        raise NotImplementedError


class _StubPipeline:
    """Pipeline double — records what `run` was called with and skips real work."""

    def __init__(self) -> None:
        from autoabsmap.config.settings import PipelineSettings
        self._settings = PipelineSettings()
        self._imagery = _StubProvider("default")
        self.run_calls: list[dict] = []

    def run(self, request, on_progress, artifacts_dir, *, learning_sink=None,
            imagery_override=None):
        self.run_calls.append({"override": imagery_override})
        from autoabsmap.generator_engine.models import PipelineResult, RunMeta
        return PipelineResult(
            slots=[],
            baseline_slots=[],
            run_meta=RunMeta(
                sam3_model_id=None,
                sam3_text_prompt=None,
                imagery_provider="stub",
                crs_epsg=4326,
                gsd_m=0.05,
                roi_geojson=request.roi.model_dump(),
            ),
            detection_overlay_geojson=None,
            postprocess_overlay_geojson=None,
        )


def _crop() -> CropRequest:
    poly = GeoJSONPolygon(
        type="Polygon",
        coordinates=[[
            [2.350, 48.856], [2.351, 48.856], [2.351, 48.857],
            [2.350, 48.857], [2.350, 48.856],
        ]],
    )
    return CropRequest(polygon=poly)


def test_get_imagery_provider_caches_per_source(monkeypatch):
    monkeypatch.setattr(pipeline_service, "_provider_cache", {})

    p_ign_a = pipeline_service.get_imagery_provider("ign-current")
    p_ign_b = pipeline_service.get_imagery_provider("ign-current")

    assert p_ign_a is p_ign_b, "same source → same cached instance"


def test_get_imagery_provider_distinct_per_preset(monkeypatch):
    """Each named IGN preset gets its own cached provider instance."""
    monkeypatch.setattr(pipeline_service, "_provider_cache", {})

    p_current = pipeline_service.get_imagery_provider("ign-current")
    p_pleiades = pipeline_service.get_imagery_provider("ign-pleiades-2026")

    assert id(p_current) != id(p_pleiades)
    assert p_current._layer.endswith("ORTHOPHOTOS")
    assert p_pleiades._layer.endswith("PLEIADES.2026")
    assert p_pleiades._format == "image/png"


def test_get_imagery_provider_legacy_ign_alias(monkeypatch):
    """Legacy ``"ign"`` source key maps to the current composite preset."""
    monkeypatch.setattr(pipeline_service, "_provider_cache", {})
    p = pipeline_service.get_imagery_provider("ign")
    assert type(p).__name__ == "IgnImageryProvider"
    assert p._layer == "ORTHOIMAGERY.ORTHOPHOTOS"


def test_get_imagery_provider_rejects_unknown_source(monkeypatch):
    monkeypatch.setattr(pipeline_service, "_provider_cache", {})
    with pytest.raises(ValueError, match="Unknown imagery source"):
        pipeline_service.get_imagery_provider("bing-aerial")


def test_orchestrator_forwards_imagery_override():
    pipeline = _StubPipeline()
    orchestrator = MultiCropOrchestrator(pipeline)

    override = _StubProvider("ign")
    asyncio.run(orchestrator.run(
        crops=[_crop()],
        job_id="job-test",
        imagery_override=override,
    ))

    assert len(pipeline.run_calls) == 1
    assert pipeline.run_calls[0]["override"] is override


def test_orchestrator_passes_none_when_no_override():
    pipeline = _StubPipeline()
    orchestrator = MultiCropOrchestrator(pipeline)

    asyncio.run(orchestrator.run(crops=[_crop()], job_id="job-test"))

    assert pipeline.run_calls[0]["override"] is None


def test_get_imagery_provider_returns_ign(monkeypatch):
    monkeypatch.setattr(pipeline_service, "_provider_cache", {})
    p = pipeline_service.get_imagery_provider("ign-current")
    assert type(p).__name__ == "IgnImageryProvider"
