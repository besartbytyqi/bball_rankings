import { useState, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchTeams, fetchTeamRoster, fetchTeamGamelog, fetchTeamSplits, fetchTeamStats } from '@/api/teams'
import { teamLogoUrl, TEAM_COLORS, playerHeadshotUrl } from '@/utils/nbaImages'
import { fmtStat, fmtPct } from '@/utils/formatters'
import Tabs from '@/components/ui/Tabs'
import { StatHeader } from '@/components/ui/StatHeader'
import { STAT_DEFS } from '@/utils/statDefs'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import DataCoverageNotice from '@/components/DataCoverageNotice'
import { AdditionalLocalStats } from '@/components/AdditionalLocalStats'
import { formatGameDateDisplay, sortGamelogByDateDesc } from '@/utils/gameLogDate'

const PROFILE_TABS = ['Stats', 'Roster', 'Game Log', 'Splits']
const STAT_TYPE_TABS = ['Base', 'Advanced', 'Opponent']
const STAT_COLS: Record<string, string[]> = {
  Base:     ['gp','wins','losses','pts','reb','ast','stl','blk','fg_pct','fg3_pct','ft_pct'],
  Advanced: ['gp','off_rating','def_rating','net_rating','pace','ts_pct','pie'],
  Opponent: ['gp','opp_pts','opp_reb','opp_ast','opp_fg_pct','opp_fg3_pct'],
}

const TEAM_GAMELOG_OPTIONAL_COLS: { colKey: string; label: string; title?: string }[] = [
  { colKey: 'opp_pts', label: 'OPP', title: 'Opponent points (when stored in DB)' },
  { colKey: 'reb', label: 'REB' },
  { colKey: 'ast', label: 'AST' },
  { colKey: 'stl', label: 'STL' },
  { colKey: 'blk', label: 'BLK' },
  { colKey: 'tov', label: 'TOV' },
  { colKey: 'fgm', label: 'FGM' },
  { colKey: 'fga', label: 'FGA' },
  { colKey: 'ftm', label: 'FTM' },
  { colKey: 'fta', label: 'FTA' },
]

const TEAM_STAT_EXTRA_EXCLUDE = new Set<string>([
  ...STAT_COLS.Base,
  ...STAT_COLS.Advanced,
  ...STAT_COLS.Opponent,
  'team_id',
  'TEAM_ID',
  'season',
  'stat_type',
  'extra_stats',
  'id',
])

type RosterSortKey = 'display_name' | 'jersey_number' | 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fg_pct' | 'fg3_pct' | 'plus_minus'

