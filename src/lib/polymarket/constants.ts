// Polymarket integration constants shared across the fifa-overlay modules.
//
// Kept on the server side (this file is imported by `client.ts`, `fifa-overlay.ts`,
// and `event-page-data.ts`). Client components must NOT import from this file —
// they should inline `FIFA_EVENT_SLUG` literally instead (see `useEventPriceHistory.ts`).

export const FIFA_EVENT_SLUG = '2026-fifa-world-cup-winner-595' as const

export const POLYMARKET_GAMMA_BASE_DEFAULT = 'https://gamma-api.polymarket.com' as const

export const POLYMARKET_CLOB_BASE_DEFAULT = 'https://clob.polymarket.com' as const
