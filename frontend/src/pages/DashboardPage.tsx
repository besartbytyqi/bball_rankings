import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { fetchStandings, fetchLeaders, fetchAwards } from '@/api/dashboard'
import { fetchFeaturedPlayers } from '@/api/players'
import { fetchFeaturedTeams } from '@/api/teams'
import { playerHeadshotUrl, teamLogoUrl, TEAM_COLORS } from '@/utils/nbaImages'
import { fmtStat, fmtPct, fmtWinPct } from '@/utils/formatters'
import SectionHeader from '@/components/ui/SectionHeader'
import Tabs from '@/components/ui/Tabs'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import ErrorCard from '@/components/ui/ErrorCard'
import { StatHeader } from '@/components/ui/StatHeader'

const AWARD_TABS = ['mvp', 'dpoy', 'roy', 'mip', 'clutch', 'smoy']
const LEADER_TABS = ['Overall', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'FG3M', 'FG_PCT', 'FT_PCT']

const LEADER_TAB_HINTS: Record<string, string> = {
  PTS: 'Points per game',
  REB: 'Rebounds per game',
  AST: 'Assists per game',
  STL: 'Steals per game',
  BLK: 'Blocks per game',
  FG3M: 'Three-pointers made per game',
  FG_PCT: 'Field goal percentage (qualified)',
  FT_PCT: 'Free throw percentage (qualified)',
}

