import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __clearAllModuleCachesForTests,
  getOrCreateModuleCache,
  snapshotModuleCaches,
} from '@/lib/db/utils/module-cache'

vi.mock('@sentry/nextjs', () => ({
  metrics: {
    count: vi.fn(),
    gauge: vi.fn(),
    distribution: vi.fn(),
  },
  addBreadcrumb: vi.fn(),
}))

function noop(): void {
  // Placeholder initializer for promise-resolver vars that get reassigned
  // inside the Promise constructor. Function-declaration form satisfies
  // ESLint's `func-style` rule.
}

describe('module-cache — hit / miss / TTL', () => {
  beforeEach(() => {
    __clearAllModuleCachesForTests()
    vi.useRealTimers()
  })

  it('first call is a miss; second call within TTL is a hit', async () => {
    const cache = getOrCreateModuleCache<string, number>('test-hit-miss', 60_000)
    const fill = vi.fn().mockResolvedValue(42)

    const r1 = await cache.get('k', fill)
    const r2 = await cache.get('k', fill)

    expect(r1).toBe(42)
    expect(r2).toBe(42)
    expect(fill).toHaveBeenCalledTimes(1)

    const snap = cache.snapshot()
    expect(snap.hits).toBe(1)
    expect(snap.misses).toBe(1)
    expect(snap.fills).toBe(1)
    expect(snap.hitRate).toBe(0.5)
    expect(snap.size).toBe(1)
  })

  it('cache miss after TTL expiry refires fill', async () => {
    vi.useFakeTimers()
    const cache = getOrCreateModuleCache<string, number>('test-ttl', 1_000)
    const fill = vi.fn().mockResolvedValue(1)

    await cache.get('k', fill)
    vi.advanceTimersByTime(1_500)
    await cache.get('k', fill)

    expect(fill).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('different keys do not collide', async () => {
    const cache = getOrCreateModuleCache<string, string>('test-keys', 60_000)
    const fillA = vi.fn().mockResolvedValue('A')
    const fillB = vi.fn().mockResolvedValue('B')

    const r1 = await cache.get('a', fillA)
    const r2 = await cache.get('b', fillB)

    expect(r1).toBe('A')
    expect(r2).toBe('B')
    expect(fillA).toHaveBeenCalledTimes(1)
    expect(fillB).toHaveBeenCalledTimes(1)
  })

  it('snapshot.hitRate is 0 when no calls have been made', () => {
    const cache = getOrCreateModuleCache<string, number>('test-zero-rate', 60_000)
    expect(cache.snapshot().hitRate).toBe(0)
  })
})

describe('module-cache — singleflight dedupe', () => {
  beforeEach(() => {
    __clearAllModuleCachesForTests()
  })

  it('concurrent first-misses on the same key share one fill Promise', async () => {
    const cache = getOrCreateModuleCache<string, number>('test-singleflight', 60_000)
    let resolveFill: (v: number) => void = noop
    const fill = vi.fn(() => new Promise<number>((resolve) => {
      resolveFill = resolve
    }))

    const p1 = cache.get('k', fill)
    const p2 = cache.get('k', fill)
    const p3 = cache.get('k', fill)

    expect(fill).toHaveBeenCalledTimes(1)

    resolveFill(99)
    const results = await Promise.all([p1, p2, p3])

    expect(results).toEqual([99, 99, 99])
    expect(fill).toHaveBeenCalledTimes(1)
  })

  it('inflight entry is cleared after fill resolves so a subsequent miss after TTL refires', async () => {
    vi.useFakeTimers()
    const cache = getOrCreateModuleCache<string, number>('test-singleflight-ttl', 1_000)
    const fill = vi.fn().mockResolvedValue(7)

    await cache.get('k', fill)
    expect(fill).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1_500)
    await cache.get('k', fill)
    expect(fill).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})

describe('module-cache — error-not-cached contract (PR #21 hardening preserved)', () => {
  beforeEach(() => {
    __clearAllModuleCachesForTests()
  })

  it('rejected fill propagates the throw and does NOT cache the failure', async () => {
    const cache = getOrCreateModuleCache<string, number>('test-error', 60_000)
    const fill = vi.fn()
      .mockRejectedValueOnce(new Error('statement timeout'))
      .mockResolvedValueOnce(42)

    await expect(cache.get('k', fill)).rejects.toThrow('statement timeout')

    const r = await cache.get('k', fill)
    expect(r).toBe(42)
    expect(fill).toHaveBeenCalledTimes(2)
  })

  it('rejected fill clears the inflight entry so retries are not blocked', async () => {
    const cache = getOrCreateModuleCache<string, number>('test-error-inflight', 60_000)

    let rejectFirst: (e: Error) => void = noop
    const failingFill = vi.fn(() => new Promise<number>((_, reject) => {
      rejectFirst = reject
    }))

    const p1 = cache.get('k', failingFill)
    rejectFirst(new Error('failure'))
    await expect(p1).rejects.toThrow('failure')

    const successFill = vi.fn().mockResolvedValue(100)
    const r = await cache.get('k', successFill)
    expect(r).toBe(100)
    expect(successFill).toHaveBeenCalledTimes(1)
  })

  it('an already-cached value is returned on hit even if the next fill would reject', async () => {
    const cache = getOrCreateModuleCache<string, number>('test-hit-immune', 60_000)
    const goodFill = vi.fn().mockResolvedValue(5)
    await cache.get('k', goodFill)

    const failingFill = vi.fn().mockRejectedValue(new Error('would-throw'))
    const r = await cache.get('k', failingFill)
    expect(r).toBe(5)
    expect(failingFill).not.toHaveBeenCalled()
  })

  it('stats do not count fills for failed attempts', async () => {
    const cache = getOrCreateModuleCache<string, number>('test-error-stats', 60_000)
    const fill = vi.fn().mockRejectedValue(new Error('boom'))

    await expect(cache.get('k', fill)).rejects.toThrow('boom')

    const snap = cache.snapshot()
    expect(snap.misses).toBe(1)
    expect(snap.fills).toBe(0)
    expect(snap.size).toBe(0)
  })
})

describe('module-cache — registry / globalThis persistence', () => {
  beforeEach(() => {
    __clearAllModuleCachesForTests()
  })

  it('getOrCreateModuleCache returns the same instance on subsequent calls with the same name', () => {
    const a = getOrCreateModuleCache<string, number>('test-registry', 60_000)
    const b = getOrCreateModuleCache<string, number>('test-registry', 60_000)
    expect(a).toBe(b)
  })

  it('subsequent calls with a different ttlMs do NOT replace the existing cache instance', () => {
    const a = getOrCreateModuleCache<string, number>('test-ttl-noop', 60_000)
    const b = getOrCreateModuleCache<string, number>('test-ttl-noop', 1_000)
    expect(a).toBe(b)
    expect(a.ttlMs).toBe(60_000)
  })

  it('snapshotModuleCaches returns one entry per registered cache', async () => {
    const a = getOrCreateModuleCache<string, number>('alpha', 60_000)
    const b = getOrCreateModuleCache<string, number>('beta', 30_000)

    await a.get('k', () => Promise.resolve(1))
    await b.get('k', () => Promise.resolve(2))

    const snaps = snapshotModuleCaches()
    const alpha = snaps.find(s => s.name === 'alpha')
    const beta = snaps.find(s => s.name === 'beta')

    expect(alpha).toMatchObject({ name: 'alpha', ttlMs: 60_000, misses: 1, fills: 1, size: 1 })
    expect(beta).toMatchObject({ name: 'beta', ttlMs: 30_000, misses: 1, fills: 1, size: 1 })
  })

  it('__clearAllModuleCachesForTests clears stats and entries on every registered cache', async () => {
    const cache = getOrCreateModuleCache<string, number>('test-clear', 60_000)
    await cache.get('k', () => Promise.resolve(1))
    await cache.get('k', () => Promise.resolve(2))

    expect(cache.snapshot().hits + cache.snapshot().misses).toBeGreaterThan(0)

    __clearAllModuleCachesForTests()

    const after = cache.snapshot()
    expect(after.hits).toBe(0)
    expect(after.misses).toBe(0)
    expect(after.fills).toBe(0)
    expect(after.size).toBe(0)
  })

  it('cache instance survives a notional module re-eval (globalThis persistence)', async () => {
    const cache = getOrCreateModuleCache<string, number>('test-persistence', 60_000)
    await cache.get('k', () => Promise.resolve(123))
    expect(cache.snapshot().fills).toBe(1)

    // Simulate `vi.resetModules()` — a fresh import would call
    // `getOrCreateModuleCache` again; since the registry lives on
    // `globalThis`, the same-named call hands back the SAME instance.
    const reAcquired = getOrCreateModuleCache<string, number>('test-persistence', 60_000)
    expect(reAcquired).toBe(cache)
    expect(reAcquired.snapshot().fills).toBe(1)
  })
})

describe('module-cache — instrumentation (Sentry.metrics)', () => {
  beforeEach(() => {
    __clearAllModuleCachesForTests()
  })

  it('emits Sentry.metrics.count("module-cache.hit") on a cached hit', async () => {
    const sentryModule = await import('@sentry/nextjs')
    const countSpy = vi.mocked(sentryModule.metrics.count)
    countSpy.mockClear()

    const cache = getOrCreateModuleCache<string, number>('test-instrumentation-hit', 60_000)
    await cache.get('k', () => Promise.resolve(1))
    await cache.get('k', () => Promise.resolve(1))

    const hitCalls = countSpy.mock.calls.filter(call => call[0] === 'module-cache.hit')
    expect(hitCalls).toHaveLength(1)
    expect(hitCalls[0][2]).toMatchObject({ attributes: { cache: 'test-instrumentation-hit' } })
  })

  it('emits module-cache.miss and module-cache.fill on a cold-fill', async () => {
    const sentryModule = await import('@sentry/nextjs')
    const countSpy = vi.mocked(sentryModule.metrics.count)
    countSpy.mockClear()

    const cache = getOrCreateModuleCache<string, number>('test-instrumentation-fill', 60_000)
    await cache.get('k', () => Promise.resolve(1))

    const missCalls = countSpy.mock.calls.filter(call => call[0] === 'module-cache.miss')
    const fillCalls = countSpy.mock.calls.filter(call => call[0] === 'module-cache.fill')
    expect(missCalls).toHaveLength(1)
    expect(fillCalls).toHaveLength(1)
  })

  it('does NOT emit module-cache.fill on a rejected fill', async () => {
    const sentryModule = await import('@sentry/nextjs')
    const countSpy = vi.mocked(sentryModule.metrics.count)
    countSpy.mockClear()

    const cache = getOrCreateModuleCache<string, number>('test-instrumentation-error', 60_000)
    await expect(cache.get('k', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')

    const fillCalls = countSpy.mock.calls.filter(call => call[0] === 'module-cache.fill')
    expect(fillCalls).toHaveLength(0)
  })
})
