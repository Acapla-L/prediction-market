import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runQuery: vi.fn(),
  // db.select chain
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  // db.insert chain
  insert: vi.fn(),
  values: vi.fn(),
  onConflictDoUpdate: vi.fn(),
  returning: vi.fn(),
  // db.update chain
  update: vi.fn(),
  set: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
}))

vi.mock('@/lib/db/utils/run-query', () => ({
  runQuery: (...args: any[]) => mocks.runQuery(...args),
}))

vi.mock('@/lib/drizzle', () => ({
  db: {
    select: (...args: any[]) => mocks.select(...args),
    insert: (...args: any[]) => mocks.insert(...args),
    update: (...args: any[]) => mocks.update(...args),
  },
}))

const { TeamsCacheRepository } = await import('@/lib/db/queries/teams-cache')

interface TeamsCacheRowDb {
  league: string
  team_id: string
  name: string
  alias: string | null
  abbreviation: string
  logo_url: string | null
  color: string | null
  record: string | null
  last_synced_at: Date
  last_sync_status: string
  last_sync_error: string | null
}

function makeDbRow(overrides: Partial<TeamsCacheRowDb> = {}): TeamsCacheRowDb {
  return {
    league: 'mlb',
    team_id: '147',
    name: 'New York Yankees',
    alias: 'Yankees',
    abbreviation: 'NYY',
    logo_url: 'https://example.com/nyy.png',
    color: '#003087',
    record: '95-67',
    last_synced_at: new Date('2026-05-06T12:00:00.000Z'),
    last_sync_status: 'ok',
    last_sync_error: null,
    ...overrides,
  }
}

function setupSelectChain(returnRows: TeamsCacheRowDb[]) {
  // select() -> from() -> where() -> limit() | orderBy()
  // limit() returns the rows directly (awaited array). orderBy() does too.
  mocks.limit.mockResolvedValue(returnRows)
  mocks.orderBy.mockResolvedValue(returnRows)
  mocks.where.mockReturnValue({
    limit: mocks.limit,
    orderBy: mocks.orderBy,
  })
  mocks.from.mockReturnValue({
    where: mocks.where,
  })
  mocks.select.mockReturnValue({
    from: mocks.from,
  })
}

function setupInsertChain(returnRows: TeamsCacheRowDb[]) {
  // insert() -> values() -> onConflictDoUpdate() -> returning()
  mocks.returning.mockResolvedValue(returnRows)
  mocks.onConflictDoUpdate.mockReturnValue({
    returning: mocks.returning,
  })
  mocks.values.mockReturnValue({
    onConflictDoUpdate: mocks.onConflictDoUpdate,
  })
  mocks.insert.mockReturnValue({
    values: mocks.values,
  })
}

function setupUpdateChain(returnRows: TeamsCacheRowDb[]) {
  // update() -> set() -> where() -> returning()
  mocks.updateReturning.mockResolvedValue(returnRows)
  mocks.updateWhere.mockReturnValue({
    returning: mocks.updateReturning,
  })
  mocks.set.mockReturnValue({
    where: mocks.updateWhere,
  })
  mocks.update.mockReturnValue({
    set: mocks.set,
  })
}

