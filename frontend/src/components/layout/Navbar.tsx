import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchAllPlayers } from '@/api/players'
import { fetchTeams } from '@/api/teams'
import { filterPlayersByName } from '@/utils/searchFilter'
import { playerHeadshotUrl, teamLogoUrl } from '@/utils/nbaImages'
import { client } from '@/api/client'
import { fetchSyncStatus } from '@/api/sync'

const NAV_LINKS = [
  { to: '/', label: 'Dashboard' },
  { to: '/players', label: 'Players' },
  { to: '/teams', label: 'Teams' },
  { to: '/compare', label: 'Compare' },
  { to: '/records', label: 'Records' },
  { to: '/dream-team', label: 'Dream Team' },
]

function GlobalSearch() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const { data: players } = useQuery({
    queryKey: ['players', 'all', true],
    queryFn: () => fetchAllPlayers({ includeInactive: true }),
    staleTime: 60 * 60 * 1000,
  })
  const { data: teams } = useQuery({ queryKey: ['teams'], queryFn: fetchTeams, staleTime: Infinity })

  const playerResults = filterPlayersByName(players ?? [], query).slice(0, 5)
  const teamResults = query.trim()
    ? (teams ?? []).filter((t) => t.name.toLowerCase().includes(query.toLowerCase()) || t.abbr.toLowerCase().includes(query.toLowerCase())).slice(0, 3)
    : []

  const hasResults = playerResults.length > 0 || teamResults.length > 0

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function go(path: string) {
    navigate(path)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Search players & teams…"
        className="w-56 bg-surface-3 border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-nba-red transition-colors"
      />
      {open && query && hasResults && (
        <div className="absolute top-full mt-1 left-0 w-72 bg-surface-2 border border-border rounded-lg shadow-2xl z-50 overflow-hidden">
          {playerResults.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-xs text-text-secondary font-semibold uppercase tracking-wide border-b border-border">Players</div>
              {playerResults.map((p) => (
                <button
                  key={p.player_id}
                  onClick={() => go(`/players/${p.player_id}`)}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-surface-3 transition-colors text-left"
                >
                  <img
                    src={playerHeadshotUrl(p.player_id)}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover bg-surface-3 flex-shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{p.display_name}</div>
                    <div className="text-xs text-text-secondary">{p.team_abbreviation ?? '—'} · {p.position ?? ''}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {teamResults.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-xs text-text-secondary font-semibold uppercase tracking-wide border-b border-border border-t">Teams</div>
              {teamResults.map((t) => (
                <button
                  key={t.id}
                  onClick={() => go(`/teams/${t.id}`)}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-surface-3 transition-colors text-left"
                >
                  <img
                    src={teamLogoUrl(t.id)}
                    alt=""
                    className="w-7 h-7 object-contain flex-shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-xs text-text-secondary ml-auto">{t.conf}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Navbar() {
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const [refreshSeason, setRefreshSeason] = useState('2025-26')
  const [quickRefresh, setQuickRefresh] = useState(true)

  const { data: syncStatus } = useQuery({
    queryKey: ['sync-status'],
    queryFn: fetchSyncStatus,
    staleTime: 60 * 1000,
  })

  const handleRefresh = async () => {
    if (refreshing) return
    const msg = quickRefresh
      ? 'Run a quick refresh? Updates current-season player/team stats and standings only (faster).'
      : `Refresh data for ${refreshSeason}? Runs a heavier season re-seed without game logs.`
    if (!confirm(msg)) return
    setRefreshing(true)
    try {
      const qs = quickRefresh
        ? `quick=true`
        : `season=${encodeURIComponent(refreshSeason)}`
      const { data } = await client.post<{ status: string; season: string; job_id: string; quick?: boolean }>(
        `/refresh?${qs}`
      )
      alert(`Refresh started (${quickRefresh ? 'quick' : 'full'}). Job: ${data.job_id.slice(0, 8)}…`)
      void queryClient.invalidateQueries({ queryKey: ['sync-status'] })
      void queryClient.invalidateQueries({ queryKey: ['featured'] })
      void queryClient.invalidateQueries({ queryKey: ['standings'] })
      void queryClient.invalidateQueries({ queryKey: ['team-stats'] })
    } catch (err) {
      alert('Failed to start refresh.')
    } finally {
      setTimeout(() => setRefreshing(false), 2000)
    }
  }

  return (
    <nav className="bg-surface-2 border-b border-border sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 flex items-center gap-6 h-14">
        <span className="text-nba-red font-bold text-xl tracking-tight select-none">
          NBA Stats
        </span>
        <div className="flex gap-1">
          {NAV_LINKS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-surface-3 text-text-primary'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-3'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
        <div className="ml-auto flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
          <div className="hidden lg:flex flex-col items-end text-[10px] text-text-secondary leading-tight max-w-[200px]">
            <span>
              Quick: {syncStatus?.last_quick_refresh?.replace('T', ' ').slice(0, 19) ?? '—'}
            </span>
            <span>
              Full: {syncStatus?.last_full_seed?.replace('T', ' ').slice(0, 19) ?? '—'}
            </span>
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={quickRefresh}
              onChange={(e) => setQuickRefresh(e.target.checked)}
              className="rounded border-border"
            />
            Quick refresh
          </label>
          <input
            value={refreshSeason}
            onChange={(e) => setRefreshSeason(e.target.value)}
            disabled={quickRefresh}
            className="w-20 bg-surface-3 border border-border rounded px-2 py-1 text-[11px] text-text-secondary focus:outline-none focus:border-sky-500/60 disabled:opacity-40"
            title="Season for full refresh (YYYY-YY)"
            placeholder="2025-26"
          />
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className={`text-[10px] uppercase font-bold px-2 py-1 rounded border border-border hover:border-sky-500/60 transition-all ${refreshing ? 'opacity-50 cursor-wait' : 'text-text-secondary hover:text-sky-400'}`}
          >
            {refreshing ? 'Starting...' : 'Refresh Data'}
          </button>
          <GlobalSearch />
        </div>
      </div>
    </nav>
  )
}
