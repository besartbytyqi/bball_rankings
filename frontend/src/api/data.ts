import apiFetch from './client'

export type DataCoverageResponse = {
  current_season: string
  tables: Record<string, number>
  sample_player_extra_stat_keys?: string[]
  player?: { player_gamelog_games: number; season: string }
  team?: {
    team_gamelog_games: number
    team_gamelog_with_opp_pts: number
    season: string
  }
}

export function fetchDataCoverage(params: { playerId?: number; teamId?: number }) {
  const q = new URLSearchParams()
  if (params.playerId != null) q.set('player_id', String(params.playerId))
  if (params.teamId != null) q.set('team_id', String(params.teamId))
  const suffix = q.toString() ? `?${q.toString()}` : ''
  return apiFetch<DataCoverageResponse>(`/data/coverage${suffix}`)
}
