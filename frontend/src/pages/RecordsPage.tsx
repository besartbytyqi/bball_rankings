import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchRecords, fetchRecordsCatalog, type RecordRow, type RecordCatalogEntry } from '@/api/records'
import Tabs from '@/components/ui/Tabs'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { StatHeader } from '@/components/ui/StatHeader'
import { fmtStat, fmtPct } from '@/utils/formatters'

const SCOPES = ['Career Totals', 'Single Season']
const FILTERS = ['All Time', 'Active', 'Retired'] as const

function filterToApi(f: (typeof FILTERS)[number]): string {
  if (f === 'All Time') return 'all'
  return f.toLowerCase()
}

function formatValue(category: string, scope: string, value: number): string {
  if (category === 'gp') return String(Math.round(value))
  if (category === 'pie') return fmtStat(value, 3)
  if (category === 'ts_pct' || category === 'usg_pct' || category.endsWith('_pct')) return fmtPct(value)
  if (category === 'min' && scope === 'Career Totals') return `${Math.round(value).toLocaleString()} min`
  if (category === 'plus_minus' && scope === 'Career Totals') {
    const v = Math.round(value)
    return (v > 0 ? '+' : '') + v.toLocaleString()
  }
  if (category === 'plus_minus') return (value > 0 ? '+' : '') + fmtStat(value)
  return fmtStat(value)
}

export default function RecordsPage() {
  const navigate = useNavigate()
  const [category, setCategory] = useState('pts')
  const [scope, setScope] = useState('Career Totals')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All Time')

  const { data: catalog } = useQuery({
    queryKey: ['records', 'catalog'],
    queryFn: fetchRecordsCatalog,
    staleTime: 60 * 60 * 1000,
  })

  const categories: RecordCatalogEntry[] = useMemo(() => {
    if (catalog?.length) return catalog
    return [
      { id: 'pts', label: 'Points', scopes: ['career', 'season'], value_kind: 'count' },
      { id: 'reb', label: 'Rebounds', scopes: ['career', 'season'], value_kind: 'count' },
      { id: 'ast', label: 'Assists', scopes: ['career', 'season'], value_kind: 'count' },
      { id: 'stl', label: 'Steals', scopes: ['career', 'season'], value_kind: 'count' },
      { id: 'blk', label: 'Blocks', scopes: ['career', 'season'], value_kind: 'count' },
      { id: 'gp', label: 'Games', scopes: ['career', 'season'], value_kind: 'games' },
    ]
  }, [catalog])

  const activeCatalog = categories.find((c) => c.id === category)

  const { data: records, isLoading } = useQuery({
    queryKey: ['records', category, scope, filter],
    queryFn: (): Promise<RecordRow[]> =>
      fetchRecords(category, scope === 'Career Totals' ? 'career' : 'season', filterToApi(filter)),
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Records & Leaders</h1>

      {activeCatalog?.notes && (
        <p className="text-xs text-text-secondary max-w-3xl">{activeCatalog.notes}</p>
      )}

      <div className="bg-surface-2 rounded-lg p-4 space-y-6">
        <div className="flex flex-wrap gap-6 items-end">
          <div className="space-y-2">
            <label className="text-xs text-text-secondary uppercase font-bold tracking-wider">Category</label>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className={`px-3 py-1.5 text-sm rounded transition-colors ${category === c.id ? 'bg-sky-600 text-white' : 'bg-surface-3 text-text-secondary hover:text-text-primary'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-text-secondary uppercase font-bold tracking-wider">Scope</label>
            <Tabs tabs={SCOPES} active={scope} onChange={setScope} />
          </div>

          <div className="space-y-2">
            <label className="text-xs text-text-secondary uppercase font-bold tracking-wider">Player Status</label>
            <div className="flex gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 text-sm rounded transition-colors ${filter === f ? 'bg-nba-blue text-white' : 'bg-surface-3 text-text-secondary hover:text-text-primary'}`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-surface-1 rounded-lg border border-border overflow-hidden">
          {isLoading ? (
            <div className="p-8">
              <LoadingSpinner />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface-3">
                <tr className="text-text-secondary border-b border-border">
                  <StatHeader colKey="rank" label="Rank" align="left" className="py-2 px-4 w-16" />
                  <StatHeader colKey="display_name" label="Player" align="left" className="py-2 px-4" />
                  <StatHeader colKey="team" label="Team" align="right" className="py-2 px-4" />
                  {scope === 'Single Season' && (
                    <StatHeader colKey="season" label="Season" align="right" className="py-2 px-4" />
                  )}
                  <StatHeader colKey="value" label="Value" align="right" className="py-2 px-4" />
                  <th className="py-2 px-4 text-center w-24 text-text-secondary">Action</th>
                </tr>
              </thead>
              <tbody>
                {(records ?? []).map((r) => (
                  <tr key={`${r.player_id}-${r.season ?? 'career'}`} className="border-b border-border/40 hover:bg-surface-3 transition-colors">
                    <td className="py-2 px-4 text-text-secondary font-medium">#{r.rank}</td>
                    <td className="py-2 px-4">
                      <Link to={`/players/${r.player_id}`} className="font-semibold text-sky-400 hover:text-sky-300 transition-colors">
                        {r.display_name}
                      </Link>
                    </td>
                    <td className="py-2 px-4 text-right text-text-secondary">{r.team || '—'}</td>
                    {scope === 'Single Season' && <td className="py-2 px-4 text-right">{r.season}</td>}
                    <td className="py-2 px-4 text-right font-bold text-nba-gold tabular-nums">
                      {formatValue(category, scope, r.value)}
                    </td>
                    <td className="py-2 px-4 text-center">
                      <button
                        onClick={() => navigate(`/compare?mode=player&p1=${r.player_id}`)}
                        className="text-[10px] bg-surface-2 hover:bg-sky-700 hover:text-white px-2 py-1 rounded border border-border transition-all"
                      >
                        Compare
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
