import { readFileSync } from 'node:fs'
import path from 'node:path'
import { revalidateTag } from 'next/cache'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/sync/polymarket-teams/route'
import { isCronAuthorized } from '@/lib/auth-cron'
import { TeamsCacheRepository } from '@/lib/db/queries/teams-cache'

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

  it('upserts each real team from the MLB fixture and fires revalidateTag once', async () => {
    const teams = loadMlbTeamsFixture()
    expect(teams).toHaveLength(32) // sanity: 30 real teams + 2 placeholders

    mockFetchJson(teams)

    const res = await GET(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.league_count).toBe(1)
    expect(body.results).toHaveLength(1)

    const mlbResult = body.results[0]
    expect(mlbResult.league).toBe('mlb')
    expect(mlbResult.status).toBe('ok')
    expect(mlbResult.team_count).toBe(30)
    expect(mlbResult.skipped_count).toBe(2)
    expect(mlbResult.error_count).toBe(0)

    // 30 real teams persisted; 2 league-level placeholders skipped.
    expect(mockedRepo.upsertSuccess).toHaveBeenCalledTimes(30)
    expect(mockedRepo.markFailure).not.toHaveBeenCalled()

    // revalidateTag fires once per league with the correct cache-tag and 'max'
    // staleness window.
    expect(mockedRevalidateTag).toHaveBeenCalledTimes(1)
    expect(mockedRevalidateTag).toHaveBeenCalledWith('teams-cache:mlb', 'max')
  })

  it('persists expected fields on each upsert call (sample: yankees)', async () => {
    const teams = loadMlbTeamsFixture()
    mockFetchJson(teams)

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
    mockFetchJson(teams)

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
    mockFetchJson(teams)

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
    mockFetchJson(teams)

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
    expect(body.results).toHaveLength(1)
    expect(body.results[0].league).toBe('mlb')
    expect(body.results[0].status).toBe('network_error')
    expect(body.results[0].error).toContain('ECONNRESET')

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
    expect(body.results[0].status).toBe('network_error')
    expect(body.results[0].error).toContain('503')
    expect(mockedRepo.upsertSuccess).not.toHaveBeenCalled()
    expect(mockedRevalidateTag).not.toHaveBeenCalled()
  })

  it('records schema_error when Zod validation fails', async () => {
    // Missing required `name` and `abbreviation` fields → schema mismatch.
    mockFetchJson([{ id: 1, league: 'mlb' }])

    const res = await GET(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results[0].status).toBe('schema_error')
    expect(body.results[0].error).toContain('Zod validation')
    expect(mockedRepo.upsertSuccess).not.toHaveBeenCalled()
    expect(mockedRevalidateTag).not.toHaveBeenCalled()
  })

  it('marks failure and continues on per-team upsert error (status: partial)', async () => {
    const teams = loadMlbTeamsFixture()
    mockFetchJson(teams)

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
    expect(body.results[0].status).toBe('partial')
    expect(body.results[0].team_count).toBe(29)
    expect(body.results[0].error_count).toBe(1)
    expect(body.results[0].skipped_count).toBe(2)

    expect(mockedRepo.markFailure).toHaveBeenCalledTimes(1)
    // revalidateTag still fires after a partial run — last-known-good metadata
    // for the failed team plus refreshed metadata for the 29 successes is
    // worth cache-busting.
    expect(mockedRevalidateTag).toHaveBeenCalledWith('teams-cache:mlb', 'max')
  })
})
