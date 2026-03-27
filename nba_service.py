"""
NBA Stats Service — data access layer.
Season: 2025-26 (current as of March 2026)

Primary data source: SQLite (nba_stats.db via db.py).
nba_api is used only for endpoints not stored in the DB (splits).
"""
from __future__ import annotations

import json
import time
import threading
from datetime import date, datetime, timedelta
from typing import Any, Optional

import pandas as pd

import db as _db
import nba_patch  # must come before any nba_api endpoint imports
from nba_api.stats.library.http import NBAStatsHTTP

NBAStatsHTTP.HEADERS = {
    "Host": "stats.nba.com",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "x-nba-stats-origin": "stats",
    "x-nba-stats-token": "true",
    "Referer": "https://www.nba.com/",
    "Origin": "https://www.nba.com",
    "Connection": "keep-alive",
}

from nba_api.stats.library.parameters import StarterBench

from nba_api.stats.endpoints import (
    LeagueDashPlayerStats,
    LeagueDashPlayerClutch,
    LeagueStandings,
    LeagueLeaders,
    LeagueDashTeamStats,
    CommonTeamRoster,
    TeamGameLog,
    TeamDashboardByGeneralSplits,
    PlayerGameLog,
    PlayerDashboardByGeneralSplits,
    PlayerCareerStats,
    CommonAllPlayers,
    ScoreboardV2,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
CURRENT_SEASON = "2025-26"
LAST_SEASON = "2024-25"
CURRENT_SEASON_YEAR = "2025"   # used to identify rookies via FROM_YEAR
NBA_TIMEOUT = 60               # seconds

FEATURED_PLAYERS = [
    {"name": "LeBron James",              "id": 2544},
    {"name": "Victor Wembanyama",         "id": 1641705},
    {"name": "Shai Gilgeous-Alexander",   "id": 1628983},
    {"name": "Kevin Durant",              "id": 201142},
]

NBA_TEAMS = [
    {"id": 1610612737, "name": "Atlanta Hawks",           "abbr": "ATL", "conf": "East"},
    {"id": 1610612738, "name": "Boston Celtics",          "abbr": "BOS", "conf": "East"},
    {"id": 1610612751, "name": "Brooklyn Nets",           "abbr": "BKN", "conf": "East"},
    {"id": 1610612766, "name": "Charlotte Hornets",       "abbr": "CHA", "conf": "East"},
    {"id": 1610612741, "name": "Chicago Bulls",           "abbr": "CHI", "conf": "East"},
    {"id": 1610612739, "name": "Cleveland Cavaliers",     "abbr": "CLE", "conf": "East"},
    {"id": 1610612742, "name": "Dallas Mavericks",        "abbr": "DAL", "conf": "West"},
    {"id": 1610612743, "name": "Denver Nuggets",          "abbr": "DEN", "conf": "West"},
    {"id": 1610612765, "name": "Detroit Pistons",         "abbr": "DET", "conf": "East"},
    {"id": 1610612744, "name": "Golden State Warriors",   "abbr": "GSW", "conf": "West"},
    {"id": 1610612745, "name": "Houston Rockets",         "abbr": "HOU", "conf": "West"},
    {"id": 1610612754, "name": "Indiana Pacers",          "abbr": "IND", "conf": "East"},
    {"id": 1610612746, "name": "LA Clippers",             "abbr": "LAC", "conf": "West"},
    {"id": 1610612747, "name": "Los Angeles Lakers",      "abbr": "LAL", "conf": "West"},
    {"id": 1610612763, "name": "Memphis Grizzlies",       "abbr": "MEM", "conf": "West"},
    {"id": 1610612748, "name": "Miami Heat",              "abbr": "MIA", "conf": "East"},
    {"id": 1610612749, "name": "Milwaukee Bucks",         "abbr": "MIL", "conf": "East"},
    {"id": 1610612750, "name": "Minnesota Timberwolves",  "abbr": "MIN", "conf": "West"},
    {"id": 1610612740, "name": "New Orleans Pelicans",    "abbr": "NOP", "conf": "West"},
    {"id": 1610612752, "name": "New York Knicks",         "abbr": "NYK", "conf": "East"},
    {"id": 1610612760, "name": "Oklahoma City Thunder",   "abbr": "OKC", "conf": "West"},
    {"id": 1610612753, "name": "Orlando Magic",           "abbr": "ORL", "conf": "East"},
    {"id": 1610612755, "name": "Philadelphia 76ers",      "abbr": "PHI", "conf": "East"},
    {"id": 1610612756, "name": "Phoenix Suns",            "abbr": "PHX", "conf": "West"},
    {"id": 1610612757, "name": "Portland Trail Blazers",  "abbr": "POR", "conf": "West"},
    {"id": 1610612758, "name": "Sacramento Kings",        "abbr": "SAC", "conf": "West"},
    {"id": 1610612759, "name": "San Antonio Spurs",       "abbr": "SAS", "conf": "West"},
    {"id": 1610612761, "name": "Toronto Raptors",         "abbr": "TOR", "conf": "East"},
    {"id": 1610612762, "name": "Utah Jazz",               "abbr": "UTA", "conf": "West"},
    {"id": 1610612764, "name": "Washington Wizards",      "abbr": "WAS", "conf": "East"},
]

# ---------------------------------------------------------------------------
# TTL Cache
# ---------------------------------------------------------------------------
_cache: dict[str, tuple[float, Any]] = {}
_lock = threading.Lock()
CACHE_MAX_ENTRIES = 420

# TTLs keyed by the first segment of the cache key (before first "_")
TTLS: dict[str, int] = {
    "live":         30,
    "standings":    300,
    "awards":       300,
    "leaders":      300,
    "teamstats":    600,
    "recentgames":  900,
    "featured":     900,
    "player":       600,
    "team":         900,
    "playoffs":     3600,
    "teams":        86400,
    "allplayers":   86400,
    "boxscore":     86400,
    "seasonawards": 86400,
    "base":         300,
    "defense":      300,
}


def _cache_get(key: str) -> Optional[Any]:
    with _lock:
        if key in _cache:
            ts, val = _cache[key]
            category = key.split("_")[0]
            ttl = TTLS.get(category, 300)
            if time.time() - ts < ttl:
                return val
    return None


def _cache_set(key: str, val: Any) -> None:
    with _lock:
        _cache[key] = (time.time(), val)
        while len(_cache) > CACHE_MAX_ENTRIES:
            oldest = min(_cache.items(), key=lambda kv: kv[1][0])[0]
            _cache.pop(oldest, None)


def _cache_del(key: str) -> None:
    with _lock:
        _cache.pop(key, None)


def clear_refreshable_caches() -> None:
    """Drop common SQLite-backed caches after a seed / refresh."""
    static_keys = (
        "standings_main",
        "playoffs_main",
        "leaders_main",
        "featured_teams_all",
        "featured_all",
        "allplayers_main",
        "allplayers_main_inactive",
        "live_scoreboard_header",
        "recentgames_board_multi",
    )
    for k in static_keys:
        _cache_del(k)
    with _lock:
        ts_keys = [k for k in list(_cache.keys()) if k == "teamstats_main" or k.startswith("teamstats_main_")]
    for k in ts_keys:
        _cache_del(k)
    with _lock:
        prefixes = (
            "player_stats_",
            "player_career_",
            "team_career_",
            "team_gamelog_",
            "player_gamelog_",
            "team_roster_",
        )
        extra = [k for k in list(_cache.keys()) if k.startswith(prefixes)]
    for k in extra:
        _cache_del(k)
    with _lock:
        aw = [k for k in list(_cache.keys()) if k.startswith("seasonawards_")]
    for k in aw:
        _cache_del(k)


def _df(df: pd.DataFrame) -> list[dict]:
    """Convert DataFrame → list of dicts, replacing NaN with None."""
    return df.where(pd.notnull(df), None).to_dict(orient="records")


# ---------------------------------------------------------------------------
# Shared base data (re-used across many award types)
# ---------------------------------------------------------------------------
_base_df: Optional[pd.DataFrame] = None
_base_ts: float = 0.0
_def_df: Optional[pd.DataFrame] = None
_def_ts: float = 0.0
_adv_df: Optional[pd.DataFrame] = None
_adv_ts: float = 0.0


def _base_stats() -> pd.DataFrame:
    global _base_df, _base_ts
    if _base_df is not None and time.time() - _base_ts < TTLS["base"]:
        return _base_df
    _base_df = LeagueDashPlayerStats(
        season=CURRENT_SEASON,
        per_mode_detailed="PerGame",
        measure_type_detailed_defense="Base",
        timeout=NBA_TIMEOUT,
    ).get_data_frames()[0]
    _base_ts = time.time()
    return _base_df


def _def_stats() -> pd.DataFrame:
    global _def_df, _def_ts
    if _def_df is not None and time.time() - _def_ts < TTLS["defense"]:
        return _def_df
    _def_df = LeagueDashPlayerStats(
        season=CURRENT_SEASON,
        per_mode_detailed="PerGame",
        measure_type_detailed_defense="Defense",
        timeout=NBA_TIMEOUT,
    ).get_data_frames()[0]
    _def_ts = time.time()
    return _def_df


def _adv_stats() -> pd.DataFrame:
    global _adv_df, _adv_ts
    if _adv_df is not None and time.time() - _adv_ts < TTLS["base"]:
        return _adv_df
    _adv_df = LeagueDashPlayerStats(
        season=CURRENT_SEASON,
        per_mode_detailed="PerGame",
        measure_type_detailed_defense="Advanced",
        timeout=NBA_TIMEOUT,
    ).get_data_frames()[0]
    _adv_ts = time.time()
    return _adv_df


def _league_dash_player_measure(season: str, measure: str) -> pd.DataFrame:
    """League-wide player stats for one season and measure (Base | Advanced | Defense)."""
    return LeagueDashPlayerStats(
        season=season,
        per_mode_detailed="PerGame",
        measure_type_detailed_defense=measure,
        timeout=NBA_TIMEOUT,
    ).get_data_frames()[0]


# ---------------------------------------------------------------------------
# Awards
# ---------------------------------------------------------------------------
def get_award_rankings(award_type: str) -> dict:
    key = f"awards_{award_type}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    rows = _db.fetchall(
        "SELECT * FROM award_rankings WHERE season = ? AND award_type = ? ORDER BY rank",
        (CURRENT_SEASON, award_type),
    )
    if rows:
        players = []
        for r in rows:
            p = {"PLAYER_ID": r["player_id"], "PLAYER_NAME": r["player_name"],
                 "TEAM_ABBREVIATION": r["team_abbreviation"], "_score": r["score"]}
            if r.get("stats_json"):
                p.update(json.loads(r["stats_json"]))
            players.append(p)
        result = {"award": award_type.upper(), "players": players}
        _cache_set(key, result)
        return result

    # Fall back to computed result
    result = _compute_award(award_type)
    _cache_set(key, result)
    return result


