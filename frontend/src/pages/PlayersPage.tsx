import { useState, useMemo, useCallback, useRef, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import {
  fetchAllPlayers,
  fetchFeaturedPlayers,
  fetchFeaturedPlayerIds,
  addFeaturedPlayer,
  removeFeaturedPlayer,
  reorderFeaturedPlayers,
} from '@/api/players'
import { filterPlayersByName } from '@/utils/searchFilter'
import PlayerAvatar from '@/components/ui/PlayerAvatar'
import StarButton from '@/components/ui/StarButton'
import { fmtStat, fmtPct } from '@/utils/formatters'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import ErrorCard from '@/components/ui/ErrorCard'
import SectionHeader from '@/components/ui/SectionHeader'
import { SortableFeaturedStrip, type SortableDragHandleProps } from '@/components/featured/SortableFeaturedStrip'
import { StatHeader } from '@/components/ui/StatHeader'
import type { Player } from '@/types'

type SortKey = 'name' | 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fg_pct'

function FeaturedPlayerCard({
  row,
  pid,
  handle,
  dim,
  onRemoveFeatured,
}: {
  row: Record<string, unknown>
  pid: number
  handle?: SortableDragHandleProps
  dim?: boolean
  onRemoveFeatured: (e: MouseEvent, pid: number) => void
}) {
  const base = ((row.base ?? []) as Record<string, unknown>[])[0] ?? {}
  return (
    <div
      className={`group relative bg-surface-2 rounded-lg flex items-stretch overflow-hidden hover:bg-surface-3/80 transition-colors ${
        dim ? 'opacity-[0.28]' : ''
      }`}
    >
      {handle ? (
        <button
          type="button"
          {...handle.attributes}
          {...handle.listeners}
          aria-label={`Reorder ${String(row.name)}`}
          title="Drag to reorder favorites"
          className="flex items-center px-1.5 cursor-grab active:cursor-grabbing text-text-secondary hover:text-sky-300/90 select-none border-r border-border shrink-0 touch-none"
        >
          <span className="text-sm leading-none tracking-tighter" aria-hidden>
            ⠿
          </span>
        </button>
      ) : null}
      <Link to={`/players/${pid}`} className="p-3 flex items-center gap-3 min-w-0 flex-1 pr-10">
        <PlayerAvatar playerId={pid} name={String(row.name)} className="w-10 h-10 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{String(row.name)}</div>
          <div className="text-xs text-text-secondary flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
            <span>{fmtStat(base.pts as number)} PPG</span>
            <span>{fmtStat(base.reb as number)} RPG</span>
            <span>{fmtStat(base.ast as number)} APG</span>
          </div>
        </div>
      </Link>
      <div className="absolute top-2 right-2 z-10 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
        <StarButton starred onToggle={(e) => onRemoveFeatured(e, pid)} className="drop-shadow-md" />
      </div>
    </div>
  )
}

const SORT_OPTIONS: { label: string; key: SortKey }[] = [
  { label: 'Name', key: 'name' },
  { label: 'PPG', key: 'pts' },
  { label: 'RPG', key: 'reb' },
  { label: 'APG', key: 'ast' },
  { label: 'SPG', key: 'stl' },
  { label: 'BPG', key: 'blk' },
  { label: 'FG%', key: 'fg_pct' },
]

export default function PlayersPage() {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const queryClient = useQueryClient()

  const { data: players, isLoading, isError, refetch } = useQuery({
    queryKey: ['players', 'all'],
    queryFn: () => fetchAllPlayers(),
    staleTime: 60 * 60 * 1000,
  })
  const { data: featuredIds = [] } = useQuery({
    queryKey: ['featured', 'ids'],
    queryFn: fetchFeaturedPlayerIds,
    staleTime: 60 * 60 * 1000,
  })

  const toggleFeatured = async (e: React.MouseEvent, pid: number) => {
    e.preventDefault()
    const isStarred = (featuredIds as number[]).includes(pid)
    if (isStarred) await removeFeaturedPlayer(pid)
    else await addFeaturedPlayer(pid)
    queryClient.invalidateQueries({ queryKey: ['featured'] })
  }

  const filtered = useMemo(() => {
    let list = filterPlayersByName(players ?? [], query)
    if (sortKey === 'name') {
      list = [...list].sort((a, b) => a.display_name.localeCompare(b.display_name))
    } else {
      list = [...list].sort((a, b) => ((b[sortKey] as number) ?? -Infinity) - ((a[sortKey] as number) ?? -Infinity))
    }
    return list
  }, [players, query, sortKey])

  const showTable = sortKey !== 'name'

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Players</h1>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          placeholder="Search by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-48 max-w-xs bg-surface-2 border border-border rounded-lg px-4 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-nba-red"
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-secondary">Sort</span>
          <div className="flex gap-1">
            {SORT_OPTIONS.map(({ label, key }) => (
              <button
                key={key}
                onClick={() => setSortKey(key)}
                className={`px-2.5 py-1.5 text-xs rounded transition-colors ${
                  sortKey === key ? 'bg-nba-red text-white' : 'bg-surface-2 text-text-secondary hover:text-text-primary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Featured players strip */}
      {!query && sortKey === 'name' && <FeaturedStrip />}

      {isLoading && <LoadingSpinner label="Loading players…" />}
      {isError && <ErrorCard onRetry={refetch} />}

      {!isLoading && !isError && (
        <div>
          <p className="text-xs text-text-secondary mb-3">
            {filtered.length} players{query && ` matching "${query}"`}
          </p>

          {showTable ? (
            <PlayerTable players={filtered} sortKey={sortKey} featuredIds={featuredIds as number[]} onToggleFeatured={toggleFeatured} />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {filtered.map((p) => (
                <PlayerCard key={p.player_id} player={p} starred={(featuredIds as number[]).includes(p.player_id)} onToggleFeatured={toggleFeatured} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PlayerTable({ players, sortKey, featuredIds, onToggleFeatured }: { players: Player[]; sortKey: SortKey; featuredIds: number[]; onToggleFeatured: (e: React.MouseEvent, id: number) => void }) {
  const cols: { label: string; key: SortKey; statCol: string; fmt: (p: Player) => string }[] = [
    { label: 'Player', key: 'name', statCol: 'display_name', fmt: (p) => p.display_name },
    { label: 'Team', key: 'name', statCol: 'team', fmt: (p) => p.team_abbreviation ?? '—' },
    { label: 'Pos', key: 'name', statCol: 'position', fmt: (p) => p.position ?? '—' },
    { label: 'GP', key: 'name', statCol: 'gp', fmt: (p) => p.gp != null ? String(p.gp) : '—' },
    { label: 'PPG', key: 'pts', statCol: 'pts', fmt: (p) => fmtStat(p.pts) },
    { label: 'RPG', key: 'reb', statCol: 'reb', fmt: (p) => fmtStat(p.reb) },
    { label: 'APG', key: 'ast', statCol: 'ast', fmt: (p) => fmtStat(p.ast) },
    { label: 'SPG', key: 'stl', statCol: 'stl', fmt: (p) => fmtStat(p.stl) },
    { label: 'BPG', key: 'blk', statCol: 'blk', fmt: (p) => fmtStat(p.blk) },
    { label: 'FG%', key: 'fg_pct', statCol: 'fg_pct', fmt: (p) => fmtPct(p.fg_pct) },
  ]

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-text-secondary border-b border-border">
            <th className="text-left py-2 pr-3 w-6">#</th>
            {cols.map((c) => (
              <StatHeader
                key={c.label}
                colKey={c.statCol}
                label={c.label}
                align={c.label === 'Player' ? 'left' : 'right'}
                className={`py-2 px-2 ${c.key === sortKey ? 'text-text-primary' : ''}`}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((p, i) => (
            <tr key={p.player_id} className="border-b border-border/40 hover:bg-surface-2 transition-colors">
              <td className="py-2 pr-3 text-text-secondary text-xs flex items-center gap-1">
                <StarButton starred={featuredIds.includes(p.player_id)} onToggle={(e) => onToggleFeatured(e, p.player_id)} />
                {i + 1}
              </td>
              {cols.map((c) => (
                <td key={c.label} className={`py-2 px-2 tabular-nums ${c.label === 'Player' ? 'text-left' : 'text-right'} ${c.key === sortKey && c.label !== 'Player' && c.label !== 'Team' && c.label !== 'Pos' && c.label !== 'GP' ? 'text-nba-gold font-semibold' : ''}`}>
                  {c.label === 'Player' ? (
                    <Link to={`/players/${p.player_id}`} className="hover:text-sky-400 transition-colors flex items-center gap-2">
                      <PlayerAvatar playerId={p.player_id} name={p.display_name} className="w-7 h-7" />
                      {p.display_name}
                    </Link>
                  ) : c.fmt(p)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PlayerCard({ player: p, starred, onToggleFeatured }: { player: Player; starred: boolean; onToggleFeatured: (e: React.MouseEvent, id: number) => void }) {
  return (
    <Link
      to={`/players/${p.player_id}`}
      className="bg-surface-2 rounded-lg p-3 hover:bg-surface-3 transition-colors flex items-center gap-3 group relative"
    >
      <PlayerAvatar playerId={p.player_id} name={p.display_name} className="w-10 h-10" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate group-hover:text-nba-red transition-colors">
          {p.display_name}
        </div>
        <div className="text-xs text-text-secondary flex gap-1">
          <span>{p.team_abbreviation ?? '—'}</span>
          {p.position && <><span>·</span><span>{p.position}</span></>}
        </div>
      </div>
      <StarButton starred={starred} onToggle={(e) => onToggleFeatured(e, p.player_id)} className="flex-shrink-0" />
    </Link>
  )
}

function FeaturedStrip() {
  const queryClient = useQueryClient()
  const [featAddQuery, setFeatAddQuery] = useState('')
  const [featAddOpen, setFeatAddOpen] = useState(false)
  const featuredReorderBusyRef = useRef(false)

  const { data: allPlayers = [] } = useQuery({
    queryKey: ['players', 'all'],
    queryFn: () => fetchAllPlayers(),
    staleTime: 60 * 60 * 1000,
  })
  const { data: featuredIds = [] } = useQuery({
    queryKey: ['featured', 'ids'],
    queryFn: fetchFeaturedPlayerIds,
    staleTime: 60 * 60 * 1000,
  })
  const { data, isLoading } = useQuery({
    queryKey: ['featured'],
    queryFn: fetchFeaturedPlayers,
    staleTime: 60 * 60 * 1000,
  })

  const featAddResults = useMemo(() => {
    const q = featAddQuery.trim()
    if (!q) return []
    const ids = new Set(featuredIds as number[])
    return filterPlayersByName(
      allPlayers.filter((p) => !ids.has(p.player_id)),
      q,
    ).slice(0, 8)
  }, [allPlayers, featuredIds, featAddQuery])

  const addFeaturedFromSearch = async (pid: number) => {
    await addFeaturedPlayer(pid)
    setFeatAddQuery('')
    setFeatAddOpen(false)
    queryClient.invalidateQueries({ queryKey: ['featured'] })
  }

  const removeFeaturedOnly = async (e: React.MouseEvent, pid: number) => {
    e.preventDefault()
    await removeFeaturedPlayer(pid)
    queryClient.invalidateQueries({ queryKey: ['featured'] })
  }

  const commitFeaturedPlayerOrder = useCallback(
    async (orderedIds: string[]) => {
      if (featuredReorderBusyRef.current) return
      featuredReorderBusyRef.current = true
      try {
        await reorderFeaturedPlayers(orderedIds.map(Number))
        await queryClient.invalidateQueries({ queryKey: ['featured'] })
      } catch (err) {
        console.error(err)
      } finally {
        featuredReorderBusyRef.current = false
      }
    },
    [queryClient],
  )

  const players = (data ?? []) as Record<string, unknown>[]
  const featuredServerIds = useMemo(() => players.map((p) => String(p.id)), [players])
  const featuredPlayerById = useMemo(
    () => Object.fromEntries(players.map((p) => [String(p.id), p])) as Record<string, Record<string, unknown>>,
    [players],
  )

  const headerRight = (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto sm:justify-end sm:max-w-md ml-auto">
      <div className="relative w-full sm:w-56 shrink-0">
        <input
          type="text"
          value={featAddQuery}
          onChange={(e) => {
            setFeatAddQuery(e.target.value)
            setFeatAddOpen(true)
          }}
          onFocus={() => setFeatAddOpen(true)}
          onBlur={() => setTimeout(() => setFeatAddOpen(false), 180)}
          placeholder="Search to add player…"
          aria-label="Search players to add to featured"
          className="w-full bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-nba-red/60"
        />
        {featAddOpen && featAddQuery.trim() && (
          <ul className="absolute z-30 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-2 shadow-xl py-1">
            {featAddResults.length === 0 ? (
              <li className="px-3 py-2 text-xs text-text-secondary">No matching players</li>
            ) : (
              featAddResults.map((pl) => (
                <li key={pl.player_id}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-surface-3 flex items-center gap-2"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void addFeaturedFromSearch(pl.player_id)}
                  >
                    <PlayerAvatar playerId={pl.player_id} name={pl.display_name} className="w-8 h-8 shrink-0" />
                    <span className="truncate">
                      <span className="font-medium">{pl.display_name}</span>
                      {pl.team_abbreviation ? (
                        <span className="text-text-secondary text-xs ml-1">{pl.team_abbreviation}</span>
                      ) : null}
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
  )

  if (isLoading) {
    return (
      <div className="mb-6">
        <SectionHeader title="Featured Players" right={headerRight} />
        <LoadingSpinner label="Loading featured…" />
      </div>
    )
  }

  return (
    <div className="mb-6">
      <SectionHeader title="Featured Players" right={headerRight} />
      {players.length === 0 ? (
        <p className="text-sm text-text-secondary">
          No featured players yet. Use the search above or star players in the list below.
        </p>
      ) : (
        <SortableFeaturedStrip
          serverOrderedIds={featuredServerIds}
          onCommit={commitFeaturedPlayerOrder}
          renderItem={(id, handle, isDragging) => {
            const row = featuredPlayerById[id]
            if (!row) return null
            const pid = Number(id)
            return (
              <FeaturedPlayerCard
                row={row}
                pid={pid}
                handle={handle}
                dim={isDragging}
                onRemoveFeatured={removeFeaturedOnly}
              />
            )
          }}
          renderOverlay={(id) => {
            const row = featuredPlayerById[id]
            if (!row) return null
            return <FeaturedPlayerCard row={row} pid={Number(id)} onRemoveFeatured={removeFeaturedOnly} />
          }}
        />
      )}
    </div>
  )
}
