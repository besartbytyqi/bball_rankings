import apiFetch from './client'
import type { Team, TeamStats, Splits } from '@/types'

export const fetchTeams = () => apiFetch<Team[]>('/teams')
export const fetchTeamStats = (season?: string) => {
  const q = season ? `?season=${encodeURIComponent(season)}` : ''
  return apiFetch<TeamStats>(`/team-stats${q}`)
}
export const fetchFeaturedTeams = () => apiFetch<Record<string, unknown>[]>('/teams/featured')
export const fetchFeaturedTeamIds = () => apiFetch<number[]>('/teams/featured/ids')
export const addFeaturedTeam = (id: number) =>
  fetch(`/api/teams/featured/${id}`, { method: 'POST' }).then((r) => r.json())
export const removeFeaturedTeam = (id: number) =>
  fetch(`/api/teams/featured/${id}`, { method: 'DELETE' }).then((r) => r.json())

export const reorderFeaturedTeams = (teamIds: number[]) =>
  fetch('/api/teams/featured/order', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ team_ids: teamIds }),
  }).then(async (r) => {
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error((err as { detail?: string }).detail ?? `HTTP ${r.status}`)
    }
    return r.json() as Promise<{ ok: boolean }>
  })
export const fetchTeamRoster = (id: number) => apiFetch<Record<string, unknown>>(`/teams/${id}/roster`)
export const fetchTeamGamelog = (id: number) => apiFetch<Record<string, unknown>>(`/teams/${id}/gamelog`)
export const fetchTeamSplits = (id: number) => apiFetch<Splits>(`/teams/${id}/splits`)
export const fetchTeamSeasonHistory = (id: number) =>
  apiFetch<Record<string, unknown>[]>(`/teams/${id}/season-history`)
