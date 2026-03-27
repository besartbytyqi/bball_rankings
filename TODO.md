# NBA Stats — TODO & history

**How to use this file** — **Completed** is the source of truth for shipped work. **Backlog** is optional future work. **Done (archive)** keeps original request text for search and context. If you change behavior in code, add a bullet under **Completed** (one line) and adjust **Backlog** if the item is no longer relevant.

**Ops note** — After changing award logic (e.g. Sixth Man), run `python seed.py` so `award_rankings` in SQLite matches the app (or rely on live `_compute_award` fallback when the table is empty for that season).

---

## Completed (shipped)

### Player & profile

- Career trajectory chart: toggles for PPG/RPG/APG/SPG/BPG, FG%/3P%/FT%, GP, MIN, **TOV, OREB, DREB**, **PF**, **FGM/FGA**; plus **auto-detect** extra numeric per-game fields from career rows as toggles.
- Game log: sort by date descending; **TOV, FGM, FGA, FTM, FTA, PF** columns when present in DB; completeness depends on seed/API.
- Season tables: best-value highlighting; `StatHeader` / `STAT_DEFS` tooltips on career and other key tables; roster tooltips via `STAT_DEFS`.
- Jersey in hero + roster; Per Game / Totals toggle on team roster.
- Multi-team history in player hero card.
- Featured players: star on Players page + strip + Dashboard section.

### Players & teams lists

- Players: grid shows **all** filtered players (no 150 cap); table mode sorts the full filtered list; **featured players** drag reorder + `sort_order` in DB (mirror teams).
- Teams: sorts for name, W%, W/L, **GB, streak, conf rank, PPG**; featured strip + **drag handle** reorder; **`sort_order`** persisted (`PUT /api/teams/featured/order`).
- Team profile: stats & game log headers with tooltips; **Compare teams** + **Compare seasons**; gamelog **sorted by date**; **OPP** when `opp_pts` in DB; **Data coverage** notices.

### Compare

- Modes: player vs player (per-season pickers **`s1`/`s2`**), team vs team (**`ts1`/`ts2`**), **player career**, **team seasons** (`team-career`); season chip colors match charts.
- Player compare: **Base / Advanced / Defense** tabs + **Additional local stats** (`extra_stats`); **inactive/retired** players via `GET /api/players?include_inactive=1` in compare picker.
- Team compare: **Base / Advanced / Opponent** stat tabs; historical seasons via `team-stats?season=`.
- Career / team-season compare: **Select all**, no 4-season cap; scrollable wide bar charts; `displayData` order matches selected seasons.
- Season dropdowns show **`season · team`**; URL params for seasons; `EntitySelector` chip + **“Type to search or change …”**.
- Less red-on-dark (sky / rose accents); `CompareLegend`; optional **stable season colors** (sessionStorage hash).
- Single-season career/team-season view: chart + table when only one season selected.

### Dashboard & records

- Standings + Featured Teams / Players on home (W–L, win %, last/next game where applicable).
- Award races + League Leaders; **Overall** leaders from **server** `GET /api/leaders/overall` (optional client fallback); Sixth Man bench-only (re-seed awards to refresh DB).
- Records page: expanded catalog + filters; **`GET /api/records/catalog`**.

### Data refresh & mobile

- **Quick refresh**: `seed.py --quick-refresh` + `POST /api/refresh?quick=true`; full refresh still available; **`sync_state`** + navbar timestamps.
- Pull-to-refresh: triggers quick backend refresh, then invalidates React Query.

### Backend / API

- `get_team_season_history`, featured-team / **featured-player** order, multi-day scoreboard cache (`recentgames_board_multi`), `clear_refreshable_caches` after refresh.
- `get_team_stats(season)`, `teamstats_main_{season}` cache keys; **`POST /api/players/careers`** batch career fetch; **`GET /api/leaders/overall`** server-side composite scores.
- **`GET /api/data/coverage`**, merged **`extra_stats`** surfacing on profiles; `_cache` max-size trim for long-running process.
- Records: expanded **RECORDS_CATALOG** entries (documented in code).

---

## Backlog (optional)

| Area        | Idea |
|------------|------|
| Sync       | True incremental/delta sync (high-water marks per table) beyond cache trim + re-seed. |
| Records    | Exhaustive every NBA Stats export you care about. |
| Dream Team | Further modes (playoff-only, custom weights). |
| CI         | Expand test matrix beyond smoke pytest + Vitest. |

---

## Original requests → status (quick map)

