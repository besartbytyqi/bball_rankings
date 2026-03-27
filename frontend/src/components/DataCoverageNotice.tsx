import { useQuery } from '@tanstack/react-query'
import { fetchDataCoverage } from '@/api/data'

type Focus = 'gamelog' | 'stats'

export default function DataCoverageNotice({
  playerId,
  teamId,
  focus,
}: {
  playerId?: number
  teamId?: number
  focus: Focus
}) {
  const enabled = playerId != null || teamId != null
  const { data, isLoading } = useQuery({
    queryKey: ['data-coverage', playerId ?? null, teamId ?? null],
    queryFn: () => fetchDataCoverage({ playerId, teamId }),
    staleTime: 60_000,
    enabled,
  })

  if (!enabled) return null
  if (isLoading || !data) return null

  const t = data.tables
  const leagueLine =
    t.player_gamelog > 0 || t.team_gamelog > 0
      ? `League snapshot: ${t.player_gamelog.toLocaleString()} player game rows, ${t.team_gamelog.toLocaleString()} team game rows in SQLite.`
      : 'No game logs in SQLite yet; tables below may come from the live API.'

  const extraHint =
    focus === 'stats' && (data.sample_player_extra_stat_keys?.length ?? 0) > 0
      ? ' Extra per-game fields from imports (FGM, TOV, etc.) appear in the section below when present.'
      : ''

  if (playerId != null && data.player) {
    const n = data.player.player_gamelog_games
    return (
      <div className="rounded-lg border border-sky-500/20 bg-sky-950/25 px-3 py-2 mb-3 text-[11px] leading-relaxed text-text-secondary">
        <p>
          <span className="font-semibold text-sky-200/95">Local database</span>
          {' · '}
          {focus === 'gamelog' ? (
            <>
              This player has <span className="text-text-primary font-medium tabular-nums">{n}</span> games on file
              for {data.current_season}. {leagueLine}
            </>
          ) : (
            <>
              Season tables can include merged columns beyond the summary grid.{extraHint} {leagueLine}
            </>
          )}
        </p>
        <p className="mt-1.5 text-text-secondary/90">
          Missing rows? Run <code className="text-sky-200/80 bg-surface-3 px-1 rounded">python seed.py --season {data.current_season}</code>
          {' '}to refresh local data.
        </p>
      </div>
    )
  }

  if (teamId != null && data.team) {
    const n = data.team.team_gamelog_games
    const opp = data.team.team_gamelog_with_opp_pts
    return (
      <div className="rounded-lg border border-sky-500/20 bg-sky-950/25 px-3 py-2 mb-3 text-[11px] leading-relaxed text-text-secondary">
        <p>
          <span className="font-semibold text-sky-200/95">Local database</span>
          {' · '}
          {focus === 'gamelog' ? (
            <>
              This team has <span className="text-text-primary font-medium tabular-nums">{n}</span> games on file for{' '}
              {data.current_season}.
              {opp > 0 ? (
                <>
                  {' '}
                  Opponent points are stored for <span className="tabular-nums text-text-primary">{opp}</span> of those games.
                </>
              ) : (
                ' Opponent points will appear in the log when that column is populated in the DB.'
              )}{' '}
              {leagueLine}
            </>
          ) : (
            <>
              Team stat rows can include extra fields from imports; open &quot;Additional local stats&quot; when shown.{extraHint}{' '}
              {leagueLine}
            </>
          )}
        </p>
        <p className="mt-1.5 text-text-secondary/90">
          Missing rows? Run <code className="text-sky-200/80 bg-surface-3 px-1 rounded">python seed.py --season {data.current_season}</code>
          {' '}to refresh local data.
        </p>
      </div>
    )
  }

  return null
}
