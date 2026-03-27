const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${path}`)
  }
  return res.json() as Promise<T>
}

export async function apiFetch<T>(path: string): Promise<T> {
  return request<T>(path)
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const client = {
  async get<T>(path: string): Promise<{ data: T }> {
    return { data: await request<T>(path) }
  },
  async post<T>(path: string, body?: unknown): Promise<{ data: T }> {
    return {
      data: await request<T>(path, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      }),
    }
  },
}

export default apiFetch
