import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAllPlayers } from '@/api/players'
import { fetchTeams } from '@/api/teams'
import { filterPlayersByName } from '@/utils/searchFilter'

export function EntitySelector({
  type, label, selectedId, onSelect, includeInactive,
}: {
  type: 'player' | 'team'
  label: string
  selectedId?: number
  onSelect: (id: number, name: string) => void
  /** When true, loads retired/inactive players (larger list; use on Compare / Dream Team). */
  includeInactive?: boolean
}) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const inc = !!includeInactive
  const { data: players } = useQuery({
    queryKey: ['players', 'all', inc],
    queryFn: () => fetchAllPlayers({ includeInactive: inc }),
    staleTime: 60 * 60 * 1000,
    enabled: type === 'player',
  })
  const { data: teams } = useQuery({ queryKey: ['teams'], queryFn: fetchTeams, staleTime: Infinity, enabled: type === 'team' })

  const selectedName = selectedId
    ? (type === 'player'
        ? players?.find((p) => p.player_id === selectedId)?.display_name
        : teams?.find((t) => t.id === selectedId)?.name)
    : undefined

  const results = useMemo(() => {
    if (!focused && !query) return []
    if (type === 'player') return filterPlayersByName(players ?? [], query).slice(0, 8)
    if (!query.trim()) return (teams ?? []).slice(0, 8)
    const q = query.toLowerCase()
    return (teams ?? []).filter((t) => t.name.toLowerCase().includes(q) || t.abbr.toLowerCase().includes(q)).slice(0, 8)
  }, [type, players, teams, query, focused])

  const showDropdown = focused && (!!query || (type === 'team' && results.length > 0))

  return (
    <div className="relative">
      <label className="block text-xs text-text-secondary mb-1">{label}</label>
      {selectedId && selectedName ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-text-secondary shrink-0">Selected:</span>
          <span className="font-semibold text-nba-gold bg-nba-gold/10 border border-nba-gold/35 rounded-md px-2.5 py-1 truncate max-w-full">
            {selectedName}
          </span>
        </div>
      ) : null}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={
            selectedId
              ? `Type to search or change ${type}…`
              : `Search ${type}…`
          }
          className={`w-full bg-surface-2 border rounded px-3 py-2 text-sm focus:outline-none transition-colors ${
            selectedId && !query ? 'border-sky-500/60 text-text-secondary placeholder:text-text-primary' : 'border-border focus:border-sky-500'
          }`}
        />
        {selectedId && !query && (
          <button
            onClick={() => { onSelect(0, ''); setQuery('') }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary text-xs px-1"
            title="Clear selection"
          >
            ✕
          </button>
        )}
      </div>
      {showDropdown && (
        <div className="absolute top-full left-0 right-0 bg-surface-2 border border-border rounded-b-lg shadow-xl z-10 max-h-48 overflow-y-auto">
          {results.map((r) => {
            const id = type === 'player' ? (r as {player_id: number}).player_id : (r as {id: number}).id
            const name = type === 'player' ? (r as {display_name: string}).display_name : (r as {name: string}).name
            return (
              <button
                key={id}
                onClick={() => { onSelect(id, name); setQuery(''); setFocused(false) }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface-3 transition-colors"
              >
                {name}
                {type === 'player' && (
                  <span className="text-text-secondary ml-2 text-xs">
                    {(r as { team_abbreviation?: string }).team_abbreviation}
                    {(r as { is_active?: number }).is_active === 0 ? (
                      <span className="ml-1 text-amber-500/90">· retired</span>
                    ) : null}
                  </span>
                )}
              </button>
            )
          })}
          {results.length === 0 && query && <p className="px-3 py-2 text-sm text-text-secondary">No results</p>}
        </div>
      )}
    </div>
  )
}