// ---------------------------------------------------------------------------
// Standings panel
// ---------------------------------------------------------------------------
function StandingsPanel() {
  const [conf, setConf] = useState('East')
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['standings'],
    queryFn: fetchStandings,
  })

  if (isLoading) return <LoadingSpinner label="Loading standings…" />
  if (isError) return <ErrorCard onRetry={refetch} />

  const rows = conf === 'All'
    ? [...(data?.east ?? []), ...(data?.west ?? [])].sort((a, b) =>
        ((b as Record<string, unknown>).win_pct as number ?? 0) - ((a as Record<string, unknown>).win_pct as number ?? 0)
      )
    : conf === 'East' ? (data?.east ?? []) : (data?.west ?? [])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Tabs tabs={['East', 'West', 'All']} active={conf} onChange={setConf} />
      <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0 scrollbar-hide">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-secondary border-b border-border">
              <th className="text-left py-1.5 pr-3">#</th>
              <StatHeader colKey="team" label="Team" align="left" className="py-1.5" />
              {conf === 'All' && (
                <th className="text-right py-1.5 px-2 hidden sm:table-cell">Conf</th>
              )}
              <StatHeader colKey="w" label="W" align="right" className="py-1.5 px-2" />
              <StatHeader colKey="l" label="L" align="right" className="py-1.5 px-2" />
              <StatHeader colKey="w_pct" label="W%" align="right" className="py-1.5 px-2" />
              <StatHeader colKey="games_back" label="GB" align="right" className="py-1.5 px-2 hidden sm:table-cell" />
              <StatHeader colKey="last10" label="L10" align="right" className="py-1.5 px-2 hidden md:table-cell" />
              <StatHeader colKey="streak" label="Streak" align="right" className="py-1.5 pl-2 hidden md:table-cell" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r: Record<string, unknown>, i: number) => (
              <tr key={String(r.team_id ?? i)} className="border-b border-border/40 hover:bg-surface-3 transition-colors">
                <td className="py-1.5 pr-3 text-text-secondary">{i + 1}</td>
                <td className="py-1.5">
                  <Link to={`/teams/${r.team_id}`} className="hover:text-sky-400 transition-colors">
                    {String(r.team_abbreviation ?? r.team_id ?? '—')}
                  </Link>
                </td>
                {conf === 'All' && <td className="text-right py-1.5 px-2 hidden sm:table-cell text-text-secondary text-xs">{String(r.conference ?? '').charAt(0)}</td>}
                <td className="text-right py-1.5 px-2">{String(r.wins ?? r.W ?? '—')}</td>
                <td className="text-right py-1.5 px-2">{String(r.losses ?? r.L ?? '—')}</td>
                <td className="text-right py-1.5 px-2">{fmtWinPct(r.win_pct as number ?? r.W_PCT as number)}</td>
                <td className="text-right py-1.5 px-2 hidden sm:table-cell text-text-secondary">{String(r.games_back ?? r.GB ?? '—')}</td>
                <td className="text-right py-1.5 px-2 hidden md:table-cell text-text-secondary">{String(r.last10 ?? '—')}</td>
                <td className="text-right py-1.5 pl-2 hidden md:table-cell text-text-secondary">{String(r.streak ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Award rankings panel
// ---------------------------------------------------------------------------
function AwardPanel() {
  const [award, setAward] = useState('mvp')
  const { data, isLoading } = useQuery({
    queryKey: ['awards', award],
    queryFn: () => fetchAwards(award),
  })

  const players = (data?.players ?? []) as Record<string, unknown>[]

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Tabs tabs={AWARD_TABS.map((t) => t.toUpperCase())} active={award.toUpperCase()} onChange={(t) => setAward(t.toLowerCase())} />
      <p className="text-[10px] text-text-secondary mt-1 mb-1" title="Rankings use stored DB rows when seeded, else live model from NBA stats">
        Ranks are heuristic (except clutch from NBA clutch splits). Sixth Man uses bench-only minutes when the API allows.
      </p>
      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <ol className="space-y-1 overflow-y-auto flex-1 min-h-0 scrollbar-hide">
          {players.slice(0, 8).map((p, i) => (
            <li key={String(p.PLAYER_ID ?? i)} className="flex items-center gap-3 py-1.5 border-b border-border/40">
              <span className="text-text-secondary text-sm w-5 text-right">{i + 1}</span>
              <Link
                to={`/players/${p.PLAYER_ID}`}
                title="Open player profile"
                className="text-sm hover:text-sky-400 transition-colors flex-1 truncate"
              >
                {String(p.PLAYER_NAME ?? '—')}
              </Link>
              <span className="text-xs text-text-secondary">{String(p.TEAM_ABBREVIATION ?? '')}</span>
              {p.PTS != null && <span className="text-xs text-text-secondary">{fmtStat(p.PTS as number)} PPG</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// League leaders panel
// ---------------------------------------------------------------------------
function LeadersPanel() {
  const [cat, setCat] = useState('Overall')
  const { data, isLoading } = useQuery({
    queryKey: ['leaders'],
    queryFn: fetchLeaders,
    staleTime: 30 * 60 * 1000,
  })

  // Compute cross-category composite score: for each category, rank 1 = 10pts, rank 10 = 1pt
  const compositeRows = useMemo(() => {
    if (!data) return []
    const overall = data.OVERALL as Record<string, unknown>[] | undefined
    if (overall?.length) {
      return overall.map((r) => ({
        id: (r.player_id ?? r.PLAYER_ID) as number | string,
        name: String(r.player_name ?? r.PLAYER ?? ''),
        team: String(r.team_abbreviation ?? r.TEAM ?? ''),
        score: Number(r.composite_score ?? 0),
        cats: (r.categories as string[]) ?? [],
      }))
    }
    const scores: Record<string, { id: number | string; name: string; team: string; score: number; cats: string[] }> = {}
    const SCORE_CATS = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'FG3M', 'FG_PCT', 'FT_PCT']
    for (const catKey of SCORE_CATS) {
      const rows = (data[catKey] ?? []) as Record<string, unknown>[]
      rows.slice(0, 10).forEach((r, i) => {
        const pid = String(r.player_id ?? r.PLAYER_ID ?? '')
        if (!pid) return
        if (!scores[pid]) {
          const rawId = r.player_id ?? r.PLAYER_ID ?? pid
          scores[pid] = {
            id: typeof rawId === 'number' || typeof rawId === 'string' ? rawId : pid,
            name: String(r.player_name ?? r.PLAYER ?? ''),
            team: String(r.team_abbreviation ?? r.TEAM ?? ''),
            score: 0,
            cats: [],
          }
        }
        scores[pid].score += 10 - i
        scores[pid].cats.push(catKey)
      })
    }
    return Object.values(scores).sort((a, b) => b.score - a.score).slice(0, 10)
  }, [data])

  const rows = cat === 'Overall' ? [] : (data?.[cat] ?? []) as Record<string, unknown>[]

  return (
    <div>
      <Tabs tabs={LEADER_TABS} active={cat} onChange={setCat} />
      {cat !== 'Overall' && (
        <p className="text-[10px] text-text-secondary mt-1 mb-1">{LEADER_TAB_HINTS[cat] ?? 'League leaders'}</p>
      )}
      {cat === 'Overall' && (
        <p className="text-[10px] text-text-secondary mt-1 mb-1" title="Sum of placement points across PTS, REB, AST, STL, BLK, 3PM, FG%, FT% top-10 lists">
          Composite score from top-10 placement across PTS · REB · AST · STL · BLK · 3PM · FG% · FT%
        </p>
      )}
      {isLoading ? (
        <LoadingSpinner />
      ) : cat === 'Overall' ? (
        <ol className="space-y-1">
          {compositeRows.map((r, i) => (
            <li key={String(r.id)} className="flex items-center gap-3 py-1.5 border-b border-border/40">
              <span className="text-text-secondary text-sm w-5 text-right">{i + 1}</span>
              <Link to={`/players/${r.id}`} title="Open player profile" className="text-sm hover:text-sky-400 transition-colors flex-1 truncate">
                {r.name}
              </Link>
              <span className="text-xs text-text-secondary">{r.team}</span>
              <span className="text-xs text-text-secondary hidden sm:block">{r.cats.slice(0, 3).join(' · ')}</span>
              <span className="text-sm font-semibold tabular-nums text-nba-gold">{r.score}pts</span>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="space-y-1">
          {rows.slice(0, 10).map((r, i) => (
            <li key={String(r.player_id ?? r.PLAYER_ID ?? i)} className="flex items-center gap-3 py-1.5 border-b border-border/40">
              <span className="text-text-secondary text-sm w-5 text-right">{String(r.rank ?? i + 1)}</span>
              <Link
                to={`/players/${r.player_id ?? r.PLAYER_ID}`}
                title="Open player profile"
                className="text-sm hover:text-sky-400 transition-colors flex-1 truncate"
              >
                {String(r.player_name ?? r.PLAYER ?? '—')}
              </Link>
              <span className="text-xs text-text-secondary">{String(r.team_abbreviation ?? r.TEAM ?? '')}</span>
              <span
                className="text-sm font-semibold tabular-nums"
                title={cat.includes('PCT') ? 'Percentage' : 'Per-game or raw leader value'}
              >
                {cat.includes('PCT') ? fmtPct(r.value as number) : fmtStat(r.value as number)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Featured players
// ---------------------------------------------------------------------------
function FeaturedTeamsHome() {
  const { data, isLoading } = useQuery({
    queryKey: ['featured', 'teams', 'home'],
    queryFn: fetchFeaturedTeams,
    staleTime: 30 * 60 * 1000,
  })
  if (isLoading || !data?.length) return null
  const teams = data as Record<string, unknown>[]
  return (
    <div className="mb-8">
      <SectionHeader title="Featured Teams" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {teams.map((t) => {
          const tid = Number(t.team_id)
          const accentColor = TEAM_COLORS[tid] ?? '#17408B'
          const last = t.last_game as Record<string, unknown> | undefined
          const next = t.next_game as Record<string, unknown> | undefined
          return (
            <Link
              key={tid}
              to={`/teams/${tid}`}
              className="rounded-lg p-3 flex items-center gap-3 hover:brightness-110 transition-all"
              style={{ background: `linear-gradient(135deg, ${accentColor}33 0%, #1F2937 100%)` }}
            >
              <img
                src={teamLogoUrl(tid)}
                alt={String(t.abbreviation ?? '')}
                className="w-10 h-10 object-contain flex-shrink-0"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
              <div className="min-w-0">
                <div className="text-sm font-semibold">{String(t.abbreviation ?? '')}</div>
                <div className="text-xs text-text-secondary">
                  {String(t.wins ?? '—')}-{String(t.losses ?? '—')}
                  {t.win_pct != null && <span className="ml-1">({fmtWinPct(t.win_pct as number)})</span>}
                </div>
                {last && (
                  <div className="text-[10px] text-text-secondary truncate mt-0.5" title={String(last.matchup ?? '')}>
                    Last: {String(last.wl ?? '')} {String(last.pts ?? '—')} · {String(last.matchup ?? '')}
                  </div>
                )}
                {next && (
                  <div className="text-[10px] text-sky-300/90 truncate mt-0.5">
                    Next: {next.is_home ? 'vs' : '@'} {String(next.opponent_abbr ?? '')}
                    {next.status_text ? ` · ${String(next.status_text)}` : ''}
                  </div>
                )}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function FeaturedPlayers() {
  const { data, isLoading } = useQuery({
    queryKey: ['featured'],
    queryFn: fetchFeaturedPlayers,
    staleTime: 60 * 60 * 1000,
  })

  if (isLoading) return <LoadingSpinner label="Loading featured players…" />

  const players = (data ?? []) as Record<string, unknown>[]
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {players.map((p) => {
        const pid = p.id as number
        const base = ((p.base ?? []) as Record<string, unknown>[])[0] ?? {}
        return (
          <Link
            key={pid}
            to={`/players/${pid}`}
            className="bg-surface-2 rounded-lg p-4 hover:bg-surface-3 transition-colors block"
          >
            <img
              src={playerHeadshotUrl(pid)}
              alt={String(p.name)}
              className="w-16 h-16 rounded-full mx-auto mb-2 object-cover bg-surface-3"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
            <div className="text-center text-sm font-semibold">{String(p.name)}</div>
            <div className="flex justify-center gap-4 mt-2 text-xs text-text-secondary">
              <span>{fmtStat(base.pts as number)} PPG</span>
              <span>{fmtStat(base.reb as number)} RPG</span>
              <span>{fmtStat(base.ast as number)} APG</span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard page
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <FeaturedTeamsHome />

      {/* Standings + Awards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="bg-surface-2 rounded-lg p-4 h-[460px] flex flex-col overflow-hidden">
          <SectionHeader title="Standings" />
          <StandingsPanel />
        </div>
        <div className="bg-surface-2 rounded-lg p-4 h-[460px] flex flex-col overflow-hidden">
          <SectionHeader title="Award Races" />
          <AwardPanel />
        </div>
      </div>

      {/* League Leaders */}
      <div className="bg-surface-2 rounded-lg p-4">
        <SectionHeader title="League Leaders" />
        <LeadersPanel />
      </div>

      {/* Featured Players */}
      <div>
        <SectionHeader title="Featured Players" />
        <FeaturedPlayers />
      </div>
    </div>
  )
}
