import apiFetch from './client'
import type { Standings } from '@/types'

export const fetchStandings = () => apiFetch<Standings>('/standings')
export const fetchLeaders = () => apiFetch<Record<string, unknown[]>>('/leaders')
export const fetchLeadersOverall = () => apiFetch<{ rows: Record<string, unknown>[] }>('/leaders/overall')
export const fetchAwards = (type: string) => apiFetch<Record<string, unknown>>(`/awards/${type}`)
