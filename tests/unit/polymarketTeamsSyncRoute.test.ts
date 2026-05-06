import { readFileSync } from 'node:fs'
import path from 'node:path'
import { revalidateTag } from 'next/cache'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/sync/polymarket-teams/route'
import { isCronAuthorized } from '@/lib/auth-cron'
import { TeamsCacheRepository } from '@/lib/db/queries/teams-cache'
import { DISCOVERED_GAMES_LEAGUES } from '@/lib/polymarket/games-leagues'

// Mirror the mocking strategy used by `discoveredGamesSyncRoute.test.ts` — the
// route uses `revalidateTag` from `next/cache`, `connection` from `next/server`,
// `isCronAuthorized` from `@/lib/auth-cron`, and the `TeamsCacheRepository`. The
// route also calls the GLOBAL `fetch` directly (not via a wrapper), so we mock
// `globalThis.fetch` for that.
vi.mock('@/lib/db/queries/teams-cache', () => ({
  TeamsCacheRepository: {
    upsertSuccess: vi.fn(),
    markFailure: vi.fn(),
    getByAbbreviation: vi.fn(),
    listByLeague: vi.fn(),
  },
}))
vi.mock('@/lib/auth-cron', () => ({
  isCronAuthorized: vi.fn(() => true),
}))
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return {
    ...actual,
    connection: vi.fn(async () => undefined),
  }
})
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}))

const mockedAuth = vi.mocked(isCronAuthorized)
const mockedRevalidateTag = vi.mocked(revalidateTag)
const mockedRepo = vi.mocked(TeamsCacheRepository)

// Hold a reference to the original global fetch so each test can install its
// own spy without leaking state across tests. We restore it in `afterAll`.
const originalFetch = globalThis.fetch

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/sync/polymarket-teams', {
    method: 'GET',
    headers: {
      authorization: 'Bearer test-secret',
      ...headers,
    },
  })
}

interface TeamFixtureRow {
  id: number
  name: string
  league: string
  abbreviation: string
  alias?: string | null
  logo?: string | null
  color?: string | null
  record?: string | null
}

function loadMlbTeamsFixture(): TeamFixtureRow[] {
  const fixturePath = path.resolve(
    __dirname,
    '..',
    'fixtures',
    'polymarket-gamma-mlb-teams.json',
  )
  return JSON.parse(readFileSync(fixturePath, 'utf8'))
}

/**
 * Build a successful upsert result for the repository mock. The route reads
 * `upsert.error` and `upsert.data` to decide success/failure; the inner row
 * shape is not inspected by the route, so we only need a non-null `data`.
 */
function upsertOk(input: { league: string, abbreviation: string, name: string }) {
  return {
    data: {
      league: input.league,
      teamId: `id-${input.abbreviation}`,
      name: input.name,
      alias: null,
      abbreviation: input.abbreviation,
      logoUrl: null,
      color: null,
      record: null,
      lastSyncedAt: '2026-05-06T00:00:00.000Z',
      lastSyncStatus: 'ok',
      lastSyncError: null,
    },
    error: null,
  }
}

function mockFetchJson(body: unknown, options: { ok?: boolean, status?: number } = {}) {
  const response = {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: vi.fn(async () => body),
  }
  const fetchSpy = vi.fn(async () => response as unknown as Response)
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch
  return { fetchSpy, response }
}

/**
 * Per-league fetch router. The route iterates ALL entries in
 * `DISCOVERED_GAMES_LEAGUES` (Phase B v2 v2 added NBA + NHL alongside MLB).
 * Tests that focus on MLB behavior must serve a per-league response keyed by
 * the `league=<slug>` query param so non-MLB leagues return an empty array
 * (clean `team_count=0` `skipped_count=0` results) rather than receiving the
 * MLB fixture and persisting MLB rows under the wrong league slug.
 *
 * Pass `{ mlb: [...], nba: [...], nhl: [...] }` to control each league
 * individually. Missing keys → empty array (200 OK, zero teams).
 */
function mockFetchPerLeague(
  bodies: Record<string, unknown>,
  options: { ok?: boolean, status?: number } = {},
) {
  const fetchSpy = vi.fn(async (input: unknown) => {
    const url = typeof input === 'string' ? input : (input as URL).toString()
    const match = /league=([^&]+)/.exec(url)
    const slug = match ? decodeURIComponent(match[1]).toLowerCase() : ''
    const body = bodies[slug] ?? []
    return {
      ok: options.ok ?? true,
      status: options.status ?? 200,
      json: vi.fn(async () => body),
    } as unknown as Response
  })
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch
  return { fetchSpy }
}