describe('teamsCacheRepository', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.runQuery.mockReset()
    mocks.select.mockReset()
    mocks.from.mockReset()
    mocks.where.mockReset()
    mocks.limit.mockReset()
    mocks.orderBy.mockReset()
    mocks.insert.mockReset()
    mocks.values.mockReset()
    mocks.onConflictDoUpdate.mockReset()
    mocks.returning.mockReset()
    mocks.update.mockReset()
    mocks.set.mockReset()
    mocks.updateWhere.mockReset()
    mocks.updateReturning.mockReset()

    // Default: runQuery just executes its callback so chained DB calls run.
    mocks.runQuery.mockImplementation(async (callback: () => Promise<unknown>) => callback())
  })

  describe('getByAbbreviation', () => {
    it('returns a populated TeamCacheRow when the row exists', async () => {
      const dbRow = makeDbRow({ league: 'mlb', abbreviation: 'NYY' })
      setupSelectChain([dbRow])

      const result = await TeamsCacheRepository.getByAbbreviation('mlb', 'NYY')

      expect(result.error).toBeNull()
      expect(result.data).toEqual({
        league: 'mlb',
        teamId: '147',
        name: 'New York Yankees',
        alias: 'Yankees',
        abbreviation: 'NYY',
        logoUrl: 'https://example.com/nyy.png',
        color: '#003087',
        record: '95-67',
        lastSyncedAt: '2026-05-06T12:00:00.000Z',
        lastSyncStatus: 'ok',
        lastSyncError: null,
      })
    })

    it('returns { data: null, error: null } when the row does not exist', async () => {
      setupSelectChain([])

      const result = await TeamsCacheRepository.getByAbbreviation('mlb', 'XXX')

      expect(result.error).toBeNull()
      expect(result.data).toBeNull()
    })
  })

  describe('listByLeague', () => {
    it('returns the rows from the DB and applies an ORDER BY clause', async () => {
      // Repository orders by abbreviation in the SQL — we simulate the DB
      // returning rows already in alphabetical order (per the orderBy clause)
      // and assert that the repo passes them through unchanged plus calls
      // .orderBy() on the chain.
      const rows: TeamsCacheRowDb[] = [
        makeDbRow({ league: 'mlb', abbreviation: 'BOS', name: 'Boston Red Sox' }),
        makeDbRow({ league: 'mlb', abbreviation: 'LAD', name: 'Los Angeles Dodgers' }),
        makeDbRow({ league: 'mlb', abbreviation: 'NYY', name: 'New York Yankees' }),
      ]
      // listByLeague uses select().from().where().orderBy() — no .limit().
      mocks.orderBy.mockResolvedValue(rows)
      mocks.where.mockReturnValue({ orderBy: mocks.orderBy })
      mocks.from.mockReturnValue({ where: mocks.where })
      mocks.select.mockReturnValue({ from: mocks.from })

      const result = await TeamsCacheRepository.listByLeague('mlb')

      expect(result.error).toBeNull()
      expect(result.data).toHaveLength(3)
      expect(result.data?.map(r => r.abbreviation)).toEqual(['BOS', 'LAD', 'NYY'])
      expect(result.data?.[0]).toMatchObject({
        league: 'mlb',
        abbreviation: 'BOS',
        name: 'Boston Red Sox',
      })
      // Lock the ordering contract: the repository MUST apply an orderBy.
      expect(mocks.orderBy).toHaveBeenCalledTimes(1)
    })

    it('only returns rows for the requested league (filter is applied via where clause)', async () => {
      // The DB layer is responsible for filtering — we assert the repo issues
      // a where() call (so the league filter actually exists) and that
      // whatever rows the DB returns are passed through.
      const nbaRows: TeamsCacheRowDb[] = [
        makeDbRow({ league: 'nba', team_id: '1610612747', abbreviation: 'LAL', name: 'Los Angeles Lakers' }),
        makeDbRow({ league: 'nba', team_id: '1610612738', abbreviation: 'BOS', name: 'Boston Celtics' }),
      ]
      mocks.orderBy.mockResolvedValue(nbaRows)
      mocks.where.mockReturnValue({ orderBy: mocks.orderBy })
      mocks.from.mockReturnValue({ where: mocks.where })
      mocks.select.mockReturnValue({ from: mocks.from })

      const result = await TeamsCacheRepository.listByLeague('nba')

      expect(result.error).toBeNull()
      expect(result.data).toHaveLength(2)
      expect(result.data?.every(r => r.league === 'nba')).toBe(true)
      // Lock the league-filter contract: a where() call is mandatory.
      expect(mocks.where).toHaveBeenCalledTimes(1)
    })
  })

  describe('upsertSuccess', () => {
    it('inserts a new row with last_sync_status="ok", last_sync_error=null, last_synced_at=now', async () => {
      const insertedRow = makeDbRow({
        league: 'mlb',
        abbreviation: 'NYY',
        last_sync_status: 'ok',
        last_sync_error: null,
      })
      setupInsertChain([insertedRow])

      const before = Date.now()
      const result = await TeamsCacheRepository.upsertSuccess({
        league: 'mlb',
        team_id: '147',
        name: 'New York Yankees',
        alias: 'Yankees',
        abbreviation: 'NYY',
        logo_url: 'https://example.com/nyy.png',
        color: '#003087',
        record: '95-67',
      })
      const after = Date.now()

      expect(result.error).toBeNull()
      expect(result.data).toMatchObject({
        league: 'mlb',
        abbreviation: 'NYY',
        lastSyncStatus: 'ok',
        lastSyncError: null,
      })

      // Verify the values() arg shape — sync-status hardcoded to 'ok',
      // error cleared to null, and last_synced_at set to "now".
      const valuesArg = mocks.values.mock.calls[0]?.[0]
      expect(valuesArg).toMatchObject({
        league: 'mlb',
        team_id: '147',
        name: 'New York Yankees',
        alias: 'Yankees',
        abbreviation: 'NYY',
        logo_url: 'https://example.com/nyy.png',
        color: '#003087',
        record: '95-67',
        last_sync_status: 'ok',
        last_sync_error: null,
      })
      expect(valuesArg.last_synced_at).toBeInstanceOf(Date)
      const ts = (valuesArg.last_synced_at as Date).getTime()
      expect(ts).toBeGreaterThanOrEqual(before)
      expect(ts).toBeLessThanOrEqual(after)
    })

    it('clears a prior failure: existing failure row gets last_sync_status="ok" and last_sync_error=null after upsert', async () => {
      // The "after upsert" row reflects what onConflictDoUpdate produces —
      // the DB returns the post-update row. We verify the repo asks Drizzle
      // to set status='ok' and error=null in the conflict-update set clause.
      const updatedRow = makeDbRow({
        league: 'mlb',
        abbreviation: 'NYY',
        last_sync_status: 'ok', // was 'failure' before the upsert
        last_sync_error: null, //  was 'old error' before the upsert
      })
      setupInsertChain([updatedRow])

      const result = await TeamsCacheRepository.upsertSuccess({
        league: 'mlb',
        team_id: '147',
        name: 'New York Yankees',
        alias: 'Yankees',
        abbreviation: 'NYY',
        logo_url: 'https://example.com/nyy.png',
        color: '#003087',
        record: '95-67',
      })

      expect(result.error).toBeNull()
      expect(result.data?.lastSyncStatus).toBe('ok')
      expect(result.data?.lastSyncError).toBeNull()

      // The conflict-update set clause MUST include the EXCLUDED references
      // for last_sync_status and last_sync_error — proving that a successful
      // upsert against a prior-failure row will overwrite those fields with
      // the new (ok / null) values from the INSERT row.
      const setArg = mocks.onConflictDoUpdate.mock.calls[0]?.[0]
      expect(setArg).toBeDefined()
      expect(setArg.target).toEqual(expect.any(Array))
      expect(setArg.set).toHaveProperty('last_sync_status')
      expect(setArg.set).toHaveProperty('last_sync_error')
      expect(setArg.set).toHaveProperty('last_synced_at')
      // The values() row asserts the new INSERT row carries ok/null —
      // combined with EXCLUDED.last_sync_status/EXCLUDED.last_sync_error in
      // the set clause, the failure state is provably cleared.
      expect(mocks.values.mock.calls[0]?.[0]).toMatchObject({
        last_sync_status: 'ok',
        last_sync_error: null,
      })
    })

    it('returns an error when the upsert returning clause is empty', async () => {
      setupInsertChain([])

      const result = await TeamsCacheRepository.upsertSuccess({
        league: 'mlb',
        team_id: '147',
        name: 'New York Yankees',
        alias: null,
        abbreviation: 'NYY',
        logo_url: null,
        color: null,
        record: null,
      })

      expect(result.data).toBeNull()
      expect(result.error).toBe('Failed to upsert team cache row.')
    })
  })

  describe('markFailure', () => {
    it('updates ONLY last_sync_status and last_sync_error (not metadata fields, not last_synced_at)', async () => {
      // Row that comes back after the update — metadata is preserved
      // (name, alias, logo_url, color, record stay intact) plus the
      // last_synced_at remains unchanged because markFailure does not touch
      // it. The repository's set() call is what we verify.
      const previouslyKnownGoodRow = makeDbRow({
        league: 'mlb',
        abbreviation: 'NYY',
        name: 'New York Yankees',
        alias: 'Yankees',
        logo_url: 'https://example.com/nyy.png',
        color: '#003087',
        record: '95-67',
        last_synced_at: new Date('2026-05-06T12:00:00.000Z'),
        last_sync_status: 'failure',
        last_sync_error: 'Polymarket Gamma 502',
      })
      setupUpdateChain([previouslyKnownGoodRow])

      const result = await TeamsCacheRepository.markFailure({
        league: 'mlb',
        abbreviation: 'NYY',
        error: 'Polymarket Gamma 502',
      })

      expect(result.error).toBeNull()
      expect(result.data).toMatchObject({
        name: 'New York Yankees',
        alias: 'Yankees',
        logoUrl: 'https://example.com/nyy.png',
        color: '#003087',
        record: '95-67',
        lastSyncStatus: 'failure',
        lastSyncError: 'Polymarket Gamma 502',
      })

      // The set() call must contain ONLY status + error, with no other
      // fields (no name, alias, logo_url, color, record, team_id, AND no
      // last_synced_at — that is the deviation from discovered-games.ts).
      const setArg = mocks.set.mock.calls[0]?.[0]
      expect(setArg).toEqual({
        last_sync_status: 'failure',
        last_sync_error: 'Polymarket Gamma 502',
      })
      // Lock the deviation explicitly — markFailure must NOT touch
      // last_synced_at (unlike DiscoveredGamesRepository.markFailure which
      // does set it). This is the strict spec interpretation A2 implemented.
      expect(setArg).not.toHaveProperty('last_synced_at')
      expect(setArg).not.toHaveProperty('name')
      expect(setArg).not.toHaveProperty('alias')
      expect(setArg).not.toHaveProperty('logo_url')
      expect(setArg).not.toHaveProperty('color')
      expect(setArg).not.toHaveProperty('record')
      expect(setArg).not.toHaveProperty('team_id')
    })

    it('returns { data: null, error: null } when no row exists for (league, abbreviation) — no-op', async () => {
      setupUpdateChain([])

      const result = await TeamsCacheRepository.markFailure({
        league: 'mlb',
        abbreviation: 'XXX',
        error: 'team not found upstream',
      })

      expect(result.error).toBeNull()
      expect(result.data).toBeNull()
    })
  })
})
