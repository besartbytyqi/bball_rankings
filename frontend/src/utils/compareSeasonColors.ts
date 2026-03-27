/** Stable HSL per season string; persisted in sessionStorage so colors do not jump when selection order changes. */
const STORAGE_KEY = 'bball_compare_season_colors_v1'

export function hslHashForString(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h)
  return `hsl(${Math.abs(h) % 360} 62% 55%)`
}

export function stableSeasonColors(seasons: string[]): Record<string, string> {
  if (typeof sessionStorage === 'undefined') {
    return Object.fromEntries(seasons.map((s) => [s, hslHashForString(s)]))
  }
  let stored: Record<string, string> = {}
  try {
    stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, string>
  } catch {
    stored = {}
  }
  const next: Record<string, string> = { ...stored }
  for (const s of seasons) {
    if (!next[s]) next[s] = hslHashForString(s)
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* private mode */
  }
  return Object.fromEntries(seasons.map((s) => [s, next[s] ?? hslHashForString(s)]))
}
