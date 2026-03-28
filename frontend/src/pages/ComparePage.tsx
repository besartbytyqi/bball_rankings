import { useState, useMemo, useCallback, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts'
import { fetchAllPlayers, fetchPlayerStats, fetchPlayerCareer, fetchPlayerSeasonAwards } from '@/api/players'
import { SeasonAwardIconsLegend, SeasonSelectWithBadges } from '@/components/ui/SeasonSelectWithBadges'
import { fetchTeams, fetchTeamStats, fetchTeamSeasonHistory } from '@/api/teams'
import { EntitySelector } from '@/components/ui/EntitySelector'
import { StatHeader } from '@/components/ui/StatHeader'
import { normalizeForRadar } from '@/utils/compareHelpers'
import { fmtStat, fmtPct, fmtCompareDelta } from '@/utils/formatters'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { AdditionalLocalStatsCompare } from '@/components/AdditionalLocalStats'
import { stableSeasonColors } from '@/utils/compareSeasonColors'
import type { CompareMode } from '@/types'

const COLORS = ['#C9082A', '#17408B', '#FDB927', '#10B981']

/** Entity name with chart swatch (red / blue); label text stays white for contrast on dark UI. */
function CompareSwatchLabel({
  label,
  fill,
  className = '',
  rightAlign = false,
}: {
  label: string
  fill: string
  className?: string
  rightAlign?: boolean
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 min-w-0 font-semibold text-white ${rightAlign ? 'justify-end' : ''} ${className}`}
    >
      <span className="w-2.5 h-2.5 rounded-sm shadow-sm shrink-0" style={{ backgroundColor: fill }} aria-hidden />
      <span className={`min-w-0 leading-tight max-w-[min(100%,14rem)] ${rightAlign ? 'text-right' : ''}`}>{label}</span>
    </span>
  )
}

/**
 * Recharts default legend tints labels with series fill; use explicit swatch + white text instead.
 */
function CompareChartLegend({ maxHeight = 56, paddingTop }: { maxHeight?: number; paddingTop?: number }) {
  return (
    <Legend
      wrapperStyle={{
        maxHeight,
        overflowY: 'auto',
        ...(paddingTop != null ? { paddingTop } : {}),
      }}
      content={({ payload }) => (
        <ul className="m-0 flex list-none flex-wrap justify-center gap-x-6 gap-y-1 py-1 pl-0">
          {payload?.map((entry, index) => (
            <li key={`legend-${index}-${String(entry.value)}`} className="flex items-center gap-2">
              <span
                className="inline-block h-3 w-3 shrink-0 rounded-sm shadow-sm"
                style={{ backgroundColor: entry.color }}
                aria-hidden
              />
              <span className="text-sm font-semibold text-white">{String(entry.value)}</span>
            </li>
          ))}
        </ul>
      )}
    />
  )
}

const PLAYER_TAB_COLS = {
  base: ['gp', 'min', 'pts', 'pts_per_min', 'reb', 'ast', 'stl', 'blk', 'fg_pct', 'fg3_pct', 'ft_pct', 'plus_minus'] as const,
  advanced: ['gp', 'min', 'ts_pct', 'usg_pct', 'off_rating', 'def_rating', 'net_rating', 'ast_pct', 'oreb_pct', 'dreb_pct', 'reb_pct', 'pie'] as const,
  defense: ['gp', 'min', 'stl', 'blk', 'dreb', 'dreb_pct', 'def_rating', 'opp_pts_paint', 'opp_pts_2nd_chance', 'opp_pts_off_tov', 'def_ws'] as const,
}
const PLAYER_COMPARE_EXCLUDE_KEYS = new Set<string>([
  'player_id', 'PLAYER_ID', 'season', 'stat_type', 'id', 'extra_stats',
  'team_abbreviation', 'TEAM_ABBREVIATION', 'team_id', 'TEAM_ID',
  ...PLAYER_TAB_COLS.base,
  ...PLAYER_TAB_COLS.advanced,
  ...PLAYER_TAB_COLS.defense,
])
const TEAM_COMPARE_TAB_KEYS: Record<'base' | 'advanced' | 'opponent', string[]> = {
  base: ['pts', 'reb', 'ast', 'stl', 'blk', 'fg_pct', 'fg3_pct', 'ft_pct'],
  advanced: ['gp', 'off_rating', 'def_rating', 'net_rating', 'pace', 'ts_pct', 'pie'],
  opponent: ['gp', 'opp_pts', 'opp_reb', 'opp_ast', 'opp_fg_pct', 'opp_fg3_pct'],
}
const TEAM_COMPARE_EXCLUDE_KEYS = new Set<string>([
  ...TEAM_COMPARE_TAB_KEYS.base,
  ...TEAM_COMPARE_TAB_KEYS.advanced,
  ...TEAM_COMPARE_TAB_KEYS.opponent,
  'team_id', 'TEAM_ID', 'season', 'stat_type', 'id', 'extra_stats', 'wins', 'losses',
])
const PLAYER_RADAR_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk']
const TEAM_RADAR_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk']

function CompareLegend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4 bg-surface-3 p-3 rounded-lg border border-border max-h-32 overflow-y-auto overscroll-contain">
      {items.map((item) => (
        <div key={item.name} className="flex items-center gap-2 min-w-0">
          <div className="w-3 h-3 rounded-sm shadow-sm shrink-0" style={{ backgroundColor: item.color }} />
          <span className="text-sm font-semibold text-white truncate">{item.name}</span>
        </div>
      ))}
    </div>
  )
}

/** Team compare: native select. Player compare: pass `awardsBySeason` for honor icons in list. */
function CompareSeasonPicker({
  seasons,
  value,
  onChange,
  teamMap,
  showCurrentSeason = true,
  awardsBySeason,
}: {
  seasons: string[]
  value: string | undefined
  onChange: (s: string | undefined) => void
  teamMap: Record<string, string>
  showCurrentSeason?: boolean
  awardsBySeason?: Record<string, string[]>
}) {
  if (awardsBySeason !== undefined) {
    return (
      <SeasonSelectWithBadges
        seasons={seasons}
        value={value}
        onChange={onChange}
        teamMap={teamMap}
        showCurrentSeason={showCurrentSeason}
        currentLabel="Current season (app)"
        awardsBySeason={awardsBySeason}
        variant="compare"
        aria-label="Season"
      />
    )
  }
  const selectValue = value ?? (showCurrentSeason ? 'current' : (seasons[0] ?? ''))
  return (
    <select
      value={selectValue}
      onChange={(e) => onChange(e.target.value === 'current' ? undefined : e.target.value)}
      className="bg-surface-3 border border-sky-500/35 rounded px-2 py-1 text-xs focus:outline-none focus:border-sky-400 max-w-[220px]"
      aria-label="Season"
    >
      {showCurrentSeason ? <option value="current">Current season (app)</option> : null}
      {seasons.map((s) => {
        const abbr = teamMap[s]
        return (
          <option key={s} value={s}>
            {abbr ? `${s} · ${abbr}` : s}
          </option>
        )
      })}
    </select>
  )
}

function compareSeasonLabel(name: string, season: string | undefined) {
  if (!season) return name
  return `${name} (${season})`
}

/** League-dash rows may use snake_case (DB) or UPPER_SNAKE (NBA API). */
function teamCompareRowNum(row: Record<string, unknown>, k: string): number {
  const v = row[k] ?? row[k.toUpperCase()]
  return Number(v ?? 0)
}

function teamRowRadarStats(row: Record<string, unknown>): Record<string, number | null> {
  const o: Record<string, number | null> = {}
  for (const k of TEAM_RADAR_KEYS) {
    o[k] = teamCompareRowNum(row, k)
  }
  return o
}

// ---------------------------------------------------------------------------
// Player vs Player comparison
// ---------------------------------------------------------------------------
function PlayerCompare({ p1Id, p2Id }: { p1Id: number; p2Id: number }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [statTab, setStatTab] = useState<'base' | 'advanced' | 'defense'>('base')
  const season1 = searchParams.get('s1') || undefined
  const season2 = searchParams.get('s2') || undefined

  const setSeasonParam = useCallback(
    (key: 's1' | 's2', value: string | undefined) => {
      const next = new URLSearchParams(searchParams)
      if (!value) next.delete(key)
      else next.set(key, value)
      setSearchParams(next)
    },
    [searchParams, setSearchParams],
  )
  const setSeason1 = useCallback((s: string | undefined) => setSeasonParam('s1', s), [setSeasonParam])
  const setSeason2 = useCallback((s: string | undefined) => setSeasonParam('s2', s), [setSeasonParam])

  const { data: players, isPending: playersPending } = useQuery({
    queryKey: ['players', 'all', true],
    queryFn: () => fetchAllPlayers({ includeInactive: true }),
    staleTime: 60 * 60 * 1000,
  })
  const { data: career1, isPending: career1Pending } = useQuery({
    queryKey: ['player', 'career', p1Id],
    queryFn: () => fetchPlayerCareer(p1Id),
    staleTime: 60 * 60 * 1000,
  })
  const { data: career2, isPending: career2Pending } = useQuery({
    queryKey: ['player', 'career', p2Id],
    queryFn: () => fetchPlayerCareer(p2Id),
    staleTime: 60 * 60 * 1000,
  })
  const { data: honors1 } = useQuery({
    queryKey: ['player', 'season-awards', p1Id],
    queryFn: () => fetchPlayerSeasonAwards(p1Id),
    staleTime: 24 * 60 * 60 * 1000,
  })
  const { data: honors2 } = useQuery({
    queryKey: ['player', 'season-awards', p2Id],
    queryFn: () => fetchPlayerSeasonAwards(p2Id),
    staleTime: 24 * 60 * 60 * 1000,
  })

  const teamBySeason = useMemo(() => {
    const build = (career: typeof career1) => {
      const m: Record<string, string> = {}
      for (const r of career ?? []) {
        const row = r as Record<string, unknown>
        const se = String(row.season ?? row.SEASON_ID ?? '')
        if (se) m[se] = String(row.team_abbreviation ?? row.TEAM_ABBREVIATION ?? '')
      }
      return m
    }
    return { p1: build(career1), p2: build(career2) }
  }, [career1, career2])

  const seasons1Raw = useMemo(
    () => (career1 ?? []).map((r) => String(r.season ?? r.SEASON_ID ?? '')).filter(Boolean).reverse(),
    [career1],
  )
  const seasons2Raw = useMemo(
    () => (career2 ?? []).map((r) => String(r.season ?? r.SEASON_ID ?? '')).filter(Boolean).reverse(),
    [career2],
  )

  const seasons1 = useMemo(() => {
    if (season1 && !seasons1Raw.includes(season1)) return [season1, ...seasons1Raw]
    return seasons1Raw
  }, [seasons1Raw, season1])

  const seasons2 = useMemo(() => {
    if (season2 && !seasons2Raw.includes(season2)) return [season2, ...seasons2Raw]
    return seasons2Raw
  }, [seasons2Raw, season2])

  const pMeta1 = players?.find((p) => p.player_id === p1Id)
  const pMeta2 = players?.find((p) => p.player_id === p2Id)
  const retired1 = pMeta1?.is_active === 0
  const retired2 = pMeta2?.is_active === 0
  const lastSeason1 = seasons1Raw[0]
  const lastSeason2 = seasons2Raw[0]

  const effectiveSeason1 = season1 ?? (retired1 && lastSeason1 ? lastSeason1 : undefined)
  const effectiveSeason2 = season2 ?? (retired2 && lastSeason2 ? lastSeason2 : undefined)

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    let changed = false
    if (retired1 && !searchParams.get('s1') && lastSeason1) {
      next.set('s1', lastSeason1)
      changed = true
    }
    if (retired2 && !searchParams.get('s2') && lastSeason2) {
      next.set('s2', lastSeason2)
      changed = true
    }
    if (changed) setSearchParams(next, { replace: true })
  }, [retired1, retired2, lastSeason1, lastSeason2, searchParams, setSearchParams])

  const waitCareer1 = retired1 && !season1 && career1Pending
  const waitCareer2 = retired2 && !season2 && career2Pending
  const enabledP1 = !playersPending && !waitCareer1
  const enabledP2 = !playersPending && !waitCareer2

  const { data: s1, isLoading: l1 } = useQuery({
    queryKey: ['player', 'stats', p1Id, effectiveSeason1 ?? 'current'],
    queryFn: () => fetchPlayerStats(p1Id, effectiveSeason1),
    enabled: enabledP1,
  })
  const { data: s2, isLoading: l2 } = useQuery({
    queryKey: ['player', 'stats', p2Id, effectiveSeason2 ?? 'current'],
    queryFn: () => fetchPlayerStats(p2Id, effectiveSeason2),
    enabled: enabledP2,
  })

  if (playersPending || waitCareer1 || waitCareer2 || l1 || l2) return <LoadingSpinner />

  const base1 = (s1?.base?.[0] ?? {}) as Record<string, number | null>
  const base2 = (s2?.base?.[0] ?? {}) as Record<string, number | null>
  const addPPM = (r: Record<string, unknown>): Record<string, unknown> => {
    const pts = Number(r.pts ?? 0); const min = Number(r.min ?? 0)
    return { ...r, pts_per_min: min > 0 ? pts / min : null }
  }
  const rowTab1 = addPPM((s1?.[statTab]?.[0] ?? {}) as Record<string, unknown>)
  const rowTab2 = addPPM((s2?.[statTab]?.[0] ?? {}) as Record<string, unknown>)
  const name1 = pMeta1?.display_name ?? `Player ${p1Id}`
  const name2 = pMeta2?.display_name ?? `Player ${p2Id}`
  const label1 = compareSeasonLabel(name1, effectiveSeason1)
  const label2 = compareSeasonLabel(name2, effectiveSeason2)

  const statKeys = [...PLAYER_TAB_COLS[statTab]]
  const radarEntities = [
    { id: p1Id, label: label1, stats: base1 as Record<string, number | null> },
    { id: p2Id, label: label2, stats: base2 as Record<string, number | null> },
  ]
  const radarData = normalizeForRadar(radarEntities, PLAYER_RADAR_KEYS)
  const radarChartData = PLAYER_RADAR_KEYS.map((k) => ({
    stat: k.toUpperCase(),
    [label1]: radarData[0]?.data[k] ?? 0,
    [label2]: radarData[1]?.data[k] ?? 0,
  }))

  const barData = statKeys.slice(0, 6).map((k) => ({
    stat: k.replace(/_/g, ' ').toUpperCase(),
    [label1]: Number(rowTab1[k] ?? 0),
    [label2]: Number(rowTab2[k] ?? 0),
  }))

  return (
    <div className="space-y-6">
      <CompareLegend items={[{ name: label1, color: COLORS[0] }, { name: label2, color: COLORS[1] }]} />

      {/* Season pickers — each player can be a different NBA season (URL: s1, s2) */}
      <div className="bg-surface-2 rounded-lg p-3 space-y-2">
        <p className="text-xs text-text-secondary">
          Choose a season per player to compare specific years (for example 2002-03 vs 2007-08). Seasons come from career data when available; the API fills gaps.
          Retired players default to their most recent season instead of the app&apos;s current year.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <CompareSwatchLabel label={name1} fill={COLORS[0]} className="text-xs shrink-0" />
            <CompareSeasonPicker
              seasons={seasons1}
              value={effectiveSeason1}
              onChange={setSeason1}
              teamMap={teamBySeason.p1}
              showCurrentSeason={!retired1}
              awardsBySeason={honors1?.by_season ?? {}}
            />
            {!retired1 && season1 ? (
              <button
                type="button"
                onClick={() => setSeason1(undefined)}
                className="text-xs text-text-secondary hover:text-text-primary"
                aria-label="Clear season for player 1"
              >
                ✕
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CompareSwatchLabel label={name2} fill={COLORS[1]} className="text-xs shrink-0" />
            <CompareSeasonPicker
              seasons={seasons2}
              value={effectiveSeason2}
              onChange={setSeason2}
              teamMap={teamBySeason.p2}
              showCurrentSeason={!retired2}
              awardsBySeason={honors2?.by_season ?? {}}
            />
            {!retired2 && season2 ? (
              <button
                type="button"
                onClick={() => setSeason2(undefined)}
                className="text-xs text-text-secondary hover:text-text-primary"
                aria-label="Clear season for player 2"
              >
                ✕
              </button>
            ) : null}
          </div>
        </div>
        <div className="pt-3 mt-1 border-t border-border/60 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">Season list icons</p>
          <SeasonAwardIconsLegend />
        </div>
      </div>

      <div className="bg-surface-2 rounded-lg p-2 flex flex-wrap gap-2">
        {(['base', 'advanced', 'defense'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setStatTab(t)}
            className={`px-3 py-1 text-xs rounded border capitalize ${
              statTab === t ? 'bg-sky-600 border-sky-500 text-white' : 'bg-surface-3 border-border text-text-secondary hover:text-text-primary'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Radar */}
      <div className="bg-surface-2 rounded-lg p-4">
        <h3 className="text-sm font-semibold mb-4 text-text-secondary">Normalized comparison (0–100)</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarChartData}>
              <PolarGrid stroke="#374151" />
              <PolarAngleAxis dataKey="stat" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
              {[label1, label2].map((n, i) => (
                <Radar key={n} name={n} dataKey={n} stroke={COLORS[i]} fill={COLORS[i]} fillOpacity={0.15} />
              ))}
              <CompareChartLegend />
              <Tooltip contentStyle={{ background: '#1F2937', border: '1px solid #374151', borderRadius: 8 }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bar chart */}
      <div className="bg-surface-2 rounded-lg p-4">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="stat" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#1F2937', border: '1px solid #374151', borderRadius: 8 }} />
              <CompareChartLegend />
              <Bar dataKey={label1} fill={COLORS[0]} />
              <Bar dataKey={label2} fill={COLORS[1]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Side-by-side table: P1 value (Δ) | Stat | (Δ) P2 value */}
      <div className="bg-surface-2 rounded-lg p-4 overflow-x-auto">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[32%]" />
            <col className="w-[34%]" />
          </colgroup>
          <thead>
            <tr className="text-text-secondary border-b border-border">
              <th className="text-left py-1.5 pr-2">
                <CompareSwatchLabel label={label1} fill={COLORS[0]} className="text-sm" />
              </th>
              <th className="text-center py-1.5 px-2 text-xs font-semibold text-text-secondary">Stat</th>
              <th className="text-right py-1.5 pl-2">
                <div className="flex justify-end">
                  <CompareSwatchLabel label={label2} fill={COLORS[1]} className="text-sm" rightAlign />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {statKeys.map((k) => {
              const v1 = Number(rowTab1[k] ?? 0)
              const v2 = Number(rowTab2[k] ?? 0)
              const isPct = k.includes('pct')
              const decimals = k === 'pts_per_min' ? 3 : 1
              const higherBetter = (a: number, b: number) => {
                if (statTab === 'defense' && (k === 'def_rating' || k.includes('opp_'))) return a < b
                return a > b
              }
              const d12 = fmtCompareDelta(v1, v2, isPct)
              const d21 = fmtCompareDelta(v2, v1, isPct)
              return (
                <tr
                  key={k}
                  className="border-b border-border/40 transition-colors hover:bg-surface-3/55"
                >
                  <td className="py-1.5 pr-2 text-left tabular-nums">
                    <span className={`font-medium ${higherBetter(v1, v2) ? 'text-nba-gold' : 'text-text-primary'}`}>
                      {isPct ? fmtPct(v1) : fmtStat(v1, decimals)}
                      {d12 !== '—' ? (
                        <span className="text-text-secondary font-normal text-[0.85em]"> ({d12})</span>
                      ) : null}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-center text-text-secondary uppercase text-xs">{k.replace(/_/g, ' ')}</td>
                  <td className="py-1.5 pl-2 text-right tabular-nums">
                    <span className={`font-medium ${higherBetter(v2, v1) ? 'text-nba-gold' : 'text-text-primary'}`}>
                      {d21 !== '—' ? (
                        <span className="text-text-secondary font-normal text-[0.85em]">({d21}) </span>
                      ) : null}
                      {isPct ? fmtPct(v2) : fmtStat(v2, decimals)}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <AdditionalLocalStatsCompare
        rowA={rowTab1}
        rowB={rowTab2}
        excludeKeys={PLAYER_COMPARE_EXCLUDE_KEYS}
        labelA={name1}
        labelB={name2}
      />

      {/* Profile links */}
      <div className="flex flex-wrap gap-4">
        <Link to={`/players/${p1Id}`} className="text-sm text-sky-400 hover:text-sky-300 hover:underline">
          View {name1} profile →
        </Link>
        <Link to={`/players/${p2Id}`} className="text-sm text-sky-400 hover:text-sky-300 hover:underline">
          View {name2} profile →
        </Link>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Career seasons comparison
// ---------------------------------------------------------------------------
function CareerCompare({ p1Id }: { p1Id: number }) {
  const [selectedSeasons, setSelectedSeasons] = useState<string[]>([])
  const [groupByTeam, setGroupByTeam] = useState(false)
  const [compareEras, setCompareEras] = useState(false)
  const [eraA, setEraA] = useState<string[]>([])
  const [eraB, setEraB] = useState<string[]>([])

  const { data: career, isLoading } = useQuery({ queryKey: ['player','career', p1Id], queryFn: () => fetchPlayerCareer(p1Id), staleTime: 60*60*1000 })
  const { data: players } = useQuery({
    queryKey: ['players', 'all', true],
    queryFn: () => fetchAllPlayers({ includeInactive: true }),
    staleTime: 60 * 60 * 1000,
  })
  const name = players?.find((p) => p.player_id === p1Id)?.display_name ?? `Player ${p1Id}`

  if (isLoading) return <LoadingSpinner />

  const seasons = (career ?? []).map((r) => String(r.season ?? r.SEASON_ID ?? ''))

  const toggleSeason = (s: string, era?: 'A' | 'B') => {
    if (era === 'A') {
      setEraA(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
    } else if (era === 'B') {
      setEraB(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
    } else {
      setSelectedSeasons((prev) =>
        prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
      )
    }
  }

  const computeAvg = (seasonList: string[]) => {
    if (!career || !seasonList.length) return null
    const filtered = (career as Record<string, unknown>[]).filter(r => seasonList.includes(String(r.season ?? r.SEASON_ID ?? '')))
    if (!filtered.length) return null
    const res: Record<string, any> = { season: 'Era', gp: 0, pts_total: 0, reb_total: 0, ast_total: 0, stl_total: 0, blk_total: 0 }
    for (const r of filtered) {
      const gp = Number(r.gp ?? 0)
      res.gp += gp
      res.pts_total += Number(r.pts ?? 0) * gp
      res.reb_total += Number(r.reb ?? 0) * gp
      res.ast_total += Number(r.ast ?? 0) * gp
      res.stl_total += Number(r.stl ?? 0) * gp
      res.blk_total += Number(r.blk ?? 0) * gp
    }
    return {
      gp: res.gp,
      pts: res.gp ? res.pts_total / res.gp : 0,
      reb: res.gp ? res.reb_total / res.gp : 0,
      ast: res.gp ? res.ast_total / res.gp : 0,
      stl: res.gp ? res.stl_total / res.gp : 0,
      blk: res.gp ? res.blk_total / res.gp : 0,
    }
  }

  // Group by team logic
  const teamStints = useMemo(() => {
    if (!career) return []
    const stints: Record<string, any> = {}
    for (const r of career as Record<string, unknown>[]) {
      const t = (r.team_abbreviation as string) || 'UNK'
      if (!stints[t]) {
        stints[t] = { team: t, gp: 0, pts_total: 0, reb_total: 0, ast_total: 0, stl_total: 0, blk_total: 0 }
      }
      const gp = Number(r.gp ?? 0)
      stints[t].gp += gp
      stints[t].pts_total += Number(r.pts ?? 0) * gp
      stints[t].reb_total += Number(r.reb ?? 0) * gp
      stints[t].ast_total += Number(r.ast ?? 0) * gp
      stints[t].stl_total += Number(r.stl ?? 0) * gp
      stints[t].blk_total += Number(r.blk ?? 0) * gp
    }
    return Object.values(stints).map(s => ({
      season: s.team, 
      team_abbreviation: s.team,
      gp: s.gp,
      pts: s.gp ? s.pts_total / s.gp : 0,
      reb: s.gp ? s.reb_total / s.gp : 0,
      ast: s.gp ? s.ast_total / s.gp : 0,
      stl: s.gp ? s.stl_total / s.gp : 0,
      blk: s.gp ? s.blk_total / s.gp : 0,
    }))
  }, [career])

  const eraAStats = useMemo(() => computeAvg(eraA), [eraA, career])
  const eraBStats = useMemo(() => computeAvg(eraB), [eraB, career])

  const displayData = compareEras
    ? [{ ...eraAStats, season: 'Era A' }, { ...eraBStats, season: 'Era B' }].filter((x) => x.gp > 0)
    : groupByTeam
      ? teamStints
      : (() => {
          const rows = (career ?? []).filter((r) =>
            selectedSeasons.includes(String(r.season ?? r.SEASON_ID ?? '')),
          )
          const ord = (r: Record<string, unknown>) =>
            selectedSeasons.indexOf(String(r.season ?? r.SEASON_ID ?? ''))
          return [...rows].sort((a, b) => ord(a as Record<string, unknown>) - ord(b as Record<string, unknown>))
        })()
  
  const displaySeasons = compareEras 
    ? displayData.map(d => d.season)
    : groupByTeam 
      ? teamStints.map(s => s.team_abbreviation) 
      : selectedSeasons

  const seasonColors = useMemo(
    () => stableSeasonColors(displaySeasons),
    [displaySeasons.join('\0')],
  )
  const chipColors = useMemo(
    () => stableSeasonColors(selectedSeasons),
    [selectedSeasons.join('\0')],
  )

  const statKeys = ['pts','reb','ast','stl','blk']
  const barData = statKeys.map((k) => {
    const entry: Record<string, unknown> = { stat: k.toUpperCase() }
    for (const r of displayData) {
      const rr = r as Record<string, unknown>
      const key = String(rr.season ?? rr.SEASON_ID ?? '')
      entry[key] = Number(rr[k] ?? 0)
    }
    return entry
  })

  return (
    <div className="space-y-6">
      <div className="bg-surface-2 rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold">
            {name} — {compareEras ? 'Compare Eras' : groupByTeam ? 'Team Stints' : 'Select seasons to compare'}
          </h3>
          <div className="flex flex-wrap gap-2">
            {!compareEras && !groupByTeam && (
              <button
                type="button"
                onClick={() => setSelectedSeasons(Array.from(new Set(seasons.filter(Boolean))))}
                className="text-xs px-2 py-1 rounded border bg-surface-3 border-emerald-600/40 text-emerald-200/90 hover:border-emerald-500/60 hover:text-emerald-100"
              >
                Select all
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setCompareEras(!compareEras)
                if (!compareEras) {
                  setGroupByTeam(false)
                  setSelectedSeasons([])
                }
              }}
              className={`text-xs px-2 py-1 rounded border ${compareEras ? 'bg-nba-gold text-black border-nba-gold' : 'bg-surface-3 border-border text-text-secondary hover:text-text-primary'}`}
            >
              {compareEras ? 'View Normal' : 'Compare Eras'}
            </button>
            <button
              type="button"
              onClick={() => {
                setGroupByTeam(!groupByTeam)
                if (!groupByTeam) {
                  setCompareEras(false)
                  setSelectedSeasons([])
                }
              }}
              className={`text-xs px-2 py-1 rounded border ${groupByTeam ? 'bg-nba-blue text-white border-nba-blue' : 'bg-surface-3 border-border text-text-secondary hover:text-text-primary'}`}
            >
              {groupByTeam ? 'View Seasons' : 'Group by Team'}
            </button>
          </div>
        </div>

        {compareEras && (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wider">Era A (Blue)</p>
              <div className="flex flex-wrap gap-2">
                {seasons.map(s => (
                  <button key={s} onClick={() => toggleSeason(s, 'A')} className={`px-2 py-1 text-[10px] rounded border ${eraA.includes(s) ? 'bg-nba-blue text-white border-nba-blue' : 'border-border text-text-secondary'}`}>{s}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wider">Era B (Rose)</p>
              <div className="flex flex-wrap gap-2">
                {seasons.map(s => (
                  <button key={s} onClick={() => toggleSeason(s, 'B')} className={`px-2 py-1 text-[10px] rounded border ${eraB.includes(s) ? 'bg-rose-700 text-white border-rose-600' : 'border-border text-text-secondary'}`}>{s}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {!groupByTeam && !compareEras && (
          <div className="flex flex-wrap gap-2">
            {seasons.map((s) => {
              const isSelected = selectedSeasons.includes(s)
              const color = chipColors[s]
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSeason(s)}
                  className="px-2 py-1 text-xs rounded border transition-colors"
                  style={
                    isSelected && color
                      ? { backgroundColor: color, borderColor: color, color: '#fff' }
                      : { borderColor: '#374151', color: '#9CA3AF' }
                  }
                >
                  {s}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {(groupByTeam || compareEras || displaySeasons.length >= 1) && displayData.length > 0 && (
        <div className="space-y-6">
          {displaySeasons.length === 1 && !compareEras && !groupByTeam ? (
            <p className="text-xs text-text-secondary bg-surface-2 rounded-lg px-3 py-2 border border-border">
              One season selected — the chart and table use a single column. Add another season to compare side by side.
            </p>
          ) : null}
          <CompareLegend items={displaySeasons.map((s) => ({ name: s, color: seasonColors[s] }))} />
          
          <div className="bg-surface-2 rounded-lg p-4 overflow-x-auto">
            <div className="h-64 min-w-[min(100%,520px)]" style={{ minWidth: `${Math.min(56 * displaySeasons.length + 200, 1400)}px` }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="stat" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#1F2937', border: '1px solid #374151', borderRadius: 8 }} />
                  <CompareChartLegend maxHeight={72} paddingTop={8} />
                  {displaySeasons.map((s) => (
                    <Bar key={s} dataKey={s} fill={seasonColors[s]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-surface-2 rounded-lg p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-text-secondary border-b border-border">
                  <StatHeader colKey="stat" label="Stat" align="left" className="py-1.5 w-16" />
                  {displaySeasons.map((s) => (
                    <th key={s} className="text-right py-1.5 px-3 font-semibold whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: seasonColors[s] }} />
                        <span className="text-text-primary">{s}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statKeys.map((k) => {
                  const vals = displayData.map((r) => Number((r as Record<string, unknown>)[k] ?? 0))
                  const maxVal = Math.max(...vals)
                  return (
                    <tr key={k} className="border-b border-border/40">
                      <td className="py-1.5 text-text-secondary uppercase text-xs">{k}</td>
                      {displayData.map((r) => {
                        const rr = r as Record<string, unknown>
                        const s = String(rr.season ?? rr.SEASON_ID ?? '')
                        const v = Number(rr[k] ?? 0)
                        return (
                          <td key={s} className={`py-1.5 px-3 text-right tabular-nums font-medium ${v === maxVal ? 'text-nba-gold' : ''}`}>
                            {v.toFixed(1)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Team vs Team comparison
// ---------------------------------------------------------------------------
function TeamCompare({ t1Id, t2Id }: { t1Id: number; t2Id: number }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [teamStatTab, setTeamStatTab] = useState<'base' | 'advanced' | 'opponent'>('base')
  const season1 = searchParams.get('ts1') || undefined
  const season2 = searchParams.get('ts2') || undefined

  const setTeamSeasonParam = useCallback(
    (key: 'ts1' | 'ts2', value: string | undefined) => {
      const next = new URLSearchParams(searchParams)
      if (!value) next.delete(key)
      else next.set(key, value)
      setSearchParams(next)
    },
    [searchParams, setSearchParams],
  )
  const setTSeason1 = useCallback((s: string | undefined) => setTeamSeasonParam('ts1', s), [setTeamSeasonParam])
  const setTSeason2 = useCallback((s: string | undefined) => setTeamSeasonParam('ts2', s), [setTeamSeasonParam])

  const { data: stats1, isLoading: l1 } = useQuery({
    queryKey: ['team-stats', season1 ?? 'current'],
    queryFn: () => fetchTeamStats(season1),
  })
  const { data: stats2, isLoading: l2 } = useQuery({
    queryKey: ['team-stats', season2 ?? 'current'],
    queryFn: () => fetchTeamStats(season2),
  })
  const { data: teams } = useQuery({ queryKey: ['teams'], queryFn: fetchTeams, staleTime: Infinity })
  const { data: hist1 } = useQuery({
    queryKey: ['team', 'season-history', t1Id],
    queryFn: () => fetchTeamSeasonHistory(t1Id),
    staleTime: 60 * 60 * 1000,
  })
  const { data: hist2 } = useQuery({
    queryKey: ['team', 'season-history', t2Id],
    queryFn: () => fetchTeamSeasonHistory(t2Id),
    staleTime: 60 * 60 * 1000,
  })

  const abbr1 = teams?.find((t) => t.id === t1Id)?.abbr ?? ''
  const abbr2 = teams?.find((t) => t.id === t2Id)?.abbr ?? ''

  const seasons1Raw = useMemo(
    () =>
      (hist1 ?? [])
        .map((r) => String((r as Record<string, unknown>).season ?? ''))
        .filter(Boolean)
        .reverse(),
    [hist1],
  )
  const seasons2Raw = useMemo(
    () =>
      (hist2 ?? [])
        .map((r) => String((r as Record<string, unknown>).season ?? ''))
        .filter(Boolean)
        .reverse(),
    [hist2],
  )

  const seasons1 = useMemo(() => {
    if (season1 && !seasons1Raw.includes(season1)) return [season1, ...seasons1Raw]
    return seasons1Raw
  }, [seasons1Raw, season1])

  const seasons2 = useMemo(() => {
    if (season2 && !seasons2Raw.includes(season2)) return [season2, ...seasons2Raw]
    return seasons2Raw
  }, [seasons2Raw, season2])

  const teamMap1 = useMemo(
    () => Object.fromEntries(seasons1.map((s) => [s, abbr1])),
    [seasons1, abbr1],
  )
  const teamMap2 = useMemo(
    () => Object.fromEntries(seasons2.map((s) => [s, abbr2])),
    [seasons2, abbr2],
  )

  if (l1 || l2) return <LoadingSpinner />

  const baseRows1 = (stats1?.base ?? []) as Record<string, unknown>[]
  const baseRows2 = (stats2?.base ?? []) as Record<string, unknown>[]
  const br1 = baseRows1.find((r) => Number(r.team_id ?? r.TEAM_ID) === t1Id) ?? {}
  const br2 = baseRows2.find((r) => Number(r.team_id ?? r.TEAM_ID) === t2Id) ?? {}

  const pickTeamRow = (
    stats: typeof stats1,
    tid: number,
    tab: 'base' | 'advanced' | 'opponent',
  ) => {
    const rows = (stats?.[tab] ?? []) as Record<string, unknown>[]
    return rows.find((r) => Number(r.team_id ?? r.TEAM_ID) === tid) ?? {}
  }
  const b1 = pickTeamRow(stats1, t1Id, teamStatTab)
  const b2 = pickTeamRow(stats2, t2Id, teamStatTab)
  const name1 = teams?.find((t) => t.id === t1Id)?.name ?? `Team ${t1Id}`
  const name2 = teams?.find((t) => t.id === t2Id)?.name ?? `Team ${t2Id}`
  const label1 = compareSeasonLabel(name1, season1)
  const label2 = compareSeasonLabel(name2, season2)

  const statKeys = TEAM_COMPARE_TAB_KEYS[teamStatTab]
  const radarEntities = [
    { id: t1Id, label: label1, stats: teamRowRadarStats(br1) },
    { id: t2Id, label: label2, stats: teamRowRadarStats(br2) },
  ]
  const radarData = normalizeForRadar(radarEntities, TEAM_RADAR_KEYS)
  const radarChartData = TEAM_RADAR_KEYS.map((k) => ({
    stat: k.toUpperCase(),
    [label1]: radarData[0]?.data[k] ?? 0,
    [label2]: radarData[1]?.data[k] ?? 0,
  }))

  const barData = statKeys.slice(0, 5).map((k) => ({
    stat: k.replace(/_/g, ' ').toUpperCase(),
    [label1]: teamCompareRowNum(b1, k),
    [label2]: teamCompareRowNum(b2, k),
  }))

  const teamLowerIsBetter = (k: string) =>
    (teamStatTab === 'advanced' && k === 'def_rating') ||
    (teamStatTab === 'opponent' && k.startsWith('opp_'))

  return (
    <div className="space-y-6">
      <CompareLegend items={[{ name: label1, color: COLORS[0] }, { name: label2, color: COLORS[1] }]} />

      <div className="bg-surface-2 rounded-lg p-3 space-y-2">
        <p className="text-xs text-text-secondary">
          Pick a season for each franchise (e.g. 2015-16 vs 2023-24). URL params{' '}
          <code className="text-[10px] bg-surface-3 px-1 rounded">ts1</code> and{' '}
          <code className="text-[10px] bg-surface-3 px-1 rounded">ts2</code> match the app season string.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <CompareSwatchLabel label={name1} fill={COLORS[0]} className="text-xs shrink-0" />
            <CompareSeasonPicker seasons={seasons1} value={season1} onChange={setTSeason1} teamMap={teamMap1} />
            {season1 ? (
              <button
                type="button"
                onClick={() => setTSeason1(undefined)}
                className="text-xs text-text-secondary hover:text-text-primary"
                aria-label="Clear season for team 1"
              >
                ✕
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CompareSwatchLabel label={name2} fill={COLORS[1]} className="text-xs shrink-0" />
            <CompareSeasonPicker seasons={seasons2} value={season2} onChange={setTSeason2} teamMap={teamMap2} />
            {season2 ? (
              <button
                type="button"
                onClick={() => setTSeason2(undefined)}
                className="text-xs text-text-secondary hover:text-text-primary"
                aria-label="Clear season for team 2"
              >
                ✕
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="bg-surface-2 rounded-lg p-2 flex flex-wrap gap-2">
        {(['base', 'advanced', 'opponent'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTeamStatTab(t)}
            className={`px-3 py-1 text-xs rounded border capitalize ${
              teamStatTab === t ? 'bg-sky-600 border-sky-500 text-white' : 'bg-surface-3 border-border text-text-secondary hover:text-text-primary'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="bg-surface-2 rounded-lg p-4">
        <h3 className="text-sm font-semibold mb-4 text-text-secondary">Normalized comparison (0–100)</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarChartData}>
              <PolarGrid stroke="#374151" />
              <PolarAngleAxis dataKey="stat" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
              {[label1, label2].map((n, i) => (
                <Radar key={n} name={n} dataKey={n} stroke={COLORS[i]} fill={COLORS[i]} fillOpacity={0.15} />
              ))}
              <CompareChartLegend />
              <Tooltip contentStyle={{ background: '#1F2937', border: '1px solid #374151', borderRadius: 8 }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-surface-2 rounded-lg p-4">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="stat" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#1F2937', border: '1px solid #374151', borderRadius: 8 }} />
              <CompareChartLegend />
              <Bar dataKey={label1} fill={COLORS[0]} />
              <Bar dataKey={label2} fill={COLORS[1]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-surface-2 rounded-lg p-4 overflow-x-auto">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[32%]" />
            <col className="w-[34%]" />
          </colgroup>
          <thead>
            <tr className="text-text-secondary border-b border-border">
              <th className="text-left py-1.5 pr-2">
                <CompareSwatchLabel label={label1} fill={COLORS[0]} className="text-sm" />
              </th>
              <th className="text-center py-1.5 px-2 text-xs font-semibold text-text-secondary">Stat</th>
              <th className="text-right py-1.5 pl-2">
                <div className="flex justify-end">
                  <CompareSwatchLabel label={label2} fill={COLORS[1]} className="text-sm" rightAlign />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {statKeys.map((k) => {
              const v1 = teamCompareRowNum(b1, k)
              const v2 = teamCompareRowNum(b2, k)
              const isPct = k.includes('pct')
              const lb = teamLowerIsBetter(k)
              const p1Win = lb ? v1 < v2 : v1 > v2
              const p2Win = lb ? v2 < v1 : v2 > v1
              const d12 = fmtCompareDelta(v1, v2, isPct)
              const d21 = fmtCompareDelta(v2, v1, isPct)
              return (
                <tr key={k} className="border-b border-border/40 transition-colors hover:bg-surface-3/55">
                  <td className="py-1.5 pr-2 text-left tabular-nums">
                    <span className={`font-medium ${p1Win ? 'text-nba-gold' : 'text-text-primary'}`}>
                      {isPct ? fmtPct(v1) : fmtStat(v1)}
                      {d12 !== '—' ? (
                        <span className="text-text-secondary font-normal text-[0.85em]"> ({d12})</span>
                      ) : null}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-center text-text-secondary uppercase text-xs">{k.replace(/_/g, ' ')}</td>
                  <td className="py-1.5 pl-2 text-right tabular-nums">
                    <span className={`font-medium ${p2Win ? 'text-nba-gold' : 'text-text-primary'}`}>
                      {d21 !== '—' ? (
                        <span className="text-text-secondary font-normal text-[0.85em]">({d21}) </span>
                      ) : null}
                      {isPct ? fmtPct(v2) : fmtStat(v2)}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <AdditionalLocalStatsCompare
        rowA={b1}
        rowB={b2}
        excludeKeys={TEAM_COMPARE_EXCLUDE_KEYS}
        labelA={name1}
        labelB={name2}
      />

      <div className="flex flex-wrap gap-4">
        <Link to={`/teams/${t1Id}`} className="text-sm text-sky-400 hover:text-sky-300 hover:underline">
          View {name1} profile →
        </Link>
        <Link to={`/teams/${t2Id}`} className="text-sm text-sky-400 hover:text-sky-300 hover:underline">
          View {name2} profile →
        </Link>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Team — season-over-season comparison
// ---------------------------------------------------------------------------
function TeamCareerCompare({ teamId }: { teamId: number }) {
  const [selectedSeasons, setSelectedSeasons] = useState<string[]>([])

  const { data: history, isLoading } = useQuery({
    queryKey: ['team', 'season-history', teamId],
    queryFn: () => fetchTeamSeasonHistory(teamId),
    staleTime: 60 * 60 * 1000,
  })
  const { data: teams } = useQuery({ queryKey: ['teams'], queryFn: fetchTeams, staleTime: Infinity })

  const name = teams?.find((t) => t.id === teamId)?.name ?? `Team ${teamId}`

  if (isLoading) return <LoadingSpinner />

  const seasons = [
    ...new Set((history ?? []).map((r) => String((r as Record<string, unknown>).season ?? '')).filter(Boolean)),
  ].sort()

  const toggleSeason = (s: string) => {
    setSelectedSeasons((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    )
  }

  const displayData = (() => {
    const rows = (history ?? []).filter((r) =>
      selectedSeasons.includes(String((r as Record<string, unknown>).season ?? '')),
    )
    const ord = (r: Record<string, unknown>) => selectedSeasons.indexOf(String(r.season ?? ''))
    return [...rows].sort((a, b) => ord(a as Record<string, unknown>) - ord(b as Record<string, unknown>))
  })()
  const displaySeasons = selectedSeasons.filter((s) =>
    displayData.some((r) => String((r as Record<string, unknown>).season ?? '') === s)
  )

  const seasonColors = useMemo(
    () => stableSeasonColors(displaySeasons),
    [displaySeasons.join('\0')],
  )
  const teamCareerChipColors = useMemo(
    () => stableSeasonColors(selectedSeasons),
    [selectedSeasons.join('\0')],
  )

  const statKeys = ['pts', 'reb', 'ast', 'stl', 'blk', 'fg_pct', 'wins', 'losses'] as const
  const barData = statKeys.map((k) => {
    const entry: Record<string, unknown> = { stat: k.replace('_', ' ').toUpperCase() }
    for (const r of displayData) {
      const season = String((r as Record<string, unknown>).season ?? '')
      entry[season] = Number((r as Record<string, unknown>)[k] ?? 0)
    }
    return entry
  })

  return (
    <div className="space-y-6">
      <div className="bg-surface-2 rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold">{name} — select seasons to compare</h3>
          <button
            type="button"
            onClick={() => setSelectedSeasons([...seasons])}
            className="text-xs px-2 py-1 rounded border bg-surface-3 border-emerald-600/40 text-emerald-200/90 hover:border-emerald-500/60 hover:text-emerald-100 shrink-0"
          >
            Select all
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {seasons.map((s) => {
            const isSelected = selectedSeasons.includes(s)
            const color = teamCareerChipColors[s]
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleSeason(s)}
                className="px-2 py-1 text-xs rounded border transition-colors"
                style={
                  isSelected && color
                    ? { backgroundColor: color, borderColor: color, color: '#fff' }
                    : { borderColor: '#374151', color: '#9CA3AF' }
                }
              >
                {s}
              </button>
            )
          })}
        </div>
      </div>

      {displaySeasons.length >= 1 && displayData.length > 0 && (
        <div className="space-y-6">
          {displaySeasons.length === 1 ? (
            <p className="text-xs text-text-secondary bg-surface-2 rounded-lg px-3 py-2 border border-border">
              One season selected — add another year to compare franchise stats side by side.
            </p>
          ) : null}
          <CompareLegend items={displaySeasons.map((s) => ({ name: s, color: seasonColors[s] }))} />

          <div className="bg-surface-2 rounded-lg p-4 overflow-x-auto">
            <div className="h-64 min-w-[min(100%,520px)]" style={{ minWidth: `${Math.min(56 * displaySeasons.length + 200, 1400)}px` }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="stat" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#1F2937', border: '1px solid #374151', borderRadius: 8 }} />
                  <CompareChartLegend maxHeight={72} paddingTop={8} />
                  {displaySeasons.map((s) => (
                    <Bar key={s} dataKey={s} fill={seasonColors[s]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-surface-2 rounded-lg p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-text-secondary border-b border-border">
                  <StatHeader colKey="stat" label="Stat" align="left" className="py-1.5 w-16" />
                  {displaySeasons.map((s) => (
                    <th key={s} className="text-right py-1.5 px-3 font-semibold whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: seasonColors[s] }} />
                        <span className="text-text-primary">{s}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statKeys.map((k) => {
                  const vals = displayData.map((r) => Number((r as Record<string, unknown>)[k] ?? 0))
                  const maxVal = Math.max(...vals)
                  const isPct = k === 'fg_pct'
                  return (
                    <tr key={k} className="border-b border-border/40">
                      <td className="py-1.5 text-text-secondary uppercase text-xs">{k.replace(/_/g, ' ')}</td>
                      {displayData.map((r) => {
                        const rr = r as Record<string, unknown>
                        const s = String(rr.season ?? '')
                        const v = Number(rr[k] ?? 0)
                        return (
                          <td
                            key={s}
                            className={`py-1.5 px-3 text-right tabular-nums font-medium ${v === maxVal && vals.length > 0 ? 'text-nba-gold' : ''}`}
                          >
                            {isPct ? fmtPct(v) : k === 'wins' || k === 'losses' ? String(Math.round(v)) : v.toFixed(1)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Compare page
// ---------------------------------------------------------------------------
export default function ComparePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const mode = (searchParams.get('mode') ?? 'player') as CompareMode
  const p1 = Number(searchParams.get('p1') ?? 0) || undefined
  const p2 = Number(searchParams.get('p2') ?? 0) || undefined
  const t1 = Number(searchParams.get('t1') ?? 0) || undefined
  const t2 = Number(searchParams.get('t2') ?? 0) || undefined

  const setMode = (m: CompareMode) => {
    const next = new URLSearchParams(searchParams)
    next.set('mode', m)
    setSearchParams(next)
  }
  const setParam = (key: string, id: number) => {
    const next = new URLSearchParams(searchParams)
    if (!id) next.delete(key)
    else next.set(key, String(id))
    setSearchParams(next)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Compare</h1>

      {/* Mode selector */}
      <div className="flex flex-wrap gap-2 mb-6">
        {(['player', 'team', 'career', 'team-career'] as CompareMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-2 text-sm rounded transition-colors ${mode === m ? 'bg-sky-600 text-white' : 'bg-surface-2 text-text-secondary hover:text-text-primary'}`}
          >
            {m === 'player'
              ? 'Player vs Player'
              : m === 'team'
                ? 'Team vs Team'
                : m === 'career'
                  ? 'Player career'
                  : 'Team seasons'}
          </button>
        ))}
      </div>

      {mode === 'player' && (
        <div className="space-y-6">
          <p className="text-sm text-text-secondary -mt-2 mb-1">
            Use <strong className="text-text-primary font-medium">Player vs Player</strong> to line up two athletes; after both are selected, pick a season for each side (or share a link with <code className="text-xs bg-surface-3 px-1 rounded">s1</code> and{' '}
            <code className="text-xs bg-surface-3 px-1 rounded">s2</code> query params, e.g. <code className="text-xs bg-surface-3 px-1 rounded">2002-03</code>).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <EntitySelector type="player" label="Player 1" selectedId={p1} includeInactive onSelect={(id) => setParam('p1', id)} />
            <EntitySelector type="player" label="Player 2" selectedId={p2} includeInactive onSelect={(id) => setParam('p2', id)} />
          </div>
          {p1 && p2 ? <PlayerCompare p1Id={p1} p2Id={p2} /> : <p className="text-text-secondary text-sm">Select two players to compare.</p>}
        </div>
      )}

      {mode === 'team' && (
        <div className="space-y-6">
          <p className="text-sm text-text-secondary -mt-2 mb-1">
            <strong className="text-text-primary font-medium">Team vs Team</strong> supports different seasons per side, like players. After both teams are selected, choose a year for each (or use{' '}
            <code className="text-xs bg-surface-3 px-1 rounded">ts1</code> / <code className="text-xs bg-surface-3 px-1 rounded">ts2</code> in the URL).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <EntitySelector type="team" label="Team 1" selectedId={t1} onSelect={(id) => setParam('t1', id)} />
            <EntitySelector type="team" label="Team 2" selectedId={t2} onSelect={(id) => setParam('t2', id)} />
          </div>
          {t1 && t2 ? <TeamCompare t1Id={t1} t2Id={t2} /> : <p className="text-text-secondary text-sm">Select two teams to compare.</p>}
        </div>
      )}

      {mode === 'career' && (
        <div className="space-y-6">
          <EntitySelector type="player" label="Player" selectedId={p1} includeInactive onSelect={(id) => setParam('p1', id)} />
          {p1 ? <CareerCompare p1Id={p1} /> : <p className="text-text-secondary text-sm">Select a player to view career season comparison.</p>}
        </div>
      )}

      {mode === 'team-career' && (
        <div className="space-y-6">
          <EntitySelector type="team" label="Team" selectedId={t1} onSelect={(id) => setParam('t1', id)} />
          {t1 ? (
            <TeamCareerCompare teamId={t1} />
          ) : (
            <p className="text-text-secondary text-sm">Select a team to compare seasons (colors match the bar chart).</p>
          )}
        </div>
      )}
    </div>
  )
}
