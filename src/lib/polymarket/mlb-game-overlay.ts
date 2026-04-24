import type {
  MlbGameOverlayMarket,
  MlbGameOverlayResult,
  MlbGammaMarket,
  MlbSportsMarketType,
} from '@/lib/polymarket/types'
import type { Event, Market, Outcome } from '@/types'
import { unstable_cache } from 'next/cache'
import { fetchMlbGameGammaEvent } from '@/lib/polymarket/client'
import { isMlbGameSlug, MLB_GAME_SLUGS } from '@/lib/polymarket/constants'
import 'server-only'

/**
 * Polymarket → our-DB outcome-label normalization, MLB-specific.
 *
 * Polymarket returns 'Yes' / 'No' for NRFI markets; our DB uses 'Yes Run' /
 * 'No Run' (Kuest convention). All other MLB outcomes (team names, Over /
 * Under) match exactly after an identity passthrough. If a future Polymarket
 * shape drift introduces another mismatch, add an entry keyed by
 * `${marketType}:${polymarketLabel}`.
 *
 * The lookup key is a tuple of market type and Polymarket label so a literal
 * 'Yes' coming from a future non-NRFI market would NOT be rewritten. The
 * parallel FIFA map (`POLYMARKET_TO_DB` in `fifa-overlay.ts`) is one-sided
 * (country name only), since FIFA markets are homogeneous binary — MLB
 * markets are heterogeneous, so the mapping has to be narrower.
 */
const POLYMARKET_TO_DB_OUTCOME: Record<string, string> = {
  'nrfi:Yes': 'Yes Run',
  'nrfi:No': 'No Run',
}

export function normalizeOutcomeLabel(marketType: MlbSportsMarketType, polymarketLabel: string): string {
  return POLYMARKET_TO_DB_OUTCOME[`${marketType}:${polymarketLabel}`] ?? polymarketLabel
}

/**
 * Composite overlay key used to pair a Polymarket Gamma market with a DB
 * market. Shape is `${marketType}` for markets without a line (moneyline,
 * nrfi) and `${marketType}:${line}` otherwise. Both sides (Gamma build path
 * and DB apply path) compute the key the same way.
 */
export function makeOverlayKey(marketType: MlbSportsMarketType, line: number | null): string {
  if (marketType === 'moneyline' || marketType === 'nrfi') {
    return marketType
  }
  if (line === null) {
    return marketType
  }
  return `${marketType}:${line}`
}

/**
 * Parse the line value from a DB market's `short_title` to mirror Polymarket's
 * `line` field. The pilot insert uses 'Spread -1.5' and 'O/U 9.5' conventions
 * (these match Kuest's sync-time format for reference games like
 * `mlb-atl-laa-2026-04-07`). Returns `null` when no numeric line is found.
 */
function parseLineFromShortTitle(shortTitle: string | null | undefined): number | null {
  if (!shortTitle) {
    return null
  }
  const match = shortTitle.match(/(-?\d+(?:\.\d+)?)/)
  if (!match) {
    return null
  }
  const n = Number.parseFloat(match[1])
  return Number.isFinite(n) ? n : null
}

/**
 * Derive the overlay key from a DB market. Returns `null` when the market's
 * `sports_market_type` is missing or unrecognized — in which case the
 * overlay simply passes the market through.
 */
function overlayKeyFromDbMarket(market: Market): string | null {
  const mt = market.sports_market_type
  if (mt !== 'moneyline' && mt !== 'nrfi' && mt !== 'spreads' && mt !== 'totals') {
    return null
  }
  if (mt === 'moneyline' || mt === 'nrfi') {
    return mt
  }
  const line = parseLineFromShortTitle(market.short_title ?? null)
  if (line === null) {
    return null
  }
  return `${mt}:${line}`
}

/**
 * Build an overlay entry for one Polymarket market. Normalizes the two
 * outcome labels to their DB-canonical form (see `normalizeOutcomeLabel`)
 * and stores price + CLOB token ID under the normalized key.
 */
function buildOverlayMarket(m: MlbGammaMarket): MlbGameOverlayMarket {
  const [labelA, labelB] = m.outcomes
  const [priceA, priceB] = m.outcomePrices
  const [tokenA, tokenB] = m.clobTokenIds

  const outcomesByLabel: Record<string, { price: number | null, tokenId: string }> = {}
  outcomesByLabel[normalizeOutcomeLabel(m.sportsMarketType, labelA)] = {
    price: Number.isFinite(priceA) ? priceA : null,
    tokenId: tokenA,
  }
  outcomesByLabel[normalizeOutcomeLabel(m.sportsMarketType, labelB)] = {
    price: Number.isFinite(priceB) ? priceB : null,
    tokenId: tokenB,
  }

  return {
    marketType: m.sportsMarketType,
    line: m.line,
    outcomesByLabel,
    volume: m.volume,
    closed: m.closed,
  }
}

/**
 * Fetch the per-game MLB event from Polymarket Gamma, filter inactive /
 * closed markets, and build the composite-key lookup consumed by the
 * loader's `applyMlbGameOverlay` pass.
 *
 * Failure behavior: returns `{ slug, marketsByKey: {}, stale: true }` on
 * upstream failure or unknown slug. Never throws. The loader sees an empty
 * map and silently skips stitching — the page falls through to the Kuest
 * render path with zero overlay contribution.
 *
 * Exported separately from `getMlbGameOverlay` so unit tests exercise the
 * build logic directly without Next.js's `unstable_cache` runtime.
 */
