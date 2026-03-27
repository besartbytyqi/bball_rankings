# NBA Stats App — Session Context

## Current Task
Personal NBA stats app: **SQLite** + **FastAPI** + **React** (Vite, Tailwind v4, TanStack Query, Recharts).

## Key Decisions
- **SQLite first**: `seed.py` fills `nba_stats.db`; many reads avoid network.
- **Selective live fallback**: `nba_service` calls **nba_api** when tables are empty or for endpoints not fully stored (e.g. splits, historical season league dash, scoreboard window).
- **Career data**: `player_season_stats` / `team_season_stats` hold multi-season rows; `extra_stats` JSON for extra columns.
- **Playoffs**: derived from standings where applicable (no live PlayoffPicture dependency).

## Routes (frontend)
| Path | Page |
|------|------|
| `/` | Dashboard (standings, featured teams/players, leaders, awards) |
| `/players` | Players list |
| `/players/:id` | Player profile |
| `/teams` | Teams list |
| `/teams/:id` | Team profile |
| `/compare` | Compare (player vs player, team vs team, player career, team seasons) |
| `/records` | Records |
| `/dream-team` | Dream Team builder |

## Backend highlights
- `GET /api/players` — optional `include_inactive=1` for full directory (compare / dream team).
- `GET /api/team-stats?season=` — league team stats per season.
- `GET /api/data/coverage` — DB footprint hints for profiles.
- `PUT /api/teams/featured/order` — persist featured team order (`sort_order`).
- `POST /api/refresh?quick=true` — quick re-seed; `sync_state` for timestamps.

## Environment
- API: `uvicorn main:app --reload --port 8000` (project root).
- Frontend: `cd frontend && npm run dev` — often **5173** or **5174**; proxy `/api` to backend via `vite.config` / `.env.local`.
- CORS in `main.py` allows localhost on both common Vite ports.

## Next Steps (onboarding)
- `python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`
- `python seed.py --no-gamelogs` (or full seed) to populate DB
- Run API + frontend as above
