// Polymarket integration constants shared across the overlay modules.
//
// Kept on the server side (this file is imported by `client.ts`, `fifa-overlay.ts`,
// `mlb-game-overlay.ts`, `event-page-data.ts`, and `sports-event-page.tsx`).
// Client components must NOT import from this file — they should inline the
// relevant slug constant literally instead (see `useEventPriceHistory.ts`).

export const FIFA_EVENT_SLUG = '2026-fifa-world-cup-winner-595' as const

export const POLYMARKET_GAMMA_BASE_DEFAULT = 'https://gamma-api.polymarket.com' as const

export const POLYMARKET_CLOB_BASE_DEFAULT = 'https://clob.polymarket.com' as const

/**
 * Explicit allowlist of MLB per-game event slugs that flow through the
 * `mlb-game-overlay` guard clause in `sports-event-page.tsx`. One entry per
 * pilot game; every other slug (including other MLB games that haven't been
 * explicitly added here) renders via the existing Kuest path with zero
 * Polymarket intervention.
 *
 * Why a Set and not a regex: the sports-slug layer in this codebase uses
 * Set-based membership throughout (`platform/src/lib/sports-slug-mapping.ts`,
 * `platform/src/lib/sports-vertical.ts`). A regex like
 * `/^mlb-[a-z]{2,4}-[a-z]{2,4}-\d{4}-\d{2}-\d{2}$/` would silently catch
 * expired games like `mlb-atl-laa-2026-04-07` (which has no overlay match
 * target on Polymarket) and any future MLB slug shipped via Kuest sync
 * without code review, breaking the "FIFA byte-for-byte unchanged + one MLB
 * game live, nothing else" scope-lock invariant. Explicit list is the safer
 * pattern for a pilot. Future sessions can migrate to a regex once the
 * overlay is validated against multiple shipped games.
 */
export const MLB_GAME_SLUGS: ReadonlySet<string> = new Set<string>([
  'mlb-chc-lad-2026-04-24',
])

/**
 * Test membership of a slug against `MLB_GAME_SLUGS`. Server-only — client
 * components must inline the slug set (see
 * `useEventPriceHistory.ts:MLB_GAME_SLUGS_INLINE`).
 */
export function isMlbGameSlug(slug: string): boolean {
  return MLB_GAME_SLUGS.has(slug)
}
