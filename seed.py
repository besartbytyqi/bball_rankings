"""
seed.py — Populate nba_stats.db from nba_api.

Usage:
    python seed.py                      # full seed (all available seasons)
    python seed.py --season 2025-26     # one season only
    python seed.py --no-gamelogs        # skip per-player/team game logs
    python seed.py --force              # overwrite existing rows (INSERT OR REPLACE)
    python seed.py --no-gamelogs --season 2025-26   # quick current-season refresh

Estimated run times:
    --no-gamelogs          : 30–45 min
    with gamelogs          : 2–4 hours (run overnight)

Incremental sync (future): use db.sync_state high-water marks or per-table jobs to skip
unchanged endpoints instead of full re-seed.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from typing import Any

import pandas as pd

import db
import nba_patch  # must come before any nba_api endpoint imports
from nba_api.stats.library.http import NBAStatsHTTP

# stats.nba.com requires browser-like headers or it blocks/times out requests
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

from nba_api.stats.endpoints import (
    CommonAllPlayers,
    CommonPlayerInfo,
    LeagueDashPlayerStats,
    LeagueDashTeamStats,
    LeagueStandings,
    LeagueLeaders,
    PlayerGameLog,
    TeamGameLog,
)
from nba_service import (
    NBA_TEAMS,
    NBA_TIMEOUT,
    _compute_award,
    CURRENT_SEASON,
)

# Seasons with reasonably complete LeagueDashPlayerStats data
ALL_SEASONS = [
    "1996-97","1997-98","1998-99","1999-00",
    "2000-01","2001-02","2002-03","2003-04","2004-05","2005-06","2006-07","2007-08","2008-09","2009-10",
    "2010-11","2011-12","2012-13","2013-14","2014-15","2015-16","2016-17","2017-18","2018-19","2019-20",
    "2020-21","2021-22","2022-23","2023-24","2024-25","2025-26",
]

STAT_CATEGORIES = ["PTS", "REB", "AST", "STL", "BLK", "FG3M", "FG_PCT", "FT_PCT"]
AWARD_TYPES     = ["mvp", "dpoy", "clutch", "mip", "roy", "smoy"]

RATE_DELAY = 0.6   # seconds between nba_api calls

# Core stats kept as named columns; everything else goes to extra_stats JSON
PLAYER_CORE = {"PLAYER_ID","GP","MIN","PTS","REB","AST","STL","BLK","FG_PCT","FG3_PCT","FT_PCT","PLUS_MINUS"}
TEAM_CORE   = {"TEAM_ID","GP","W","L","PTS","REB","AST","STL","BLK","FG_PCT","FG3_PCT","FT_PCT"}


def _sleep():
    time.sleep(RATE_DELAY)


def _safe(val):
    """Convert NaN / None to Python None for SQLite."""
    if val is None:
        return None
    try:
        import math
        if math.isnan(float(val)):
            return None
    except (TypeError, ValueError):
        pass
    return val


def seed_teams() -> None:
    print("  Seeding teams...", end=" ")
    rows = [
        (t["id"], t["name"], t["abbr"], t["conf"], t["name"].split()[-1], "#17408B")
        for t in NBA_TEAMS
    ]
    db.executemany(
        "INSERT OR REPLACE INTO teams (team_id, name, abbreviation, conference, city, primary_color) VALUES (?,?,?,?,?,?)",
        rows,
    )
    print(f"done ({len(rows)} teams)")


def seed_players() -> None:
    print("  Seeding players (all, active + historical)...", end=" ")
    df = CommonAllPlayers(
        is_only_current_season=0,
        timeout=NBA_TIMEOUT,
    ).get_data_frames()[0]
    _sleep()

    rows = []
    for _, r in df.iterrows():
        rows.append((
            int(r["PERSON_ID"]),
            str(r.get("DISPLAY_FIRST_LAST") or r.get("DISPLAY_LAST_COMMA_FIRST", "")),
            str(r.get("FIRST_NAME", "") or ""),
            str(r.get("LAST_NAME", "") or ""),
            _safe(r.get("TEAM_ID")),
            str(r.get("TEAM_ABBREVIATION", "") or ""),
            str(r.get("POSITION", "") or ""),
            str(r.get("JERSEY", "") or ""),
            _safe(r.get("FROM_YEAR")),
            _safe(r.get("TO_YEAR")),
            1 if str(r.get("ROSTERSTATUS", "0")) == "1" else 0,
        ))
    db.executemany(
        """INSERT OR REPLACE INTO players
           (player_id, display_name, first_name, last_name, team_id, team_abbreviation,
            position, jersey_number, from_year, to_year, is_active)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        rows,
    )
    print(f"done ({len(rows)} players)")