def _safe_cols(df: pd.DataFrame, wanted: list[str]) -> list[str]:
    return [c for c in wanted if c in df.columns]


def _compute_award(award_type: str) -> dict:
    if award_type == "mvp":
        df = _base_stats().copy()
        df = df[df["MIN"] >= 24].copy()
        df["_score"] = (
            df["PTS"] * 0.40 +
            df["AST"] * 0.20 +
            df["REB"] * 0.20 +
            df.get("W_PCT", pd.Series(0, index=df.index)) * 50 * 0.20
        )
        df = df.nlargest(15, "_score")
        cols = _safe_cols(df, ["PLAYER_ID","PLAYER_NAME","TEAM_ABBREVIATION","GP","MIN","PTS","AST","REB","STL","BLK","FG_PCT","FG3_PCT","W_PCT","_score"])
        return {"award": "MVP", "stat_labels": ["PTS","AST","REB","STL","BLK","FG%","3P%","W%"], "players": _df(df[cols])}

    elif award_type == "dpoy":
        base = _base_stats()
        defs = _def_stats()
        # Merge to get both base and defense columns
        df = base[_safe_cols(base, ["PLAYER_ID","PLAYER_NAME","TEAM_ABBREVIATION","GP","MIN","STL","BLK","DREB"])].copy()
        df = df[df["MIN"] >= 20].copy()
        # Try to get DFGM/DFGA from defense df
        def_extra = defs[_safe_cols(defs, ["PLAYER_ID","DFGM","DFGA","DFGA_PCT"])].copy() if any(c in defs.columns for c in ["DFGM","DFGA"]) else pd.DataFrame({"PLAYER_ID": []})
        if not def_extra.empty and "PLAYER_ID" in def_extra.columns:
            df = df.merge(def_extra, on="PLAYER_ID", how="left")
        df["_score"] = df["STL"] * 2.0 + df["BLK"] * 2.5 + df["DREB"] * 0.3
        df = df.nlargest(15, "_score")
        cols = _safe_cols(df, ["PLAYER_ID","PLAYER_NAME","TEAM_ABBREVIATION","GP","MIN","STL","BLK","DREB","DFGM","DFGA","_score"])
        return {"award": "DPOY", "stat_labels": ["STL","BLK","DREB"], "players": _df(df[cols])}

    elif award_type == "clutch":
        df = LeagueDashPlayerClutch(
            season=CURRENT_SEASON,
            per_mode_detailed="PerGame",
            clutch_time="Last 5 Minutes",
            ahead_behind="Ahead or Behind",
            point_diff=5,
            timeout=NBA_TIMEOUT,
        ).get_data_frames()[0]
        df = df[df["GP"] >= 10].copy() if "GP" in df.columns else df
        df = df.nlargest(15, "PTS")
        cols = _safe_cols(df, ["PLAYER_ID","PLAYER_NAME","TEAM_ABBREVIATION","GP","MIN","PTS","AST","REB","FG_PCT","W","L","W_PCT"])
        return {"award": "Clutch Player", "stat_labels": ["PTS","AST","REB","FG%","W","L","W%"], "players": _df(df[cols])}

    elif award_type == "mip":
        curr = _base_stats().copy()
        try:
            prev = LeagueDashPlayerStats(
                season=LAST_SEASON,
                per_mode_detailed="PerGame",
                measure_type_detailed_defense="Base",
                timeout=NBA_TIMEOUT,
            ).get_data_frames()[0]
            merged = curr.merge(
                prev[["PLAYER_ID","PTS","REB","AST","GP"]],
                on="PLAYER_ID", suffixes=("","_prev")
            )
            merged = merged[merged["GP_prev"] >= 20].copy()
            merged["_improvement"] = merged["PTS"] - merged["PTS_prev"]
            merged = merged[merged["_improvement"] > 0].nlargest(15, "_improvement")
            cols = _safe_cols(merged, ["PLAYER_ID","PLAYER_NAME","TEAM_ABBREVIATION","GP","PTS","PTS_prev","REB","AST","_improvement"])
            return {"award": "Most Improved", "stat_labels": ["PTS (curr)","PTS (prev)","REB","AST","Improvement"], "players": _df(merged[cols])}
        except Exception:
            df = curr.nlargest(15, "PTS")
            cols = _safe_cols(df, ["PLAYER_ID","PLAYER_NAME","TEAM_ABBREVIATION","GP","PTS","REB","AST"])
            return {"award": "Most Improved", "stat_labels": ["PTS","REB","AST"], "players": _df(df[cols])}

    elif award_type == "roy":
        try:
            all_p = CommonAllPlayers(
                is_only_current_season=1,
                season=CURRENT_SEASON,
                timeout=NBA_TIMEOUT,
            ).get_data_frames()[0]
            rookies = all_p[all_p["FROM_YEAR"].astype(str) == CURRENT_SEASON_YEAR][["PERSON_ID"]].copy()
            rookies = rookies.rename(columns={"PERSON_ID": "PLAYER_ID"})
            df = _base_stats().merge(rookies, on="PLAYER_ID")
            df = df[df["GP"] >= 5].nlargest(15, "PTS")
            cols = _safe_cols(df, ["PLAYER_ID","PLAYER_NAME","TEAM_ABBREVIATION","GP","MIN","PTS","REB","AST","FG_PCT","FG3_PCT"])
            return {"award": "Rookie of the Year", "stat_labels": ["PTS","REB","AST","FG%","3P%"], "players": _df(df[cols])}
        except Exception:
            return {"award": "Rookie of the Year", "stat_labels": [], "players": []}

    elif award_type == "smoy":
        # LeagueDashPlayerStats has no GS column — use NBA’s Starter/Bench split (“Bench” only).
        try:
            bench = LeagueDashPlayerStats(
                season=CURRENT_SEASON,
                per_mode_detailed="PerGame",
                measure_type_detailed_defense="Base",
                starter_bench_nullable=StarterBench.bench,
                timeout=NBA_TIMEOUT,
            ).get_data_frames()[0]
            df = bench.copy()
            if "GP" in df.columns:
                df = df[df["GP"] >= 15].copy()
            df["_score"] = (
                df["PTS"] * 0.42 +
                df["AST"] * 0.28 +
                df["REB"] * 0.15 +
                (df["STL"] + df["BLK"]) * 0.15
            )
            df = df.nlargest(15, "_score")
            cols = _safe_cols(
                df,
                ["PLAYER_ID", "PLAYER_NAME", "TEAM_ABBREVIATION", "GP", "MIN", "PTS", "REB", "AST", "STL", "BLK", "FG_PCT", "_score"],
            )
            return {
                "award": "Sixth Man",
                "stat_labels": ["PTS", "AST", "REB", "STL", "BLK", "FG%", "MIN"],
                "players": _df(df[cols]),
            }
        except Exception:
            pass
        # Fallback: starters table + loose GS filter if column ever appears
        df = _base_stats().copy()
        gs_col = next((c for c in df.columns if c in ("GP_STARTS", "GS")), None)
        if gs_col:
            df = df[(df[gs_col] < df["GP"] / 2) & (df["MIN"] >= 15)].copy()
        else:
            df = df[df["MIN"] >= 15].copy()
        df["_score"] = (
            df["PTS"] * 0.40 + df["REB"] * 0.20 + df["AST"] * 0.20 + (df["STL"] + df["BLK"]) * 0.20
        )
        df = df.nlargest(15, "_score")
        cols = _safe_cols(df, ["PLAYER_ID", "PLAYER_NAME", "TEAM_ABBREVIATION", "GP", "MIN", "PTS", "REB", "AST", "STL", "BLK", "FG_PCT", "_score"])
        return {"award": "Sixth Man", "stat_labels": ["PTS", "REB", "AST", "STL+BLK", "FG%", "MIN"], "players": _df(df[cols])}

    return {"award": award_type, "players": []}


