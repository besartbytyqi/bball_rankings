import { useState, useMemo, useCallback, useRef, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchTeams,
  fetchTeamStats,
  fetchFeaturedTeamIds,
  fetchFeaturedTeams,
  addFeaturedTeam,
  removeFeaturedTeam,
  reorderFeaturedTeams,
} from '@/api/teams'
import { fetchStandings } from '@/api/dashboard'
import { teamLogoUrl, TEAM_COLORS } from '@/utils/nbaImages'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import StarButton from '@/components/ui/StarButton'
import SectionHeader from '@/components/ui/SectionHeader'
import { SortableFeaturedStrip, type SortableDragHandleProps } from '@/components/featured/SortableFeaturedStrip'
import { fmtWinPct } from '@/utils/formatters'

type SortOption =
  | 'name'
  | 'wins'
  | 'win_pct'
  | 'losses'
  | 'pts'
  | 'conf'
  | 'games_back'
  | 'streak'
  | 'conference_rank'

const SORT_OPTS: { label: string; key: SortOption }[] = [
  { label: 'Name', key: 'name' },
  { label: 'W%', key: 'win_pct' },
  { label: 'Wins', key: 'wins' },
  { label: 'Losses', key: 'losses' },
  { label: 'GB', key: 'games_back' },
  { label: 'Streak', key: 'streak' },
  { label: 'Conf Rk', key: 'conference_rank' },
  { label: 'PPG', key: 'pts' },
  { label: 'Conf', key: 'conf' },
]

function streakSortKey(s: unknown): number {
  const t = String(s ?? '').trim()
  const m = t.match(/^([WL])\s*(\d+)$/i)
  if (!m) return 0
  const n = parseInt(m[2], 10)
  return m[1].toUpperCase() === 'W' ? n : -n
}

function gbSortKey(g: unknown): number {
  if (g == null || g === '' || g === '—' || g === '-') return 0
  const n = parseFloat(String(g))
  return Number.isFinite(n) ? n : 999
}

function FeaturedTeamCard({
  t,
  tid,
  handle,
  dim,
  onToggleFeatured,
}: {
  t: Record<string, unknown>
  tid: number
  handle?: SortableDragHandleProps
  dim?: boolean
  onToggleFeatured: (e: MouseEvent, tid: number) => void
}) {
  const accentColor = TEAM_COLORS[tid] ?? '#17408B'
  const last = t.last_game as Record<string, unknown> | undefined
  const nextG = t.next_game as Record<string, unknown> | undefined
  return (
    <div
      className={`group relative rounded-lg flex items-stretch overflow-hidden hover:brightness-110 transition-all ${
        dim ? 'opacity-[0.28]' : ''
      }`}
      style={{ background: `linear-gradient(135deg, ${accentColor}33 0%, #1F2937 100%)` }}
    >
      {handle ? (
        <button
          type="button"
          {...handle.attributes}
          {...handle.listeners}
          aria-label={`Reorder ${String(t.abbreviation ?? tid)}`}
          title="Drag to reorder favorites"
          className="flex items-center px-1.5 cursor-grab active:cursor-grabbing text-text-secondary hover:text-sky-300/90 select-none border-r border-white/10 shrink-0 touch-none"
        >
          <span className="text-sm leading-none tracking-tighter" aria-hidden>
            ⠿
          </span>
        </button>
      ) : null}
      <Link to={`/teams/${tid}`} className="p-3 flex items-center gap-3 min-w-0 flex-1 pr-10">
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
          {nextG && (
            <div className="text-[10px] text-sky-300/90 truncate mt-0.5">
              Next: {nextG.is_home ? 'vs' : '@'} {String(nextG.opponent_abbr ?? '')}
              {nextG.status_text ? ` · ${String(nextG.status_text)}` : ''}
            </div>
          )}
        </div>
      </Link>
      <div className="absolute top-2 right-2 z-10 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
        <StarButton starred onToggle={(e) => onToggleFeatured(e, tid)} className="drop-shadow-md" />
      </div>
    </div>
  )
}

