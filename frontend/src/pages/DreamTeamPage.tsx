import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from 'recharts'
import { fetchAllPlayers, fetchPlayerCareersBatch } from '@/api/players'
import { EntitySelector } from '@/components/ui/EntitySelector'
import { StatHeader } from '@/components/ui/StatHeader'
import { fmtPct, fmtStat } from '@/utils/formatters'
import { STAT_DEFS } from '@/utils/statDefs'

type PlayerSlot = { id: number; name: string }

type BestSeasonBy = 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'ts_pct' | 'composite'

type ProfileAgg = {
  pts: number
  reb: number
  ast: number
  stl: number
  blk: number
  tov: number
  ts_pct: number
}

function weightedAvg(rows: Record<string, unknown>[], key: string): number {
  let num = 0
  let den = 0
  for (const row of rows) {
    const gp = Number(row.gp ?? 0)
    if (gp <= 0) continue
    const v = Number(row[key] ?? 0)
    if (Number.isNaN(v)) continue
    num += v * gp
    den += gp
  }
  return den ? num / den : 0
}

function pickBestRow(rows: Record<string, unknown>[], by: BestSeasonBy): Record<string, unknown> {
  if (!rows.length) return {}
  const score = (r: Record<string, unknown>) => {
    if (by === 'composite') {
      return (
        Number(r.pts ?? 0) +
        Number(r.reb ?? 0) +
        Number(r.ast ?? 0) +
        Number(r.stl ?? 0) +
        Number(r.blk ?? 0)
      )
    }
    return Number(r[by] ?? 0)
  }
  return [...rows].sort((a, b) => score(b) - score(a))[0] ?? {}
}

function buildProfile(
  rows: Record<string, unknown>[],
  mode: 'Career Avg' | 'Best Season',
  bestBy: BestSeasonBy,
): ProfileAgg {
  if (!rows.length) {
    return { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, ts_pct: 0 }
  }
  if (mode === 'Best Season') {
    const b = pickBestRow(rows, bestBy)
    return {
      pts: Number(b.pts ?? 0),
      reb: Number(b.reb ?? 0),
      ast: Number(b.ast ?? 0),
      stl: Number(b.stl ?? 0),
      blk: Number(b.blk ?? 0),
      tov: Number(b.tov ?? 0),
      ts_pct: Number(b.ts_pct ?? 0),
    }
  }
  return {
    pts: weightedAvg(rows, 'pts'),
    reb: weightedAvg(rows, 'reb'),
    ast: weightedAvg(rows, 'ast'),
    stl: weightedAvg(rows, 'stl'),
    blk: weightedAvg(rows, 'blk'),
    tov: weightedAvg(rows, 'tov'),
    ts_pct: weightedAvg(rows, 'ts_pct'),
  }
}

const CHART_ROWS: { stat: string; colKey: keyof ProfileAgg; scalePct?: boolean }[] = [
  { stat: 'PTS', colKey: 'pts' },
  { stat: 'REB', colKey: 'reb' },
  { stat: 'AST', colKey: 'ast' },
  { stat: 'STL', colKey: 'stl' },
  { stat: 'BLK', colKey: 'blk' },
  { stat: 'TOV', colKey: 'tov' },
  { stat: 'TS%', colKey: 'ts_pct', scalePct: true },
]