# ---------------------------------------------------------------------------
# Standings
# ---------------------------------------------------------------------------
def get_standings() -> dict:
    cached = _cache_get("standings_main")
    if cached is not None:
        return cached

    rows = _db.fetchall(
        """SELECT s.*, t.name AS team_name, t.abbreviation AS team_abbreviation
           FROM standings s
           LEFT JOIN teams t ON t.team_id = s.team_id
           WHERE s.season = ?
           ORDER BY s.conference, s.conference_rank""",
        (CURRENT_SEASON,),
    )
    if rows:
        east = [r for r in rows if r.get("conference") == "East"]
        west = [r for r in rows if r.get("conference") == "West"]
        result = {"east": east, "west": west, "season": CURRENT_SEASON}
        _cache_set("standings_main", result)
        return result

    # DB not seeded yet — fall back to nba_api
    df = LeagueStandings(
        season=CURRENT_SEASON,
        season_type="Regular Season",
        timeout=NBA_TIMEOUT,
    ).get_data_frames()[0]
    conf_col = next((c for c in df.columns if "conf" in c.lower() and "erence" in c.lower()), "Conference")
    rank_col = next((c for c in df.columns if "playoffrank" in c.lower()), None)
    if rank_col:
        df = df.sort_values(rank_col)
    east = df[df[conf_col] == "East"].reset_index(drop=True)
    west = df[df[conf_col] == "West"].reset_index(drop=True)
    result = {"east": _df(east), "west": _df(west), "season": CURRENT_SEASON}
    _cache_set("standings_main", result)
    return result


# ---------------------------------------------------------------------------
# Playoffs — derived from standings (top 8 each conference)
# ---------------------------------------------------------------------------
def get_playoffs() -> dict:
    cached = _cache_get("playoffs_main")
    if cached is not None:
        return cached

    try:
        s = get_standings()
        def seeds(teams: list[dict]) -> list[dict]:
            out = []
            for i, t in enumerate(teams[:10]):
                out.append({
                    "seed":      i + 1,
                    "team_id":   t.get("team_id"),
                    "team_name": t.get("team_name") or t.get("TeamName", ""),
                    "abbr":      t.get("team_abbreviation") or t.get("TeamAbbreviation", ""),
                    "wins":      t.get("wins") or t.get("W", 0),
                    "losses":    t.get("losses") or t.get("L", 0),
                    "win_pct":   t.get("win_pct") or t.get("W_PCT", 0),
                })
            return out
        result = {
            "east_seeds": seeds(s["east"]),
            "west_seeds": seeds(s["west"]),
            "source": "standings_projection",
        }
    except Exception:
        result = {"source": "unavailable", "east_seeds": [], "west_seeds": []}

    _cache_set("playoffs_main", result)
    return result


# ---------------------------------------------------------------------------
# League Leaders
# ---------------------------------------------------------------------------
def _leaders_composite_overall(leaders_block: dict[str, list]) -> list[dict[str, Any]]:
    """Top-10 placement points across standard leader categories (matches dashboard Overall tab)."""
    scores: dict[str, dict[str, Any]] = {}
    score_cats = ["PTS", "REB", "AST", "STL", "BLK", "FG3M", "FG_PCT", "FT_PCT"]
    for cat_key in score_cats:
        rows = leaders_block.get(cat_key) or []
        for i, r in enumerate(rows[:10]):
            if not isinstance(r, dict):
                continue
            pid = r.get("player_id") or r.get("PLAYER_ID")
            if pid is None:
                continue
            pk = str(pid)
            if pk not in scores:
                scores[pk] = {
                    "player_id": int(pid) if str(pid).isdigit() else pid,
                    "player_name": str(r.get("player_name") or r.get("PLAYER") or ""),
                    "team_abbreviation": str(r.get("team_abbreviation") or r.get("TEAM") or ""),
                    "composite_score": 0,
                    "categories": [],
                }
            scores[pk]["composite_score"] += 10 - i
            scores[pk]["categories"].append(cat_key)
    ranked = sorted(scores.values(), key=lambda x: x["composite_score"], reverse=True)
    return ranked[:10]


def get_leaders() -> dict:
    cached = _cache_get("leaders_main")
    if cached is not None:
        return cached

    rows = _db.fetchall(
        "SELECT * FROM leaders WHERE season = ? ORDER BY stat_category, rank",
        (CURRENT_SEASON,),
    )
    result: dict[str, list] = {}
    if rows:
        for r in rows:
            cat = r["stat_category"]
            result.setdefault(cat, []).append(r)

    # FG_PCT and FT_PCT aren't supported by LeagueLeaders API — compute from player_season_stats
    for col, label in [("fg_pct", "FG_PCT"), ("ft_pct", "FT_PCT")]:
        if label not in result:
            pct_rows = _db.fetchall(
                f"""SELECT p.player_id, p.display_name as player_name, p.team_id,
                           s.{col} as value
                    FROM player_season_stats s
                    JOIN players p ON p.player_id = s.player_id
                    WHERE s.season = ? AND s.stat_type = 'base' AND s.gp >= 20
                      AND s.{col} IS NOT NULL
                    ORDER BY s.{col} DESC
                    LIMIT 10""",
                (CURRENT_SEASON,),
            )
            result[label] = [
                {"season": CURRENT_SEASON, "stat_category": label, "rank": i + 1,
                 "player_id": r["player_id"], "player_name": r["player_name"],
                 "team_id": r["team_id"], "value": r["value"]}
                for i, r in enumerate(pct_rows)
            ]

    if result:
        result["OVERALL"] = _leaders_composite_overall(result)
        _cache_set("leaders_main", result)
        return result

    # DB not seeded — fall back to nba_api
    categories = ["PTS", "REB", "AST", "STL", "BLK", "FG3M", "FG_PCT", "FT_PCT"]
    result = {}
    for cat in categories:
        try:
            df = LeagueLeaders(
                season=CURRENT_SEASON,
                stat_category_abbreviation=cat,
                per_mode48="PerGame",
                timeout=NBA_TIMEOUT,
            ).get_data_frames()[0].head(10)
            result[cat] = _df(df)
            time.sleep(0.3)
        except Exception:
            result[cat] = []
    result["OVERALL"] = _leaders_composite_overall(result)
    _cache_set("leaders_main", result)
    return result