| Topic | Status |
|-------|--------|
| More YoY stats + chart toggles | **Done** (core + TOV/OREB/DREB; more metrics = backlog). |
| Game log data / sort | **Done** for sort/display; more columns = backlog. |
| Acronyms / tooltips everywhere | **Done** on main surfaces; niche pages = backlog. |
| Load all players + sort | **Done.** |
| Team sorts (record, etc.) | **Done** (GB, streak, conf rank, PPG). |
| Esoteric records / catalog | **Done** subset + API catalog; exhaustive = backlog. |
| Featured players/teams + dashboard + last/next | **Done.** |
| Refresh “since last update” | **Partial** — quick + full re-seed + metadata; true delta = backlog. |
| Compare UX + less red | **Done.** |
| Team multi-season compare + colors | **Done** (`team-career`). |

---

## Done (archive — original wording)

Historical notes; many are superseded by **Completed** above.

- I don't know what the plus minus means when viewing all seasons for a particular player.  
  _(Tooltip text in `statDefs`.)_

- Pull in player images under teams roster in the table, a small avatar will do.

- ![alt text](<Screenshot 2026-03-24 at 6.03.06 AM.png>) The group value shows an error for Overall. location, win loss and month.

- When we're looking at all seasons that a player has played, I would like to highlight the best value for all seasons. for each column. So for example one player had the best season in the 2009, 2010 season when it comes to games played, that number should be highlighted in the table.

- League Leaders: It would be nice to know which player has the best placement across all of the different categories under the league leaders table in the dashboard. So for example if Nikola Jokic has number eight most amount of points but he has the number one most rebounds and the number one most steals, then he would rank higher than Luka Dantchis that has the most amount of points but isn't even in the list for rebounds or assists or steals. this should be an algorithmic thing that we calculate and store in the database and then refresh every time the data gets updated.  
  _(Composite “Overall” tab; computed client-side from leaders payload.)_

- ![alt text](<Screenshot 2026-03-24 at 6.13.33 AM.png>) If a player has played for multiple teams, looking at their individual player page should show all of their previous teams in the card at the top of the page. And the years that they were with those teams.

- I want to be able to sort the roster table under the teams pages by any of the columns in the table.

- In the players tab we should see featured players at the top of the page and in the teams tab we should see featured teams at the top of the teams page.

- We should be saving the player images in our local machine so that we don't have to make a request for them every time. And maybe we can create a script that will check for any updated images once every season. If an image is missing, we can just show a simple person icon avatar.  
  _( `cache_images.py`, `--check-updates`, static headshots, `PlayerAvatar` fallback.)_

- In the compare page, it's not clear immediately which colour belongs to which player. Same goes for games.

- I would also like to be able to compare a player while they played on one team versus while they played on another team. For example, for LeBron James, I want to be able to compare Cleveland versus Miami Heat. I want the averages of all the seasons that he played for those teams. I also want the option to select multiple seasons and then compare them with another set of multiple seasons.  
  _(Career compare: “Group by team” and “Compare Eras”.)_

- I want to add the ability to compare a player from a particular season to another player from a different season in the player versus player compare once a player is selected, then we can have a another dropdown that is by default always the current season, but the user can change it to a different season.

- The game log is missing recent games.  
  _(nba_api fallback no longer truncates; DB still needs seeding for latest season.)_

- The Sixth Man of the Year award under award races has the wrong data. Right now it's just looking at points per game for all players across the NBA.  
  _(Fixed in `_compute_award("smoy")` via bench-only `LeagueDashPlayerStats`; **re-seed** `award_rankings` to replace old rows.)_

- ![alt text](<Screenshot 2026-03-24 at 7.05.20 AM.png>) Add the team to the season dropdown  
  _(Player compare season `<select>` shows `season · team`.)_

- I want to add a new functionality to the app where I can pick a group of players from all time, current and history, put them on a team, and then I can pick another group of players and put them in another team. And I want that to be analyzed so each player gets analyzed, and we can choose the user wants to compare the average over their whole career for each player, or we pick the best season for each player and compare the team totals and be able to figure out which team would be better.  
  _(Dream Team page + URL share.)_

- I want to fetch new data by pulling the page similar to how it works on mobile. That needs to be smart.  
  _(Pull-to-refresh starts **quick** backend refresh, then invalidates queries.)_

- I can't favorite teams.  
  _(Feature exists in app + API; if it failed before, fix was proxy/port/CORS to the correct NBA Stats backend.)_

- I want to know each player's number on their profile. I want it placed to the left of the player. And also on the table when viewing the team rosters. One other thing is that I want to know by total stats what are the best players, not just points per game on the team rosters.  
  _(Jersey in hero + roster; Per Game / Totals toggle on roster.)_
