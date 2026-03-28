import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchAllPlayers } from '@/api/players'
import { fetchTeams } from '@/api/teams'
import { filterPlayersByName } from '@/utils/searchFilter'
import { playerHeadshotUrl, teamLogoUrl } from '@/utils/nbaImages'
import { client } from '@/api/client'

/** Season sent with full (non-quick) refresh; no UI control. */
const FULL_REFRESH_SEASON = '2025-26'

const NAV_LINKS = [
  { to: '/', label: 'Dashboard' },
  { to: '/players', label: 'Players' },
  { to: '/teams', label: 'Teams' },
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
    <div ref={ref} className="relative w-full min-w-0 md:w-56 md:flex-shrink-0">
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Search players & teams…"
        className="w-full bg-surface-3 border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-nba-red transition-colors"
      />
      {open && query && hasResults && (
        <div className="absolute top-full mt-1 left-0 right-0 md:right-auto md:w-72 bg-surface-2 border border-border rounded-lg shadow-2xl z-50 overflow-hidden">
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

function navLinkClass(isActive: boolean) {
  return `block md:inline-block px-3 py-2 md:py-1.5 rounded text-sm font-medium transition-colors ${
    isActive
      ? 'bg-surface-3 text-text-primary'
      : 'text-text-secondary hover:text-text-primary hover:bg-surface-3'
  }`
}

export default function Navbar() {
  const queryClient = useQueryClient()
  const location = useLocation()
  const [refreshing, setRefreshing] = useState(false)
  const [quickRefresh, setQuickRefresh] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleRefresh = async () => {
    if (refreshing) return
    const msg = quickRefresh
      ? 'Run a quick refresh? Updates current-season player/team stats and standings only (faster).'
      : `Run a full season refresh? Runs a heavier season re-seed without game logs.`
    if (!confirm(msg)) return
    setRefreshing(true)
    try {
      const qs = quickRefresh
        ? `quick=true`
        : `season=${encodeURIComponent(FULL_REFRESH_SEASON)}`
      const { data } = await client.post<{ status: string; season: string; job_id: string; quick?: boolean }>(
        `/refresh?${qs}`
      )
      alert(`Refresh started (${quickRefresh ? 'quick' : 'full'}). Job: ${data.job_id.slice(0, 8)}…`)
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
      <div className="max-w-7xl mx-auto px-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 md:py-0 md:h-14 md:flex-nowrap">
          <div className="flex items-center gap-2 min-w-0 flex-1 md:flex-none">
            <span className="text-nba-red font-bold text-lg sm:text-xl tracking-tight select-none shrink-0">
              NBA Stats
            </span>
            <div className="hidden md:flex md:items-center md:gap-1 md:ml-2">
              {NAV_LINKS.map(({ to, label }) => (
                <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => navLinkClass(isActive)}>
                  {label}
                </NavLink>
              ))}
            </div>
            <button
              type="button"
              className="md:hidden ml-auto p-2 rounded-md border border-border text-text-secondary hover:bg-surface-3 hover:text-text-primary"
              aria-expanded={menuOpen}
              aria-controls="nav-mobile-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen((o) => !o)}
            >
              {menuOpen ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden={true}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden={true}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto md:ml-auto md:flex-nowrap md:justify-end">
            <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={quickRefresh}
                onChange={(e) => setQuickRefresh(e.target.checked)}
                className="rounded border-border"
              />
              Quick refresh
            </label>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className={`text-xs uppercase font-bold px-2.5 py-1.5 rounded border border-border hover:border-sky-500/60 transition-all shrink-0 ${refreshing ? 'opacity-50 cursor-wait' : 'text-text-secondary hover:text-sky-400'}`}
            >
              {refreshing ? 'Starting...' : 'Refresh Data'}
            </button>
            <GlobalSearch />
          </div>
        </div>

        <div
          id="nav-mobile-menu"
          hidden={!menuOpen}
          className="md:hidden border-t border-border"
        >
          <div className="flex flex-col py-1 pb-2">
            {NAV_LINKS.map(({ to, label }) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => navLinkClass(isActive)}>
                {label}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </nav>
  )
}
