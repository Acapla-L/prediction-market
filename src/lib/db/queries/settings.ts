import type { QueryResult } from '@/types'
import { sql } from 'drizzle-orm'
import { cacheLife, cacheTag, updateTag } from 'next/cache'
import { cacheTags } from '@/lib/cache-tags'
import { DEFAULT_ERROR_MESSAGE } from '@/lib/constants'
import { settings } from '@/lib/db/schema/settings/tables'
import { getOrCreateModuleCache } from '@/lib/db/utils/module-cache'
import { runQuery } from '@/lib/db/utils/run-query'
import { db } from '@/lib/drizzle'

type SettingsByGroup = Record<string, Record<string, { value: string, updated_at: string }>>

// Per-Vercel-instance burst absorption for the settings fetch. PR 2 of the
// cascade-fix sequence (RC-1) — admin mutations propagate via the 60s TTL,
// NOT via `updateTag(cacheTags.settings)` (that busts the outer Next.js
// `'use cache'` layer, not this module cache). 60s admin-staleness contract
// is documented at docs/plans/cascade-fix-plan-2026-05-15.md §PR 2.
const SETTINGS_MODULE_CACHE_KEY = 'settings'
const settingsModuleCache = getOrCreateModuleCache<typeof SETTINGS_MODULE_CACHE_KEY, SettingsByGroup>(
  'settings',
  60_000,
)

/**
 * Cached settings fetcher. Issue 1 fix: this THROWS on a DB error instead of
 * returning a `{ data: null, error }` sentinel. A normal return would be
 * persisted by `'use cache'` for the cache TTL (~5–15 min), which is exactly
 * what made site branding (theme + nav) stick to the Kuest fallback after a
 * transient Supabase timeout. Throwing prevents Cache Components from caching
 * the failed read, so the next request retries the DB. The public
 * `SettingsRepository.getSettings` wrapper below converts the throw back into
 * the historical sentinel so existing callers keep their graceful degradation.
 *
 * PR 2 (cascade-fix RC-1): wrapped with a per-instance module cache that
 * survives `'use cache'` invalidations. Throws still propagate cleanly —
 * the module cache stores only resolved values; rejected fills clear the
 * inflight entry without poisoning the cache. PR #21 hardening preserved.
 */
async function getSettingsCached(): Promise<SettingsByGroup> {
  'use cache'
  cacheTag(cacheTags.settings)
  // Settings change only on admin actions (which bust `cacheTags.settings` via
  // `updateTag`). `'max'` makes this tag-driven — no 15-min time-based
  // background re-renders of this DB read.
  cacheLife('max')

  return settingsModuleCache.get(SETTINGS_MODULE_CACHE_KEY, async () => {
    const data = await db.select({
      group: settings.group,
      key: settings.key,
      value: settings.value,
      updated_at: settings.updated_at,
    }).from(settings)

    const settingsByGroup: SettingsByGroup = {}

    for (const setting of data) {
      settingsByGroup[setting.group] ??= {}
      settingsByGroup[setting.group][setting.key] = {
        value: setting.value,
        updated_at: setting.updated_at.toISOString(),
      }
    }

    return settingsByGroup
  })
}

export const SettingsRepository = {
  async getSettings(): Promise<QueryResult<SettingsByGroup>> {
    try {
      const data = await getSettingsCached()
      return { data, error: null }
    }
    catch (error) {
      console.error('Failed to fetch settings:', error)
      return { data: null, error: DEFAULT_ERROR_MESSAGE }
    }
  },

  async updateSettings(settingsArray: Array<{ group: string, key: string, value: string }>): Promise<QueryResult<Array<typeof settings.$inferSelect>>> {
    return runQuery(async () => {
      const data = await db
        .insert(settings)
        .values(settingsArray)
        .onConflictDoUpdate({
          target: [settings.group, settings.key],
          set: {
            value: sql`EXCLUDED.value`,
          },
        })
        .returning({
          id: settings.id,
          group: settings.group,
          key: settings.key,
          value: settings.value,
          created_at: settings.created_at,
          updated_at: settings.updated_at,
        })

      updateTag(cacheTags.settings)

      return { data, error: null }
    })
  },
}