def seed_active_player_info() -> None:
    """Refresh jersey numbers and positions for all active players."""
    players = db.fetchall("SELECT player_id, display_name FROM players WHERE is_active = 1")
    print(f"  Refreshing info for {len(players)} active players...")
    for i, p in enumerate(players):
        if i % 10 == 0:
            print(f"    ... {i}/{len(players)}", flush=True)
        try:
            df = CommonPlayerInfo(
                player_id=p["player_id"],
                timeout=NBA_TIMEOUT,
            ).get_data_frames()[0]
            if not df.empty:
                r = df.iloc[0]
                db.execute(
                    "UPDATE players SET position = ?, jersey_number = ?, first_name = ?, last_name = ? WHERE player_id = ?",
                    (str(r.get("POSITION", "")), str(r.get("JERSEY", "")), str(r.get("FIRST_NAME", "")), str(r.get("LAST_NAME", "")), p["player_id"])
                )
            _sleep()
        except Exception as e:
            print(f"    [SKIP {p['display_name']}: {e}]")
            _sleep()
    print("  Done refreshing active player info.")


def _extra(row: pd.Series, exclude_cols: set[str]) -> str:
    extra = {k: _safe(v) for k, v in row.items() if k not in exclude_cols}
    return json.dumps(extra, default=str)


def seed_player_season_stats(seasons: list[str], force: bool) -> None:
    insert_or = "INSERT OR REPLACE" if force else "INSERT OR IGNORE"
    for season in seasons:
        for stat_type, measure in [("base", "Base"), ("advanced", "Advanced"), ("defense", "Defense")]:
            print(f"  Player stats {season} [{measure}]...", end=" ", flush=True)
            try:
                df = LeagueDashPlayerStats(
                    season=season,
                    per_mode_detailed="PerGame",
                    measure_type_detailed_defense=measure,
                    timeout=NBA_TIMEOUT,
                ).get_data_frames()[0]
                _sleep()
            except Exception as e:
                print(f"SKIP ({e})")
                _sleep()
                continue

            rows = []
            exclude = {"PLAYER_ID","PLAYER_NAME","TEAM_ID","TEAM_ABBREVIATION","GP","MIN",
                       "PTS","REB","AST","STL","BLK","FG_PCT","FG3_PCT","FT_PCT","PLUS_MINUS",
                       "CFID","CFPARAMS","NICKNAME"}
            for _, r in df.iterrows():
                rows.append((
                    int(r["PLAYER_ID"]),
                    season,
                    stat_type,
                    _safe(r.get("GP")),
                    _safe(r.get("MIN")),
                    _safe(r.get("PTS")),
                    _safe(r.get("REB")),
                    _safe(r.get("AST")),
                    _safe(r.get("STL")),
                    _safe(r.get("BLK")),
                    _safe(r.get("FG_PCT")),
                    _safe(r.get("FG3_PCT")),
                    _safe(r.get("FT_PCT")),
                    _safe(r.get("PLUS_MINUS")),
                    _extra(r, exclude),
                    str(r.get("TEAM_ABBREVIATION") or ""),
                ))
            db.executemany(
                f"""{insert_or} INTO player_season_stats
                    (player_id, season, stat_type, gp, min, pts, reb, ast, stl, blk,
                     fg_pct, fg3_pct, ft_pct, plus_minus, extra_stats, team_abbreviation)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                rows,
            )
            print(f"done ({len(rows)} rows)")


def seed_team_season_stats(seasons: list[str], force: bool) -> None:
    insert_or = "INSERT OR REPLACE" if force else "INSERT OR IGNORE"
    for season in seasons:
        for stat_type, measure in [("base", "Base"), ("advanced", "Advanced"), ("opponent", "Opponent")]:
            print(f"  Team stats {season} [{measure}]...", end=" ", flush=True)
            try:
                df = LeagueDashTeamStats(
                    season=season,
                    per_mode_detailed="PerGame",
                    measure_type_detailed_defense=measure,
                    timeout=NBA_TIMEOUT,
                ).get_data_frames()[0]
                _sleep()
            except Exception as e:
                print(f"SKIP ({e})")
                _sleep()
                continue

            rows = []
            exclude = {"TEAM_ID","TEAM_NAME","TEAM_ABBREVIATION","GP","W","L","PTS","REB","AST",
                       "STL","BLK","FG_PCT","FG3_PCT","FT_PCT","CFID","CFPARAMS"}
            for _, r in df.iterrows():
                rows.append((
                    int(r["TEAM_ID"]),
                    season,
                    stat_type,
                    _safe(r.get("GP")),
                    _safe(r.get("W")),
                    _safe(r.get("L")),
                    _safe(r.get("PTS")),
                    _safe(r.get("REB")),
                    _safe(r.get("AST")),
                    _safe(r.get("STL")),
                    _safe(r.get("BLK")),
                    _safe(r.get("FG_PCT")),
                    _safe(r.get("FG3_PCT")),
                    _safe(r.get("FT_PCT")),
                    _extra(r, exclude),
                ))
            db.executemany(
                f"""{insert_or} INTO team_season_stats
                    (team_id, season, stat_type, gp, wins, losses, pts, reb, ast, stl, blk,
                     fg_pct, fg3_pct, ft_pct, extra_stats)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                rows,
            )
            print(f"done ({len(rows)} rows)")


