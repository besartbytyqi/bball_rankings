import { useState, useMemo, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { fetchPlayerStats, fetchPlayerGamelog, fetchPlayerSplits, fetchPlayerCareer, fetchFeaturedPlayerIds, addFeaturedPlayer, removeFeaturedPlayer, fetchPlayerSeasonAwards } from '@/api/players'
import { fetchAllPlayers } from '@/api/players'
import PlayerAvatar from '@/components/ui/PlayerAvatar'
import StarButton from '@/components/ui/StarButton'
import { fmtStat, fmtPct } from '@/utils/formatters'
import Tabs from '@/components/ui/Tabs'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import ErrorCard from '@/components/ui/ErrorCard'
import SectionHeader from '@/components/ui/SectionHeader'
import { StatHeader } from '@/components/ui/StatHeader'
import { sortGamelogByDateDesc, formatGameDateDisplay } from '@/utils/gameLogDate'
import DataCoverageNotice from '@/components/DataCoverageNotice'
import { SeasonSelectWithBadges } from '@/components/ui/SeasonSelectWithBadges'
import { AdditionalLocalStats } from '@/components/AdditionalLocalStats'

const STAT_TABS = ['Base', 'Advanced', 'Defense']
const PROFILE_TABS = ['Season Stats', 'Game Log', 'Splits', 'Career']

const BASE_COLS = ['gp','min','pts','pts_per_min','reb','ast','stl','blk','fg_pct','fg3_pct','ft_pct','plus_minus']
const ADV_COLS  = ['gp','min','ts_pct','usg_pct','off_rating','def_rating','net_rating','ast_pct','oreb_pct','dreb_pct','reb_pct','pie']
const DEF_COLS  = ['gp','min','stl','blk','dreb','dreb_pct','def_rating','opp_pts_paint','opp_pts_2nd_chance','opp_pts_off_tov','def_ws']

const PLAYER_STAT_EXTRA_EXCLUDE = new Set([
  ...BASE_COLS,
  ...ADV_COLS,
  ...DEF_COLS,
  'id',
  'player_id',
  'season',
  'stat_type',
  'team_abbreviation',
  'extra_stats',
])

function withPtsPerMin(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => {
    const pts = Number(r.pts ?? 0)
    const min = Number(r.min ?? 0)
    return { ...r, pts_per_min: min > 0 ? pts / min : null }
  })
}

// Columns that should NOT be highlighted (identifiers / text / lower-is-better)
const NO_HIGHLIGHT_COLS = new Set(['season', 'GROUP_VALUE', 'gp', 'def_rating'])

