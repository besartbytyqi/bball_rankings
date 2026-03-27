import type { Player } from '@/types'

export function filterPlayersByName(players: Player[], query: string): Player[] {
  if (!query.trim()) return players
  const q = query.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
  return players.filter((p) => {
    const name = p.display_name.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    return name.includes(q)
  })
}
