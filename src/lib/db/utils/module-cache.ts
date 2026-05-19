import * as Sentry from '@sentry/nextjs'

/**
 * Per-Vercel-instance TTL cache with singleflight dedupe.
 *
 * Use for low-cardinality, small-payload shared-infrastructure queries
 * (e.g. settings, main_tags). Holds resolved values in an in-process Map
 * with TTL eviction. Survives Next.js `'use cache'` invalidations because
 * it uses its own state rather than tag registrations — admin mutations
 * therefore propagate to public pages only via TTL expiry, NOT via
 * `updateTag(...)`.
 *
 * Critical contracts:
 *
 * 1. Caches only SUCCESSFUL resolved values. Rejected Promises clear
 *    inflight only — they do NOT poison the cache with a null sentinel.
 *    This preserves the PR #21 throw-to-sentinel hardening in
 *    `settings.ts` and `tag.ts`, where the outer wrapper converts throws
 *    into degraded responses without leaving a cached failure for the
 *    next request.
 *
 * 2. Persists across HMR / module re-eval via `globalThis` (mirrors the
 *    `globalForDb` pattern in `drizzle.ts:8-11`).
 *
 * 3. Singleflight: concurrent first-misses on the same key share one
 *    fill Promise so we never double-fire a cold-fill against the DB.
 *
 * NOT suitable for:
 * - High-cardinality keys (per-user, per-event) — Map grows unbounded.
 * - Large payloads — held in process memory until TTL eviction.
 * - Per-request freshness contracts — TTL means up to TTL-window
 *   staleness per Vercel instance after any underlying mutation.
 */

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

interface ModuleCacheStats {
  hits: number
  misses: number
  fills: number
}

export interface ModuleCacheSnapshot {
  name: string
  ttlMs: number
  hits: number
  misses: number
  fills: number
  hitRate: number
  size: number
}

type ModuleCacheRegistry = Map<string, ModuleCache<string | number, unknown>>

const globalForModuleCache = globalThis as unknown as {
  __wirepredictions_module_caches?: ModuleCacheRegistry
}

function getRegistry(): ModuleCacheRegistry {
  if (!globalForModuleCache.__wirepredictions_module_caches) {
    globalForModuleCache.__wirepredictions_module_caches = new Map()
  }
  return globalForModuleCache.__wirepredictions_module_caches
}

class ModuleCache<TKey extends string | number, TValue> {
  private cache = new Map<TKey, CacheEntry<TValue>>()
  private inflight = new Map<TKey, Promise<TValue>>()
  private stats: ModuleCacheStats = { hits: 0, misses: 0, fills: 0 }

  constructor(public readonly name: string, public readonly ttlMs: number) {}

  async get(key: TKey, fill: () => Promise<TValue>): Promise<TValue> {
    const entry = this.cache.get(key)
    if (entry && entry.expiresAt > Date.now()) {
      this.stats.hits++
      Sentry.metrics.count('module-cache.hit', 1, { attributes: { cache: this.name } })
      return entry.value
    }
    this.stats.misses++
    Sentry.metrics.count('module-cache.miss', 1, { attributes: { cache: this.name } })

    let pending = this.inflight.get(key)
    if (!pending) {
      pending = fill().finally(() => this.inflight.delete(key))
      this.inflight.set(key, pending)
    }

    // If `pending` rejects, the throw propagates and the `.set()` below
    // never runs — the cache is NOT poisoned with the failure. The outer
    // non-cached wrapper (`SettingsRepository.getSettings` /
    // `TagRepository.getMainTags`) produces the historical degraded
    // sentinel for that one request only. PR #21 hardening preserved.
    const value = await pending

    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs })
    this.stats.fills++
    Sentry.metrics.count('module-cache.fill', 1, { attributes: { cache: this.name } })

    return value
  }

  snapshot(): ModuleCacheSnapshot {
    const total = this.stats.hits + this.stats.misses
    return {
      name: this.name,
      ttlMs: this.ttlMs,
      hits: this.stats.hits,
      misses: this.stats.misses,
      fills: this.stats.fills,
      hitRate: total === 0 ? 0 : this.stats.hits / total,
      size: this.cache.size,
    }
  }

  clear(): void {
    this.cache.clear()
    this.inflight.clear()
    this.stats = { hits: 0, misses: 0, fills: 0 }
  }
}

/**
 * Returns the singleton ModuleCache for the given name, creating it on
 * first call. Subsequent calls with the same name return the SAME
 * instance (so `ttlMs` is honored only on first creation).
 *
 * Instances are held on `globalThis.__wirepredictions_module_caches` so
 * they survive Turbopack HMR and Next.js module re-evaluation in dev.
 */
export function getOrCreateModuleCache<TKey extends string | number, TValue>(
  name: string,
  ttlMs: number,
): ModuleCache<TKey, TValue> {
  const registry = getRegistry()
  const existing = registry.get(name) as ModuleCache<TKey, TValue> | undefined
  if (existing) {
    return existing
  }
  const created = new ModuleCache<TKey, TValue>(name, ttlMs)
  registry.set(name, created as unknown as ModuleCache<string | number, unknown>)
  return created
}

/**
 * Returns snapshots for every registered module-cache. Consumed by the
 * `debug/module-cache-stats` endpoint for hit-rate observability.
 */
export function snapshotModuleCaches(): ModuleCacheSnapshot[] {
  const registry = globalForModuleCache.__wirepredictions_module_caches
  if (!registry) {
    return []
  }
  return Array.from(registry.values()).map(cache => cache.snapshot())
}

/**
 * Test-only helper. Clears the state of every registered module-cache so
 * tests using `vi.resetModules()` don't leak cached values across runs.
 * The `globalThis` persistence pattern that protects HMR also makes the
 * registry survive Vitest module resets — explicit clear is required.
 *
 * Wired from `vitest.setup.ts` `beforeEach`. NOT for production code.
 */
export function __clearAllModuleCachesForTests(): void {
  const registry = globalForModuleCache.__wirepredictions_module_caches
  if (!registry) {
    return
  }
  for (const cache of registry.values()) {
    cache.clear()
  }
}
