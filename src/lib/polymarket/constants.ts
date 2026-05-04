// Polymarket integration constants shared across the polymarket modules.
//
// Kept on the server side (this file is imported by `client.ts`, `fifa-overlay.ts`,
// `discovery.ts`, and `event-page-data.ts`). Client components must NOT import
// from this file — they should inline the slug literals instead (see
// `useEventPriceHistory.ts` for the FIFA + discovered-slugs allowlist mirror).

export const FIFA_EVENT_SLUG = '2026-fifa-world-cup-winner-595' as const

export const POLYMARKET_GAMMA_BASE_DEFAULT = 'https://gamma-api.polymarket.com' as const

export const POLYMARKET_CLOB_BASE_DEFAULT = 'https://clob.polymarket.com' as const

/**
 * Hardcoded allowlist of Polymarket Gamma slugs that the discovery sidecar
 * surfaces. Each entry must exist on Polymarket Gamma at the time it is added —
 * verified via `/events?slug=<slug>` returning a non-empty event payload.
 *
 * Adding a slug here is a two-step ship:
 *   1. Append the slug here (server-side allowlist).
 *   2. Append the SAME slug to the inline list in `useEventPriceHistory.ts`
 *      (client-side allowlist mirror).
 *
 * The drift detector at `tests/unit/discoveryAllowlistInvariant.test.ts`
 * fails if these two lists diverge.
 *
 * Day-1 list (verified 2026-05-04 — see Phase A v2 execution plan §C):
 */
export const DISCOVERED_POLYMARKET_SLUGS = [
  '2026-nba-champion',
  'mlb-world-series-champion-2026',
  '2026-nhl-stanley-cup-champion',
  'big-game-champion-2027',
  'uefa-champions-league-winner',
] as const

export type DiscoveredPolymarketSlug = typeof DISCOVERED_POLYMARKET_SLUGS[number]

/**
 * Convenience: full overlay allowlist for routing decisions that need to
 * accept BOTH FIFA (the original overlay) AND any discovered slug. Server-only.
 */
export const POLYMARKET_OVERLAY_SLUGS = [
  FIFA_EVENT_SLUG,
  ...DISCOVERED_POLYMARKET_SLUGS,
] as const