def get_leaders_overall() -> list[dict[str, Any]]:
    """Server-side composite leader list (also embedded in GET /api/leaders as OVERALL)."""
    data = get_leaders()
    return list(data.get("OVERALL") or [])


# ---------------------------------------------------------------------------
# Team Stats (league-wide)
# ---------------------------------------------------------------------------
def get_team_stats(season: Optional[str] = None) -> dict:
    season = season or CURRENT_SEASON
    cache_key = f"teamstats_main_{season}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    rows = _db.fetchall(
        "SELECT * FROM team_season_stats WHERE season = ?",
        (season,),
    )
    if rows:
        result: dict[str, list] = {"base": [], "advanced": [], "opponent": []}
        for r in rows:
            key = r.get("stat_type", "base")
            if r.get("extra_stats"):
                extra = json.loads(r["extra_stats"])
                r = {**r, **extra}
            result.setdefault(key, []).append(r)
        _cache_set(cache_key, result)
        return result

    # Fall back to nba_api for requested season
    result = {}
    for measure in ["Base", "Advanced", "Opponent"]:
        try:
            df = LeagueDashTeamStats(
                season=season,
                per_mode_detailed="PerGame",
                measure_type_detailed_defense=measure,
                timeout=NBA_TIMEOUT,
            ).get_data_frames()[0]
            result[measure.lower()] = _df(df)
            time.sleep(0.3)
        except Exception:
            result[measure.lower()] = []
    _cache_set(cache_key, result)
    return result


# ---------------------------------------------------------------------------
# Teams list
# ---------------------------------------------------------------------------
def get_teams() -> list[dict]:
    return NBA_TEAMS


# ---------------------------------------------------------------------------
# Team Detail
# ---------------------------------------------------------------------------
def get_team_roster(team_id: int) -> dict:
    key = f"team_roster_{team_id}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    players = _db.fetchall(
        "SELECT * FROM players WHERE team_id = ? AND is_active = 1",
        (team_id,),
    )
    if players:
        player_ids = [p["player_id"] for p in players]
        placeholders = ",".join("?" * len(player_ids))
        stats = _db.fetchall(
            f"SELECT * FROM player_season_stats WHERE player_id IN ({placeholders}) AND season = ? AND stat_type = 'base'",
            tuple(player_ids) + (CURRENT_SEASON,),
        )
        stats_by_id = {s["player_id"]: s for s in stats}
        merged = []
        for p in players:
            row = {**p}
            s = stats_by_id.get(p["player_id"], {})
            if s.get("extra_stats"):
                extra = json.loads(s["extra_stats"])
                s = {**s, **extra}
            row.update({k: v for k, v in s.items() if k not in row})
            merged.append(row)
        result = {"team_id": team_id, "players": merged}
        _cache_set(key, result)
        return result

    # Fall back to nba_api
    roster = CommonTeamRoster(
        team_id=team_id,
        season=CURRENT_SEASON,
        timeout=NBA_TIMEOUT,
    ).get_data_frames()[0]
    base = _base_stats()
    roster_ids = set(roster["PLAYER_ID"].tolist()) if "PLAYER_ID" in roster.columns else set()
    stats_df = base[base["PLAYER_ID"].isin(roster_ids)]
    stat_cols = _safe_cols(stats_df, ["PLAYER_ID","GP","MIN","PTS","AST","REB","STL","BLK","FG_PCT","FG3_PCT","FT_PCT","PLUS_MINUS"])
    merged_df = roster.merge(stats_df[stat_cols], on="PLAYER_ID", how="left").fillna(0)
    result = {"team_id": team_id, "players": _df(merged_df)}
    _cache_set(key, result)
    return result


def get_team_gamelog(team_id: int) -> dict:
    key = f"team_gamelog_{team_id}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    rows = _db.fetchall(
        "SELECT * FROM team_gamelog WHERE team_id = ? AND season = ? ORDER BY game_id DESC",
        (team_id, CURRENT_SEASON),
    )
    if rows:
        result = {"team_id": team_id, "games": _convert_gamelog_dates(rows)}
        _cache_set(key, result)
        return result

    # Fall back to nba_api
    df = TeamGameLog(
        team_id=team_id,
        season=CURRENT_SEASON,
        season_type_all_star="Regular Season",
        timeout=NBA_TIMEOUT,
    ).get_data_frames()[0]
    result = {"team_id": team_id, "games": _df(df)}
    _cache_set(key, result)
    return result


def get_team_season_history(team_id: int) -> list[dict]:
    key = f"team_career_{team_id}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    rows = _db.fetchall(
        "SELECT * FROM team_season_stats WHERE team_id = ? AND stat_type = 'base' ORDER BY season",
        (team_id,),
    )
    result = []
    for r in rows:
        row = dict(r)
        if row.get("extra_stats"):
            try:
                extra = {k.lower(): v for k, v in json.loads(row["extra_stats"]).items()}
                row = {**row, **extra}
            except Exception:
                pass
        result.append(row)
    _cache_set(key, result)
    return result


def get_team_splits(team_id: int) -> dict:
    key = f"team_splits_{team_id}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    try:
        dfs = TeamDashboardByGeneralSplits(
            team_id=team_id,
            season=CURRENT_SEASON,
            per_mode_detailed="PerGame",
            timeout=NBA_TIMEOUT,
        ).get_data_frames()
        result = {
            "overall":   _df(dfs[0]) if len(dfs) > 0 else [],
            "location":  _df(dfs[1]) if len(dfs) > 1 else [],
            "win_loss":  _df(dfs[2]) if len(dfs) > 2 else [],
            "month":     _df(dfs[3]) if len(dfs) > 3 else [],
        }
    except Exception:
        result = {"overall": [], "location": [], "win_loss": [], "month": []}

    _cache_set(key, result)
    return result


# ---------------------------------------------------------------------------
# Player Detail
# ---------------------------------------------------------------------------
def get_player_stats(player_id: int, season: Optional[str] = None) -> dict:
    season = season or CURRENT_SEASON
    key = f"player_stats_{player_id}_{season}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    rows = _db.fetchall(
        "SELECT * FROM player_season_stats WHERE player_id = ? AND season = ?",
        (player_id, season),
    )
    if rows:
        result: dict[str, Any] = {"player_id": player_id, "season": season, "base": [], "advanced": [], "defense": []}
        for r in rows:
            stat_type = r.get("stat_type", "base")
            if r.get("extra_stats"):
                extra = {k.lower(): v for k, v in json.loads(r["extra_stats"]).items()}
                r = {**r, **extra}
            result[stat_type].append(r)
        _cache_set(key, result)
        return result

    # Fall back to nba_api for the requested season (cached globals only cover CURRENT_SEASON)
    if season == CURRENT_SEASON:
        base = _base_stats()
        p_base = base[base["PLAYER_ID"] == player_id]
        try:
            adv = _adv_stats()
            p_adv = adv[adv["PLAYER_ID"] == player_id]
        except Exception:
            p_adv = pd.DataFrame()
        try:
            defs = _def_stats()
            p_def = defs[defs["PLAYER_ID"] == player_id]
        except Exception:
            p_def = pd.DataFrame()
    else:
        try:
            base = _league_dash_player_measure(season, "Base")
            p_base = base[base["PLAYER_ID"] == player_id]
        except Exception:
            p_base = pd.DataFrame()
        try:
            adv = _league_dash_player_measure(season, "Advanced")
            p_adv = adv[adv["PLAYER_ID"] == player_id]
        except Exception:
            p_adv = pd.DataFrame()
        try:
            defs = _league_dash_player_measure(season, "Defense")
            p_def = defs[defs["PLAYER_ID"] == player_id]
        except Exception:
            p_def = pd.DataFrame()
    result = {
        "player_id": player_id,
        "season":   season,
        "base":     _df(p_base),
        "advanced": _df(p_adv),
        "defense":  _df(p_def),
    }
    _cache_set(key, result)
    return result