export default function TeamsPage() {
  const [conf, setConf] = useState<'All' | 'East' | 'West'>('All')
  const [sortBy, setSortBy] = useState<SortOption>('win_pct')
  const [featTeamAddQuery, setFeatTeamAddQuery] = useState('')
  const [featTeamAddOpen, setFeatTeamAddOpen] = useState(false)
  const featuredReorderBusyRef = useRef(false)
  const queryClient = useQueryClient()

  const { data: teams, isLoading } = useQuery({ queryKey: ['teams'], queryFn: fetchTeams, staleTime: Infinity })
  const { data: standings } = useQuery({ queryKey: ['standings'], queryFn: fetchStandings, staleTime: 30 * 60 * 1000 })
  const { data: teamStats } = useQuery({
    queryKey: ['team-stats', 'current'],
    queryFn: () => fetchTeamStats(),
    staleTime: 30 * 60 * 1000,
  })
  const { data: featuredIds = [] } = useQuery({ queryKey: ['featured','team','ids'], queryFn: fetchFeaturedTeamIds, staleTime: 60*60*1000 })
  const { data: featuredTeams = [] } = useQuery({ queryKey: ['featured','teams'], queryFn: fetchFeaturedTeams, staleTime: 30*60*1000 })

  const toggleFeatured = async (e: React.MouseEvent, tid: number) => {
    e.preventDefault()
    const isStarred = (featuredIds as number[]).includes(tid)
    if (isStarred) await removeFeaturedTeam(tid)
    else await addFeaturedTeam(tid)
    queryClient.invalidateQueries({ queryKey: ['featured'] })
  }

  const featTeamAddResults = useMemo(() => {
    const q = featTeamAddQuery.trim().toLowerCase()
    if (!q) return []
    const ids = new Set(featuredIds as number[])
    return (teams ?? [])
      .filter(
        (t) =>
          !ids.has(t.id) &&
          (t.name.toLowerCase().includes(q) || t.abbr.toLowerCase().includes(q)),
      )
      .slice(0, 8)
  }, [teams, featuredIds, featTeamAddQuery])

  const addFeaturedTeamFromSearch = async (tid: number) => {
    await addFeaturedTeam(tid)
    setFeatTeamAddQuery('')
    setFeatTeamAddOpen(false)
    queryClient.invalidateQueries({ queryKey: ['featured'] })
  }

  const commitFeaturedTeamOrder = useCallback(
    async (orderedIds: string[]) => {
      if (featuredReorderBusyRef.current) return
      featuredReorderBusyRef.current = true
      try {
        await reorderFeaturedTeams(orderedIds.map(Number))
        await queryClient.invalidateQueries({ queryKey: ['featured'] })
      } catch (err) {
        console.error(err)
      } finally {
        featuredReorderBusyRef.current = false
      }
    },
    [queryClient],
  )

  const featuredList = featuredTeams as Record<string, unknown>[]
  const featuredServerIds = useMemo(() => featuredList.map((t) => String(t.team_id)), [featuredList])
  const featuredTeamById = useMemo(
    () => Object.fromEntries(featuredList.map((t) => [String(t.team_id), t])) as Record<string, Record<string, unknown>>,
    [featuredList],
  )

  // Build a standings lookup by team_id
  const standingsMap = useMemo(() => {
    const all = [...(standings?.east ?? []), ...(standings?.west ?? [])]
    return Object.fromEntries(all.map((s) => [s.team_id, s]))
  }, [standings])

  const teamStatsMap = useMemo(() => {
    const base = (teamStats?.base ?? []) as Record<string, unknown>[]
    return Object.fromEntries(base.map((r) => [Number(r.team_id ?? r.TEAM_ID), r]))
  }, [teamStats])

  const sorted = useMemo(() => {
    let list = (teams ?? []).filter((t) => conf === 'All' || t.conf === conf)
    list = [...list].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'conf') return a.conf.localeCompare(b.conf) || a.name.localeCompare(b.name)
      if (sortBy === 'pts') {
        const ta = teamStatsMap[a.id] as Record<string, unknown> | undefined
        const tb = teamStatsMap[b.id] as Record<string, unknown> | undefined
        const va = ta ? Number(ta.pts ?? 0) : -1
        const vb = tb ? Number(tb.pts ?? 0) : -1
        return vb - va
      }
      const sa = standingsMap[a.id] as Record<string, unknown> | undefined
      const sb = standingsMap[b.id] as Record<string, unknown> | undefined
      if (!sa && !sb) return 0
      if (!sa) return 1
      if (!sb) return -1
      if (sortBy === 'games_back') {
        return gbSortKey(sa.games_back ?? sa.GB) - gbSortKey(sb.games_back ?? sb.GB)
      }
      if (sortBy === 'streak') {
        return streakSortKey(sb.streak) - streakSortKey(sa.streak)
      }
      if (sortBy === 'conference_rank') {
        const ra = Number(sa.conference_rank ?? 999)
        const rb = Number(sb.conference_rank ?? 999)
        return ra - rb
      }
      const va = Number(sa[sortBy] ?? 0)
      const vb = Number(sb[sortBy] ?? 0)
      return sortBy === 'losses' ? va - vb : vb - va
    })
    return list
  }, [teams, conf, sortBy, standingsMap, teamStatsMap])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold mr-2">Teams</h1>
        <div className="flex gap-1">
          {(['All', 'East', 'West'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setConf(c)}
              className={`px-3 py-1.5 text-sm rounded transition-colors ${conf === c ? 'bg-nba-red text-white' : 'bg-surface-2 text-text-secondary hover:text-text-primary'}`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-text-secondary">Sort</span>
          <div className="flex gap-1">
            {SORT_OPTS.map(({ label, key }) => (
              <button
                key={key}
                onClick={() => setSortBy(key)}
                className={`px-2.5 py-1.5 text-xs rounded transition-colors ${sortBy === key ? 'bg-nba-red text-white' : 'bg-surface-2 text-text-secondary hover:text-text-primary'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Featured teams strip */}
      <div className="mb-6">
        <SectionHeader
          title="Featured Teams"
          right={
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto sm:justify-end sm:max-w-md ml-auto">
              <div className="relative w-full sm:w-56 shrink-0">
                <input
                  type="text"
                  value={featTeamAddQuery}
                  onChange={(e) => {
                    setFeatTeamAddQuery(e.target.value)
                    setFeatTeamAddOpen(true)
                  }}
                  onFocus={() => setFeatTeamAddOpen(true)}
                  onBlur={() => setTimeout(() => setFeatTeamAddOpen(false), 180)}
                  placeholder="Search to add team…"
                  aria-label="Search teams to add to featured"
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-sky-500/60"
                />
                {featTeamAddOpen && featTeamAddQuery.trim() && (
                  <ul className="absolute z-30 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-2 shadow-xl py-1">
                    {featTeamAddResults.length === 0 ? (
                      <li className="px-3 py-2 text-xs text-text-secondary">No matching teams</li>
                    ) : (
                      featTeamAddResults.map((t) => (
                        <li key={t.id}>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-surface-3 flex items-center gap-2"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => void addFeaturedTeamFromSearch(t.id)}
                          >
                            <img
                              src={teamLogoUrl(t.id)}
                              alt=""
                              className="w-7 h-7 object-contain shrink-0"
                              onError={(ev) => {
                                (ev.target as HTMLImageElement).style.display = 'none'
                              }}
                            />
                            <span>
                              <span className="font-medium">{t.abbr}</span>
                              <span className="text-text-secondary text-xs ml-1">{t.name}</span>
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
              <span className="text-[11px] text-text-secondary whitespace-nowrap">
                Drag <span className="tabular-nums">⠿</span> to reorder · auto-saved
              </span>
            </div>
          }
        />
        {featuredList.length === 0 ? (
          <p className="text-sm text-text-secondary">No featured teams yet. Use the search above or star teams in the grid below.</p>
        ) : (
          <SortableFeaturedStrip
            serverOrderedIds={featuredServerIds}
            onCommit={commitFeaturedTeamOrder}
            renderItem={(id, handle, isDragging) => {
              const t = featuredTeamById[id]
              if (!t) return null
              return (
                <FeaturedTeamCard
                  t={t}
                  tid={Number(id)}
                  handle={handle}
                  dim={isDragging}
                  onToggleFeatured={toggleFeatured}
                />
              )
            }}
            renderOverlay={(id) => {
              const t = featuredTeamById[id]
              if (!t) return null
              return <FeaturedTeamCard t={t} tid={Number(id)} onToggleFeatured={toggleFeatured} />
            }}
          />
        )}
      </div>

      {isLoading ? <LoadingSpinner /> : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3">
          {sorted.map((t) => {
            const s = standingsMap[t.id] as Record<string, unknown> | undefined
            const starred = (featuredIds as number[]).includes(t.id)
            return (
              <Link
                key={t.id}
                to={`/teams/${t.id}`}
                className="bg-surface-2 rounded-lg p-4 hover:bg-surface-3 transition-colors flex flex-col items-center gap-2 relative"
              >
                <StarButton starred={starred} onToggle={(e) => toggleFeatured(e, t.id)} className="absolute top-2 right-2" />
                <img
                  src={teamLogoUrl(t.id)}
                  alt={t.name}
                  className="w-12 h-12 object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
                <div className="text-center">
                  <div className="text-sm font-semibold">{t.abbr}</div>
                  <div className="text-xs text-text-secondary">{t.conf}</div>
                  {s && (
                    <div className="text-xs text-text-secondary mt-0.5">
                      {String(s.wins ?? '—')}-{String(s.losses ?? '—')}
                    </div>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
