import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueries } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from 'recharts'
import { fetchAllPlayers, fetchPlayerCareersBatch, fetchPlayerSeasonAwards } from '@/api/players'
import { EntitySelector } from '@/components/ui/EntitySelector'
import { StatHeader } from '@/components/ui/StatHeader'
import { fmtPct, fmtStat } from '@/utils/formatters'
import { STAT_DEFS } from '@/utils/statDefs'

const AWARD_ICONS: Record<string, string> = {
  champion: '🏆',
  fmvp: '🎖️',
  mvp: '⭐',
  roy: '🌟',
  smoy: '✨',
}

const CURRENT_SEASON = '2025-26'

type PlayerSlot = { id: number; name: string; season: string }

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

// URL encoding: "id:season" per slot, e.g. "2544:2025-26"
function encodeRoster(roster: PlayerSlot[]): string {
  return roster.map((p) => `${p.id}:${p.season}`).join(',')
}

function decodeRoster(raw: string | null, allPlayers: { player_id: number; display_name: string }[]): PlayerSlot[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((chunk) => {
      const colonIdx = chunk.lastIndexOf(':')
      const id = colonIdx > 0 ? Number(chunk.slice(0, colonIdx)) : Number(chunk)
      const season = colonIdx > 0 ? chunk.slice(colonIdx + 1) : CURRENT_SEASON
      if (!Number.isFinite(id) || id <= 0) return null
      const player = allPlayers.find((p) => p.player_id === id)
      return { id, name: player?.display_name ?? `Player ${id}`, season }
    })
    .filter((s): s is PlayerSlot => s !== null)
    .slice(0, 5)
}

// Weighted score: pts×3, reb×1.5, ast×1.5, stl×1, blk×1, tov×−2, ts%×2
function teamScore(t: ProfileAgg): number {
  return t.pts * 3 + t.reb * 1.5 + t.ast * 1.5 + t.stl + t.blk - t.tov * 2 + t.ts_pct * 200
}

function WinnerVerdict({
  totalsA, totalsB, hasA, hasB,
}: { totalsA: ProfileAgg; totalsB: ProfileAgg; hasA: boolean; hasB: boolean }) {
  if (!hasA || !hasB) return null
  const sA = teamScore(totalsA)
  const sB = teamScore(totalsB)
  const diff = Math.abs(sA - sB)
  const total = sA + sB
  const margin = total > 0 ? diff / total : 0

  const winner = sA > sB ? 'Alpha' : sB > sA ? 'Omega' : null
  const winnerColor = winner === 'Alpha' ? 'text-[#6b9fff]' : 'text-nba-red'
  const edge = margin < 0.04 ? 'Extremely close — could go either way' : margin < 0.10 ? 'Slight edge' : margin < 0.20 ? 'Clear advantage' : 'Dominant advantage'
  const borderColor = winner === 'Alpha' ? 'border-[#17408B]' : winner === 'Omega' ? 'border-nba-red' : 'border-border'

  return (
    <div className={`mb-6 rounded-xl border-2 ${borderColor} bg-surface-3 px-5 py-4 flex flex-col sm:flex-row items-center justify-between gap-3`}>
      <div className="flex items-center gap-3">
        <span className="text-2xl">{winner ? '🏆' : '🤝'}</span>
        <div>
          {winner ? (
            <p className="font-bold text-base">
              <span className={winnerColor}>Team {winner}</span>
              <span className="text-text-primary"> wins</span>
            </p>
          ) : (
            <p className="font-bold text-base text-text-primary">It's a tie</p>
          )}
          <p className="text-xs text-text-secondary">{edge}</p>
        </div>
      </div>
      <div className="flex items-center gap-4 text-sm font-mono">
        <span className="text-[#6b9fff] font-bold">{sA.toFixed(1)}</span>
        <span className="text-text-secondary text-xs">vs</span>
        <span className="text-nba-red font-bold">{sB.toFixed(1)}</span>
      </div>
    </div>
  )
}

