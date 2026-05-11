import type { DiscoveredGamesLeague } from '@/lib/polymarket/games-leagues'
import { revalidateTag } from 'next/cache'
import { connection, NextResponse } from 'next/server'
import { z } from 'zod'
import { isCronAuthorized } from '@/lib/auth-cron'
import { cacheTags } from '@/lib/cache-tags'
import { TeamsCacheRepository } from '@/lib/db/queries/teams-cache'
import { POLYMARKET_GAMMA_BASE_DEFAULT } from '@/lib/polymarket/constants'
import { DISCOVERED_GAMES_LEAGUES } from '@/lib/polymarket/games-leagues'

interface LeagueSyncResult {
  league: string
  status: 'ok' | 'network_error' | 'schema_error' | 'partial'
  team_count?: number
  skipped_count?: number
  error_count?: number
  error?: string
}

interface TeamsSyncResponse {
  ok: boolean
  disabled?: boolean
  message?: string
  league_count?: number
  results?: LeagueSyncResult[]
}

/**
 * Polymarket Gamma `/teams` response schema.
 *
 * Verified against `tests/fixtures/polymarket-gamma-mlb-teams.json` (32 entries
 * — 30 real MLB teams + 2 league-level all-star placeholders, "American" and
 * "National", which are filtered out by `isLeaguePlaceholder` below).
 *
 * Optional fields tolerate Polymarket adding/removing entries on individual
 * teams (e.g., a team without a logo during preseason) — we only require the
 * fields we actually persist.
 */
const TeamSchema = z.object({
  id: z.coerce.string(),
  name: z.string(),
  league: z.string(),
  abbreviation: z.string(),
  alias: z.string().optional().nullable(),
  logo: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  record: z.string().optional().nullable(),
})

const TeamsResponseSchema = z.array(TeamSchema)

/**
 * League-level placeholder filter (e.g. MLB returns the All-Star roster
 * placeholders "American" / "National" alongside the 30 real teams). These are
 * NOT real teams and must NOT be persisted to `teams_cache` — the projection
 * layer parses team abbreviations from per-game slugs and would never match
 * these. Three layered tiers, evaluated in order:
 *
 *   Tier 1 (authoritative): the abbreviation matches a known league-level
 *     placeholder, sourced from the league registry's `placeholderAbbreviations`
 *     field (`src/lib/polymarket/games-leagues.ts`). Source-of-truth migration
 *     (Phase B v2 v2): the per-league Set lives on the registry entry, not here.
 *   Tier 2 (always-on belt-and-suspenders): the team name contains the literal
 *     "all-star" substring — catches abbreviations we haven't yet enumerated.
 *   Tier 3 (opt-in heuristic): both `logo` and `color` are null. Per Polymarket
 *     support, placeholder rosters consistently ship with both null — but so do
 *     some real teams (FIFA WC Switzerland, WNBA expansion teams), so this tier
 *     is OPT-IN per-league via `DiscoveredGamesLeague.applyLogoColorPlaceholderHeuristic`.
 *
 * Adding a league: populate `placeholderAbbreviations` on the registry entry;
 * set `applyLogoColorPlaceholderHeuristic: true` only if the league has rotating
 * all-star / international rosters that may introduce new placeholder variants.
 */
function isLeaguePlaceholder(
  team: z.infer<typeof TeamSchema>,
  league: DiscoveredGamesLeague,
): boolean {
  const abbr = team.abbreviation.toLowerCase()

  // Tier 1 (authoritative): explicit per-league Set. Workstream-1 caught
  // all-star/exhibition rosters via this mechanism in Phase B v2 v2.
  if (league.placeholderAbbreviations?.has(abbr)) {
    return true
  }

  // Tier 2 (always-on belt-and-suspenders): name-pattern match. Catches
  // rosters whose abbreviation we haven't yet enumerated but whose name
  // string contains the standard "All-Star" tell.
  if (team.name.toLowerCase().includes('all-star')) {
    return true
  }

  // Tier 3 (opt-in heuristic): logo+color absence. Per Polymarket support,
  // placeholder rosters consistently ship with both null. Per the empirical
  // §Investigate.E probe, real teams in FIFA WC (Switzerland) and WNBA
  // (expansion teams) ALSO ship with both null — the heuristic is therefore
  // OPT-IN per-league via `applyLogoColorPlaceholderHeuristic`. Default off.
  if (league.applyLogoColorPlaceholderHeuristic && team.logo == null && team.color == null) {
    return true
  }

  return false
}

function getGammaBase(): string {
  return process.env.POLYMARKET_GAMMA_BASE || POLYMARKET_GAMMA_BASE_DEFAULT
}

