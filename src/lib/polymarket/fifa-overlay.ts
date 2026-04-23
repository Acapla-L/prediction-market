import type {
  FifaOverlayMarket,
  FifaOverlayResult,
} from '@/lib/polymarket/types'
import { unstable_cache } from 'next/cache'
import { fetchFifaGammaEvent } from '@/lib/polymarket/client'
import 'server-only'

/**
 * Polymarket → our-DB country-name normalization.
 *
 * Keyed by Polymarket's `groupItemTitle`; value is the canonical name that
 * matches our DB's `markets.short_title`. The single confirmed entry is a DB
 * typo that predates this feature; every other country matched exactly in the
 * 2026-04-22 curl diff (see Section 3 of
 * `docs/plans/fifa-polymarket-overlay-implementation-plan.md`).
 */
const POLYMARKET_TO_DB: Record<string, string> = {
  Czechia: 'Cezchia',
}

/**
 * Map a Polymarket country name to our DB equivalent. Identity passthrough
 * for any name that is not explicitly in the map.
 */
export function normalizePolymarketCountry(groupItemTitle: string): string {
  return POLYMARKET_TO_DB[groupItemTitle] ?? groupItemTitle
}

/**
 * Fetch the FIFA event from Polymarket Gamma, filter out placeholder /
 * eliminated markets, and build a lookup keyed by normalized country name
 * for the event-page loader's FIFA guard clause to stitch onto
 * `event.markets[i]` at render time.
 *
 * Failure behavior: returns `{ marketsByCountry: {}, stale: true,
 * lastUpdatedAt: now }` on upstream failure. Never throws. The loader sees
 * an empty map and silently skips stitching; the page falls through to
 * today's Kuest render path.
 *
 * Exported separately from `getFifaOverlay` so unit tests can exercise the
 * build logic directly without touching Next.js's `unstable_cache` runtime.
 */
export async function buildFifaOverlay(): Promise<FifaOverlayResult> {
  const gammaEvent = await fetchFifaGammaEvent()
  const now = new Date()
  if (!gammaEvent) {
    return { marketsByCountry: {}, stale: true, lastUpdatedAt: now }
  }

  const marketsByCountry: Record<string, FifaOverlayMarket> = {}
  for (const m of gammaEvent.markets) {
    // Filter out Team AM/AI placeholders (active=false) and eliminated teams
    // like Italy (closed=true). Matches the invariant enforced by the live
    // Gamma response documented in Section 1 of the investigation.
    if (!m.active || m.closed) {
      continue
    }

    const country = normalizePolymarketCountry(m.groupItemTitle)
    const [yesPrice, noPrice] = m.outcomePrices
    const [yesTokenId, noTokenId] = m.clobTokenIds

    marketsByCountry[country] = {
      country,
      yesPrice: Number.isFinite(yesPrice) ? yesPrice : null,
      noPrice: Number.isFinite(noPrice) ? noPrice : null,
      volume: m.volume,
      closed: m.closed,
      yesTokenId,
      noTokenId,
    }
  }

  return { marketsByCountry, stale: false, lastUpdatedAt: now }
}

/**
 * Cached public accessor. 30s revalidate keeps Polymarket load low while
 * giving the page a live feel. Tag `polymarket:event:<slug>` so any future
 * admin-side revalidation can nuke this cache independently of the
 * event-page's own cache tag (`cacheTags.event(slug)`).
 *
 * The cache key includes `POLYMARKET_GAMMA_BASE` so a future env-var swap
 * (e.g., routing Gamma through a Cloudflare Worker proxy) does not serve
 * the cached result from the previous origin. Regression test lives at
 * `tests/unit/polymarketFifaOverlayCacheKey.test.ts` — code-reviewer
 * finding I-1 (2026-04-22).
 */
const DEFAULT_GAMMA_KEY_SENTINEL = '__default__'

export function getFifaOverlay(): Promise<FifaOverlayResult> {
  const gammaBaseForKey = process.env.POLYMARKET_GAMMA_BASE || DEFAULT_GAMMA_KEY_SENTINEL
  const cached = unstable_cache(
    buildFifaOverlay,
    ['polymarket-fifa-overlay-v1', gammaBaseForKey],
    {
      revalidate: 30,
      tags: ['polymarket:event:2026-fifa-world-cup-winner-595'],
    },
  )
  return cached()
}
