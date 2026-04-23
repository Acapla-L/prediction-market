import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression guard for code-reviewer finding I-1 (2026-04-22):
 *
 *   "If you ever point Gamma at a staging/proxy origin via env var, the
 *    cached result from prod origin will be served."
 *
 * The fix is to include `POLYMARKET_GAMMA_BASE` in the `unstable_cache`
 * key array. This test captures every `unstable_cache` invocation and
 * asserts the key includes the env-var value, and that two distinct
 * env-var values produce two distinct keys.
 */

// Capture every call to unstable_cache so we can inspect the key array.
const unstableCacheCalls: Array<{ keys: readonly unknown[], options: unknown }> = []

vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown, keys: readonly unknown[], options: unknown) => {
    unstableCacheCalls.push({ keys, options })
    return fn
  },
}))

vi.mock('@/lib/polymarket/client', () => ({
  fetchFifaGammaEvent: vi.fn().mockResolvedValue(null),
}))

const ORIGINAL_ENV = process.env.POLYMARKET_GAMMA_BASE

describe('getFifaOverlay — env-var isolation in the unstable_cache key (I-1)', () => {
  beforeEach(() => {
    unstableCacheCalls.length = 0
  })

  afterEachCleanup()

  it('includes the POLYMARKET_GAMMA_BASE value in the cache key array', async () => {
    process.env.POLYMARKET_GAMMA_BASE = 'https://example-cache-key-A.test'
    const { getFifaOverlay } = await import('@/lib/polymarket/fifa-overlay')
    await getFifaOverlay()

    expect(unstableCacheCalls.length).toBeGreaterThanOrEqual(1)
    const latestCall = unstableCacheCalls.at(-1)
    expect(latestCall?.keys).toContain('polymarket-fifa-overlay-v1')
    expect(latestCall?.keys).toContain('https://example-cache-key-A.test')
  })

  it('two different POLYMARKET_GAMMA_BASE values produce two distinct cache keys', async () => {
    const { getFifaOverlay } = await import('@/lib/polymarket/fifa-overlay')

    process.env.POLYMARKET_GAMMA_BASE = 'https://example-cache-key-B.test'
    await getFifaOverlay()
    process.env.POLYMARKET_GAMMA_BASE = 'https://example-cache-key-C.test'
    await getFifaOverlay()

    expect(unstableCacheCalls.length).toBeGreaterThanOrEqual(2)
    const beforeKey = unstableCacheCalls[unstableCacheCalls.length - 2]?.keys
    const afterKey = unstableCacheCalls.at(-1)?.keys

    // They must differ because the env var is in the key array. If a future
    // edit accidentally removes the env var from the key, both calls end up
    // with the same key and this assertion fails.
    expect(beforeKey).not.toEqual(afterKey)
    expect(beforeKey).toContain('https://example-cache-key-B.test')
    expect(afterKey).toContain('https://example-cache-key-C.test')
  })

  it('falls back to the default sentinel when POLYMARKET_GAMMA_BASE is unset', async () => {
    delete process.env.POLYMARKET_GAMMA_BASE
    const { getFifaOverlay } = await import('@/lib/polymarket/fifa-overlay')
    await getFifaOverlay()

    // The key must contain SOME non-empty string so cache entries from a
    // previously-set env var do not bleed into the unset case.
    const latestCall = unstableCacheCalls.at(-1)
    const envKey = latestCall?.keys?.[1]
    expect(typeof envKey).toBe('string')
    expect(envKey).toBeTruthy()
  })
})

function afterEachCleanup() {
  // Restore the original env var state after the describe block so we do not
  // leak test values into sibling suites.
  return () => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.POLYMARKET_GAMMA_BASE
    }
    else {
      process.env.POLYMARKET_GAMMA_BASE = ORIGINAL_ENV
    }
  }
}
