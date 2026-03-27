import { STAT_DEFS } from '@/utils/statDefs'

/** Human label → tooltip key lookup for display headers that aren't snake_case DB keys */
const LABEL_TO_KEY: Record<string, string> = {
  date: 'game_date',
  pts: 'pts',
  matchup: 'matchup',
  'w/l': 'wl',
  w: 'w',
  l: 'l',
  'min': 'min',
  reb: 'reb',
  ast: 'ast',
  stl: 'stl',
  blk: 'blk',
  'fg%': 'fg_pct',
  '3p%': 'fg3_pct',
  'ft%': 'ft_pct',
  '+/-': 'plus_minus',
  stat: 'stat',
  rank: 'rank',
  player: 'display_name',
  pos: 'position',
  team: 'team',
  value: 'value',
  season: 'season',
  action: 'action',
}

function resolveTitle(colKey: string, displayLabel: string): string | undefined {
  const k = colKey.toLowerCase()
  if (STAT_DEFS[k]) return STAT_DEFS[k]
  if (STAT_DEFS[colKey]) return STAT_DEFS[colKey]
  const mapped = LABEL_TO_KEY[displayLabel.toLowerCase().trim()]
  if (mapped && STAT_DEFS[mapped]) return STAT_DEFS[mapped]
  return undefined
}

type Align = 'left' | 'right'

export function StatHeader({
  colKey,
  label,
  className = '',
  align = 'right',
  title: titleProp,
}: {
  colKey: string
  label: string
  className?: string
  align?: Align
  /** When set, used as the native tooltip instead of STAT_DEFS lookup */
  title?: string
}) {
  const title = titleProp ?? resolveTitle(colKey, label)
  const alignCls = align === 'left' ? 'text-left' : 'text-right'
  if (title) {
    return (
      <th className={`${alignCls} py-1.5 px-2 ${className}`}>
        <span title={title} className="cursor-help border-b border-dashed border-text-secondary/40">
          {label}
        </span>
      </th>
    )
  }
  return <th className={`${alignCls} py-1.5 px-2 ${className}`}>{label}</th>
}
