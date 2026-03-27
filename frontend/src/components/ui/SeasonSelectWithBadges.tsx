import { useEffect, useId, useMemo, useRef, useState } from 'react'

/** Tags returned by GET /api/players/{id}/season-awards */
export const SEASON_AWARD_ORDER = ['champion', 'fmvp', 'mvp', 'roy', 'smoy'] as const
export type SeasonAwardTag = (typeof SEASON_AWARD_ORDER)[number]

const TAG_LABELS: Record<string, string> = {
  champion: 'NBA champion',
  fmvp: 'Finals MVP',
  mvp: 'Most Valuable Player',
  roy: 'Rookie of the Year',
  smoy: 'Sixth Man of the Year',
}

/** Legend row matching icons shown next to seasons in the picker (compare / profile). */
export function SeasonAwardIconsLegend({ className }: { className?: string }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${className ?? ''}`}
      role="list"
      aria-label="Award icons shown in the season list"
    >
      {SEASON_AWARD_ORDER.map((tag) => (
        <div key={tag} className="flex items-center gap-1.5" role="listitem">
          <AwardIcon tag={tag} />
          <span className="text-xs text-text-primary">{TAG_LABELS[tag] ?? tag}</span>
        </div>
      ))}
    </div>
  )
}

function orderedTags(raw: string[] | undefined): string[] {
  if (!raw?.length) return []
  const set = new Set(raw)
  return SEASON_AWARD_ORDER.filter((t) => set.has(t))
}

function AwardIcon({ tag }: { tag: string }) {
  const common = 'w-3.5 h-3.5 shrink-0'
  switch (tag) {
    case 'champion':
      return (
        <svg className={`${common} text-amber-400`} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <path d="M4 3h8v1c0 1.1.6 2 1.5 2.5L12 9H4l-.5-2.5C4.6 6 5.2 5 5.2 4V3zm1 0V2h6v1H5zm-.8 4h7.6l.3 1.5H4.9L4.2 7zm1.3 3h5l-.4 4H5.9l-.4-4z" />
        </svg>
      )
    case 'fmvp':
      return (
        <svg className={`${common} text-amber-300`} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <path d="M8 1.2l1.4 3.5 3.8.3-2.9 2.4 1 3.7L8 9.4 4.7 11l1-3.7-2.9-2.4 3.8-.3L8 1.2z" />
        </svg>
      )
    case 'mvp':
      return (
        <svg className={`${common} text-yellow-400`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
          <path d="M8 2l1.2 3.6h3.8l-3 2.3 1.2 3.7L8 10.3 4.8 11.6 6 7.9 3 5.6h3.8L8 2z" />
        </svg>
      )
    case 'roy':
      return (
        <svg className={`${common} text-emerald-400`} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <path d="M8 2c.8 1.6 2.2 2.4 4 2.6-.6 2.4-2 4.2-4 5.2-2-1-3.4-2.8-4-5.2 1.8-.2 3.2-1 4-2.6zm0 3.2a2.2 2.2 0 100 4.4 2.2 2.2 0 000-4.4z" />
        </svg>
      )
    case 'smoy':
      return (
        <svg className={`${common} text-sky-400`} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <rect x="2" y="6" width="12" height="2" rx="0.5" />
          <rect x="3" y="9" width="4" height="5" rx="0.5" />
          <rect x="9" y="9" width="4" height="5" rx="0.5" />
        </svg>
      )
    default:
      return null
  }
}

function AwardIconRow({ tags, className }: { tags: string[]; className?: string }) {
  const list = orderedTags(tags)
  if (!list.length) return null
  return (
    <span className={`inline-flex items-center gap-0.5 ${className ?? ''}`} role="img" aria-label={list.map((t) => TAG_LABELS[t] ?? t).join(', ')}>
      {list.map((t) => (
        <span key={t} className="inline-flex" title={TAG_LABELS[t]}>
          <AwardIcon tag={t} />
        </span>
      ))}
    </span>
  )
}

type SeasonSelectWithBadgesProps = {
  seasons: string[]
  value: string | undefined
  onChange: (season: string | undefined) => void
  teamMap: Record<string, string>
  showCurrentSeason?: boolean
  currentLabel?: string
  /** From GET /players/{id}/season-awards */
  awardsBySeason?: Record<string, string[]>
  disabled?: boolean
  /** compare = sky border accent; profile = default border */
  variant?: 'compare' | 'profile'
  'aria-label'?: string
}

export function SeasonSelectWithBadges({
  seasons,
  value,
  onChange,
  teamMap,
  showCurrentSeason = true,
  currentLabel = 'Current season (app)',
  awardsBySeason = {},
  disabled = false,
  variant = 'compare',
  'aria-label': ariaLabel = 'Season',
}: SeasonSelectWithBadgesProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const selectId = useId()

  const isCurrent = showCurrentSeason && value === undefined
  const effectiveValue = value ?? (showCurrentSeason ? undefined : seasons[0])

  const rowTitle = (s: string) => {
    const ab = teamMap[s]
    return ab ? `${s} · ${ab}` : s
  }

  const displayLabel = isCurrent
    ? currentLabel
    : effectiveValue
      ? rowTitle(effectiveValue)
      : currentLabel

  const borderClass =
    variant === 'compare'
      ? 'border-sky-500/35 focus:border-sky-400'
      : 'border-border focus:border-nba-red'

  const textSz = variant === 'profile' ? 'text-sm' : 'text-xs'

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const currentRowTags = useMemo(() => {
    if (isCurrent || !effectiveValue) return []
    return awardsBySeason[effectiveValue] ?? []
  }, [awardsBySeason, effectiveValue, isCurrent])

  const optionSelected = (s: string) => effectiveValue === s

  const pick = (next: string | undefined) => {
    onChange(next)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative inline-block min-w-[12rem] max-w-[min(100%,20rem)]">
      <button
        type="button"
        id={selectId}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 bg-surface-3 border rounded px-2 py-1 ${textSz} text-left text-text-primary focus:outline-none ${borderClass} disabled:opacity-40`}
      >
        <span className="truncate flex items-center gap-1.5 min-w-0">
          <span className="truncate">{displayLabel}</span>
          <AwardIconRow tags={currentRowTags} />
        </span>
        <span className="text-text-secondary shrink-0" aria-hidden>
          ▾
        </span>
      </button>
      {open && !disabled ? (
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={selectId}
          className={`absolute z-50 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-surface-2 shadow-xl py-1 ${textSz}`}
        >
          {showCurrentSeason ? (
            <li role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={isCurrent}
                className={`w-full text-left px-2 py-1.5 flex items-center justify-between gap-2 hover:bg-surface-3 ${isCurrent ? 'bg-surface-3/80' : ''}`}
                onClick={() => pick(undefined)}
              >
                <span>{currentLabel}</span>
              </button>
            </li>
          ) : null}
          {seasons.map((s) => {
            const selected = optionSelected(s)
            const tags = awardsBySeason[s] ?? []
            return (
              <li key={s} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`w-full text-left px-2 py-1.5 flex items-center justify-between gap-2 hover:bg-surface-3 ${selected ? 'bg-surface-3/80' : ''}`}
                  onClick={() => pick(s)}
                >
                  <span className="truncate">{teamMap[s] ? `${s} · ${teamMap[s]}` : s}</span>
                  <AwardIconRow tags={tags} className="shrink-0" />
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