export async function buildMlbGameOverlay(slug: string): Promise<MlbGameOverlayResult> {
  const now = new Date()
  if (!isMlbGameSlug(slug)) {
    return { slug, marketsByKey: {}, stale: true, lastUpdatedAt: now }
  }

  const gammaEvent = await fetchMlbGameGammaEvent(slug)
  if (!gammaEvent) {
    return { slug, marketsByKey: {}, stale: true, lastUpdatedAt: now }
  }

  const marketsByKey: Record<string, MlbGameOverlayMarket> = {}
  let skippedCount = 0
  let overlaidCount = 0

  for (const m of gammaEvent.markets) {
    if (!m.active || m.closed) {
      skippedCount += 1
      continue
    }
    const key = makeOverlayKey(m.sportsMarketType, m.line)
    marketsByKey[key] = buildOverlayMarket(m)
    overlaidCount += 1
  }

  console.info(
    `[mlb-game-overlay] slug=${slug} skipped ${skippedCount} inactive/closed markets, overlaid ${overlaidCount} active markets`,
  )

  return { slug, marketsByKey, stale: false, lastUpdatedAt: now }
}

/**
 * Stitch Polymarket overlay data onto an MLB event's markets and outcomes.
 *
 * **Revision 1 invariant (MLB-shaped):** this function NEVER writes to
 * `outcome.token_id` or removes any existing field. For matched markets:
 *   - Overrides `market.price`, `market.probability`, `market.volume`
 *     (using the HOME-team outcome's price as the market-level price, to
 *     mirror FIFA's "YES price is the market price" convention — for MLB
 *     this means the outcome at `outcome_index === 0` wins the market
 *     probability display).
 *   - For each outcome: looks up `outcome.outcome_text` in the overlay's
 *     `outcomesByLabel` map. If found, overrides `buy_price` / `sell_price`
 *     and sets the new optional `polymarket_token_id`. If NOT found, the
 *     outcome passes through untouched (partial overlay is safe).
 *
 * The Kuest `token_id` on every outcome survives intact. Non-MLB-game
 * events pass through untouched (defensive — the loader's guard clause
 * already filters on slug, but this keeps the function caller-safe).
 *
 * Pure function — returns a new `Event`; never mutates its arguments.
 */
export function applyMlbGameOverlay(event: Event, overlay: MlbGameOverlayResult): Event {
  if (!isMlbGameSlug(event.slug)) {
    return event
  }
  if (event.slug !== overlay.slug) {
    // Defensive: caller constructed overlay for a different slug.
    return event
  }

  const stitchedMarkets = event.markets.map((market) => {
    const key = overlayKeyFromDbMarket(market)
    if (!key) {
      return market
    }
    const overlayMarket = overlay.marketsByKey[key]
    if (!overlayMarket) {
      return market
    }

    const stitchedOutcomes: Outcome[] = market.outcomes.map((outcome) => {
      const overlayOutcome = overlayMarket.outcomesByLabel[outcome.outcome_text]
      if (!overlayOutcome) {
        return outcome
      }
      return {
        ...outcome,
        buy_price: overlayOutcome.price ?? outcome.buy_price,
        sell_price: overlayOutcome.price ?? outcome.sell_price,
        polymarket_token_id: overlayOutcome.tokenId,
      }
    })

    // Market-level price: mirror FIFA's YES-is-market-price convention by
    // reading the outcome at index 0 (home team for moneyline/spreads,
    // 'Yes Run' for NRFI, 'Over' for totals). If the overlay didn't match
    // that outcome, fall back to the existing market.price.
    const index0Outcome = market.outcomes.find(o => o.outcome_index === 0)
    const index0Label = index0Outcome?.outcome_text
    const index0OverlayPrice = index0Label != null
      ? overlayMarket.outcomesByLabel[index0Label]?.price ?? null
      : null

    return {
      ...market,
      price: index0OverlayPrice ?? market.price,
      probability: index0OverlayPrice != null ? index0OverlayPrice * 100 : market.probability,
      volume: overlayMarket.volume,
      outcomes: stitchedOutcomes,
    }
  })

  return { ...event, markets: stitchedMarkets }
}

/**
 * Cached public accessor. 30s revalidate keeps Polymarket load low while
 * giving the page a live feel. Tag `polymarket:event:<slug>` for uniformity
 * with the FIFA overlay so an admin-side revalidation pattern can invalidate
 * any Polymarket overlay with a single tag shape.
 *
 * The cache key includes `POLYMARKET_GAMMA_BASE` (I-1 regression guard,
 * mirrored from FIFA) AND the slug, so a future env-var swap OR an added
 * game slug in `MLB_GAME_SLUGS` does not serve the cached result from the
 * previous origin/slug.
 */
const DEFAULT_GAMMA_KEY_SENTINEL = '__default__'

export function getMlbGameOverlay(slug: string): Promise<MlbGameOverlayResult> {
  const gammaBaseForKey = process.env.POLYMARKET_GAMMA_BASE || DEFAULT_GAMMA_KEY_SENTINEL
  const cached = unstable_cache(
    () => buildMlbGameOverlay(slug),
    ['polymarket-mlb-game-overlay-v1', gammaBaseForKey, slug],
    {
      revalidate: 30,
      tags: [`polymarket:event:${slug}`],
    },
  )
  return cached()
}

// Re-export the slug set so consumers who only import this module don't
// need a second import. (Sports-event-page loader reads it via this path.)
export { isMlbGameSlug, MLB_GAME_SLUGS }