def seed_standings(seasons: list[str], force: bool) -> None:
    insert_or = "INSERT OR REPLACE" if force else "INSERT OR IGNORE"
    for season in seasons:
        print(f"  Standings {season}...", end=" ", flush=True)
        try:
            df = LeagueStandings(
                season=season,
                season_type="Regular Season",
                timeout=NBA_TIMEOUT,
            ).get_data_frames()[0]
            _sleep()
        except Exception as e:
            print(f"SKIP ({e})")
            _sleep()
            continue

        conf_col  = next((c for c in df.columns if "conf" in c.lower() and "erence" in c.lower()), None)
        rank_col  = next((c for c in df.columns if "playoffrank" in c.lower() or "conferencerank" in c.lower()), None)
        team_col  = next((c for c in df.columns if "teamid" in c.lower()), "TeamID")

        rows = []
        for _, r in df.iterrows():
            conf = str(r[conf_col]) if conf_col else ""
            rows.append((
                season,
                int(r[team_col]),
                conf,
                _safe(r.get("WINS") or r.get("W")),
                _safe(r.get("LOSSES") or r.get("L")),
                _safe(r.get("WinPCT") or r.get("W_PCT")),
                _safe(r.get("GB") or r.get("ConferenceGamesBack")),
                str(r.get("HOME", "") or ""),
                str(r.get("ROAD", "") or ""),
                str(r.get("L10", "") or r.get("OT", "")),
                str(r.get("CurrentStreak", "") or ""),
                _safe(r[rank_col]) if rank_col else None,
            ))
        db.executemany(
            f"""{insert_or} INTO standings
                (season, team_id, conference, wins, losses, win_pct, games_back,
                 home_record, road_record, last10, streak, conference_rank)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            rows,
        )
        print(f"done ({len(rows)} teams)")


def seed_leaders(seasons: list[str], force: bool) -> None:
    insert_or = "INSERT OR REPLACE" if force else "INSERT OR IGNORE"
    for season in seasons:
        print(f"  Leaders {season}...", end=" ", flush=True)
        season_rows = []
        for cat in STAT_CATEGORIES:
            try:
                df = LeagueLeaders(
                    season=season,
                    stat_category_abbreviation=cat,
                    per_mode48="PerGame",
                    timeout=NBA_TIMEOUT,
                ).get_data_frames()[0].head(10)
                _sleep()
            except Exception:
                _sleep()
                continue

            val_col = cat if cat in df.columns else df.columns[-1]
            for rank, (_, r) in enumerate(df.iterrows(), start=1):
                season_rows.append((
                    season,
                    cat,
                    rank,
                    _safe(r.get("PLAYER_ID")),
                    str(r.get("PLAYER", "") or r.get("PLAYER_NAME", "")),
                    _safe(r.get("TEAM_ID")),
                    _safe(r.get(val_col)),
                ))

        db.executemany(
            f"""{insert_or} INTO leaders
                (season, stat_category, rank, player_id, player_name, team_id, value)
                VALUES (?,?,?,?,?,?,?)""",
            season_rows,
        )
        print(f"done ({len(season_rows)} entries)")


def seed_award_rankings(seasons: list[str], force: bool) -> None:
    insert_or = "INSERT OR REPLACE" if force else "INSERT OR IGNORE"
    for season in seasons:
        if season != CURRENT_SEASON:
            # Award computations rely on live LeagueDashPlayerStats calls inside _compute_award.
            # For historical seasons we only seed what we have data for (current season).
            continue
        print(f"  Award rankings {season}...", end=" ", flush=True)
        all_rows = []
        for award_type in AWARD_TYPES:
            try:
                result = _compute_award(award_type)
                for rank, p in enumerate(result.get("players", [])[:15], start=1):
                    all_rows.append((
                        season,
                        award_type,
                        rank,
                        p.get("PLAYER_ID"),
                        p.get("PLAYER_NAME", ""),
                        p.get("TEAM_ABBREVIATION", ""),
                        p.get("_score"),
                        json.dumps({k: v for k, v in p.items() if k not in ("PLAYER_ID","PLAYER_NAME","TEAM_ABBREVIATION","_score")}, default=str),
                    ))
                _sleep()
            except Exception as e:
                print(f"  [award {award_type} skip: {e}]")
        db.executemany(
            f"""{insert_or} INTO award_rankings
                (season, award_type, rank, player_id, player_name, team_abbreviation, score, stats_json)
                VALUES (?,?,?,?,?,?,?,?)""",
            all_rows,
        )
        print(f"done ({len(all_rows)} entries)")


def seed_player_gamelogs(seasons: list[str], force: bool) -> None:
    insert_or = "INSERT OR REPLACE" if force else "INSERT OR IGNORE"
    players = db.fetchall("SELECT player_id FROM players WHERE is_active = 1")
    player_ids = [r["player_id"] for r in players]
    total = len(player_ids) * len(seasons)
    done = 0
    print(f"  Player game logs: {len(player_ids)} players × {len(seasons)} seasons = {total} calls")
    for pid in player_ids:
        for season in seasons:
            done += 1
            if done % 50 == 0:
                print(f"    ... {done}/{total}", flush=True)
            try:
                df = PlayerGameLog(
                    player_id=pid,
                    season=season,
                    season_type_all_star="Regular Season",
                    timeout=NBA_TIMEOUT,
                ).get_data_frames()[0]
                _sleep()
            except Exception:
                _sleep()
                continue
            if df.empty:
                continue
            rows = []
            for _, r in df.iterrows():
                rows.append((
                    pid,
                    season,
                    str(r.get("Game_ID", "")),
                    str(r.get("GAME_DATE", "")),
                    str(r.get("MATCHUP", "")),
                    str(r.get("WL", "")),
                    _safe(r.get("MIN")),
                    _safe(r.get("PTS")),
                    _safe(r.get("REB")),
                    _safe(r.get("AST")),
                    _safe(r.get("STL")),
                    _safe(r.get("BLK")),
                    _safe(r.get("FG_PCT")),
                    _safe(r.get("FG3_PCT")),
                    _safe(r.get("FT_PCT")),
                    _safe(r.get("PLUS_MINUS")),
                    _safe(r.get("TOV")),
                    _safe(r.get("FGM")),
                    _safe(r.get("FGA")),
                    _safe(r.get("FTM")),
                    _safe(r.get("FTA")),
                    _safe(r.get("PF")),
                ))
            if rows:
                db.executemany(
                    f"""{insert_or} INTO player_gamelog
                        (player_id, season, game_id, game_date, matchup, wl,
                         min, pts, reb, ast, stl, blk, fg_pct, fg3_pct, ft_pct, plus_minus,
                         tov, fgm, fga, ftm, fta, pf)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    rows,
                )
    print(f"  Player game logs done.")


