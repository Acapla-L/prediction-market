import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Issue 1 — branding flickers between WirePredictions and Kuest.
 *
 * Root cause: `loadRuntimeThemeState` and `SettingsRepository.getSettings`
 * are `'use cache'`-wrapped. When the Supabase `settings` query times out,
 * `runQuery` swallows the throw and returns a `{ data: null, error }`
 * sentinel — a *normal return* — so Next.js Cache Components caches that
 * degraded result for the cache TTL (~5–15 min). The cached degraded result
 * was the Kuest "K" `#CDFF00` SVG + the Kuest-blue `'default'` preset.
 *
 * Fix has two halves:
 *  (a) The `'use cache'` data fetchers THROW on a DB error instead of
 *      returning a sentinel — Next.js does NOT cache the result of a
 *      throwing `'use cache'` function, so the next request retries the DB.
 *      A thin NON-cached public wrapper catches the throw and returns the
 *      defaults for that one request only.
 *  (b) Those defaults are WagerWire / WirePredictions branding (cyan
 *      `#02FDDD`, dark surfaces, a WirePredictions wordmark) — never the
 *      Kuest "K" `#CDFF00`.
 *
 * These tests cover both halves.
 */

describe('issue 1 — theme fallback never shows Kuest branding (goal b)', () => {
  it('createDefaultThemeSiteIdentity does not return the Kuest "K" logo', async () => {
    const { createDefaultThemeSiteIdentity } = await import('@/lib/theme-site-identity')
    const identity = createDefaultThemeSiteIdentity()

    expect(identity.name).toBe('WirePredictions')
    // The Kuest "K" lettermark is the lime-green #CDFF00 path.
    expect(identity.logoSvg.toLowerCase()).not.toContain('#cdff00')
    expect(identity.logoUrl.toLowerCase()).not.toContain('cdff00')
    // viewBox "0 0 518 414" is the Kuest "K" geometry.
    expect(identity.logoSvg).not.toContain('0 0 518 414')
    // Still a valid SVG (the header renders it as a data URI).
    expect(identity.logoSvg).toMatch(/<svg[\s>]/i)
  })

  it('buildDefaultThemeState applies the WagerWire palette (cyan #02FDDD), not the Kuest-blue default', async () => {
    const { loadRuntimeThemeStateDefaults } = await import('@/lib/theme-settings')
    const state = loadRuntimeThemeStateDefaults()

    expect(state.source).toBe('default')
    // Preset id stays 'default' (the base layer), but the WagerWire dark/light
    // overrides must be layered on top so the rendered CSS is WagerWire, not Kuest.
    expect(state.theme.dark.primary?.toLowerCase()).toBe('#02fddd')
    expect(state.theme.light.primary?.toLowerCase()).toBe('#02fddd')
    expect(state.theme.dark.background?.toLowerCase()).toBe('#0d0d0d')
    expect(state.theme.cssText.toLowerCase()).toContain('#02fddd')
    // No Kuest "K" in the default site identity either.
    expect(state.site.logoSvg.toLowerCase()).not.toContain('#cdff00')
    expect(state.site.name).toBe('WirePredictions')
  })
})

describe('issue 1 — loadRuntimeThemeState does not cache the DB-error fallback (goal a)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('the cached fetcher THROWS when the settings DB query errors (so Next.js does not cache the degraded result)', async () => {
    vi.doMock('next/cache', () => ({ cacheTag: vi.fn() }))
    vi.doMock('@/lib/db/queries/settings', () => ({
      SettingsRepository: {
        getSettings: vi.fn().mockResolvedValue({ data: null, error: 'Failed to fetch settings.' }),
      },
    }))

    const mod = await import('@/lib/theme-settings')
    await expect(mod.loadRuntimeThemeStateCached()).rejects.toThrow()
  })

  it('the public non-cached loadRuntimeThemeState catches the throw and returns WagerWire defaults', async () => {
    vi.doMock('next/cache', () => ({ cacheTag: vi.fn() }))
    vi.doMock('@/lib/db/queries/settings', () => ({
      SettingsRepository: {
        getSettings: vi.fn().mockResolvedValue({ data: null, error: 'Failed to fetch settings.' }),
      },
    }))

    const mod = await import('@/lib/theme-settings')
    const state = await mod.loadRuntimeThemeState()

    expect(state.source).toBe('default')
    expect(state.site.name).toBe('WirePredictions')
    expect(state.site.logoSvg.toLowerCase()).not.toContain('#cdff00')
    expect(state.theme.dark.primary?.toLowerCase()).toBe('#02fddd')
  })

  it('the cached fetcher resolves normally when the DB read succeeds (happy path unchanged)', async () => {
    vi.doMock('next/cache', () => ({ cacheTag: vi.fn() }))
    vi.doMock('@/lib/db/queries/settings', () => ({
      SettingsRepository: {
        getSettings: vi.fn().mockResolvedValue({ data: {}, error: null }),
      },
    }))

    const mod = await import('@/lib/theme-settings')
    const state = await mod.loadRuntimeThemeStateCached()
    expect(state.source).toBe('default')
  })
})

describe('issue 1 — getMainTags does not cache the DB-error fallback (goal a)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('getMainTagsCached THROWS when the main-tags DB query errors (so Next.js does not cache the collapsed nav)', async () => {
    vi.doMock('next/cache', () => ({
      cacheTag: vi.fn(),
      revalidatePath: vi.fn(),
    }))
    vi.doMock('@/lib/db/utils/run-query', () => ({
      runQuery: vi.fn().mockResolvedValue({ data: null, error: 'statement timeout' }),
    }))

    const { TagRepository } = await import('@/lib/db/queries/tag')
    await expect(TagRepository.getMainTagsCached('en')).rejects.toThrow()
  })

  it('the public getMainTags catches the throw and returns the graceful null-data sentinel for one request', async () => {
    vi.doMock('next/cache', () => ({
      cacheTag: vi.fn(),
      revalidatePath: vi.fn(),
    }))
    vi.doMock('@/lib/db/utils/run-query', () => ({
      runQuery: vi.fn().mockResolvedValue({ data: null, error: 'statement timeout' }),
    }))

    const { TagRepository } = await import('@/lib/db/queries/tag')
    const result = await TagRepository.getMainTags('en')

    expect(result.data).toBeNull()
    expect(result.error).toBeTruthy()
    expect(result.globalChilds).toEqual([])
  })
})