export default function TeamProfilePage() {
  const { teamId } = useParams<{ teamId: string }>()
  const navigate = useNavigate()
  const tid = Number(teamId)
  const [tab, setTab] = useState('Stats')
  const [splitTab, setSplitTab] = useState('overall')
  const [statTypeTab, setStatTypeTab] = useState('Base')
  const [rosterMode, setRosterMode] = useState<'Per Game' | 'Totals'>('Per Game')
  const [rosterSort, setRosterSort] = useState<RosterSortKey>('pts')
  const [rosterSortDir, setRosterSortDir] = useState<'asc' | 'desc'>('desc')

  const { data: teams } = useQuery({ queryKey: ['teams'], queryFn: fetchTeams, staleTime: Infinity })
  const { data: allTeamStats, isLoading: statsLoading } = useQuery({
    queryKey: ['team-stats', 'current'],
    queryFn: () => fetchTeamStats(),
  })
  const { data: roster, isLoading: rosterLoading } = useQuery({ queryKey: ['team','roster', tid], queryFn: () => fetchTeamRoster(tid), enabled: !!tid })
  const { data: gamelog, isLoading: gamelogLoading } = useQuery({ queryKey: ['team','gamelog', tid], queryFn: () => fetchTeamGamelog(tid), enabled: !!tid })
  const { data: splits, isLoading: splitsLoading } = useQuery({ queryKey: ['team','splits', tid], queryFn: () => fetchTeamSplits(tid), enabled: !!tid })

  const teamMeta = teams?.find((t) => t.id === tid)
  const accentColor = TEAM_COLORS[tid] ?? '#17408B'

  const rosterPlayers = useMemo(() => {
    const rows = (roster?.players ?? []) as Record<string, unknown>[]
    return [...rows].sort((a, b) => {
      const av = rosterSort === 'display_name'
        ? String(a.display_name ?? '')
        : Number(a[rosterSort] ?? -Infinity)
      const bv = rosterSort === 'display_name'
        ? String(b.display_name ?? '')
        : Number(b[rosterSort] ?? -Infinity)
      if (typeof av === 'string') return rosterSortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av)
      return rosterSortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
  }, [roster, rosterSort, rosterSortDir])
  const games = (gamelog?.games ?? []) as Record<string, unknown>[]
  const sortedGames = useMemo(() => sortGamelogByDateDesc(games), [games])
  const splitsData = (splits ?? {}) as Record<string, unknown[]>
  const visibleTeamGamelogCols = useMemo(
    () =>
      TEAM_GAMELOG_OPTIONAL_COLS.filter((c) =>
        sortedGames.some((g) => g[c.colKey] != null && g[c.colKey] !== ''),
      ),
    [sortedGames],
  )

  const handleRosterSort = (key: RosterSortKey) => {
    if (key === rosterSort) setRosterSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setRosterSort(key); setRosterSortDir('desc') }
  }

  return (
    <div>
      {/* Hero */}
      <div
        className="rounded-lg p-6 mb-6 flex items-center gap-6"
        style={{ background: `linear-gradient(135deg, ${accentColor}33 0%, #1F2937 100%)` }}
      >
        <img
          src={teamLogoUrl(tid)}
          alt={teamMeta?.name ?? 'Team'}
          className="w-20 h-20 object-contain"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        <div>
          <h1 className="text-2xl font-bold">{teamMeta?.name ?? `Team ${tid}`}</h1>
          <p className="text-text-secondary text-sm mt-1">{teamMeta?.conf} Conference</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => navigate(`/compare?mode=team&t1=${tid}`)}
              className="text-xs px-3 py-1.5 bg-sky-700 text-white rounded hover:bg-sky-600 transition-colors"
            >
              Compare teams
            </button>
            <button
              type="button"
              onClick={() => navigate(`/compare?mode=team-career&t1=${tid}`)}
              className="text-xs px-3 py-1.5 bg-surface-3 border border-border text-text-primary rounded hover:border-sky-500/50 transition-colors"
            >
              Compare seasons
            </button>
          </div>
        </div>
      </div>

      <Tabs tabs={PROFILE_TABS} active={tab} onChange={setTab} />

      {tab === 'Stats' && (
        <div className="bg-surface-2 rounded-lg p-4">
          <DataCoverageNotice teamId={tid} focus="stats" />
          <Tabs tabs={STAT_TYPE_TABS} active={statTypeTab} onChange={setStatTypeTab} />
          {statsLoading ? <LoadingSpinner /> : (() => {
            const typeKey = statTypeTab.toLowerCase() as 'base' | 'advanced' | 'opponent'
            const rows = ((allTeamStats?.[typeKey] ?? []) as Record<string, unknown>[])
            const teamRow = rows.find((r) => Number(r.team_id ?? r.TEAM_ID) === tid) ?? {}
            const cols = STAT_COLS[statTypeTab] ?? []
            if (!cols.length) return <p className="text-text-secondary text-sm">No data.</p>
            return (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-text-secondary border-b border-border">
                        {cols.map((c, i) => (
                          <StatHeader
                            key={c}
                            colKey={c}
                            label={c.replace(/_/g, ' ')}
                            align={i === 0 ? 'left' : 'right'}
                            className="py-1.5 px-3 capitalize"
                          />
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-border/40">
                        {cols.map((c) => {
                          const val = teamRow[c] ?? teamRow[c.toUpperCase()]
                          const isPct = c.includes('pct') || c.includes('rating') || c.includes('ts')
                          return (
                            <td key={c} className="py-2 px-3 text-right first:text-left tabular-nums font-medium">
                              {val == null ? '—' : isPct && c.includes('pct') ? fmtPct(val as number) : fmtStat(val as number)}
                            </td>
                          )
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <AdditionalLocalStats row={teamRow} excludeKeys={TEAM_STAT_EXTRA_EXCLUDE} />
              </>
            )
          })()}
        </div>
      )}

      {tab === 'Roster' && (
        <div className="bg-surface-2 rounded-lg p-4 space-y-4">
          <div className="flex justify-end">
            <div className="flex p-1 bg-surface-3 rounded-lg border border-border">
              {(['Per Game', 'Totals'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setRosterMode(m)}
                  className={`px-3 py-1 text-xs rounded-md transition-all ${rosterMode === m ? 'bg-nba-red text-white shadow-md' : 'text-text-secondary hover:text-text-primary'}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {rosterLoading ? <LoadingSpinner /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-text-secondary border-b border-border">
                    {(rosterMode === 'Per Game' ? [
                      { label: 'Player', key: 'display_name' as RosterSortKey, tip: '' },
                      { label: '#', key: 'jersey_number' as RosterSortKey, tip: '' },
                      { label: 'Pos', key: null, tip: STAT_DEFS.position },
                      { label: 'GP', key: null, tip: STAT_DEFS.gp },
                      { label: 'PTS', key: 'pts' as RosterSortKey, tip: STAT_DEFS.pts },
                      { label: 'REB', key: 'reb' as RosterSortKey, tip: STAT_DEFS.reb },
                      { label: 'AST', key: 'ast' as RosterSortKey, tip: STAT_DEFS.ast },
                      { label: 'STL', key: 'stl' as RosterSortKey, tip: STAT_DEFS.stl },
                      { label: 'BLK', key: 'blk' as RosterSortKey, tip: STAT_DEFS.blk },
                      { label: 'FG%', key: 'fg_pct' as RosterSortKey, tip: STAT_DEFS.fg_pct },
                      { label: '3P%', key: 'fg3_pct' as RosterSortKey, tip: STAT_DEFS.fg3_pct },
                      { label: '+/-', key: 'plus_minus' as RosterSortKey, tip: STAT_DEFS.plus_minus },
                    ] : [
                      { label: 'Player', key: 'display_name' as RosterSortKey, tip: '' },
                      { label: '#', key: 'jersey_number' as RosterSortKey, tip: '' },
                      { label: 'Pos', key: null, tip: STAT_DEFS.position },
                      { label: 'GP', key: null, tip: STAT_DEFS.gp },
                      { label: 'MIN', key: null, tip: STAT_DEFS.min },
                      { label: 'PTS', key: null, tip: STAT_DEFS.pts },
                      { label: 'REB', key: null, tip: STAT_DEFS.reb },
                      { label: 'AST', key: null, tip: STAT_DEFS.ast },
                      { label: 'STL', key: null, tip: STAT_DEFS.stl },
                      { label: 'BLK', key: null, tip: STAT_DEFS.blk },
                    ]).map(({ label, key, tip }) => {
                      const inner = (
                        <>
                          {label}
                          {key === rosterSort ? (rosterSortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                        </>
                      )
                      const cls = `py-1.5 px-2 ${label === 'Player' ? 'text-left' : 'text-right'} ${key ? 'cursor-pointer hover:text-text-primary select-none' : ''} ${key === rosterSort ? 'text-text-primary' : ''}`
                      return (
                        <th key={label} onClick={key ? () => handleRosterSort(key) : undefined} className={cls}>
                          {tip ? (
                            <span title={tip} className="cursor-help border-b border-dashed border-text-secondary/40">
                              {inner}
                            </span>
                          ) : (
                            inner
                          )}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rosterPlayers.map((p, i) => {
                    const gp = Number(p.gp ?? p.GP ?? 0)
                    const fmtVal = (v: any, total = false) => {
                      const num = Number(v ?? 0)
                      return rosterMode === 'Totals' && total ? Math.round(num * gp) : fmtStat(num)
                    }
                    return (
                      <tr key={String(p.player_id ?? p.PLAYER_ID ?? i)} className="border-b border-border/40 hover:bg-surface-3 transition-colors">
                        <td className="py-1.5 px-2">
                          <Link to={`/players/${p.player_id ?? p.PLAYER_ID}`} className="hover:text-nba-red transition-colors flex items-center gap-2">
                            <img
                              src={playerHeadshotUrl(Number(p.player_id ?? p.PLAYER_ID))}
                              alt={String(p.display_name ?? '')}
                              className="w-7 h-7 rounded-full object-cover bg-surface-3 flex-shrink-0"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                            />
                            {String(p.display_name ?? p.PLAYER ?? '—')}
                          </Link>
                        </td>
                        <td className="py-1.5 px-2 text-right text-text-secondary tabular-nums">{String(p.jersey_number ?? p.NUM ?? '—')}</td>
                        <td className="py-1.5 px-2 text-right text-text-secondary">{String(p.position ?? p.POSITION ?? '—')}</td>
                        <td className="py-1.5 px-2 text-right">{String(gp || '—')}</td>
                        {rosterMode === 'Per Game' ? (
                          <>
                            <td className={`py-1.5 px-2 text-right ${rosterSort === 'pts' ? 'text-nba-gold font-semibold' : ''}`}>{fmtStat(p.pts as number)}</td>
                            <td className={`py-1.5 px-2 text-right ${rosterSort === 'reb' ? 'text-nba-gold font-semibold' : ''}`}>{fmtStat(p.reb as number)}</td>
                            <td className={`py-1.5 px-2 text-right ${rosterSort === 'ast' ? 'text-nba-gold font-semibold' : ''}`}>{fmtStat(p.ast as number)}</td>
                            <td className={`py-1.5 px-2 text-right ${rosterSort === 'stl' ? 'text-nba-gold font-semibold' : ''}`}>{fmtStat(p.stl as number)}</td>
                            <td className={`py-1.5 px-2 text-right ${rosterSort === 'blk' ? 'text-nba-gold font-semibold' : ''}`}>{fmtStat(p.blk as number)}</td>
                            <td className={`py-1.5 px-2 text-right ${rosterSort === 'fg_pct' ? 'text-nba-gold font-semibold' : ''}`}>{fmtPct(p.fg_pct as number)}</td>
                            <td className={`py-1.5 px-2 text-right ${rosterSort === 'fg3_pct' ? 'text-nba-gold font-semibold' : ''}`}>{fmtPct(p.fg3_pct as number)}</td>
                            <td className={`py-1.5 px-2 text-right ${rosterSort === 'plus_minus' ? 'text-nba-gold font-semibold' : ''}`}>{fmtStat(p.plus_minus as number)}</td>
                          </>
                        ) : (
                          <>
                            <td className="py-1.5 px-2 text-right">{fmtVal(p.min, true)}</td>
                            <td className="py-1.5 px-2 text-right">{fmtVal(p.pts, true)}</td>
                            <td className="py-1.5 px-2 text-right">{fmtVal(p.reb, true)}</td>
                            <td className="py-1.5 px-2 text-right">{fmtVal(p.ast, true)}</td>
                            <td className="py-1.5 px-2 text-right">{fmtVal(p.stl, true)}</td>
                            <td className="py-1.5 px-2 text-right">{fmtVal(p.blk, true)}</td>
                          </>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'Game Log' && (
        <div className="bg-surface-2 rounded-lg p-4">
          <DataCoverageNotice teamId={tid} focus="gamelog" />
          {gamelogLoading ? <LoadingSpinner /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-text-secondary border-b border-border">
                    <StatHeader colKey="game_date" label="Date" align="left" className="py-1.5" />
                    <StatHeader colKey="matchup" label="Matchup" align="left" className="py-1.5 px-2" />
                    <StatHeader colKey="wl" label="W/L" align="right" className="py-1.5 px-2" />
                    <StatHeader colKey="pts" label="PTS" align="right" className="py-1.5 px-2" />
                    {visibleTeamGamelogCols.map((c) => (
                      <StatHeader
                        key={c.colKey}
                        colKey={c.colKey}
                        label={c.label}
                        align="right"
                        className="py-1.5 px-2"
                        title={c.title}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedGames.map((g, i) => (
                    <tr key={String(g.game_id ?? i)} className="border-b border-border/40">
                      <td className="py-1.5 text-text-secondary tabular-nums">{formatGameDateDisplay(g.game_date)}</td>
                      <td className="py-1.5 px-2">{String(g.matchup ?? '—')}</td>
                      <td className={`py-1.5 px-2 text-right font-medium ${g.wl === 'W' ? 'text-green-400' : 'text-red-400'}`}>{String(g.wl ?? '—')}</td>
                      <td className="py-1.5 px-2 text-right font-semibold">{String(g.pts ?? '—')}</td>
                      {visibleTeamGamelogCols.map((c) => (
                        <td key={c.colKey} className="py-1.5 px-2 text-right tabular-nums text-text-secondary">
                          {g[c.colKey] != null && g[c.colKey] !== '' ? String(g[c.colKey]) : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'Splits' && (
        <div className="bg-surface-2 rounded-lg p-4">
          {splitsLoading ? <LoadingSpinner /> : (
            <>
              <Tabs
                tabs={['overall','location','win_loss','month'].map((t) => t.replace('_', ' '))}
                active={splitTab.replace('_', ' ')}
                onChange={(t) => setSplitTab(t.replace(' ', '_'))}
              />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-text-secondary border-b border-border">
                      {['GROUP_VALUE','GP','W','L','W_PCT','PTS','REB','AST','FG_PCT','FG3_PCT'].map((c) => (
                        <th key={c} className="text-right py-1.5 px-2 first:text-left capitalize">{c.replace(/_/g, ' ')}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(splitsData[splitTab] ?? [] as unknown[]).map((row: unknown, i: number) => {
                      const r = row as Record<string, unknown>
                      return (
                        <tr key={i} className="border-b border-border/40">
                          {['GROUP_VALUE','GP','W','L','W_PCT','PTS','REB','AST','FG_PCT','FG3_PCT'].map((c) => (
                            <td key={c} className="py-1.5 px-2 text-right first:text-left tabular-nums">
                              {r[c] == null ? '—' : c.includes('PCT') ? fmtPct(r[c] as number) : fmtStat(r[c] as number)}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