def seed_team_gamelogs(seasons: list[str], force: bool) -> None:
    insert_or = "INSERT OR REPLACE" if force else "INSERT OR IGNORE"
    for season in seasons:
        print(f"  Team game logs {season}...", end=" ", flush=True)
        season_rows = []
        for team in NBA_TEAMS:
            try:
                df = TeamGameLog(
                    team_id=team["id"],
                    season=season,
                    season_type_all_star="Regular Season",
                    timeout=NBA_TIMEOUT,
                ).get_data_frames()[0]
                _sleep()
            except Exception:
                _sleep()
                continue
            for _, r in df.iterrows():
                matchup = str(r.get("MATCHUP", ""))
                wl = str(r.get("WL", ""))
                season_rows.append((
                    team["id"],
                    season,
                    str(r.get("Game_ID", "")),
                    str(r.get("GAME_DATE", "")),
                    matchup,
                    wl,
                    _safe(r.get("PTS")),
                    None,  # opp_pts not in TeamGameLog row
                    _safe(r.get("REB")),
                    _safe(r.get("AST")),
                    _safe(r.get("STL")),
                    _safe(r.get("BLK")),
                    _safe(r.get("TOV")),
                    _safe(r.get("FGM")),
                    _safe(r.get("FGA")),
                    _safe(r.get("FTM")),
                    _safe(r.get("FTA")),
                ))
        db.executemany(
            f"""{insert_or} INTO team_gamelog
                (team_id, season, game_id, game_date, matchup, wl, pts, opp_pts,
                 reb, ast, stl, blk, tov, fgm, fga, ftm, fta)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            season_rows,
        )
        print(f"done ({len(season_rows)} games)")


def main():
    parser = argparse.ArgumentParser(description="Seed NBA stats into SQLite")
    parser.add_argument("--season",       help="Seed a single season (e.g. 2025-26)")
    parser.add_argument("--no-gamelogs",  action="store_true", help="Skip per-player/team game logs")
    parser.add_argument("--force",        action="store_true", help="Overwrite existing rows")
    parser.add_argument("--players-only", action="store_true", help="Only seed players table")
    parser.add_argument("--teams-only",   action="store_true", help="Only seed teams table")
    parser.add_argument("--refresh-info", action="store_true", help="Refresh jersey/position for active players")
    parser.add_argument(
        "--quick-refresh",
        action="store_true",
        help="Current season only: players + player/team season stats + standings (no leaders, awards, or game logs)",
    )
    args = parser.parse_args()

    print(f"Initialising database at {db.DB_PATH}...")
    db.init_db()

    if args.quick_refresh:
        seasons = [CURRENT_SEASON]
        print("\n=== Quick refresh (current season stats + standings) ===")
        seed_teams()
        seed_players()
        seed_player_season_stats(seasons, True)
        seed_team_season_stats(seasons, True)
        seed_standings(seasons, True)
        db.execute(
            "INSERT OR REPLACE INTO sync_state (sync_key, updated_at) VALUES (?, ?)",
            ("last_quick_refresh", datetime.now(timezone.utc).isoformat()),
        )
        print("\n=== Quick refresh complete ===")
        for tbl in ["players", "player_season_stats", "team_season_stats", "standings"]:
            print(f"  {tbl}: {db.table_count(tbl):,} rows")
        sys.exit(0)

    seasons = [args.season] if args.season else ALL_SEASONS

    print("\n=== Step 1: Teams ===")
    seed_teams()

    if args.teams_only:
        print("Done (teams only).")
        sys.exit(0)

    print("\n=== Step 2: Players ===")
    seed_players()
    if args.refresh_info:
        seed_active_player_info()

    if args.players_only:
        print("Done (players only).")
        sys.exit(0)

    print("\n=== Step 3: Player season stats ===")
    seed_player_season_stats(seasons, args.force)

    print("\n=== Step 4: Team season stats ===")
    seed_team_season_stats(seasons, args.force)

    print("\n=== Step 5: Standings ===")
    seed_standings(seasons, args.force)

    print("\n=== Step 6: League leaders ===")
    seed_leaders(seasons, args.force)

    print("\n=== Step 7: Award rankings (current season only) ===")
    seed_award_rankings(seasons, args.force)

    if not args.no_gamelogs:
        gl_seasons = seasons if args.season else seasons[-3:]  # default: last 3 seasons only
        print(f"\n=== Step 8: Player game logs (seasons: {gl_seasons}) ===")
        seed_player_gamelogs(gl_seasons, args.force)

        print(f"\n=== Step 9: Team game logs ===")
        seed_team_gamelogs(seasons, args.force)
    else:
        print("\n(Skipping game logs — --no-gamelogs flag set)")

    print("\n=== Seed complete ===")
    for tbl in ["players","player_season_stats","team_season_stats","standings","leaders","award_rankings","player_gamelog","team_gamelog"]:
        print(f"  {tbl}: {db.table_count(tbl):,} rows")

    db.execute(
        "INSERT OR REPLACE INTO sync_state (sync_key, updated_at) VALUES (?, ?)",
        ("last_full_seed", datetime.now(timezone.utc).isoformat()),
    )


if __name__ == "__main__":
    main()