def _convert_gamelog_dates(rows: list[dict]) -> list[dict]:
    """Convert 'Mar 23, 2026' style dates to ISO '2026-03-23' for consistent display/sorting."""
    result = []
    for r in rows:
        d = r.get("game_date") or ""
        try:
            iso = datetime.strptime(str(d), "%b %d, %Y").strftime("%Y-%m-%d")
            result.append({**r, "game_date": iso})
        except ValueError:
            result.append(r)
    return result


def get_player_gamelog(player_id: int) -> list[dict]:
    key = f"player_gamelog_{player_id}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    rows = _db.fetchall(
        "SELECT * FROM player_gamelog WHERE player_id = ? AND season = ? ORDER BY game_id DESC",
        (player_id, CURRENT_SEASON),
    )
    if rows:
        rows = _convert_gamelog_dates(rows)
        _cache_set(key, rows)
        return rows

    # Fall back to nba_api
    df = PlayerGameLog(
        player_id=player_id,
        season=CURRENT_SEASON,
        season_type_all_star="Regular Season",
        timeout=NBA_TIMEOUT,
    ).get_data_frames()[0]
    result = _df(df)
    _cache_set(key, result)
    return result


def get_player_splits(player_id: int) -> dict:
    key = f"player_splits_{player_id}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    # Compute splits from game_log (reliable, already seeded)
    def _agg(rows: list[dict]) -> dict:
        if not rows:
            return {}
        gp = len(rows)
        w = sum(1 for r in rows if r.get("wl") == "W")
        def avg(col): return round(sum(r.get(col) or 0 for r in rows) / gp, 1) if gp else 0
        def pct(col): vals = [r.get(col) for r in rows if r.get(col) is not None]; return round(sum(vals) / len(vals), 3) if vals else None
        return {"gp": gp, "w": w, "l": gp - w, "w_pct": round(w / gp, 3) if gp else 0,
                "pts": avg("pts"), "reb": avg("reb"), "ast": avg("ast"),
                "stl": avg("stl"), "blk": avg("blk"),
                "fg_pct": pct("fg_pct"), "fg3_pct": pct("fg3_pct"), "ft_pct": pct("ft_pct")}

    logs = _db.fetchall(
        "SELECT * FROM player_gamelog WHERE player_id = ? AND season = ?",
        (player_id, CURRENT_SEASON),
    )

    overall = [dict(GROUP_VALUE="Season", **_agg(logs))] if logs else []

    home = [r for r in logs if "vs." in (r.get("matchup") or "")]
    away = [r for r in logs if " @ " in (r.get("matchup") or "")]
    location = []
    if home: location.append(dict(GROUP_VALUE="Home", **_agg(home)))
    if away: location.append(dict(GROUP_VALUE="Away", **_agg(away)))

    wins = [r for r in logs if r.get("wl") == "W"]
    losses = [r for r in logs if r.get("wl") == "L"]
    win_loss = []
    if wins: win_loss.append(dict(GROUP_VALUE="W", **_agg(wins)))
    if losses: win_loss.append(dict(GROUP_VALUE="L", **_agg(losses)))

    MONTH_NAMES = {1:"Jan",2:"Feb",3:"Mar",4:"Apr",5:"May",6:"Jun",
                   7:"Jul",8:"Aug",9:"Sep",10:"Oct",11:"Nov",12:"Dec"}
    from collections import defaultdict
    by_month: dict[int, list] = defaultdict(list)
    for r in logs:
        date_str = str(r.get("game_date") or "")
        try:
            # Try ISO format first (YYYY-MM-DD), then "Mon DD, YYYY"
            if len(date_str) >= 10 and date_str[4] == "-":
                month = int(date_str[5:7])
            else:
                month = datetime.strptime(date_str, "%b %d, %Y").month
            by_month[month].append(r)
        except (ValueError, IndexError):
            pass
    month = [dict(GROUP_VALUE=MONTH_NAMES.get(m, str(m)), **_agg(gs)) for m, gs in sorted(by_month.items())]

    result = {"overall": overall, "location": location, "win_loss": win_loss, "month": month}
    _cache_set(key, result)
    return result


# ---------------------------------------------------------------------------
# Featured Players
# ---------------------------------------------------------------------------
def _featured_player_ids_db() -> list[int]:
    rows = _db.fetchall(
        "SELECT player_id FROM featured_players ORDER BY sort_order ASC, added_at ASC",
    )
    return [r["player_id"] for r in rows]


def _get_featured_player_ids() -> list[int]:
    """Return featured player IDs from DB, falling back to hardcoded list."""
    rows = _db.fetchall(
        "SELECT player_id FROM featured_players ORDER BY sort_order ASC, added_at ASC",
    )
    if rows:
        return [r["player_id"] for r in rows]
    for i, p in enumerate(FEATURED_PLAYERS):
        try:
            _db.execute(
                "INSERT OR IGNORE INTO featured_players (player_id, sort_order) VALUES (?, ?)",
                (p["id"], i),
            )
        except Exception:
            pass
    return [p["id"] for p in FEATURED_PLAYERS]


def get_featured_player_ids() -> list[int]:
    return _get_featured_player_ids()


def add_featured_player(player_id: int) -> None:
    row = _db.fetchone("SELECT MAX(sort_order) AS m FROM featured_players")
    next_order = (int(row["m"]) + 1) if row and row["m"] is not None else 0
    _db.execute(
        "INSERT OR IGNORE INTO featured_players (player_id, sort_order) VALUES (?, ?)",
        (player_id, next_order),
    )
    _cache_del("featured_all")


def remove_featured_player(player_id: int) -> None:
    _db.execute("DELETE FROM featured_players WHERE player_id = ?", (player_id,))
    _cache_del("featured_all")


def reorder_featured_players(player_ids: list[int]) -> None:
    """Persist user order; player_ids must be exactly the current featured set, each once."""
    current = _featured_player_ids_db()
    if not current:
        raise ValueError("No featured players to reorder.")
    if len(player_ids) != len(current) or set(player_ids) != set(current):
        raise ValueError("player_ids must list every featured player exactly once.")
    for order, pid in enumerate(player_ids):
        _db.execute(
            "UPDATE featured_players SET sort_order = ? WHERE player_id = ?",
            (order, pid),
        )
    _cache_del("featured_all")


def get_featured_players() -> list[dict]:
    cached = _cache_get("featured_all")
    if cached is not None:
        return cached

    pids = _get_featured_player_ids()
    # Get display_name from players table for each ID
    placeholders = ",".join("?" * len(pids)) if pids else "NULL"
    name_rows = _db.fetchall(
        f"SELECT player_id, display_name FROM players WHERE player_id IN ({placeholders})",
        tuple(pids),
    ) if pids else []
    name_map = {r["player_id"]: r["display_name"] for r in name_rows}

    result = []
    for pid in pids:
        name = name_map.get(pid) or next((p["name"] for p in FEATURED_PLAYERS if p["id"] == pid), f"Player {pid}")
        data: dict[str, Any] = {"name": name, "id": pid}
        try:
            data.update(get_player_stats(pid))
        except Exception:
            pass
        try:
            data["gamelog"] = get_player_gamelog(pid)
        except Exception:
            data["gamelog"] = []
        result.append(data)

    _cache_set("featured_all", result)
    return result


# ---------------------------------------------------------------------------
# Featured Teams
# ---------------------------------------------------------------------------
_DEFAULT_FEATURED_TEAMS = [1610612747, 1610612738, 1610612759, 1610612744]  # LAL, BOS, SAS, GSW


def _get_featured_team_ids() -> list[int]:
    rows = _db.fetchall("SELECT team_id FROM featured_teams ORDER BY sort_order ASC, added_at ASC")
    if rows:
        return [r["team_id"] for r in rows]
    for i, tid in enumerate(_DEFAULT_FEATURED_TEAMS):
        try:
            _db.execute(
                "INSERT OR IGNORE INTO featured_teams (team_id, sort_order) VALUES (?, ?)",
                (tid, i),
            )
        except Exception:
            pass
    return list(_DEFAULT_FEATURED_TEAMS)


def _featured_team_ids_db() -> list[int]:
    """Featured team ids from DB only (no default bootstrap)."""
    rows = _db.fetchall("SELECT team_id FROM featured_teams ORDER BY sort_order ASC, added_at ASC")
    return [r["team_id"] for r in rows]


def get_featured_team_ids() -> list[int]:
    return _get_featured_team_ids()


