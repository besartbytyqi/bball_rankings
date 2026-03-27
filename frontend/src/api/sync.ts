import apiFetch from './client'

export const fetchSyncStatus = () => apiFetch<Record<string, string>>('/sync/status')