function StatTable({ rows, cols }: { rows: Record<string, unknown>[]; cols: string[] }) {
  const colMaxes = useMemo(() => {
    const maxes: Record<string, number> = {}
    for (const col of cols) {
      if (NO_HIGHLIGHT_COLS.has(col)) continue
      const vals = rows.map((r) => r[col]).filter((v) => typeof v === 'number' && (v as number) > 0) as number[]
      if (vals.length > 1) maxes[col] = Math.max(...vals)
    }
    return maxes
  }, [rows, cols])

  if (!rows.length) return <p className="text-text-secondary text-sm">No data available.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-text-secondary border-b border-border">
            {cols.map((c) => (
              <StatHeader
                key={c}
                colKey={c}
                label={c.replace(/_/g, ' ')}
                align={c === 'season' || c === 'GROUP_VALUE' ? 'left' : 'right'}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/40">
              {cols.map((c) => {
                const val = r[c]
                const isPct = c.includes('pct') || c === 'ts_pct'
                const isMax = typeof val === 'number' && colMaxes[c] !== undefined && val === colMaxes[c]
                return (
                  <td key={c} className={`py-1.5 px-2 text-right first:text-left tabular-nums ${isMax ? 'text-nba-gold font-semibold' : ''}`}>
                    {val == null ? '—' : typeof val === 'string' ? val : isPct ? fmtPct(val as number) : fmtStat(val as number, c === 'pts_per_min' ? 3 : 1)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const GAMELOG_HEADERS: { label: string; colKey: string; align?: 'left' | 'right' }[] = [
  { label: 'Date', colKey: 'game_date', align: 'left' },
  { label: 'Matchup', colKey: 'matchup', align: 'right' },
  { label: 'W/L', colKey: 'wl', align: 'right' },
  { label: 'MIN', colKey: 'min', align: 'right' },
  { label: 'PTS', colKey: 'pts', align: 'right' },
  { label: 'REB', colKey: 'reb', align: 'right' },
  { label: 'AST', colKey: 'ast', align: 'right' },
  { label: 'STL', colKey: 'stl', align: 'right' },
  { label: 'BLK', colKey: 'blk', align: 'right' },
  { label: 'FG%', colKey: 'fg_pct', align: 'right' },
  { label: '3P%', colKey: 'fg3_pct', align: 'right' },
  { label: 'FT%', colKey: 'ft_pct', align: 'right' },
  { label: 'TOV', colKey: 'tov', align: 'right' },
  { label: 'FGM', colKey: 'fgm', align: 'right' },
  { label: 'FGA', colKey: 'fga', align: 'right' },
  { label: 'FTM', colKey: 'ftm', align: 'right' },
  { label: 'FTA', colKey: 'fta', align: 'right' },
  { label: 'PF', colKey: 'pf', align: 'right' },
  { label: '+/-', colKey: 'plus_minus', align: 'right' },
]

function GamelogTable({ rows }: { rows: Record<string, unknown>[] }) {
  const sorted = useMemo(() => sortGamelogByDateDesc(rows), [rows])
  if (!sorted.length) return <p className="text-text-secondary text-sm">No game log data.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-text-secondary border-b border-border">
            {GAMELOG_HEADERS.map(({ label, colKey, align }) => (
              <StatHeader key={colKey} colKey={colKey} label={label} align={align ?? 'right'} />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={String(r.game_id ?? i)} className={`border-b border-border/40 ${r.wl === 'W' ? 'hover:bg-green-900/10' : 'hover:bg-red-900/10'}`}>
              <td className="py-1.5 px-2 text-left text-text-secondary tabular-nums">{formatGameDateDisplay(r.game_date)}</td>
              <td className="py-1.5 px-2 text-right">{String(r.matchup ?? '—')}</td>
              <td className={`py-1.5 px-2 text-right font-medium ${r.wl === 'W' ? 'text-green-400' : 'text-red-400'}`}>{String(r.wl ?? '—')}</td>
              <td className="py-1.5 px-2 text-right">{fmtStat(r.min as number, 0)}</td>
              <td className="py-1.5 px-2 text-right font-semibold">{String(r.pts ?? '—')}</td>
              <td className="py-1.5 px-2 text-right">{String(r.reb ?? '—')}</td>
              <td className="py-1.5 px-2 text-right">{String(r.ast ?? '—')}</td>
              <td className="py-1.5 px-2 text-right">{String(r.stl ?? '—')}</td>
              <td className="py-1.5 px-2 text-right">{String(r.blk ?? '—')}</td>
              <td className="py-1.5 px-2 text-right">{fmtPct(r.fg_pct as number)}</td>
              <td className="py-1.5 px-2 text-right">{fmtPct(r.fg3_pct as number)}</td>
              <td className="py-1.5 px-2 text-right">{fmtPct(r.ft_pct as number)}</td>
              <td className="py-1.5 px-2 text-right">{String(r.tov ?? '—')}</td>
              <td className="py-1.5 px-2 text-right">{String(r.fgm ?? '—')}</td>
              <td className="py-1.5 px-2 text-right">{String(r.fga ?? '—')}</td>
              <td className="py-1.5 px-2 text-right">{String(r.ftm ?? '—')}</td>
              <td className="py-1.5 px-2 text-right">{String(r.fta ?? '—')}</td>
              <td className="py-1.5 px-2 text-right">{String(r.pf ?? '—')}</td>
              <td className={`py-1.5 px-2 text-right ${Number(r.plus_minus) > 0 ? 'text-green-400' : Number(r.plus_minus) < 0 ? 'text-red-400' : ''}`}>
                {r.plus_minus != null ? (Number(r.plus_minus) > 0 ? '+' : '') + String(r.plus_minus) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type ChartPayloadEntry = { color?: string; name?: string; value?: number; payload?: Record<string, unknown> }
function CareerTooltip({ active, payload, label }: { active?: boolean; payload?: ChartPayloadEntry[]; label?: string }) {
  if (!active || !payload?.length) return null
  const team = payload[0]?.payload?.team as string | undefined
  return (
    <div className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm shadow-lg">
      <p className="font-semibold mb-1">
        {label}
        {team ? <span className="text-text-secondary font-normal ml-2 text-xs">{team}</span> : null}
      </p>
      {payload.map((entry, i) => {
        const nm = String(entry.name ?? '')
        const v = entry.value
        const isPct = nm.includes('%')
        const shown =
          typeof v === 'number' ? (isPct ? `${v.toFixed(1)}%` : fmtStat(v)) : String(v ?? '—')
        return (
          <p key={i} style={{ color: entry.color }} className="tabular-nums">
            {nm}: {shown}
          </p>
        )
      })}
    </div>
  )
}

type CareerLineDef = { key: string; label: string; color: string; statKey: string; volume?: boolean; isPct?: boolean }

const CAREER_CHART_STATIC: CareerLineDef[] = [
  { key: 'PPG', label: 'PPG', color: '#C9082A', statKey: 'pts' },
  { key: 'RPG', label: 'RPG', color: '#17408B', statKey: 'reb' },
  { key: 'APG', label: 'APG', color: '#FDB927', statKey: 'ast' },
  { key: 'SPG', label: 'SPG', color: '#10B981', statKey: 'stl' },
  { key: 'BPG', label: 'BPG', color: '#8B5CF6', statKey: 'blk' },
  { key: 'PF', label: 'PF', color: '#DC2626', statKey: 'pf' },
  { key: 'FGM', label: 'FGM', color: '#65A30D', statKey: 'fgm' },
  { key: 'FGA', label: 'FGA', color: '#4D7C0F', statKey: 'fga' },
  { key: 'TOV', label: 'TOV', color: '#F97316', statKey: 'tov' },
  { key: 'OREB', label: 'OREB', color: '#14B8A6', statKey: 'oreb' },
  { key: 'DREB', label: 'DREB', color: '#0EA5E9', statKey: 'dreb' },
  { key: 'FG%', label: 'FG%', color: '#F59E0B', statKey: 'fg_pct', isPct: true },
  { key: '3P%', label: '3P%', color: '#06B6D4', statKey: 'fg3_pct', isPct: true },
  { key: 'FT%', label: 'FT%', color: '#EC4899', statKey: 'ft_pct', isPct: true },
  { key: 'GP', label: 'GP', color: '#94A3B8', statKey: 'gp', volume: true },
  { key: 'MIN', label: 'MIN', color: '#64748B', statKey: 'min', volume: true },
]

const CAREER_CHART_EXCLUDE_LOWER = new Set([
  'season', 'season_id', 'team', 'team_abbreviation', 'team_id', 'player_id', 'id', 'stat_type',
  'extra_stats', 'display_name', 'first_name', 'last_name', 'jersey_number', 'position',
  'group_value', 'num', 'player', 'from_year', 'to_year', 'is_active',
])

const MAX_AUTO_CAREER_METRICS = 14

function hslForCareerKey(keyLower: string): string {
  let h = 0
  for (let i = 0; i < keyLower.length; i++) h = keyLower.charCodeAt(i) + ((h << 5) - h)
  const hue = Math.abs(h) % 360
  return `hsl(${hue} 62% 52%)`
}

function careerRowNumericKeys(rows: Record<string, unknown>[], staticLower: Set<string>): string[] {
  const seen = new Set<string>()
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      const kl = k.toLowerCase()
      if (CAREER_CHART_EXCLUDE_LOWER.has(kl) || staticLower.has(kl)) continue
      const v = r[k]
      if (v != null && v !== '' && Number.isFinite(Number(v))) seen.add(k)
    }
  }
  return [...seen].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).slice(0, MAX_AUTO_CAREER_METRICS)
}

function careerStatRaw(r: Record<string, unknown>, statKey: string): number {
  const kl = statKey.toLowerCase()
  const raw = r[statKey] ?? r[kl] ?? r[statKey.toUpperCase()] ?? r[kl.toUpperCase()]
  return Number(raw ?? 0)
}

function buildCareerChartData(rows: Record<string, unknown>[], lines: CareerLineDef[]) {
  return rows.map((r) => {
    const entry: Record<string, unknown> = {
      season: String(r.season ?? r.SEASON_ID ?? '').slice(0, 7),
      team: String(r.team_abbreviation ?? r.TEAM_ABBREVIATION ?? ''),
    }
    for (const line of lines) {
      const raw = careerStatRaw(r, line.statKey)
      const pct = line.isPct ?? line.statKey.toLowerCase().includes('pct')
      entry[line.key] = pct ? Math.round(raw * 1000) / 10 : raw
    }
    return entry
  })
}

function CareerChart({ rows }: { rows: Record<string, unknown>[] }) {
  const [visible, setVisible] = useState<Set<string>>(new Set(['PPG', 'RPG', 'APG']))
  const [lineMotion, setLineMotion] = useState(true)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setLineMotion(!mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const staticLower = useMemo(() => new Set(CAREER_CHART_STATIC.map((l) => l.statKey.toLowerCase())), [])
  const autoKeys = useMemo(() => careerRowNumericKeys(rows, staticLower), [rows, staticLower])
  const autoLines: CareerLineDef[] = useMemo(
    () =>
      autoKeys.map((statKey) => {
        const kl = statKey.toLowerCase()
        const isPct = kl.includes('pct')
        return {
          key: `~${kl}`,
          label: kl.replace(/_/g, ' ').toUpperCase().slice(0, 10),
          color: hslForCareerKey(kl),
          statKey,
          isPct,
          volume: false,
        }
      }),
    [autoKeys],
  )
  const chartLines = useMemo(() => [...CAREER_CHART_STATIC, ...autoLines], [autoLines])

  if (!rows.length) return <p className="text-text-secondary text-sm">No career data.</p>

  const chartData = useMemo(() => buildCareerChartData(rows, chartLines), [rows, chartLines])

  const toggle = (key: string) => {
    setVisible((prev) => {
      const next = new Set(prev)
      if (next.has(key)) { if (next.size > 1) next.delete(key) }
      else next.add(key)
      return next
    })
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {chartLines.map((line) => (
          <button
            key={line.key}
            onClick={() => toggle(line.key)}
            className={`px-2 py-0.5 text-xs rounded border transition-colors ${
              visible.has(line.key) ? 'text-white border-transparent' : 'bg-transparent text-text-secondary border-border hover:text-text-primary'
            }`}
            style={visible.has(line.key) ? { backgroundColor: line.color, borderColor: line.color } : {}}
          >
            {line.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-text-secondary mb-2">
        Per-game counting stats and shooting % use the <span className="text-text-primary">left axis</span>; GP and minutes use the <span className="text-text-primary">right axis</span>. Extra numeric columns from the API are added as toggles when present.
      </p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <XAxis dataKey="season" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
            <YAxis yAxisId="left" tick={{ fill: '#9CA3AF', fontSize: 11 }} width={40} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: '#9CA3AF', fontSize: 11 }} width={36} />
            <Tooltip content={<CareerTooltip />} />
            <Legend />
            {chartLines.filter((l) => visible.has(l.key)).map((line) => (
              <Line
                key={line.key}
                yAxisId={line.volume ? 'right' : 'left'}
                type="monotone"
                dataKey={line.key}
                stroke={line.color}
                dot={false}
                strokeWidth={2}
                isAnimationActive={lineMotion}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function SplitsSection({ splits }: { splits: Record<string, unknown[]> }) {
  const [split, setSplit] = useState('overall')
  const tabs = ['overall', 'location', 'win_loss', 'month']
  const rows = (splits[split] ?? []) as Record<string, unknown>[]
  return (
    <div>
      <Tabs tabs={tabs.map((t) => t.replace('_', ' '))} active={split.replace('_', ' ')} onChange={(t) => setSplit(t.replace(' ', '_'))} />
      <StatTable rows={rows} cols={['GROUP_VALUE','gp','w','l','w_pct','pts','reb','ast','stl','blk','fg_pct','fg3_pct','ft_pct']} />
    </div>
  )
}

export default function PlayerProfilePage() {
  const { playerId } = useParams<{ playerId: string }>()
  const navigate = useNavigate()
  const pid = Number(playerId)
  const [tab, setTab] = useState('Season Stats')
  const [statTab, setStatTab] = useState('Base')
  const [selectedSeason, setSelectedSeason] = useState<string | undefined>(undefined)
  const [showAllSeasons, setShowAllSeasons] = useState(false)
  const queryClient = useQueryClient()

  const { data: allPlayers } = useQuery({ queryKey: ['players','all'], queryFn: () => fetchAllPlayers(), staleTime: 60*60*1000 })
  const { data: stats, isLoading: statsLoading, isError: statsError } = useQuery({
    queryKey: ['player','stats', pid, selectedSeason ?? 'current'],
    queryFn: () => fetchPlayerStats(pid, selectedSeason),
    enabled: !!pid,
  })
  const { data: gamelog, isLoading: glLoading } = useQuery({
    queryKey: ['player','gamelog', pid], queryFn: () => fetchPlayerGamelog(pid), enabled: !!pid,
  })
  const { data: splits, isLoading: splitsLoading } = useQuery({
    queryKey: ['player','splits', pid], queryFn: () => fetchPlayerSplits(pid), enabled: !!pid,
  })
  const { data: career, isLoading: careerLoading } = useQuery({
    queryKey: ['player','career', pid], queryFn: () => fetchPlayerCareer(pid), enabled: !!pid, staleTime: 60*60*1000,
  })
  const { data: seasonHonors } = useQuery({
    queryKey: ['player', 'season-awards', pid],
    queryFn: () => fetchPlayerSeasonAwards(pid),
    enabled: !!pid,
    staleTime: 24 * 60 * 60 * 1000,
  })

  const playerMeta = allPlayers?.find((p) => p.player_id === pid)

  const seasonTeamMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const r of (career ?? []) as Record<string, unknown>[]) {
      const s = String(r.season ?? r.SEASON_ID ?? '')
      if (s) m[s] = String(r.team_abbreviation ?? r.TEAM_ABBREVIATION ?? '')
    }
    return m
  }, [career])

  const profileSeasonOptions = useMemo(
    () =>
      [...(career as Record<string, unknown>[] ?? [])]
        .map((r) => String(r.season ?? r.SEASON_ID ?? ''))
        .filter(Boolean)
        .reverse(),
    [career],
  )

  const { data: featuredIds = [] } = useQuery({ queryKey: ['featured','ids'], queryFn: fetchFeaturedPlayerIds, staleTime: 60*60*1000 })
  const isStarred = (featuredIds as number[]).includes(pid)
  const toggleFeatured = async () => {
    if (isStarred) await removeFeaturedPlayer(pid)
    else await addFeaturedPlayer(pid)
    queryClient.invalidateQueries({ queryKey: ['featured'] })
  }

  // Build team history from career data: [{team, firstSeason, lastSeason}]
  const teamHistory = useMemo(() => {
    if (!career?.length) return []
    const stints: { team: string; first: string; last: string }[] = []
    for (const row of career as Record<string, unknown>[]) {
      const team = String(row.team_abbreviation ?? row.TEAM_ABBREVIATION ?? '')
      const season = String(row.season ?? row.SEASON_ID ?? '').slice(0, 7)
      if (!team || !season) continue
      const last = stints[stints.length - 1]
      if (last && last.team === team) {
        last.last = season
      } else {
        stints.push({ team, first: season, last: season })
      }
    }
    return stints
  }, [career])

  const primaryStatRow = useMemo(() => {
    if (showAllSeasons) return null
    const rows =
      statTab === 'Base' ? stats?.base : statTab === 'Advanced' ? stats?.advanced : stats?.defense
    return (rows?.[0] as Record<string, unknown> | undefined) ?? null
  }, [showAllSeasons, statTab, stats])

  if (statsError) return <ErrorCard message="Player not found." />

  return (
    <div>
      {/* Hero */}
      <div className="bg-surface-2 rounded-lg p-6 mb-6 flex items-center gap-6">
        <div className="relative">
          <PlayerAvatar playerId={pid} name={playerMeta?.display_name} className="w-24 h-24" />
          {playerMeta?.jersey_number && (
            <div className="absolute -top-2 -right-2 bg-nba-red text-white text-[10px] font-bold px-1 py-0.5 rounded border border-white/20">
              #{playerMeta.jersey_number}
            </div>
          )}
        </div>
        <div>
          <h1 className="text-2xl font-bold">{playerMeta?.display_name ?? `Player #${pid}`}</h1>
          <div className="text-text-secondary text-sm mt-1">
            {playerMeta?.team_abbreviation && <span className="mr-3 font-medium text-text-primary">{playerMeta.team_abbreviation}</span>}
            {playerMeta?.position && <span className="mr-3">{playerMeta.position}</span>}
          </div>
          {teamHistory.length > 1 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
              {teamHistory.map((s, i) => (
                <span key={i} className="text-xs text-text-secondary">
                  <span className="text-text-primary">{s.team}</span>
                  {' '}
                  <span>{s.first === s.last ? s.first.slice(0, 4) : `${s.first.slice(0, 4)}–${s.last.slice(5, 7)}`}</span>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={() => navigate(`/compare?mode=player&p1=${pid}`)}
              className="text-xs px-3 py-1.5 bg-nba-red text-white rounded hover:bg-red-700 transition-colors"
            >
              Compare
            </button>
            <StarButton starred={isStarred} onToggle={toggleFeatured} className="text-xl" />
            <span className="text-xs text-text-secondary">{isStarred ? 'Featured' : 'Add to featured'}</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs tabs={PROFILE_TABS} active={tab} onChange={setTab} />

      {tab === 'Season Stats' && (
        <div className="bg-surface-2 rounded-lg p-4">
          <DataCoverageNotice playerId={pid} focus="stats" />
          {/* Season picker */}
          {career && career.length > 0 && (
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <label className="text-xs text-text-secondary">Season</label>
              <SeasonSelectWithBadges
                seasons={profileSeasonOptions}
                value={selectedSeason}
                onChange={(s) => {
                  setSelectedSeason(s)
                  setShowAllSeasons(false)
                }}
                teamMap={seasonTeamMap}
                showCurrentSeason
                currentLabel="Current (2025-26)"
                awardsBySeason={seasonHonors?.by_season ?? {}}
                disabled={showAllSeasons}
                variant="profile"
                aria-label="Season"
              />
              <button
                onClick={() => { setShowAllSeasons((v) => !v); setSelectedSeason(undefined) }}
                className={`text-xs px-3 py-1 rounded transition-colors ${showAllSeasons ? 'bg-nba-red text-white' : 'bg-surface-3 text-text-secondary hover:text-text-primary'}`}
              >
                All Seasons
              </button>
              {selectedSeason && !showAllSeasons && (
                <button onClick={() => setSelectedSeason(undefined)} className="text-xs text-nba-red hover:underline">Reset</button>
              )}
            </div>
          )}
          {showAllSeasons ? (
            <StatTable
              rows={withPtsPerMin([...(career as Record<string, unknown>[] ?? [])].reverse())}
              cols={['season', ...BASE_COLS]}
            />
          ) : statsLoading ? <LoadingSpinner /> : (
            <>
              <Tabs tabs={STAT_TABS} active={statTab} onChange={setStatTab} />
              <StatTable
                rows={withPtsPerMin((statTab === 'Base' ? stats?.base : statTab === 'Advanced' ? stats?.advanced : stats?.defense) as Record<string, unknown>[] ?? [])}
                cols={statTab === 'Base' ? BASE_COLS : statTab === 'Advanced' ? ADV_COLS : DEF_COLS}
              />
              <AdditionalLocalStats row={primaryStatRow} excludeKeys={PLAYER_STAT_EXTRA_EXCLUDE} />
            </>
          )}
        </div>
      )}

      {tab === 'Game Log' && (
        <div className="bg-surface-2 rounded-lg p-4">
          <DataCoverageNotice playerId={pid} focus="gamelog" />
          {glLoading ? <LoadingSpinner /> : <GamelogTable rows={(gamelog ?? []) as Record<string, unknown>[]} />}
        </div>
      )}

      {tab === 'Splits' && (
        <div className="bg-surface-2 rounded-lg p-4">
          {splitsLoading ? <LoadingSpinner /> : <SplitsSection splits={(splits ?? {}) as Record<string, unknown[]>} />}
        </div>
      )}

      {tab === 'Career' && (
        <div className="bg-surface-2 rounded-lg p-4 space-y-6">
          {careerLoading ? <LoadingSpinner /> : (
            <>
              <div>
                <SectionHeader title="Career Trajectory" />
                <CareerChart rows={(career ?? []) as Record<string, unknown>[]} />
              </div>
              <div>
                <SectionHeader title="Season-by-Season" />
                <StatTable rows={withPtsPerMin((career ?? []) as Record<string, unknown>[])} cols={['season','gp','min','pts','pts_per_min','reb','ast','stl','blk','fg_pct','fg3_pct','ft_pct']} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