def add_featured_team(team_id: int) -> None:
    row = _db.fetchone("SELECT MAX(sort_order) AS m FROM featured_teams")
    next_order = (int(row["m"]) + 1) if row and row["m"] is not None else 0
    _db.execute(
        "INSERT OR IGNORE INTO featured_teams (team_id, sort_order) VALUES (?, ?)",
        (team_id, next_order),
    )
    _cache_del("featured_teams_all")


def remove_featured_team(team_id: int) -> None:
    _db.execute("DELETE FROM featured_teams WHERE team_id = ?", (team_id,))
    _cache_del("featured_teams_all")


def reorder_featured_teams(team_ids: list[int]) -> None:
    """Persist user order; team_ids must be exactly the current featured set, each once."""
    current = _featured_team_ids_db()
    if not current:
        raise ValueError("No featured teams to reorder.")
    if len(team_ids) != len(current) or set(team_ids) != set(current):
        raise ValueError("team_ids must list every featured team exactly once.")
    for order, tid in enumerate(team_ids):
        _db.execute(
            "UPDATE featured_teams SET sort_order = ? WHERE team_id = ?",
            (order, tid),
        )
    _cache_del("featured_teams_all")


def get_sync_status() -> dict[str, str]:
    rows = _db.fetchall("SELECT sync_key, updated_at FROM sync_state")
    return {str(r["sync_key"]): str(r["updated_at"]) for r in rows}


def get_data_coverage(
    player_id: Optional[int] = None,
    team_id: Optional[int] = None,
) -> dict[str, Any]:
    """Table row counts plus optional player/team game-log footprint for UI copy."""
    tables = {
        "players": _db.table_count("players"),
        "player_season_stats": _db.table_count("player_season_stats"),
        "player_gamelog": _db.table_count("player_gamelog"),
        "team_season_stats": _db.table_count("team_season_stats"),
        "team_gamelog": _db.table_count("team_gamelog"),
        "standings": _db.table_count("standings"),
        "leaders": _db.table_count("leaders"),
        "award_rankings": _db.table_count("award_rankings"),
    }
    out: dict[str, Any] = {
        "current_season": CURRENT_SEASON,
        "tables": tables,
    }
    sample_keys: list[str] = []
    ex = _db.fetchone(
        "SELECT extra_stats FROM player_season_stats "
        "WHERE extra_stats IS NOT NULL AND TRIM(extra_stats) NOT IN ('', '{}', 'null') LIMIT 1"
    )
    if ex and ex.get("extra_stats"):
        try:
            sample_keys = list(json.loads(ex["extra_stats"]).keys())[:16]
        except Exception:
            pass
    out["sample_player_extra_stat_keys"] = sample_keys

    if player_id is not None:
        pg = _db.fetchone(
            "SELECT COUNT(*) AS n FROM player_gamelog WHERE player_id = ? AND season = ?",
            (player_id, CURRENT_SEASON),
        )
        out["player"] = {
            "player_gamelog_games": int(pg["n"] or 0) if pg else 0,
            "season": CURRENT_SEASON,
        }
    if team_id is not None:
        tg = _db.fetchone(
            "SELECT COUNT(*) AS n FROM team_gamelog WHERE team_id = ? AND season = ?",
            (team_id, CURRENT_SEASON),
        )
        opp = _db.fetchone(
            "SELECT COUNT(*) AS n FROM team_gamelog WHERE team_id = ? AND season = ? AND opp_pts IS NOT NULL",
            (team_id, CURRENT_SEASON),
        )
        out["team"] = {
            "team_gamelog_games": int(tg["n"] or 0) if tg else 0,
            "team_gamelog_with_opp_pts": int(opp["n"] or 0) if opp else 0,
            "season": CURRENT_SEASON,
        }
    return out


def _team_abbr(team_id: int) -> str:
    for t in NBA_TEAMS:
        if t["id"] == team_id:
            return t["abbr"]
    return str(team_id)


def _team_last_game_db(team_id: int) -> Optional[dict]:
    row = _db.fetchone(
        "SELECT * FROM team_gamelog WHERE team_id = ? AND season = ? ORDER BY game_id DESC LIMIT 1",
        (team_id, CURRENT_SEASON),
    )
    if not row:
        return None
    r = dict(row)
    if r.get("game_date"):
        r = {**r, "game_date": _convert_gamelog_dates([r])[0].get("game_date", r["game_date"])}
    return r


def _scoreboard_games_next_days(num_days: int = 8) -> list[dict]:
    """Merge GameHeader rows for today through today+num_days-1 (ET calendar dates). Cached ~15m."""
    key = "recentgames_board_multi"
    cached = _cache_get(key)
    if cached is not None:
        return cached
    today = date.today()
    all_rows: list[dict] = []
    for i in range(num_days):
        gd = (today + timedelta(days=i)).strftime("%Y-%m-%d")
        try:
            df = ScoreboardV2(game_date=gd, timeout=NBA_TIMEOUT).game_header.get_data_frame()
            if df is not None and not df.empty:
                all_rows.extend(_df(df))
        except Exception:
            continue
    _cache_set(key, all_rows)
    return all_rows


def _team_next_game_live(team_id: int) -> Optional[dict]:
    """Next scheduled or in-progress game in the next ~8 days (skips finals)."""

    def _sort_key(r: dict) -> tuple:
        d = str(r.get("GAME_DATE_EST") or r.get("game_date_est") or "")
        try:
            seq = int(r.get("GAME_SEQUENCE") or r.get("game_sequence") or 0)
        except (TypeError, ValueError):
            seq = 0
        return (d, seq)

    for row in sorted(_scoreboard_games_next_days(), key=_sort_key):
        hid = row.get("HOME_TEAM_ID") or row.get("home_team_id")
        vid = row.get("VISITOR_TEAM_ID") or row.get("visitor_team_id")
        try:
            h, v = int(hid), int(vid)
        except (TypeError, ValueError):
            continue
        if team_id == h:
            opp_id, is_home = v, True
        elif team_id == v:
            opp_id, is_home = h, False
        else:
            continue
        try:
            status_id = int(row.get("GAME_STATUS_ID") or row.get("game_status_id") or 0)
        except (TypeError, ValueError):
            status_id = 0
        if status_id == 3:
            continue
        status = str(row.get("GAME_STATUS_TEXT") or row.get("game_status_text") or "")
        return {
            "game_date_est": row.get("GAME_DATE_EST") or row.get("game_date_est"),
            "opponent_abbr": _team_abbr(opp_id),
            "is_home": is_home,
            "status_text": status,
        }
    return None


def get_featured_teams() -> list[dict]:
    cached = _cache_get("featured_teams_all")
    if cached is not None:
        return cached

    tids = _get_featured_team_ids()
    if not tids:
        return []

    # Get standings + team info
    standings_rows = _db.fetchall(
        "SELECT s.*, t.name, t.abbreviation FROM standings s "
        "JOIN teams t ON t.team_id = s.team_id "
        "WHERE s.season = ? AND s.team_id IN (" + ",".join("?" * len(tids)) + ")",
        (CURRENT_SEASON, *tids),
    )
    by_id: dict[int, dict] = {}
    for r in standings_rows:
        d = dict(r)
        tid = int(d.get("team_id", 0))
        d["last_game"] = _team_last_game_db(tid)
        d["next_game"] = _team_next_game_live(tid)
        by_id[tid] = d
    result = [by_id[tid] for tid in tids if tid in by_id]
    _cache_set("featured_teams_all", result)
    return result


# ---------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------
RECORDS_MIN_GP_RATES = 20
RECORDS_MIN_GP_MINUTES_SEASON = 10