describe('/api/sync/polymarket-teams', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.mockReturnValue(true)
    mockedRepo.upsertSuccess.mockImplementation(async (input) => {
      return upsertOk({
        league: input.league,
        abbreviation: input.abbreviation,
        name: input.name,
      })
    })
    mockedRepo.markFailure.mockResolvedValue({ data: null, error: null })
    process.env.POLYMARKET_GAMES_DISCOVERY_ENABLED = 'true'
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  it('returns 401 for unauthorized requests', async () => {
    mockedAuth.mockReturnValueOnce(false)
    const { fetchSpy } = mockFetchJson([])

    const res = await GET(makeRequest())

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mockedRepo.upsertSuccess).not.toHaveBeenCalled()
    expect(mockedRevalidateTag).not.toHaveBeenCalled()
  })

  it('returns disabled=true and skips polymarket calls when kill switch is off', async () => {
    process.env.POLYMARKET_GAMES_DISCOVERY_ENABLED = 'false'
    const { fetchSpy } = mockFetchJson([])

    const res = await GET(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.disabled).toBe(true)
    expect(typeof body.message).toBe('string')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mockedRepo.upsertSuccess).not.toHaveBeenCalled()
    expect(mockedRevalidateTag).not.toHaveBeenCalled()
  })

  it('returns disabled=true when env var is unset (default-off)', async () => {
    delete process.env.POLYMARKET_GAMES_DISCOVERY_ENABLED
    const { fetchSpy } = mockFetchJson([])

    const res = await GET(makeRequest())

    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.disabled).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('upserts each real team from the MLB fixture and fires revalidateTag once per league', async () => {
    const teams = loadMlbTeamsFixture()
    expect(teams).toHaveLength(32) // sanity: 30 real teams + 2 placeholders

    // Per-league mock: only MLB gets data; NBA/NHL return [] (clean zeros).
    mockFetchPerLeague({ mlb: teams })

    const res = await GET(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.league_count).toBe(DISCOVERED_GAMES_LEAGUES.length)
    expect(body.results).toHaveLength(DISCOVERED_GAMES_LEAGUES.length)

    const mlbResult = body.results.find((r: { league: string }) => r.league === 'mlb')
    expect(mlbResult).toBeDefined()
    expect(mlbResult.status).toBe('ok')
    expect(mlbResult.team_count).toBe(30)
    expect(mlbResult.skipped_count).toBe(2)
    expect(mlbResult.error_count).toBe(0)

    // 30 real teams persisted; 2 league-level placeholders skipped.
    expect(mockedRepo.upsertSuccess).toHaveBeenCalledTimes(30)
    expect(mockedRepo.markFailure).not.toHaveBeenCalled()

    // revalidateTag fires once per league iteration with 'max' staleness.
    expect(mockedRevalidateTag).toHaveBeenCalledWith('teams-cache:mlb', 'max')
    expect(mockedRevalidateTag).toHaveBeenCalledTimes(DISCOVERED_GAMES_LEAGUES.length)
  })

  it('persists expected fields on each upsert call (sample: yankees)', async () => {
    const teams = loadMlbTeamsFixture()
    mockFetchPerLeague({ mlb: teams })

    await GET(makeRequest())

    const yankeesCall = mockedRepo.upsertSuccess.mock.calls.find(
      ([input]) => input.abbreviation === 'nyy',
    )
    expect(yankeesCall).toBeDefined()
    const [yankeesInput] = yankeesCall!
    expect(yankeesInput).toMatchObject({
      league: 'mlb',
      name: 'New York Yankees',
      abbreviation: 'nyy',
      alias: 'Yankees',
      record: '25-11',
    })
    expect(yankeesInput.team_id).toBe('114226') // Zod coerces id → string
    expect(yankeesInput.logo_url).toContain('New York Yankees')
    expect(yankeesInput.color).toBe('#e4002b')
  })

  it('filters league-level placeholders ("al" / "nl" all-stars)', async () => {
    const teams = loadMlbTeamsFixture()
    mockFetchPerLeague({ mlb: teams })

    await GET(makeRequest())

    const upsertedAbbreviations = mockedRepo.upsertSuccess.mock.calls.map(
      ([input]) => input.abbreviation,
    )
    expect(upsertedAbbreviations).not.toContain('al')
    expect(upsertedAbbreviations).not.toContain('nl')
    expect(upsertedAbbreviations).toHaveLength(30)
  })

  it('persists the registry league slug, not the upstream-provided value (PreWork.1)', async () => {
    // PreWork.1 drift-lock: even if Polymarket returns "MLB" / "Mlb" / etc.
    // on individual rows, the route MUST persist `league.slug` (the registry
    // value used to construct the request) so subsequent
    // `getByAbbreviation(league, abbreviation)` reads with the canonical
    // lowercase slug succeed. Pinning to the registry slug keeps writes and
    // reads symmetric.
    const teams = loadMlbTeamsFixture().map(team => ({
      ...team,
      league: 'MLB', // simulate Polymarket returning an uppercase variant
    }))
    mockFetchPerLeague({ mlb: teams })

    await GET(makeRequest())

    const upsertedLeagues = mockedRepo.upsertSuccess.mock.calls.map(
      ([input]) => input.league,
    )
    expect(upsertedLeagues.length).toBeGreaterThan(0)
    upsertedLeagues.forEach((league) => {
      expect(league).toBe('mlb')
    })
  })

  it('lowercases team abbreviations on persistence', async () => {
    // Fixture abbreviations are already lowercase; verify the route still
    // applies `.toLowerCase()` defensively. Inject one synthetic team with an
    // uppercase abbreviation to confirm.
    const teams = loadMlbTeamsFixture()
    teams.push({
      id: 999999,
      name: 'Fake Team',
      league: 'mlb',
      abbreviation: 'XYZ',
      alias: 'XYZ',
      logo: null,
      color: null,
      record: null,
    })
    mockFetchPerLeague({ mlb: teams })

    await GET(makeRequest())

    const fakeCall = mockedRepo.upsertSuccess.mock.calls.find(
      ([input]) => input.abbreviation === 'xyz',
    )
    expect(fakeCall).toBeDefined()
  })

  it('records network_error and skips upserts when fetch throws', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch

    const res = await GET(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.results).toHaveLength(DISCOVERED_GAMES_LEAGUES.length)
    body.results.forEach((r: { status: string, error?: string }) => {
      expect(r.status).toBe('network_error')
      expect(r.error).toContain('ECONNRESET')
    })

    expect(mockedRepo.upsertSuccess).not.toHaveBeenCalled()
    expect(mockedRepo.markFailure).not.toHaveBeenCalled()
    // No successful league processing → no cache invalidation.
    expect(mockedRevalidateTag).not.toHaveBeenCalled()
  })

  it('records network_error when Polymarket returns non-2xx', async () => {
    mockFetchJson({ message: 'Service Unavailable' }, { ok: false, status: 503 })

    const res = await GET(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    // All leagues fail with the same 503; assert at least the MLB entry.
    const mlbResult = body.results.find((r: { league: string }) => r.league === 'mlb')
    expect(mlbResult.status).toBe('network_error')
    expect(mlbResult.error).toContain('503')
    expect(mockedRepo.upsertSuccess).not.toHaveBeenCalled()
    expect(mockedRevalidateTag).not.toHaveBeenCalled()
  })

  it('records schema_error when Zod validation fails', async () => {
    // Missing required `name` and `abbreviation` fields → schema mismatch.
    mockFetchJson([{ id: 1, league: 'mlb' }])

    const res = await GET(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    const mlbResult = body.results.find((r: { league: string }) => r.league === 'mlb')
    expect(mlbResult.status).toBe('schema_error')
    expect(mlbResult.error).toContain('Zod validation')
    expect(mockedRepo.upsertSuccess).not.toHaveBeenCalled()
    expect(mockedRevalidateTag).not.toHaveBeenCalled()
  })

  it('marks failure and continues on per-team upsert error (status: partial)', async () => {
    const teams = loadMlbTeamsFixture()
    mockFetchPerLeague({ mlb: teams })

    // First real team upsert (after the 2 placeholders are skipped) returns
    // an error; all subsequent upserts succeed via the default mock impl.
    mockedRepo.upsertSuccess.mockReset()
    let callIndex = 0
    mockedRepo.upsertSuccess.mockImplementation(async (input) => {
      callIndex++
      if (callIndex === 1) {
        return { data: null, error: 'DB conflict' }
      }
      return upsertOk({
        league: input.league,
        abbreviation: input.abbreviation,
        name: input.name,
      })
    })

    const res = await GET(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    const mlbResult = body.results.find((r: { league: string }) => r.league === 'mlb')
    expect(mlbResult.status).toBe('partial')
    expect(mlbResult.team_count).toBe(29)
    expect(mlbResult.error_count).toBe(1)
    expect(mlbResult.skipped_count).toBe(2)

    expect(mockedRepo.markFailure).toHaveBeenCalledTimes(1)
    // revalidateTag still fires after a partial run — last-known-good metadata
    // for the failed team plus refreshed metadata for the 29 successes is
    // worth cache-busting.
    expect(mockedRevalidateTag).toHaveBeenCalledWith('teams-cache:mlb', 'max')
  })

  // ---------------------------------------------------------------------------
  // Phase B v2 v2 — per-league placeholder filter (Round 1 X refactor coverage).
  //
  // Round 1 X refactored `isLeaguePlaceholder` to take a `league` parameter and
  // read `league.placeholderAbbreviations` from the registry instead of a
  // hardcoded `LEAGUE_PLACEHOLDER_ABBREVIATIONS = new Set(['al', 'nl'])`. The
  // tests below cover the new per-league behavior on NBA + NHL and lock the
  // cross-league boundary so MLB's filter cannot leak into NBA (or vice versa).
  // ---------------------------------------------------------------------------

  it('filters NBA placeholder abbreviations from teams_cache sync', async () => {
    // 30 real teams + 3 NBA-specific placeholders (`world`, `stars`, `crs` —
    // all members of the NBA registry's `placeholderAbbreviations` Set).
    const realNbaTeams = Array.from({ length: 30 }, (_, i) => ({
      id: 5000 + i,
      name: `NBA Team ${i + 1}`,
      league: 'nba',
      abbreviation: `nb${i.toString().padStart(2, '0')}`,
      alias: null,
      logo: null,
      color: null,
      record: null,
    }))
    const placeholders = [
      { id: 9001, name: 'World Team', league: 'nba', abbreviation: 'world', alias: null, logo: null, color: null, record: null },
      { id: 9002, name: 'Stars Roster', league: 'nba', abbreviation: 'stars', alias: null, logo: null, color: null, record: null },
      { id: 9003, name: 'Rising Stars Challenge', league: 'nba', abbreviation: 'crs', alias: null, logo: null, color: null, record: null },
    ]
    mockFetchPerLeague({ nba: [...realNbaTeams, ...placeholders] })

    const res = await GET(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    const nbaResult = body.results.find((r: { league: string }) => r.league === 'nba')
    expect(nbaResult).toBeDefined()
    expect(nbaResult.status).toBe('ok')
    expect(nbaResult.team_count).toBe(30)
    expect(nbaResult.skipped_count).toBe(3)
    expect(nbaResult.error_count).toBe(0)

    // Assert the 3 placeholders were NOT persisted.
    const upsertedAbbreviations = mockedRepo.upsertSuccess.mock.calls
      .filter(([input]) => input.league === 'nba')
      .map(([input]) => input.abbreviation)
    expect(upsertedAbbreviations).toHaveLength(30)
    expect(upsertedAbbreviations).not.toContain('world')
    expect(upsertedAbbreviations).not.toContain('stars')
    expect(upsertedAbbreviations).not.toContain('crs')

    // Cache invalidation fires for NBA.
    expect(mockedRevalidateTag).toHaveBeenCalledWith('teams-cache:nba', 'max')
  })

  it('filters NHL placeholder abbreviations from teams_cache sync', async () => {
    // 32 real NHL teams + 2 NHL-specific placeholders (`finnhl`, `swenhl` —
    // 4-Nations Face-Off / international placeholders in the NHL registry's
    // `placeholderAbbreviations` Set: `{'finnhl','cannhl','swenhl','usanhl'}`).
    const realNhlTeams = Array.from({ length: 32 }, (_, i) => ({
      id: 6000 + i,
      name: `NHL Team ${i + 1}`,
      league: 'nhl',
      abbreviation: `nh${i.toString().padStart(2, '0')}`,
      alias: null,
      logo: null,
      color: null,
      record: null,
    }))
    const placeholders = [
      { id: 9101, name: 'Finland NHL', league: 'nhl', abbreviation: 'finnhl', alias: null, logo: null, color: null, record: null },
      { id: 9102, name: 'Sweden NHL', league: 'nhl', abbreviation: 'swenhl', alias: null, logo: null, color: null, record: null },
    ]
    mockFetchPerLeague({ nhl: [...realNhlTeams, ...placeholders] })

    const res = await GET(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    const nhlResult = body.results.find((r: { league: string }) => r.league === 'nhl')
    expect(nhlResult).toBeDefined()
    expect(nhlResult.status).toBe('ok')
    expect(nhlResult.team_count).toBe(32)
    expect(nhlResult.skipped_count).toBe(2)
    expect(nhlResult.error_count).toBe(0)

    const upsertedAbbreviations = mockedRepo.upsertSuccess.mock.calls
      .filter(([input]) => input.league === 'nhl')
      .map(([input]) => input.abbreviation)
    expect(upsertedAbbreviations).toHaveLength(32)
    expect(upsertedAbbreviations).not.toContain('finnhl')
    expect(upsertedAbbreviations).not.toContain('swenhl')

    expect(mockedRevalidateTag).toHaveBeenCalledWith('teams-cache:nhl', 'max')
  })

  it('does NOT filter MLB placeholders ("al"/"nl") when sync runs for NBA — per-league boundary holds', async () => {
    // Cross-league boundary drift-lock: if a future refactor accidentally
    // re-introduces a global placeholder Set (or merges the per-league Sets),
    // an `'al'`-abbreviated team in the NBA response would be filtered. NBA's
    // registry Set is `{'crs','cgs','sog','kys','world','stars','stripes'}`;
    // it does NOT contain `'al'` or `'nl'`. So a coincidentally-abbreviated
    // NBA team must persist.
    const nbaTeamWithMlbPlaceholderAbbrev = {
      id: 7001,
      name: 'Atlanta Legends', // benign name, deliberately not 'All-Star'
      league: 'nba',
      abbreviation: 'al',
      alias: null,
      logo: null,
      color: null,
      record: null,
    }
    mockFetchPerLeague({ nba: [nbaTeamWithMlbPlaceholderAbbrev] })

    const res = await GET(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    const nbaResult = body.results.find((r: { league: string }) => r.league === 'nba')
    expect(nbaResult).toBeDefined()
    expect(nbaResult.status).toBe('ok')
    expect(nbaResult.team_count).toBe(1)
    expect(nbaResult.skipped_count).toBe(0)

    // The 'al'-abbreviated NBA team WAS persisted (under the NBA league slug).
    const nbaUpserts = mockedRepo.upsertSuccess.mock.calls.filter(
      ([input]) => input.league === 'nba',
    )
    expect(nbaUpserts).toHaveLength(1)
    expect(nbaUpserts[0][0].abbreviation).toBe('al')
  })

  it('locks the registry placeholderAbbreviations source-of-truth shape', async () => {
    // Drift-lock: the per-league placeholder Sets live on the registry
    // (`DiscoveredGamesLeague.placeholderAbbreviations`). If a future PR drops
    // an entry or rewires the source-of-truth back to a route-local constant,
    // this test fires.
    const mlb = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === 'mlb')
    const nba = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === 'nba')
    const nhl = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === 'nhl')

    expect(mlb).toBeDefined()
    expect(nba).toBeDefined()
    expect(nhl).toBeDefined()

    // MLB byte-identical with the pre-refactor hardcoded constant.
    expect(mlb!.placeholderAbbreviations).toBeDefined()
    expect(mlb!.placeholderAbbreviations!.size).toBe(2)
    expect(mlb!.placeholderAbbreviations!.has('al')).toBe(true)
    expect(mlb!.placeholderAbbreviations!.has('nl')).toBe(true)

    // NBA: 7 placeholders per Round 2.
    expect(nba!.placeholderAbbreviations).toBeDefined()
    expect(nba!.placeholderAbbreviations!.size).toBe(7)

    // NHL: 4 placeholders per Round 2.
    expect(nhl!.placeholderAbbreviations).toBeDefined()
    expect(nhl!.placeholderAbbreviations!.size).toBe(4)
  })
})
