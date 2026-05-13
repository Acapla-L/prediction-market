import { revalidatePath, revalidateTag } from 'next/cache'
import { connection, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/auth-cron'
import { cacheTags } from '@/lib/cache-tags'
import { DiscoveredEventsRepository } from '@/lib/db/queries/discovered-events'
import { fetchPolymarketGammaEvent } from '@/lib/polymarket/client'
import { DISCOVERED_POLYMARKET_SLUGS } from '@/lib/polymarket/constants'
import { getDiscoveredSlugMetadata } from '@/lib/polymarket/discovered-slugs'
import {
  normalizeDiscoveryPayload,
  serializeDiscoveryPayload,
} from '@/lib/polymarket/normalize-discovery-payload'

// Long-running cron sync — match the legacy Kuest sync routes' ceiling
// (`polymarket-games-discovery`, `polymarket-games-refresh`, `polymarket-teams`
// all set this). Without it, the route 504s at the default function timeout
// under Supavisor pool contention (observed 2026-05-12T01:07). `maxDuration` is
// the one route-segment config still tolerated under `cacheComponents`.
export const maxDuration = 300

interface SlugSyncResult {
  slug: string
  status: 'ok' | 'gamma_404' | 'parse_error' | 'network_error' | 'upsert_error'
  market_count?: number
  error?: string
}

/**
 * POST /api/sync/polymarket-discovery (also accepts GET for parity with the
 * other sync routes that pg_cron triggers).
 *
 * Iterates the hardcoded DISCOVERED_POLYMARKET_SLUGS allowlist, fetches each
 * slug from Polymarket Gamma, and upserts the trimmed payload into
 * `discovered_polymarket_events`. Failures preserve the previously-known-good
 * payload — only `last_sync_status` and `last_sync_error` are updated on the
 * row when a slug fetch fails.
 *
 * After processing all slugs, revalidates the `discoveredEvent(slug)` cache
 * tag for each successful slug plus the global `eventsList` tag.
 */
async function handleDiscoverySync(request: Request) {
  // Cache Components: opt this route out of static rendering — auth header
  // and external Gamma fetches make the response per-request.
  await connection()

  const auth = request.headers.get('authorization')
  if (!isCronAuthorized(auth, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 })
  }

  const results: SlugSyncResult[] = []
  const successfulSlugs: string[] = []

  for (const slug of DISCOVERED_POLYMARKET_SLUGS) {
    try {
      const gammaEvent = await fetchPolymarketGammaEvent(slug)

      if (!gammaEvent) {
        await DiscoveredEventsRepository.markFailure({
          slug,
          status: 'gamma_404',
          error: 'fetchPolymarketGammaEvent returned null (404 / network / Zod failure)',
        })
        results.push({ slug, status: 'gamma_404' })
        continue
      }

      const payload = normalizeDiscoveryPayload(gammaEvent)
      const serialized = serializeDiscoveryPayload(payload)

      const metadata = getDiscoveredSlugMetadata(slug)
      const title = gammaEvent.title || metadata?.canonical_title || slug
      const endDate = gammaEvent.endDate ? new Date(gammaEvent.endDate) : null
      const isActive = payload.markets.some(m => m.is_active && !m.is_closed)

      const upsert = await DiscoveredEventsRepository.upsertSuccess({
        slug,
        polymarket_event_id: gammaEvent.id ?? '',
        title,
        is_active: isActive,
        end_date: endDate,
        markets_payload: serialized,
      })

      if (upsert.error || !upsert.data) {
        await DiscoveredEventsRepository.markFailure({
          slug,
          status: 'upsert_error',
          error: upsert.error || 'upsert returned no row',
        })
        results.push({ slug, status: 'upsert_error', error: upsert.error || undefined })
        continue
      }

      successfulSlugs.push(slug)
      results.push({
        slug,
        status: 'ok',
        market_count: payload.markets.length,
      })
    }
    catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      await DiscoveredEventsRepository.markFailure({
        slug,
        status: 'network_error',
        error: message,
      })
      results.push({ slug, status: 'network_error', error: message })
    }
  }

  for (const slug of successfulSlugs) {
    revalidateTag(cacheTags.discoveredEvent(slug), 'max')
    // Also bust the Vercel edge CDN HTML for the event page so the pre-rendered
    // "Oops" response from before the first sync never gets served again.
    revalidatePath(`/event/${slug}`)
  }
  if (successfulSlugs.length > 0) {
    revalidateTag(cacheTags.eventsList, 'max')
  }

  return NextResponse.json({ ok: true, results })
}

export async function GET(request: Request) {
  return handleDiscoverySync(request)
}

export async function POST(request: Request) {
  return handleDiscoverySync(request)
}