RECORDS_CATALOG: list[dict[str, Any]] = [
    {"id": "pts", "label": "Points (total)", "scopes": ["career", "season"], "value_kind": "count"},
    {"id": "reb", "label": "Rebounds (total)", "scopes": ["career", "season"], "value_kind": "count"},
    {"id": "ast", "label": "Assists (total)", "scopes": ["career", "season"], "value_kind": "count"},
    {"id": "stl", "label": "Steals (total)", "scopes": ["career", "season"], "value_kind": "count"},
    {"id": "blk", "label": "Blocks (total)", "scopes": ["career", "season"], "value_kind": "count"},
    {"id": "gp", "label": "Games played", "scopes": ["career", "season"], "value_kind": "games"},
    {"id": "min", "label": "Minutes (career total / best season MPG)", "scopes": ["career", "season"], "value_kind": "minutes"},
    {
        "id": "fg_pct",
        "label": f"FG% (min {RECORDS_MIN_GP_RATES} GP)",
        "scopes": ["career", "season"],
        "value_kind": "pct",
        "notes": "Career = best single-season percentage (qualified seasons only).",
    },
    {
        "id": "fg3_pct",
        "label": f"3P% (min {RECORDS_MIN_GP_RATES} GP)",
        "scopes": ["career", "season"],
        "value_kind": "pct",
        "notes": "Career = best single-season percentage (qualified seasons only).",
    },
    {
        "id": "ft_pct",
        "label": f"FT% (min {RECORDS_MIN_GP_RATES} GP)",
        "scopes": ["career", "season"],
        "value_kind": "pct",
        "notes": "Career = best single-season percentage (qualified seasons only).",
    },
    {
        "id": "plus_minus",
        "label": "Plus/minus (sum of season totals)",
        "scopes": ["career", "season"],
        "value_kind": "plus_minus",
        "notes": "Career = sum of (per-game +/- × GP) per season; single season = that season’s per-game +/-.",
    },
    {
        "id": "pie",
        "label": "PIE — Player Impact Estimate (advanced)",
        "scopes": ["career", "season"],
        "value_kind": "rate",
        "notes": "Career = best single-season PIE; season = that year’s value (from advanced stat rows).",
    },
    {
        "id": "ts_pct",
        "label": "True shooting % (advanced)",
        "scopes": ["career", "season"],
        "value_kind": "pct",
        "notes": "From advanced imports; career = best qualified season (min 20 GP).",
    },
    {
        "id": "usg_pct",
        "label": "Usage rate % (advanced)",
        "scopes": ["career", "season"],
        "value_kind": "pct",
        "notes": "From advanced imports; career = highest single-season usage (min 20 GP).",
    },
]


def _adv_metric_json_expr(category: str) -> str:
    """
    Advanced PIE / TS% / USG% live in player_season_stats.extra_stats (seeded from LeagueDashPlayerStats),
    not as real columns — use json_extract for records queries.
    """
    keys: dict[str, tuple[str, ...]] = {
        "usg_pct": ("$.USG_PCT", "$.E_USG_PCT"),
        "ts_pct": ("$.TS_PCT",),
        "pie": ("$.PIE",),
    }
    paths = keys[category]
    coalesced = ", ".join(f"json_extract(s.extra_stats, '{p}')" for p in paths)
    return f"CAST(COALESCE({coalesced}) AS REAL)"


def get_records_catalog() -> list[dict[str, Any]]:
    return list(RECORDS_CATALOG)


def get_records(category: str = "pts", scope: str = "career", filter_type: str = "all") -> list[dict]:
    """
    Leaders per category. Per-game counting stats use SUM(per_game * gp) for career totals.
    Shooting categories require min GP; career shooting uses best qualified season.
    """
    category = category.lower()
    valid = {c["id"] for c in RECORDS_CATALOG}
    if category not in valid:
        category = "pts"

    where_parts = ["s.stat_type = 'base'"]
    if filter_type == "active":
        where_parts.append("p.is_active = 1")
    elif filter_type == "retired":
        where_parts.append("p.is_active = 0")

    where_clause = "WHERE " + " AND ".join(where_parts)
    rate_where = where_parts + [f"s.gp >= {RECORDS_MIN_GP_RATES}"]
    rate_clause = "WHERE " + " AND ".join(rate_where)
    min_season_where = where_parts + [f"s.gp >= {RECORDS_MIN_GP_MINUTES_SEASON}"]
    min_season_clause = "WHERE " + " AND ".join(min_season_where)

    adv_where_parts = ["s.stat_type = 'advanced'"]
    if filter_type == "active":
        adv_where_parts.append("p.is_active = 1")
    elif filter_type == "retired":
        adv_where_parts.append("p.is_active = 0")
    adv_where_clause = "WHERE " + " AND ".join(adv_where_parts)
    adv_rate_parts = adv_where_parts + [f"s.gp >= {RECORDS_MIN_GP_RATES}"]
    adv_rate_clause = "WHERE " + " AND ".join(adv_rate_parts)

    if category in ("pie", "ts_pct", "usg_pct"):
        metric = _adv_metric_json_expr(category)
        extra_ok = (
            "s.extra_stats IS NOT NULL AND trim(s.extra_stats) NOT IN ('', '{}') "
            f"AND ({metric}) IS NOT NULL"
        )
        if scope == "career":
            sql = f"""
                SELECT player_id, display_name, team_abbreviation, best_val FROM (
                    SELECT p.player_id, p.display_name, p.team_abbreviation,
                           MAX({metric}) AS best_val
                    FROM players p
                    JOIN player_season_stats s ON p.player_id = s.player_id
                    {adv_rate_clause}
                      AND {extra_ok}
                    GROUP BY p.player_id, p.display_name, p.team_abbreviation
                )
                WHERE best_val IS NOT NULL
                ORDER BY best_val DESC
                LIMIT 50
            """
            rows = _db.fetchall(sql)
            rd = 3 if category == "pie" else 4
            return [
                {
                    "rank": i + 1,
                    "player_id": r["player_id"],
                    "display_name": r["display_name"],
                    "team": r["team_abbreviation"],
                    "value": round(float(r["best_val"]), rd) if r["best_val"] is not None else 0.0,
                }
                for i, r in enumerate(rows)
            ]
        sql = f"""
            SELECT p.player_id, p.display_name, s.season, s.team_abbreviation, {metric} AS val
            FROM player_season_stats s
            JOIN players p ON p.player_id = s.player_id
            {adv_where_clause}
              AND {extra_ok}
            ORDER BY val DESC
            LIMIT 50
        """
        rows = _db.fetchall(sql)
        rd = 3 if category == "pie" else 4
        return [
            {
                "rank": i + 1,
                "player_id": r["player_id"],
                "display_name": r["display_name"],
                "season": r["season"],
                "team": r["team_abbreviation"],
                "value": round(float(r["val"]), rd) if r["val"] is not None else 0.0,
            }
            for i, r in enumerate(rows)
        ]

    if category in ("fg_pct", "fg3_pct", "ft_pct"):
        col = category
        if scope == "career":
            sql = f"""
                SELECT p.player_id, p.display_name, p.team_abbreviation,
                       MAX(s.{col}) as best_pct
                FROM players p
                JOIN player_season_stats s ON p.player_id = s.player_id
                {rate_clause}
                GROUP BY p.player_id
                ORDER BY best_pct DESC
                LIMIT 50
            """
            rows = _db.fetchall(sql)
            return [
                {
                    "rank": i + 1,
                    "player_id": r["player_id"],
                    "display_name": r["display_name"],
                    "team": r["team_abbreviation"],
                    "value": round(float(r["best_pct"]), 4) if r["best_pct"] is not None else 0.0,
                }
                for i, r in enumerate(rows)
            ]
        sql = f"""
            SELECT p.player_id, p.display_name, s.season, s.team_abbreviation, s.{col} as val
            FROM player_season_stats s
            JOIN players p ON p.player_id = s.player_id
            {rate_clause}
            ORDER BY val DESC
            LIMIT 50
        """
        rows = _db.fetchall(sql)
        return [
            {
                "rank": i + 1,
                "player_id": r["player_id"],
                "display_name": r["display_name"],
                "season": r["season"],
                "team": r["team_abbreviation"],
                "value": round(float(r["val"]), 4) if r["val"] is not None else 0.0,
            }
            for i, r in enumerate(rows)
        ]

    if category == "min":
        if scope == "career":
            sql = f"""
                SELECT p.player_id, p.display_name, p.team_abbreviation,
                       SUM(COALESCE(s.min, 0) * COALESCE(s.gp, 0)) as total_val
                FROM players p
                JOIN player_season_stats s ON p.player_id = s.player_id
                {where_clause}
                GROUP BY p.player_id
                ORDER BY total_val DESC
                LIMIT 50
            """
            rows = _db.fetchall(sql)
            return [
                {
                    "rank": i + 1,
                    "player_id": r["player_id"],
                    "display_name": r["display_name"],
                    "team": r["team_abbreviation"],
                    "value": round(float(r["total_val"]), 0) if r["total_val"] is not None else 0.0,
                }
                for i, r in enumerate(rows)
            ]
        sql = f"""
            SELECT p.player_id, p.display_name, s.season, s.team_abbreviation, s.min as val
            FROM player_season_stats s
            JOIN players p ON p.player_id = s.player_id
            {min_season_clause}
            ORDER BY val DESC
            LIMIT 50
        """
        rows = _db.fetchall(sql)
        return [
            {
                "rank": i + 1,
                "player_id": r["player_id"],
                "display_name": r["display_name"],
                "season": r["season"],
                "team": r["team_abbreviation"],
                "value": round(float(r["val"]), 1) if r["val"] is not None else 0.0,
            }
            for i, r in enumerate(rows)
        ]

    if scope == "career":
        if category == "gp":
            sql = f"""
                SELECT p.player_id, p.display_name, p.team_abbreviation,
                       SUM(s.gp) as total_val
                FROM players p
                JOIN player_season_stats s ON p.player_id = s.player_id
                {where_clause}
                GROUP BY p.player_id
                ORDER BY total_val DESC
                LIMIT 50
            """
        else:
            sql = f"""
                SELECT p.player_id, p.display_name, p.team_abbreviation,
                       SUM(s.{category} * s.gp) as total_val
                FROM players p
                JOIN player_season_stats s ON p.player_id = s.player_id
                {where_clause}
                GROUP BY p.player_id
                ORDER BY total_val DESC
                LIMIT 50
            """
        rows = _db.fetchall(sql)
        rd = 0 if category == "gp" else 1
        return [
            {
                "rank": i + 1,
                "player_id": r["player_id"],
                "display_name": r["display_name"],
                "team": r["team_abbreviation"],
                "value": round(float(r["total_val"]), rd) if r["total_val"] is not None else 0.0,
            }
            for i, r in enumerate(rows)
        ]

    sql = f"""
        SELECT p.player_id, p.display_name, s.season, s.team_abbreviation, s.{category} as val
        FROM player_season_stats s
        JOIN players p ON p.player_id = s.player_id
        {where_clause}
        ORDER BY val DESC
        LIMIT 50
    """
    rows = _db.fetchall(sql)
    return [
        {
            "rank": i + 1,
            "player_id": r["player_id"],
            "display_name": r["display_name"],
            "season": r["season"],
            "team": r["team_abbreviation"],
            "value": r["val"],
        }
        for i, r in enumerate(rows)
    ]


