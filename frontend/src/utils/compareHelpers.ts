/**
 * Normalize a set of stat objects to a 0–100 scale for radar charts.
 * Each entity gets a score per stat key relative to the max across all entities.
 */
export function normalizeForRadar(
  entities: { id: number | string; label: string; stats: Record<string, number | null> }[],
  keys: string[],
): { id: number | string; label: string; data: Record<string, number> }[] {
  const maxes: Record<string, number> = {}
  for (const key of keys) {
    maxes[key] = Math.max(...entities.map((e) => Number(e.stats[key] ?? 0)))
  }

  return entities.map((e) => {
    const data: Record<string, number> = {}
    for (const key of keys) {
      const max = maxes[key]
      data[key] = max > 0 ? Math.round((Number(e.stats[key] ?? 0) / max) * 100) : 0
    }
    return { id: e.id, label: e.label, data }
  })
}
