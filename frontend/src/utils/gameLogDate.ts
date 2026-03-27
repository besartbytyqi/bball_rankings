/** Parse game_date from DB (ISO) or API ("Mar 23, 2026") for sorting. */
export function parseGameLogDateMs(raw: unknown): number {
  const s = String(raw ?? '').trim()
  if (!s) return 0
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = new Date(s.slice(0, 10)).getTime()
    return Number.isNaN(t) ? 0 : t
  }
  const t = Date.parse(s)
  return Number.isNaN(t) ? 0 : t
}

export function formatGameDateDisplay(raw: unknown): string {
  const ms = parseGameLogDateMs(raw)
  if (!ms) return String(raw ?? '—')
  return new Date(ms).toISOString().slice(0, 10)
}

export function sortGamelogByDateDesc<T extends Record<string, unknown>>(rows: T[]): T[] {
  return [...rows].sort((a, b) => parseGameLogDateMs(b.game_date) - parseGameLogDateMs(a.game_date))
}
