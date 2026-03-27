"""
main.py — FastAPI application.
All data logic lives in nba_service.py. This file is thin routing only.
"""
from pathlib import Path
from typing import Optional
import uuid
from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import db
import nba_service as svc

app = FastAPI(title="NBA Stats API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

Path("static/headshots").mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")
_refresh_jobs: dict[str, dict] = {}


@app.on_event("startup")
def startup():
    db.init_db()


# ---------------------------------------------------------------------------
# Standings & Playoffs
# ---------------------------------------------------------------------------

@app.get("/api/standings")
def standings():
    return svc.get_standings()


@app.get("/api/playoffs")
def playoffs():
    return svc.get_playoffs()


# ---------------------------------------------------------------------------
# Leaders & Awards
# ---------------------------------------------------------------------------

@app.get("/api/leaders")
def leaders():
    return svc.get_leaders()


@app.get("/api/leaders/overall")
def leaders_overall():
    return {"rows": svc.get_leaders_overall()}


@app.get("/api/records")
def records(
    category: str = Query(default="pts"),
    scope: str = Query(default="career"),
    filter: str = Query(default="all")
):
    return svc.get_records(category, scope, filter)


@app.get("/api/records/catalog")
def records_catalog():
    return svc.get_records_catalog()


@app.get("/api/sync/status")
def sync_status():
    return svc.get_sync_status()


@app.get("/api/data/coverage")
def data_coverage(
    player_id: Optional[int] = Query(default=None),
    team_id: Optional[int] = Query(default=None),
):
    return svc.get_data_coverage(player_id=player_id, team_id=team_id)


@app.get("/api/awards/{award_type}")
def awards(award_type: str):
    valid = {"mvp", "dpoy", "clutch", "mip", "roy", "smoy"}
    if award_type not in valid:
        raise HTTPException(status_code=404, detail=f"Unknown award type: {award_type}")
    return svc.get_award_rankings(award_type)


# ---------------------------------------------------------------------------
# Data Refresh
# ---------------------------------------------------------------------------

@app.post("/api/refresh")
def refresh_data(
    background_tasks: BackgroundTasks,
    season: str = Query(default=svc.CURRENT_SEASON),
    quick: bool = Query(default=False),
):
    job_id = str(uuid.uuid4())
    _refresh_jobs[job_id] = {"status": "started", "season": season, "quick": quick}
    background_tasks.add_task(run_refresh_script, job_id, season, quick)
    return {"status": "started", "season": season, "quick": quick, "job_id": job_id}


def run_refresh_script(job_id: str, season: str, quick: bool = False):
    import subprocess
    import sys
    try:
        if quick:
            subprocess.run([sys.executable, "seed.py", "--quick-refresh"], check=True)
        else:
            subprocess.run(
                [sys.executable, "seed.py", "--season", season, "--force", "--no-gamelogs"],
                check=True,
            )
        svc.clear_refreshable_caches()
        _refresh_jobs[job_id] = {"status": "completed", "season": season, "quick": quick}
    except Exception as exc:
        _refresh_jobs[job_id] = {"status": "failed", "season": season, "quick": quick, "error": str(exc)}


@app.get("/api/refresh/{job_id}")
def refresh_status(job_id: str):
    job = _refresh_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown refresh job id")
    return {"job_id": job_id, **job}


# ---------------------------------------------------------------------------
# Teams
# ---------------------------------------------------------------------------

@app.get("/api/team-stats")
def team_stats(season: Optional[str] = Query(default=None)):
    return svc.get_team_stats(season=season)


@app.get("/api/teams/featured")
def featured_teams():
    return svc.get_featured_teams()


@app.get("/api/teams/featured/ids")
def featured_team_ids():
    return svc.get_featured_team_ids()


@app.post("/api/teams/featured/{team_id}")
def add_featured_team(team_id: int):
    svc.add_featured_team(team_id)
    return {"ok": True}


@app.delete("/api/teams/featured/{team_id}")
def remove_featured_team(team_id: int):
    svc.remove_featured_team(team_id)
    return {"ok": True}


class FeaturedTeamOrderBody(BaseModel):
    team_ids: list[int] = Field(min_length=1)


@app.put("/api/teams/featured/order")
def reorder_featured_teams(body: FeaturedTeamOrderBody):
    try:
        svc.reorder_featured_teams(body.team_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@app.get("/api/teams")
def teams():
    return svc.get_teams()


@app.get("/api/teams/{team_id}/roster")
def team_roster(team_id: int):
    return svc.get_team_roster(team_id)


@app.get("/api/teams/{team_id}/gamelog")
def team_gamelog(team_id: int):
    return svc.get_team_gamelog(team_id)


@app.get("/api/teams/{team_id}/season-history")
def team_season_history(team_id: int):
    return svc.get_team_season_history(team_id)


@app.get("/api/teams/{team_id}/splits")
def team_splits(team_id: int):
    return svc.get_team_splits(team_id)


# ---------------------------------------------------------------------------
# Players
# ---------------------------------------------------------------------------

@app.get("/api/players")
def players(include_inactive: bool = Query(False)):
    return svc.get_all_players(include_inactive=include_inactive)


@app.get("/api/players/featured")
def featured():
    return svc.get_featured_players()


@app.get("/api/players/featured/ids")
def featured_ids():
    return svc.get_featured_player_ids()


@app.post("/api/players/featured/{player_id}")
def add_featured(player_id: int):
    svc.add_featured_player(player_id)
    return {"ok": True}


@app.delete("/api/players/featured/{player_id}")
def remove_featured(player_id: int):
    svc.remove_featured_player(player_id)
    return {"ok": True}


class FeaturedPlayerOrderBody(BaseModel):
    player_ids: list[int] = Field(min_length=1)


@app.put("/api/players/featured/order")
def reorder_featured_players(body: FeaturedPlayerOrderBody):
    try:
        svc.reorder_featured_players(body.player_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


class PlayerCareersBatchBody(BaseModel):
    player_ids: list[int] = Field(default_factory=list, max_length=40)


@app.post("/api/players/careers")
def players_careers_batch(body: PlayerCareersBatchBody):
    return svc.get_players_careers_batch(body.player_ids)


@app.get("/api/players/{player_id}/stats")
def player_stats(player_id: int, season: Optional[str] = Query(default=None)):
    return svc.get_player_stats(player_id, season=season)


@app.get("/api/players/{player_id}/gamelog")
def player_gamelog(player_id: int):
    return svc.get_player_gamelog(player_id)


@app.get("/api/players/{player_id}/splits")
def player_splits(player_id: int):
    return svc.get_player_splits(player_id)


@app.get("/api/players/{player_id}/career")
def player_career(player_id: int):
    return svc.get_player_career(player_id)


@app.get("/api/players/{player_id}/season-awards")
def player_season_awards(player_id: int):
    """Season → honor tags from NBA PlayerAwards (MVP, Finals MVP, champion, ROY, Sixth Man)."""
    return {"by_season": svc.get_player_season_awards(player_id)}
