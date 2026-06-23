"""HTTP contract for POST /api/v1/clients/{id}/slots/save."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "autocalib-api"))

from app.main import app  # noqa: E402
from app.services.b2b_geography import SaveSlotsResult  # noqa: E402


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_slots_save_returns_overlay(client: TestClient) -> None:
    outcome = SaveSlotsResult(
        results=[
            {
                "slot_id": "prod-1",
                "center": {"lat": 48.9, "lng": 2.4},
                "polygon": {
                    "type": "Polygon",
                    "coordinates": [[[2.4, 48.9], [2.41, 48.9], [2.41, 48.91], [2.4, 48.91], [2.4, 48.9]]],
                },
                "source": "manual",
                "confidence": 1.0,
                "status": "unknown",
                "slot_type": "common",
            },
        ],
        save_summary={"created": 1, "updated": 0, "deleted": 0, "total_slots": 1},
        warning=None,
    )
    with (
        patch("app.routes.clients.b2b_enabled", return_value=True),
        patch(
            "app.services.b2b_clients.resolve_b2b_client_id_for_sync",
            new_callable=AsyncMock,
            return_value=(None, None),
        ),
        patch(
            "app.routes.clients.save_client_slots_dirty",
            new_callable=AsyncMock,
            return_value=outcome,
        ),
    ):
        response = client.post(
            "/api/v1/clients/test-client/slots/save",
            json={"slots": [], "deleted_prod_ids": []},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["client_id"] == "test-client"
    assert len(body["results"]) == 1
    assert body["save_summary"]["created"] == 1
    assert body["warning"] is None


def test_slots_save_503_when_b2b_disabled(client: TestClient) -> None:
    with patch("app.routes.clients.b2b_enabled", return_value=False):
        response = client.post(
            "/api/v1/clients/test-client/slots/save",
            json={"slots": [], "deleted_prod_ids": []},
        )
    assert response.status_code == 503


def test_slots_sync_deprecated_410(client: TestClient) -> None:
    response = client.post("/api/v1/clients/test-client/slots/sync")
    assert response.status_code == 410
