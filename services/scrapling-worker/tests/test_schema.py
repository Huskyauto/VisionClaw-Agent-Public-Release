import os

from fastapi.testclient import TestClient

from app import app


def test_authentication_and_unknown_fields(monkeypatch):
    monkeypatch.setenv("SCRAPLING_ACCESS_KEY", "test-key")
    client = TestClient(app)
    assert client.get("/healthz").status_code == 401
    assert client.get("/healthz", headers={"Authorization": "Bearer test-key"}).status_code == 200
    response = client.post(
        "/v1/scrape",
        headers={"Authorization": "Bearer test-key"},
        json={"url": "https://example.com", "unexpected": True},
    )
    assert response.status_code == 422


def test_mode_and_timeout_are_server_bounded(monkeypatch):
    monkeypatch.setenv("SCRAPLING_ACCESS_KEY", "test-key")
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-key"}
    assert client.post("/v1/scrape", headers=headers, json={"url": "https://example.com", "mode": "browser"}).status_code == 422
    assert client.post("/v1/scrape", headers=headers, json={"url": "https://example.com", "timeout_seconds": 31}).status_code == 422