export default function DreamTeamPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [teamA, setTeamA] = useState<PlayerSlot[]>([])
  const [teamB, setTeamB] = useState<PlayerSlot[]>([])
  const [mode, setMode] = useState<'Career Avg' | 'Best Season'>('Career Avg')
  const [bestBy, setBestBy] = useState<BestSeasonBy>('pts')
  const [chartMotion, setChartMotion] = useState(true)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setChartMotion(!mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const { data: allPlayers = [] } = useQuery({
    queryKey: ['players', 'all', true],
    queryFn: () => fetchAllPlayers({ includeInactive: true }),
    staleTime: 60 * 60 * 1000,
  })
  const teamAIds = teamA.map((p) => p.id)
  const teamBIds = teamB.map((p) => p.id)
  const allIds = useMemo(() => Array.from(new Set([...teamAIds, ...teamBIds])).sort((a, b) => a - b), [teamAIds, teamBIds])
  const allIdsKey = allIds.join(',')

  const { data: careerMap = {} } = useQuery({
    queryKey: ['dream-team', 'career-map', allIdsKey],
    queryFn: async () => {
      const careers = await fetchPlayerCareersBatch(allIds)
      return Object.fromEntries(Object.entries(careers).map(([k, v]) => [Number(k), v])) as Record<
        number,
        Record<string, unknown>[]
      >
    },
    enabled: allIds.length > 0,
  })

  useEffect(() => {
    const modeParam = searchParams.get('mode')
    const bestParam = searchParams.get('best') as BestSeasonBy | null
    const parseRoster = (raw: string | null): PlayerSlot[] => {
      if (!raw) return []
      return raw
        .split(',')
        .map((idStr) => Number(idStr))
        .filter((id) => Number.isFinite(id) && id > 0)
        .slice(0, 5)
        .map((id) => {
          const player = allPlayers.find((p) => p.player_id === id)
          return { id, name: player?.display_name ?? `Player ${id}` }
        })
    }
    if (!teamA.length && !teamB.length) {
      setTeamA(parseRoster(searchParams.get('a')))
      setTeamB(parseRoster(searchParams.get('b')))
      if (modeParam === 'best') setMode('Best Season')
      if (
        bestParam &&
        ['pts', 'reb', 'ast', 'stl', 'blk', 'ts_pct', 'composite'].includes(bestParam)
      ) {
        setBestBy(bestParam)
      }
    }
  }, [searchParams, allPlayers, teamA.length, teamB.length])

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    next.set('mode', mode === 'Best Season' ? 'best' : 'career')
    if (mode === 'Best Season') next.set('best', bestBy)
    else next.delete('best')
    if (teamA.length) next.set('a', teamA.map((p) => p.id).join(','))
    else next.delete('a')
    if (teamB.length) next.set('b', teamB.map((p) => p.id).join(','))
    else next.delete('b')
    setSearchParams(next, { replace: true })
  }, [teamA, teamB, mode, bestBy, searchParams, setSearchParams])

  const resolveProfile = (playerId: number): ProfileAgg => {
    const rows = (careerMap[playerId] ?? []) as Record<string, unknown>[]
    return buildProfile(rows, mode, bestBy)
  }

  const sumTeam = (roster: PlayerSlot[]): ProfileAgg => {
    const z: ProfileAgg = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, ts_pct: 0 }
    for (const p of roster) {
      const s = resolveProfile(p.id)
      z.pts += s.pts
      z.reb += s.reb
      z.ast += s.ast
      z.stl += s.stl
      z.blk += s.blk
      z.tov += s.tov
      z.ts_pct += s.ts_pct
    }
    return z
  }

  const totalsA = useMemo(() => sumTeam(teamA), [teamA, careerMap, mode, bestBy])
  const totalsB = useMemo(() => sumTeam(teamB), [teamB, careerMap, mode, bestBy])

  const chartData = CHART_ROWS.map(({ stat, colKey, scalePct }) => ({
    stat,
    colKey,
    'Team A': scalePct ? totalsA[colKey] * 100 : totalsA[colKey],
    'Team B': scalePct ? totalsB[colKey] * 100 : totalsB[colKey],
  }))

  const addPlayer = (team: 'A' | 'B', id: number, name?: string) => {
    if (!id) return
    const set = team === 'A' ? setTeamA : setTeamB
    const current = team === 'A' ? teamA : teamB
    if (current.length >= 5) return
    if (current.some((p) => p.id === id)) return
    const fallbackName = allPlayers.find((p) => p.player_id === id)?.display_name ?? `Player ${id}`
    set([...current, { id, name: name ?? fallbackName }])
  }

  const removePlayer = (team: 'A' | 'B', id: number) => {
    const set = team === 'A' ? setTeamA : setTeamB
    set((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Dream Team Builder</h1>
          <p className="text-text-secondary text-sm">
            Build two 5-man rosters and compare combined per-game stats (career weighted averages or each player’s best
            season by a stat you choose).
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="bg-surface-2 p-1 rounded-lg border border-border flex">
            {(['Career Avg', 'Best Season'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  mode === m ? 'bg-nba-red text-white' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          {mode === 'Best Season' ? (
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <span className="shrink-0">Best season by</span>
              <select
                value={bestBy}
                onChange={(e) => setBestBy(e.target.value as BestSeasonBy)}
                className="bg-surface-3 border border-border rounded px-2 py-1 text-text-primary"
              >
                <option value="pts">Points (PTS)</option>
                <option value="reb">Rebounds (REB)</option>
                <option value="ast">Assists (AST)</option>
                <option value="stl">Steals (STL)</option>
                <option value="blk">Blocks (BLK)</option>
                <option value="ts_pct">True shooting (TS%)</option>
                <option value="composite">Composite (PTS+REB+AST+STL+BLK)</option>
              </select>
            </label>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-surface-2 rounded-xl border border-border p-6 space-y-6">
          <div className="flex items-center gap-3 border-b border-border pb-4">
            <div className="w-3 h-3 rounded-full bg-nba-blue shadow-[0_0_8px_rgba(23,64,139,0.6)]" />
            <h2 className="font-bold text-lg uppercase tracking-tight">Team Alpha</h2>
            <span className="ml-auto text-xs text-text-secondary font-mono">{teamA.length}/5</span>
          </div>

          <div className="space-y-3 min-h-[200px]">
            {teamA.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between bg-surface-3 p-3 rounded-lg border border-border/50 group hover:border-nba-blue transition-colors"
              >
                <span className="font-medium text-sm">{p.name}</span>
                <button
                  type="button"
                  onClick={() => removePlayer('A', p.id)}
                  className="text-text-secondary hover:text-nba-red opacity-0 group-hover:opacity-100 transition-all text-xs"
                >
                  Remove
                </button>
              </div>
            ))}
            {teamA.length === 0 && (
              <p className="text-center py-8 text-text-secondary text-sm italic">No players added yet</p>
            )}
          </div>

          {teamA.length < 5 && (
            <EntitySelector type="player" label="Add Player" includeInactive onSelect={(id, name) => addPlayer('A', id, name)} />
          )}
        </div>

        <div className="bg-surface-2 rounded-xl border border-border p-6 space-y-6">
          <div className="flex items-center gap-3 border-b border-border pb-4">
            <div className="w-3 h-3 rounded-full bg-nba-red shadow-[0_0_8px_rgba(201,8,42,0.6)]" />
            <h2 className="font-bold text-lg uppercase tracking-tight">Team Omega</h2>
            <span className="ml-auto text-xs text-text-secondary font-mono">{teamB.length}/5</span>
          </div>

          <div className="space-y-3 min-h-[200px]">
            {teamB.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between bg-surface-3 p-3 rounded-lg border border-border/50 group hover:border-nba-red transition-colors"
              >
                <span className="font-medium text-sm">{p.name}</span>
                <button
                  type="button"
                  onClick={() => removePlayer('B', p.id)}
                  className="text-text-secondary hover:text-nba-red opacity-0 group-hover:opacity-100 transition-all text-xs"
                >
                  Remove
                </button>
              </div>
            ))}
            {teamB.length === 0 && (
              <p className="text-center py-8 text-text-secondary text-sm italic">No players added yet</p>
            )}
          </div>

          {teamB.length < 5 && (
            <EntitySelector type="player" label="Add Player" includeInactive onSelect={(id, name) => addPlayer('B', id, name)} />
          )}
        </div>
      </div>

      {(teamA.length > 0 || teamB.length > 0) && (
        <div className="bg-surface-2 rounded-xl border border-border p-6">
          <h3 className="font-bold mb-4 text-text-secondary uppercase text-xs tracking-widest">Combined Team Comparison</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis
                  dataKey="stat"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#9CA3AF', fontSize: 12, fontWeight: 600 }}
                  dy={10}
                />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  contentStyle={{
                    background: '#111827',
                    border: '1px solid #374151',
                    borderRadius: 12,
                    boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)',
                  }}
                  formatter={(value, _name, item) => {
                    const v = Number(value ?? 0)
                    const pl = item?.payload as { scalePct?: boolean } | undefined
                    if (pl?.scalePct) return [fmtPct(v / 100), '']
                    return [fmtStat(v), '']
                  }}
                />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: 20 }} />
                <Bar
                  dataKey="Team A"
                  fill="#17408B"
                  radius={[4, 4, 0, 0]}
                  barSize={32}
                  isAnimationActive={chartMotion}
                />
                <Bar
                  dataKey="Team B"
                  fill="#C9082A"
                  radius={[4, 4, 0, 0]}
                  barSize={32}
                  isAnimationActive={chartMotion}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-6 overflow-x-auto border-t border-border pt-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-text-secondary border-b border-border">
                  <StatHeader colKey="stat" label="Stat" align="left" className="py-2" />
                  <StatHeader
                    colKey="group_value"
                    label="Team Alpha (sum)"
                    align="right"
                    className="py-2 px-2"
                    title="Sum of roster per-player values for this row"
                  />
                  <StatHeader
                    colKey="group_value"
                    label="Team Omega (sum)"
                    align="right"
                    className="py-2 px-2"
                    title="Sum of roster per-player values for this row"
                  />
                </tr>
              </thead>
              <tbody>
                {CHART_ROWS.map(({ stat, colKey, scalePct }) => (
                  <tr key={stat} className="border-b border-border/40">
                    <td className="py-1.5 text-xs text-text-secondary" title={STAT_DEFS[colKey] ?? stat}>
                      {stat}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      {scalePct ? fmtPct(totalsA[colKey]) : fmtStat(totalsA[colKey])}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      {scalePct ? fmtPct(totalsB[colKey]) : fmtStat(totalsB[colKey])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
