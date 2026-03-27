import apiFetch, { client } from './client'

export type RecordRow = { rank: number; player_id: number; display_name: string; team?: string; season?: string; value: number }

export type RecordCatalogEntry = {
  id: string
  label: string
  scopes: string[]
  value_kind: string
  notes?: string
}

export const fetchRecords = async (category: string, scope: string, filter: string): Promise<RecordRow[]> => {
  const { data } = await client.get<RecordRow[]>(`/records?category=${category}&scope=${scope}&filter=${filter}`)
  return data
}

export const fetchRecordsCatalog = () => apiFetch<RecordCatalogEntry[]>('/records/catalog')
