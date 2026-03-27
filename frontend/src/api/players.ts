import apiFetch, { apiPost } from './client'
import type { Player, PlayerProfile, GameLogEntry, Splits } from '@/types'

export const fetchAllPlayers = (opts?: { includeInactive?: boolean }) => {
  const q = opts?.includeInactive ? '?include_inactive=1' : ''
  return apiFetch<Player[]>(`/players${q}`)
}
export const fetchFeaturedPlayers = () => apiFetch<Record<string, unknown>[]>('/players/featured')
export const fetchFeaturedPlayerIds = () => apiFetch<number[]>('/players/featured/ids')
export const addFeaturedPlayer = (id: number) =>
  fetch(`/api/players/featured/${id}`, { method: 'POST' }).then((r) => r.json())
export const removeFeaturedPlayer = (id: number) =>
  fetch(`/api/players/featured/${id}`, { method: 'DELETE' }).then((r) => r.json())
export const fetchPlayerStats = (id: number, season?: string) =>
  apiFetch<PlayerProfile>(`/players/${id}/stats${season ? `?season=${encodeURIComponent(season)}` : ''}`)
export const fetchPlayerGamelog = (id: number) => apiFetch<GameLogEntry[]>(`/players/${id}/gamelog`)
export const fetchPlayerSplits = (id: number) => apiFetch<Splits>(`/players/${id}/splits`)
export const fetchPlayerCareer = (id: number) => apiFetch<Record<string, unknown>[]>(`/players/${id}/career`)

export type PlayerSeasonAwardsResponse = { by_season: Record<string, string[]> }

export const fetchPlayerSeasonAwards = (id: number) =>
  apiFetch<PlayerSeasonAwardsResponse>(`/players/${id}/season-awards`)

export const fetchPlayerCareersBatch = (playerIds: number[]) =>
  apiPost<{ careers: Record<string, Record<string, unknown>[]> }>('/players/careers', { player_ids: playerIds }).then(
    (r) => r.careers,
  )

export const reorderFeaturedPlayers = (playerIds: number[]) =>
  fetch(`/api/players/featured/order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player_ids: playerIds }),
  }).then((r) => r.json())
