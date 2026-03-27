// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------
export interface Player {
  player_id: number
  display_name: string
  first_name?: string
  last_name?: string
  team_id?: number
  team_abbreviation?: string
  position?: string
  jersey_number?: string
  from_year?: number
  to_year?: number
  is_active?: number
  // Current-season stats (included from get_all_players JOIN)
  pts?: number | null
  reb?: number | null
  ast?: number | null
  stl?: number | null
  blk?: number | null
  fg_pct?: number | null
  gp?: number | null
}

export interface PlayerSeasonStat {
  player_id: number
  season: string
  stat_type: 'base' | 'advanced' | 'defense'
  gp?: number
  min?: number
  pts?: number
  reb?: number
  ast?: number
  stl?: number
  blk?: number
  fg_pct?: number
  fg3_pct?: number
  ft_pct?: number
  plus_minus?: number
  // Extra stats (merged from extra_stats JSON)
  [key: string]: unknown
}

export interface GameLogEntry {
  player_id?: number
  team_id?: number
  season?: string
  game_id?: string
  game_date?: string
  matchup?: string
  wl?: string
  min?: number
  pts?: number
  reb?: number
  ast?: number
  stl?: number
  blk?: number
  fg_pct?: number
  fg3_pct?: number
  ft_pct?: number
  plus_minus?: number
}

export interface PlayerProfile {
  player_id: number
  base: PlayerSeasonStat[]
  advanced: PlayerSeasonStat[]
  defense: PlayerSeasonStat[]
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------
export interface Team {
  id: number
  name: string
  abbr: string
  conf: string
}

export interface TeamSeasonStat {
  team_id: number
  season: string
  stat_type: 'base' | 'advanced' | 'opponent'
  gp?: number
  wins?: number
  losses?: number
  pts?: number
  reb?: number
  ast?: number
  stl?: number
  blk?: number
  fg_pct?: number
  fg3_pct?: number
  ft_pct?: number
  [key: string]: unknown
}

export interface TeamStats {
  base: TeamSeasonStat[]
  advanced: TeamSeasonStat[]
  opponent: TeamSeasonStat[]
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------
export interface StandingsRow {
  season: string
  team_id: number
  conference: string
  wins: number
  losses: number
  win_pct: number
  games_back?: number
  home_record?: string
  road_record?: string
  last10?: string
  streak?: string
  conference_rank?: number
  // Extra columns from nba_api fallback
  [key: string]: unknown
}

export interface Standings {
  east: StandingsRow[]
  west: StandingsRow[]
  season: string
}

// ---------------------------------------------------------------------------
// Leaders
// ---------------------------------------------------------------------------
export interface LeaderEntry {
  season: string
  stat_category: string
  rank: number
  player_id?: number
  player_name?: string
  team_id?: number
  value?: number
  // nba_api fallback may include more fields
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Awards
// ---------------------------------------------------------------------------
export interface AwardPlayer {
  PLAYER_ID: number
  PLAYER_NAME: string
  TEAM_ABBREVIATION: string
  _score?: number
  [key: string]: unknown
}

export interface AwardRanking {
  award: string
  players: AwardPlayer[]
}

// ---------------------------------------------------------------------------
// Splits
// ---------------------------------------------------------------------------
export interface Splits {
  overall: Record<string, unknown>[]
  location: Record<string, unknown>[]
  win_loss: Record<string, unknown>[]
  month: Record<string, unknown>[]
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------
export type CompareMode = 'player' | 'team' | 'career' | 'team-career'

export interface CompareTarget {
  id: number
  type: 'player' | 'team'
  label: string
  stats: Record<string, number | null>
}
