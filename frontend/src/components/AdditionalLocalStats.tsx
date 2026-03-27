import { useMemo } from 'react'
import { fmtPct, fmtStat, fmtCompareDelta } from '@/utils/formatters'

/** Coerce import extra field to a number for deltas; null if not comparable. */
function parseExtraNumeric(val: unknown): number | null {
  if (val == null || val === '') return null
  if (typeof val === 'number' && Number.isFinite(val)) return val
  if (typeof val === 'boolean') return null
  if (typeof val === 'string') {
    const t = val.trim().replace(/%/g, '')
    if (!t) return null
    const n = parseFloat(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function extraStatIsPctKey(key: string): boolean {
  const k = key.toLowerCase()
  if (k.includes('rank')) return false
  return k.includes('pct') || k.includes('percentage') || k.endsWith('_pct')
}

/** For highlighting: ranks — lower better; everything else — higher better. */
function extraHigherIsBetter(key: string): boolean {
  return !key.toLowerCase().includes('rank')
}

function formatMergedExtraValue(key: string, val: unknown): string {
  if (val == null || val === '') return '—'
  if (typeof val === 'boolean') return val ? 'Yes' : 'No'
  if (typeof val === 'string') return val
  if (typeof val !== 'number') return String(val)
  const k = key.toLowerCase()
  if (k.includes('rank')) return fmtStat(val)
  if (k.includes('pct') || k.includes('percentage') || k.endsWith('_pct')) return fmtPct(val)
  return fmtStat(val)
}

export function AdditionalLocalStats({
  row,
  excludeKeys,
  label = 'Additional local stats',
}: {
  row?: Record<string, unknown> | null
  excludeKeys: Set<string>
  label?: string
}) {
  const keys = useMemo(() => {
    if (!row) return []
    return Object.keys(row)
      .filter((k) => {
        if (excludeKeys.has(k)) return false
        const v = row[k]
        if (v == null || v === '') return false
        if (typeof v === 'object') return false
        return true
      })
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [row, excludeKeys])

  if (!keys.length || !row) return null

  return (
    <details className="mt-4 rounded-lg border border-border bg-surface-3/40 open:border-sky-500/25">
      <summary className="cursor-pointer select-none list-none px-3 py-2 text-xs font-semibold text-sky-100 hover:text-white [&::-webkit-details-marker]:hidden">
        {label}
        <span className="ml-1 font-normal text-text-secondary">({keys.length} fields from imports)</span>
      </summary>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 px-3 pb-3 text-xs">
        {keys.map((k) => (
          <div key={k} className="rounded bg-surface-2/80 px-2 py-1.5 border border-border/50">
            <div className="text-text-secondary truncate" title={k}>
              {k.replace(/_/g, ' ')}
            </div>
            <div className="tabular-nums font-medium text-text-primary">
              {formatMergedExtraValue(k, row[k])}
            </div>
          </div>
        ))}
      </div>
    </details>
  )
}

/** Single table: each row is one stat with both players’ values for easier scanning. */
export function AdditionalLocalStatsCompare({
  rowA,
  rowB,
  excludeKeys,
  labelA,
  labelB,
  colorA = '#C9082A',
  colorB = '#17408B',
}: {
  rowA?: Record<string, unknown> | null
  rowB?: Record<string, unknown> | null
  excludeKeys: Set<string>
  labelA: string
  labelB: string
  colorA?: string
  colorB?: string
}) {
  const keys = useMemo(() => {
    const acc = new Set<string>()
    const collect = (row: Record<string, unknown> | null | undefined) => {
      if (!row) return
      for (const k of Object.keys(row)) {
        if (excludeKeys.has(k)) continue
        const v = row[k]
        if (v == null || v === '') continue
        if (typeof v === 'object') continue
        acc.add(k)
      }
    }
    collect(rowA)
    collect(rowB)
    return [...acc].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [rowA, rowB, excludeKeys])

  if (!keys.length) return null

  return (
    <details className="mt-4 rounded-lg border border-border bg-surface-3/40 open:border-sky-500/25">
      <summary className="cursor-pointer select-none list-none px-3 py-2 text-xs font-semibold text-sky-100 hover:text-white [&::-webkit-details-marker]:hidden">
        Additional local stats (side-by-side)
        <span className="ml-1 font-normal text-text-secondary">({keys.length} fields from imports)</span>
      </summary>
      <div className="overflow-x-auto px-3 pb-3">
        <table className="w-full text-xs min-w-[18rem] table-fixed">
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[32%]" />
            <col className="w-[34%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border">
              <th className="py-2 pr-2 text-left font-semibold align-bottom">
                <span className="inline-flex items-center gap-1.5 text-white">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm shadow-sm" style={{ backgroundColor: colorA }} aria-hidden />
                  <span className="leading-tight">{labelA}</span>
                </span>
              </th>
              <th className="py-2 px-2 text-center font-medium text-text-secondary align-bottom">Stat</th>
              <th className="py-2 pl-2 text-right font-semibold align-bottom">
                <span className="inline-flex items-center justify-end gap-1.5 text-white">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm shadow-sm" style={{ backgroundColor: colorB }} aria-hidden />
                  <span className="leading-tight text-right">{labelB}</span>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const nA = parseExtraNumeric(rowA?.[k])
              const nB = parseExtraNumeric(rowB?.[k])
              const isPct = extraStatIsPctKey(k)
              const d12 = nA != null && nB != null ? fmtCompareDelta(nA, nB, isPct) : '—'
              const d21 = nA != null && nB != null ? fmtCompareDelta(nB, nA, isPct) : '—'
              const hb = extraHigherIsBetter(k)
              const p1Win = nA != null && nB != null && (hb ? nA > nB : nA < nB)
              const p2Win = nA != null && nB != null && (hb ? nB > nA : nB < nA)
              return (
                <tr key={k} className="border-b border-border/40 transition-colors hover:bg-surface-3/55">
                  <td className="py-1.5 pr-2 text-left tabular-nums">
                    <span className={`font-medium ${p1Win ? 'text-nba-gold' : 'text-text-primary'}`}>
                      {formatMergedExtraValue(k, rowA?.[k])}
                      {d12 !== '—' ? (
                        <span className="text-text-secondary font-normal text-[0.85em]"> ({d12})</span>
                      ) : null}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-center text-text-secondary capitalize" title={k}>
                    {k.replace(/_/g, ' ')}
                  </td>
                  <td className="py-1.5 pl-2 text-right tabular-nums">
                    <span className={`font-medium ${p2Win ? 'text-nba-gold' : 'text-text-primary'}`}>
                      {d21 !== '—' ? (
                        <span className="text-text-secondary font-normal text-[0.85em]">({d21}) </span>
                      ) : null}
                      {formatMergedExtraValue(k, rowB?.[k])}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </details>
  )
}
