import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Parallel to I-1 (FIFA cache-key regression guard):
 *
 *   "If you ever point Gamma at a staging/proxy origin via env var, the
 *    cached result from prod origin will be served."
 *
 * The fix is to include `POLYMARKET_GAMMA_BASE` AND the slug in the
 * `unstable_cache` key array. This test captures every `unstable_cache`
 * invocation and asserts the key includes the env-var value + the slug,
 * and that distinct env vars / slugs produce distinct keys.
 */

const unstableCacheCalls: Array<{ keys: readonly unknown[], options: unknown }> = []

vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown, keys: readonly unknown[], options: unknown) => {
    unstableCacheCalls.push({ keys, options })
    return fn
  },
}))

vi.mock('@/lib/polymarket/client', () => ({
  fetchMlbGameGammaEvent: vi.fn().mockResolvedValue(null),
}))

const ORIGINAL_ENV = process.env.POLYMARKET_GAMMA_BASE

describe('getMlbGameOverlay — env-var isolation + slug isolation in the unstable_cache key', () => {
  beforeEach(() => {
    unstableCacheCalls.length = 0
  })

  afterEachCleanup()

  it('includes the POLYMARKET_GAMMA_BASE value AND the slug in the cache key array', async () => {
    process.env.POLYMARKET_GAMMA_BASE = 'https://example-cache-key-A.test'
    const { getMlbGameOverlay } = await import('@/lib/polymarket/mlb-game-overlay')
    await getMlbGameOverlay('mlb-chc-lad-2026-04-24')

    expect(unstableCacheCalls.length).toBeGreaterThanOrEqual(1)
    const latestCall = unstableCacheCalls.at(-1)
    expect(latestCall?.keys).toContain('polymarket-mlb-game-overlay-v1')
    expect(latestCall?.keys).toContain('https://example-cache-key-A.test')
    expect(latestCall?.keys).toContain('mlb-chc-lad-2026-04-24')
  })

  it('two different POLYMARKET_GAMMA_BASE values produce two distinct cache keys for the same slug', async () => {
    const { getMlbGameOverlay } = await import('@/lib/polymarket/mlb-game-overlay')

    process.env.POLYMARKET_GAMMA_BASE = 'https://example-cache-key-B.test'
    await getMlbGameOverlay('mlb-chc-lad-2026-04-24')
    process.env.POLYMARKET_GAMMA_BASE = 'https://example-cache-key-C.test'
    await getMlbGameOverlay('mlb-chc-lad-2026-04-24')

    expect(unstableCacheCalls.length).toBeGreaterThanOrEqual(2)
    const beforeKey = unstableCacheCalls[unstableCacheCalls.length - 2]?.keys
    const afterKey = unstableCacheCalls.at(-1)?.keys
    expect(beforeKey).not.toEqual(afterKey)
  })

  it('two different slugs under the same env var produce two distinct cache keys', async () => {
    const { getMlbGameOverlay } = await import('@/lib/polymarket/mlb-game-overlay')
    process.env.POLYMARKET_GAMMA_BASE = 'https://example-same-origin.test'

    await getMlbGameOverlay('mlb-chc-lad-2026-04-24')
    // Using the same env var but a different slug — call still registers in
    // the cache key array regardless of whether the slug is in MLB_GAME_SLUGS
    // (getMlbGameOverlay does not filter; buildMlbGameOverlay does).
    await getMlbGameOverlay('mlb-other-future-pilot-2026-04-25')

    expect(unstableCacheCalls.length).toBeGreaterThanOrEqual(2)
    const first = unstableCacheCalls[unstableCacheCalls.length - 2]?.keys
    const second = unstableCacheCalls.at(-1)?.keys
    expect(first).not.toEqual(second)
    expect(first).toContain('mlb-chc-lad-2026-04-24')
    expect(second).toContain('mlb-other-future-pilot-2026-04-25')
  })

  it('falls back to the default sentinel when POLYMARKET_GAMMA_BASE is unset', async () => {
    delete process.env.POLYMARKET_GAMMA_BASE
    const { getMlbGameOverlay } = await import('@/lib/polymarket/mlb-game-overlay')
    await getMlbGameOverlay('mlb-chc-lad-2026-04-24')

    const latestCall = unstableCacheCalls.at(-1)
    const envKey = latestCall?.keys?.[1]
    expect(typeof envKey).toBe('string')
    expect(envKey).toBeTruthy()
  })
})

function afterEachCleanup() {
  return () => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.POLYMARKET_GAMMA_BASE
    }
    else {
      process.env.POLYMARKET_GAMMA_BASE = ORIGINAL_ENV
    }
  }
}
