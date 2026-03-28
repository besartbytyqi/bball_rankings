"""
db.py — SQLite schema, connection helpers, and query utilities.
Database file: nba_stats.db (project root)
"""
from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(os.environ.get("DATABASE_PATH", str(Path(__file__).parent / "nba_stats.db")))

DDL = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS players (
    player_id         INTEGER PRIMARY KEY,
    display_name      TEXT NOT NULL,
    first_name        TEXT,
    last_name         TEXT,
    team_id           INTEGER,
    team_abbreviation TEXT,
    position          TEXT,
    jersey_number     TEXT,
    from_year         INTEGER,
    to_year           INTEGER,
    is_active         INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS player_season_stats (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id   INTEGER NOT NULL,
    season      TEXT NOT NULL,
    stat_type   TEXT NOT NULL,   -- 'base' | 'advanced' | 'defense'
    gp          INTEGER,
    min         REAL,
    pts         REAL,
    reb         REAL,
    ast         REAL,
    stl         REAL,
    blk         REAL,
    fg_pct      REAL,
    fg3_pct     REAL,
    ft_pct      REAL,
    plus_minus  REAL,
    extra_stats TEXT,            -- JSON: remaining stat columns vary by stat_type
    UNIQUE(player_id, season, stat_type)
);
CREATE INDEX IF NOT EXISTS idx_pss_player  ON player_season_stats(player_id);
CREATE INDEX IF NOT EXISTS idx_pss_season  ON player_season_stats(season);

CREATE TABLE IF NOT EXISTS player_gamelog (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id   INTEGER NOT NULL,
    season      TEXT NOT NULL,
    game_id     TEXT NOT NULL,
    game_date   TEXT,
    matchup     TEXT,
    wl          TEXT,
    min         REAL,
    pts         INTEGER,
    reb         INTEGER,
    ast         INTEGER,
    stl         INTEGER,
    blk         INTEGER,
    fg_pct      REAL,
    fg3_pct     REAL,
    ft_pct      REAL,
    plus_minus  INTEGER,
    tov         INTEGER,
    fgm         INTEGER,
    fga         INTEGER,
    ftm         INTEGER,
    fta         INTEGER,
    pf          INTEGER,
    UNIQUE(player_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_pgl_player ON player_gamelog(player_id, season);

CREATE TABLE IF NOT EXISTS teams (
    team_id       INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    abbreviation  TEXT NOT NULL,
    conference    TEXT NOT NULL,
    city          TEXT,
    primary_color TEXT
);

CREATE TABLE IF NOT EXISTS team_season_stats (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id     INTEGER NOT NULL,
    season      TEXT NOT NULL,
    stat_type   TEXT NOT NULL,   -- 'base' | 'advanced' | 'opponent'
    gp          INTEGER,
    wins        INTEGER,
    losses      INTEGER,
    pts         REAL,
    reb         REAL,
    ast         REAL,
    stl         REAL,
    blk         REAL,
    fg_pct      REAL,
    fg3_pct     REAL,
    ft_pct      REAL,
    extra_stats TEXT,            -- JSON
    UNIQUE(team_id, season, stat_type)
);
CREATE INDEX IF NOT EXISTS idx_tss_team   ON team_season_stats(team_id);
CREATE INDEX IF NOT EXISTS idx_tss_season ON team_season_stats(season);

CREATE TABLE IF NOT EXISTS team_gamelog (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id   INTEGER NOT NULL,
    season    TEXT NOT NULL,
    game_id   TEXT NOT NULL,
    game_date TEXT,
    matchup   TEXT,
    wl        TEXT,
    pts       INTEGER,
    opp_pts   INTEGER,
    reb       INTEGER,
    ast       INTEGER,
    stl       INTEGER,
    blk       INTEGER,
    tov       INTEGER,
    fgm       INTEGER,
    fga       INTEGER,
    ftm       INTEGER,
    fta       INTEGER,
    UNIQUE(team_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_tgl_team ON team_gamelog(team_id, season);

CREATE TABLE IF NOT EXISTS standings (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    season           TEXT NOT NULL,
    team_id          INTEGER NOT NULL,
    conference       TEXT,
    wins             INTEGER,
    losses           INTEGER,
    win_pct          REAL,
    games_back       REAL,
    home_record      TEXT,
    road_record      TEXT,
    last10           TEXT,
    streak           TEXT,
    conference_rank  INTEGER,
    UNIQUE(season, team_id)
);

CREATE TABLE IF NOT EXISTS leaders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    season      TEXT NOT NULL,
    stat_category TEXT NOT NULL,
    rank        INTEGER NOT NULL,
    player_id   INTEGER,
    player_name TEXT,
    team_id     INTEGER,
    value       REAL,
    UNIQUE(season, stat_category, rank)
);

CREATE TABLE IF NOT EXISTS award_rankings (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    season             TEXT NOT NULL,
    award_type         TEXT NOT NULL,
    rank               INTEGER NOT NULL,
    player_id          INTEGER,
    player_name        TEXT,
    team_abbreviation  TEXT,
    score              REAL,
    stats_json         TEXT,
    UNIQUE(season, award_type, rank)
);

CREATE TABLE IF NOT EXISTS featured_players (
    player_id  INTEGER PRIMARY KEY,
    added_at   TEXT DEFAULT (datetime('now')),
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS featured_teams (
    team_id    INTEGER PRIMARY KEY,
    added_at   TEXT DEFAULT (datetime('now')),
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_state (
    sync_key   TEXT PRIMARY KEY,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _migrate_team_gamelog_extras(conn: sqlite3.Connection) -> None:
    """Add box-score columns to existing team_gamelog tables."""
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='team_gamelog'"
    ).fetchone()
    if not row:
        return
    cols = {r[1] for r in conn.execute("PRAGMA table_info(team_gamelog)").fetchall()}
    for col, typ in (
        ("reb", "INTEGER"),
        ("ast", "INTEGER"),
        ("stl", "INTEGER"),
        ("blk", "INTEGER"),
        ("tov", "INTEGER"),
        ("fgm", "INTEGER"),
        ("fga", "INTEGER"),
        ("ftm", "INTEGER"),
        ("fta", "INTEGER"),
    ):
        if col not in cols:
            conn.execute(f"ALTER TABLE team_gamelog ADD COLUMN {col} {typ}")
            cols.add(col)


def _migrate_player_gamelog_extras(conn: sqlite3.Connection) -> None:
    """Add box-score columns to existing player_gamelog tables."""
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='player_gamelog'"
    ).fetchone()
    if not row:
        return
    cols = {r[1] for r in conn.execute("PRAGMA table_info(player_gamelog)").fetchall()}
    for col, typ in (
        ("tov", "INTEGER"),
        ("fgm", "INTEGER"),
        ("fga", "INTEGER"),
        ("ftm", "INTEGER"),
        ("fta", "INTEGER"),
        ("pf", "INTEGER"),
    ):
        if col not in cols:
            conn.execute(f"ALTER TABLE player_gamelog ADD COLUMN {col} {typ}")
            cols.add(col)


def _migrate_featured_players_sort_order(conn: sqlite3.Connection) -> None:
    """Add sort_order to existing featured_players tables."""
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='featured_players'"
    ).fetchone()
    if not row:
        return
    cols = {r[1] for r in conn.execute("PRAGMA table_info(featured_players)").fetchall()}
    if "sort_order" in cols:
        return
    conn.execute("ALTER TABLE featured_players ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
    rows = conn.execute("SELECT player_id FROM featured_players ORDER BY added_at").fetchall()
    for i, (pid,) in enumerate(rows):
        conn.execute(
            "UPDATE featured_players SET sort_order = ? WHERE player_id = ?",
            (i, pid),
        )


def _migrate_featured_teams_sort_order(conn: sqlite3.Connection) -> None:
    """Add sort_order to existing DBs and backfill from added_at order."""
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='featured_teams'"
    ).fetchone()
    if not row:
        return
    cols = [r[1] for r in conn.execute("PRAGMA table_info(featured_teams)").fetchall()]
    if "sort_order" in cols:
        return
    conn.execute("ALTER TABLE featured_teams ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
    rows = conn.execute("SELECT team_id FROM featured_teams ORDER BY added_at").fetchall()
    for i, (tid,) in enumerate(rows):
        conn.execute(
            "UPDATE featured_teams SET sort_order = ? WHERE team_id = ?",
            (i, tid),
        )


def init_db() -> None:
    """Create tables if they don't exist; run lightweight migrations."""
    with get_conn() as conn:
        conn.executescript(DDL)
        _migrate_player_gamelog_extras(conn)
        _migrate_team_gamelog_extras(conn)
        _migrate_featured_players_sort_order(conn)
        _migrate_featured_teams_sort_order(conn)


def fetchall(sql: str, params: tuple = ()) -> list[dict]:
    """Run a SELECT and return list of dicts."""
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def fetchone(sql: str, params: tuple = ()) -> dict | None:
    """Run a SELECT and return a single dict or None."""
    with get_conn() as conn:
        row = conn.execute(sql, params).fetchone()
    return dict(row) if row else None


def execute(sql: str, params: tuple = ()) -> None:
    """Run an INSERT / UPDATE / DELETE."""
    with get_conn() as conn:
        conn.execute(sql, params)


def executemany(sql: str, params_list: list[tuple]) -> None:
    """Run an INSERT / UPDATE in batch."""
    with get_conn() as conn:
        conn.executemany(sql, params_list)


def table_count(table: str) -> int:
    """Return number of rows in a table (for seed progress reporting)."""
    with get_conn() as conn:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


def json_dumps(obj) -> str:
    return json.dumps(obj, default=str)


if __name__ == "__main__":
    init_db()
    print(f"Database initialised at {DB_PATH}")