export default function DreamTeamPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [teamA, setTeamA] = useState<PlayerSlot[]>([])
  const [teamB, setTeamB] = useState<PlayerSlot[]>([])
  const [chartMotion, setChartMotion] = useState(true)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

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

  const awardsResults = useQueries({
    queries: allIds.map((id) => ({
      queryKey: ['player-season-awards', id],
      queryFn: () => fetchPlayerSeasonAwards(id),
      staleTime: 60 * 60 * 1000,
    })),
  })
  const awardsMap = useMemo(() => {
    const m: Record<number, Record<string, string[]>> = {}
    allIds.forEach((id, i) => {
      m[id] = awardsResults[i]?.data?.by_season ?? {}
    })
    return m
  }, [allIds, awardsResults])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Decode URL params once on mount (allPlayers may be empty yet — names get backfilled below)
  useEffect(() => {
    if (!teamA.length && !teamB.length) {
      setTeamA(decodeRoster(searchParams.get('a'), allPlayers))
      setTeamB(decodeRoster(searchParams.get('b'), allPlayers))
    }
  }, [searchParams, allPlayers, teamA.length, teamB.length])

  // Backfill names once allPlayers resolves (fixes "Player 12345" fallbacks from URL load)
  useEffect(() => {
    if (!allPlayers.length) return
    const resolve = (slots: PlayerSlot[]) =>
      slots.map((p) => {
        if (!p.name.startsWith('Player ')) return p
        const found = allPlayers.find((pl) => pl.player_id === p.id)
        return found ? { ...p, name: found.display_name } : p
      })
    setTeamA((prev) => resolve(prev))
    setTeamB((prev) => resolve(prev))
  }, [allPlayers])

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('mode')
    next.delete('best')
    if (teamA.length) next.set('a', encodeRoster(teamA))
    else next.delete('a')
    if (teamB.length) next.set('b', encodeRoster(teamB))
    else next.delete('b')
    setSearchParams(next, { replace: true })
  }, [teamA, teamB, searchParams, setSearchParams])

  const getPlayerSeasons = (playerId: number): string[] => {
    const rows = careerMap[playerId] ?? []
    return rows
      .map((r) => String(r.season ?? ''))
      .filter(Boolean)
      .reverse() // most recent first
  }

  const getBestSeason = (playerId: number): string => {
    const rows = (careerMap[playerId] ?? []) as Record<string, unknown>[]
    const best = pickBestRow(rows, 'composite')
    return String(best.season ?? '')
  }

  const resolveProfile = (slot: PlayerSlot): ProfileAgg => {
    const allRows = (careerMap[slot.id] ?? []) as Record<string, unknown>[]
    const rows = slot.season
      ? allRows.filter((r) => String(r.season ?? '') === slot.season)
      : allRows
    return buildProfile(rows, 'Career Avg', 'composite')
  }

  const sumTeam = (roster: PlayerSlot[]): ProfileAgg => {
    const z: ProfileAgg = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, ts_pct: 0 }
    for (const p of roster) {
      const s = resolveProfile(p)
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

  const totalsA = useMemo(() => sumTeam(teamA), [teamA, careerMap])
  const totalsB = useMemo(() => sumTeam(teamB), [teamB, careerMap])

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
    set([...current, { id, name: name ?? fallbackName, season: CURRENT_SEASON }])
  }

  const removePlayer = (team: 'A' | 'B', id: number) => {
    const set = team === 'A' ? setTeamA : setTeamB
    set((prev) => prev.filter((p) => p.id !== id))
  }

  const setPlayerSeason = (team: 'A' | 'B', id: number, season: string) => {
    const set = team === 'A' ? setTeamA : setTeamB
    set((prev) => prev.map((p) => (p.id === id ? { ...p, season } : p)))
  }

  const renderRoster = (roster: PlayerSlot[], team: 'A' | 'B') => {
    const hoverBorder = team === 'A' ? 'hover:border-nba-blue' : 'hover:border-nba-red'
    return roster.map((p) => {
      const seasons = getPlayerSeasons(p.id)
      const bestSeason = getBestSeason(p.id)
      const playerAwards = awardsMap[p.id] ?? {}
      const dropKey = `${team}-${p.id}`
      const isOpen = openDropdown === dropKey
      const seasonIcons = (s: string) =>
        (playerAwards[s] ?? []).map((tag) => AWARD_ICONS[tag]).filter(Boolean).join('')

      return (
        <div
          key={p.id}
          className={`flex items-center justify-between bg-surface-3 p-3 rounded-lg border border-border/50 group ${hoverBorder} transition-colors gap-3`}
        >
          <span className="font-medium text-sm flex-1 min-w-0 truncate">{p.name}</span>

          {seasons.length > 0 ? (
            <div className="relative shrink-0" ref={isOpen ? dropdownRef : undefined}>
              <button
                type="button"
                onClick={() => setOpenDropdown(isOpen ? null : dropKey)}
                className="flex items-center gap-1 bg-surface-2 border border-border rounded px-2 py-0.5 text-xs text-text-primary hover:border-border/80 transition-colors"
              >
                <span className="font-mono">{p.season}</span>
                {seasonIcons(p.season) && (
                  <span className="text-[11px] leading-none">{seasonIcons(p.season)}</span>
                )}
                <svg className="w-3 h-3 text-text-secondary ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-surface-2 border border-border rounded-lg shadow-xl overflow-hidden min-w-[148px] max-h-64 overflow-y-auto">
                  {seasons.map((s) => {
                    const icons = seasonIcons(s)
                    const isBest = s === bestSeason
                    const isSelected = s === p.season
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          setPlayerSeason(team, p.id, s)
                          setOpenDropdown(null)
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs hover:bg-surface-3 transition-colors ${
                          isSelected ? 'text-text-primary font-semibold' : 'text-text-secondary'
                        } ${isBest ? 'bg-amber-950/30' : ''}`}
                      >
                        <span className="font-mono">{s}</span>
                        <span className="flex items-center gap-1 shrink-0">
                          {icons && <span className="text-[11px] leading-none">{icons}</span>}
                          {isBest && (
                            <span className="text-[9px] font-bold uppercase tracking-wide text-amber-400 leading-none">
                              best
                            </span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <span className="text-xs text-text-secondary shrink-0 font-mono">{p.season || '—'}</span>
          )}

          <button
            type="button"
            onClick={() => removePlayer(team, p.id)}
            title="Remove player"
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-text-secondary hover:text-white hover:bg-nba-red transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )
    })
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Dream Team Builder</h1>
          <p className="text-text-secondary text-sm">
            Build two 5-man rosters and compare combined per-game stats. Pick a season per player — best season is highlighted in the dropdown.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
        {Object.entries(AWARD_ICONS).map(([tag, icon]) => (
          <span key={tag} className="flex items-center gap-1">
            <span>{icon}</span>
            <span>{{
              champion: 'Champion',
              fmvp: 'Finals MVP',
              mvp: 'MVP',
              roy: 'Rookie of the Year',
              smoy: 'Sixth Man',
            }[tag]}</span>
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-surface-2 rounded-xl border border-border p-6 space-y-6">
          <div className="flex items-center gap-3 border-b border-border pb-4">
            <div className="w-3 h-3 rounded-full bg-nba-blue shadow-[0_0_8px_rgba(23,64,139,0.6)]" />
            <h2 className="font-bold text-lg uppercase tracking-tight">Team Alpha</h2>
            <span className="ml-auto text-xs text-text-secondary font-mono">{teamA.length}/5</span>
          </div>

          <div className="space-y-3 min-h-[200px]">
            {renderRoster(teamA, 'A')}
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
            {renderRoster(teamB, 'B')}
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
          <WinnerVerdict totalsA={totalsA} totalsB={totalsB} hasA={teamA.length > 0} hasB={teamB.length > 0} />
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