# ---------------------------------------------------------------------------
# All players (for search)
# ---------------------------------------------------------------------------
def get_all_players(include_inactive: bool = False) -> list[dict]:
    cache_key = "allplayers_main_inactive" if include_inactive else "allplayers_main"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    where = "" if include_inactive else "WHERE p.is_active = 1"
    rows = _db.fetchall(
        f"""SELECT p.*, s.pts, s.reb, s.ast, s.stl, s.blk, s.fg_pct, s.gp
           FROM players p
           LEFT JOIN player_season_stats s
             ON p.player_id = s.player_id AND s.season = ? AND s.stat_type = 'base'
           {where}
           ORDER BY p.display_name""",
        (CURRENT_SEASON,),
    )
    if rows:
        _cache_set(cache_key, rows)
        return rows

    # Fall back to nba_api (current season only — no retirees without a seeded DB)
    df = CommonAllPlayers(
        is_only_current_season=1,
        season=CURRENT_SEASON,
        timeout=NBA_TIMEOUT,
    ).get_data_frames()[0]
    result = _df(df)
    _cache_set(cache_key, result)
    return result


# ---------------------------------------------------------------------------
# Player career history (all seasons)
# ---------------------------------------------------------------------------
def get_player_career(player_id: int) -> list[dict]:
    key = f"player_career_{player_id}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    rows = _db.fetchall(
        """SELECT s.*, s.team_abbreviation
           FROM player_season_stats s
           WHERE s.player_id = ? AND s.stat_type = 'base'
           ORDER BY s.season""",
        (player_id,),
    )
    if rows:
        # Merge extra_stats JSON into each row
        result = []
        for r in rows:
            if r.get("extra_stats"):
                extra = {k.lower(): v for k, v in json.loads(r["extra_stats"]).items()}
                r = {**r, **extra}
            result.append(r)
        _cache_set(key, result)
        return result

    # Fall back to nba_api PlayerCareerStats
    try:
        df = PlayerCareerStats(
            player_id=player_id,
            per_mode36="PerGame",
            timeout=NBA_TIMEOUT,
        ).get_data_frames()[0]
        result = _df(df)
    except Exception:
        result = []
    _cache_set(key, result)
    return result


_AWARD_TAG_ORDER = ("champion", "fmvp", "mvp", "roy", "smoy")


def _award_description_to_tag(desc: str) -> Optional[str]:
    """Map NBA stats PlayerAwards DESCRIPTION → compact tag for UI."""
    d = (desc or "").strip().lower()
    if not d:
        return None
    if "all-star" in d:
        return None
    if "conference" in d and "champion" in d and "nba champion" not in d:
        return None
    if "all-nba" in d or "all-defensive" in d or "all defensive" in d:
        return None
    if "player of the month" in d or "player of the week" in d:
        return None
    if "most improved" in d:
        return None
    if "sportsmanship" in d or "citizenship" in d or "teammate" in d:
        return None
    # Finals MVP before generic MVP
    if ("bill russell" in d and "mvp" in d) or ("finals" in d and "most valuable" in d):
        return "fmvp"
    if "rookie of the year" in d or ("wilt chamberlain" in d and "trophy" in d):
        return "roy"
    if "sixth man" in d or ("john havlicek" in d and "trophy" in d):
        return "smoy"
    if "nba champion" in d or d in ("championship", "nba champions"):
        return "champion"
    if "most valuable player" in d:
        return "mvp"
    return None


def _sort_award_tags(tags: set[str]) -> list[str]:
    return [t for t in _AWARD_TAG_ORDER if t in tags]


def get_player_season_awards(player_id: int) -> dict[str, list[str]]:
    """
    Official-style honors from NBA stats playerawards, keyed by season id (e.g. 2007-08).
    Values are ordered: champion, fmvp, mvp, roy, smoy.
    """
    key = f"seasonawards_{player_id}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    try:
        from nba_api.stats.endpoints import PlayerAwards

        pa = PlayerAwards(player_id=player_id, timeout=NBA_TIMEOUT)
        df = pa.player_awards.get_data_frame()
    except Exception:
        _cache_set(key, {})
        return {}

    by_season: dict[str, set[str]] = {}
    for _, row in df.iterrows():
        desc = str(row.get("DESCRIPTION") or "")
        tag = _award_description_to_tag(desc)
        if not tag:
            continue
        season = str(row.get("SEASON") or "").strip()
        if not season:
            continue
        by_season.setdefault(season, set()).add(tag)

    out: dict[str, list[str]] = {s: _sort_award_tags(t) for s, t in by_season.items()}
    _cache_set(key, out)
    return out


def get_players_careers_batch(player_ids: list[int]) -> dict[str, Any]:
    """Bulk career rows (base per-season) for many players; one DB query when seeded."""
    ids = sorted({int(p) for p in player_ids if isinstance(p, int) and p > 0})
    if not ids:
        return {"careers": {}}
    placeholders = ",".join("?" * len(ids))
    rows = _db.fetchall(
        f"""SELECT * FROM player_season_stats
           WHERE player_id IN ({placeholders}) AND stat_type = 'base'
           ORDER BY player_id, season""",
        tuple(ids),
    )
    by_pid: dict[int, list[dict]] = {pid: [] for pid in ids}
    found: set[int] = set()
    for r in rows:
        row = dict(r)
        pid = int(row["player_id"])
        found.add(pid)
        if row.get("extra_stats"):
            try:
                extra = {k.lower(): v for k, v in json.loads(row["extra_stats"]).items()}
                row = {**row, **extra}
            except Exception:
                pass
        by_pid[pid].append(row)
    out: dict[str, list[dict]] = {}
    for pid in ids:
        if pid in found:
            out[str(pid)] = by_pid[pid]
        else:
            out[str(pid)] = get_player_career(pid)
    return {"careers": out}