/**
 * GET / POST /api/sync/polymarket-teams
 *
 * Per-league teams cache sync (Phase B v2). Triggered hourly by pg_cron at :17.
 * For each enabled Phase B league:
 *   1. Polls `GET /teams?league=<slug>&limit=50` from Polymarket Gamma
 *   2. Filters out league-level placeholders (e.g. MLB All-Star rosters)
 *   3. Upserts each real team into `teams_cache` keyed by (league, abbreviation)
 *   4. On per-team failure, calls `markFailure` (preserves last-known-good metadata)
 *   5. After per-league processing, invalidates `cacheTags.teamsCache(league)`
 *
 * Default-off via `POLYMARKET_GAMES_DISCOVERY_ENABLED=false` env var (shared
 * with the per-game discovery route — Phase B v2 reuses the same kill switch
 * since teams data only matters when per-game discovery is enabled).
 */
async function handleTeamsSync(request: Request): Promise<NextResponse<TeamsSyncResponse | { error: string }>> {
  // Cache Components: opt this route out of static rendering.
  await connection()

  const auth = request.headers.get('authorization')
  if (!isCronAuthorized(auth, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 })
  }

  // Kill switch — share with per-game discovery. When per-game discovery is
  // disabled, teams sync is moot (nothing reads `teams_cache` until per-game
  // pages render). Operators flip both at once via the same env var.
  const flag = (process.env.POLYMARKET_GAMES_DISCOVERY_ENABLED ?? 'false').toLowerCase()
  if (flag !== 'true' && flag !== '1') {
    return NextResponse.json({
      ok: true,
      disabled: true,
      message: 'POLYMARKET_GAMES_DISCOVERY_ENABLED is not set to "true". Skipping teams sync.',
    })
  }

  const results: LeagueSyncResult[] = []

  for (const league of DISCOVERED_GAMES_LEAGUES) {
    const url = `${getGammaBase()}/teams?league=${encodeURIComponent(league.slug)}&limit=50`

    let res: Response
    try {
      res = await fetch(url, {
        cache: 'no-store',
        headers: {
          'User-Agent': 'WirePredictions/1.0 (+https://wirepredictions.vercel.app)',
          'Accept': 'application/json',
        },
      })
    }
    catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      results.push({
        league: league.slug,
        status: 'network_error',
        error: message,
      })
      continue
    }

    if (!res.ok) {
      results.push({
        league: league.slug,
        status: 'network_error',
        error: `Gamma /teams returned HTTP ${res.status}`,
      })
      continue
    }

    let raw: unknown
    try {
      raw = await res.json()
    }
    catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      results.push({
        league: league.slug,
        status: 'schema_error',
        error: `JSON parse failed: ${message}`,
      })
      continue
    }

    const parsed = TeamsResponseSchema.safeParse(raw)
    if (!parsed.success) {
      results.push({
        league: league.slug,
        status: 'schema_error',
        error: `Zod validation failed: ${parsed.error.issues.length} issue(s)`,
      })
      continue
    }

    let teamCount = 0
    let skippedCount = 0
    let errorCount = 0

    for (const team of parsed.data) {
      if (isLeaguePlaceholder(team, league)) {
        skippedCount++
        continue
      }

      try {
        // PreWork.1: persist `league.slug` (the iteration value from the league
        // registry, used to construct the Gamma request) rather than
        // `team.league` from the upstream response. Polymarket can return
        // case/format variants (e.g. "MLB" vs "mlb") on individual rows; the
        // projection layer's `getByAbbreviation(league, abbreviation)` lookup
        // would miss while a row exists under the upstream-formatted league
        // value. Pinning to the registry slug keeps writes and reads symmetric.
        const upsert = await TeamsCacheRepository.upsertSuccess({
          league: league.slug,
          team_id: team.id,
          name: team.name,
          alias: team.alias ?? null,
          abbreviation: team.abbreviation.toLowerCase(),
          logo_url: team.logo ?? null,
          color: team.color ?? null,
          record: team.record ?? null,
        })

        if (upsert.error || !upsert.data) {
          await TeamsCacheRepository.markFailure({
            league: league.slug,
            abbreviation: team.abbreviation.toLowerCase(),
            error: upsert.error || 'upsert returned no row',
          })
          errorCount++
          continue
        }

        teamCount++
      }
      catch (err) {
        const message = err instanceof Error ? err.message : 'unknown'
        await TeamsCacheRepository.markFailure({
          league: league.slug,
          abbreviation: team.abbreviation.toLowerCase(),
          error: message,
        })
        errorCount++
      }
    }

    // Invalidate cached reads for this league after all upserts complete.
    revalidateTag(cacheTags.teamsCache(league.slug), 'max')

    results.push({
      league: league.slug,
      status: errorCount > 0 ? 'partial' : 'ok',
      team_count: teamCount,
      skipped_count: skippedCount,
      error_count: errorCount,
    })
  }

  return NextResponse.json({
    ok: true,
    league_count: DISCOVERED_GAMES_LEAGUES.length,
    results,
  })
}

export async function GET(request: Request) {
  return handleTeamsSync(request)
}

export async function POST(request: Request) {
  return handleTeamsSync(request)
}
