"""Smoke tests for critical API routes (no network; uses local SQLite if present)."""
from __future__ import annotations

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_players_default():
    r = client.get("/api/players")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_players_include_inactive_param():
    r = client.get("/api/players", params={"include_inactive": True})
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, list)


def test_records_catalog():
    r = client.get("/api/records/catalog")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    ids = {entry["id"] for entry in data}
    assert "pts" in ids
    assert "pie" in ids


def test_records_advanced_usg_shape():
    """Advanced records read PIE/TS%/USG% from extra_stats JSON, not missing columns."""
    r = client.get(
        "/api/records",
        params={"category": "usg_pct", "scope": "career", "filter": "all"},
    )
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    for row in data:
        assert "player_id" in row and "value" in row and "display_name" in row


def test_leaders_overall():
    r = client.get("/api/leaders/overall")
    assert r.status_code == 200
    body = r.json()
    assert "rows" in body
    assert isinstance(body["rows"], list)


def test_players_careers_batch_empty():
    r = client.post("/api/players/careers", json={"player_ids": []})
    assert r.status_code == 200
    assert r.json() == {"careers": {}}


def test_player_season_awards_route(monkeypatch):
    import nba_service

    def fake(_pid: int):
        return {"2007-08": ["champion", "fmvp", "mvp"]}

    monkeypatch.setattr(nba_service, "get_player_season_awards", fake)
    r = client.get("/api/players/1/season-awards")
    assert r.status_code == 200
    assert r.json() == {"by_season": {"2007-08": ["champion", "fmvp", "mvp"]}}
