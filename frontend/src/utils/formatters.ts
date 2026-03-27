export function fmtPct(val: number | null | undefined): string {
  if (val == null) return '—'
  return (val * 100).toFixed(1) + '%'
}

export function fmtStat(val: number | null | undefined, decimals = 1): string {
  if (val == null) return '—'
  return Number(val).toFixed(decimals)
}

/** Signed P1−P2 for compare tables; pct values are 0–1 → show as percentage points. */
export function fmtCompareDelta(v1: number, v2: number, isPct: boolean): string {
  const delta = v1 - v2
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-12) return '—'
  if (isPct) {
    const pp = delta * 100
    return (pp > 0 ? '+' : '') + pp.toFixed(1) + ' pp'
  }
  return (delta > 0 ? '+' : '') + delta.toFixed(1)
}

export function fmtRecord(wins: number | null | undefined, losses: number | null | undefined): string {
  if (wins == null || losses == null) return '—'
  return `${wins}-${losses}`
}

export function fmtWinPct(val: number | null | undefined): string {
  if (val == null) return '—'
  return (val * 100).toFixed(1) + '%'
}
