import { useState } from 'react'
import { playerHeadshotUrl } from '@/utils/nbaImages'

// Simple person silhouette as inline SVG data URI (no external dependency)
const FALLBACK_SVG = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239CA3AF'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E`

interface PlayerAvatarProps {
  playerId: number
  name?: string
  className?: string
}

export default function PlayerAvatar({ playerId, name = '', className = 'w-10 h-10' }: PlayerAvatarProps) {
  const [src, setSrc] = useState(playerHeadshotUrl(playerId))
  const [triedCDN, setTriedCDN] = useState(false)

  const handleError = () => {
    if (!triedCDN) {
      setTriedCDN(true)
      setSrc(`https://cdn.nba.com/headshots/nba/latest/1040x760/${playerId}.png`)
    } else {
      setSrc(FALLBACK_SVG)
    }
  }

  return (
    <img
      src={src}
      alt={name}
      className={`rounded-full object-cover bg-surface-3 flex-shrink-0 ${className}`}
      onError={handleError}
    />
  )
}
