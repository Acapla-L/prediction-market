/**
 * Synthetic condition_id prefix registry.
 *
 * This file is the single source of truth for the read-side prefix check
 * applied by client hooks (useEventMidPrices, useEventLastTrades) and any
 * other consumer that needs to distinguish synthetic Polymarket-discovery
 * condition_ids from real Kuest CLOB condition_ids.
 *
 * IMPORTANT — no imports.
 *
 * This file MUST stay free of any import that transitively pulls
 * `'server-only'` into the bundle. Importing `@/lib/polymarket/discovery`,
 * `@/lib/polymarket/constants`, or `@/lib/polymarket/client` would break
 * client-bundle compilation. Keep this file dependency-free.
 *
 * Two prefix variants:
 *   - `polymarket-discovered:`        — Phase A v2 futures (5 hardcoded slugs)
 *   - `polymarket-discovered-game:`   — Phase B per-game discovery (Phase B+)
 *
 * Both prefixes are READ-SIDE strings (include trailing colon) for direct
 * `String.prototype.startsWith` use. The corresponding WRITE-SIDE prefix
 * lives next to its builder (discovery.ts, games-discovery.ts) — those
 * builders own the template-literal that appends the colon.
 */
export const SYNTHETIC_CONDITION_PREFIXES = [
  'polymarket-discovered:',
  'polymarket-discovered-game:',
] as const

export type SyntheticConditionPrefix = (typeof SYNTHETIC_CONDITION_PREFIXES)[number]

/**
 * Returns `true` when `conditionId` is a synthetic Polymarket-discovery id
 * (Phase A v2 futures OR Phase B per-game). Returns `false` for real Kuest
 * CLOB condition_ids (66-char hex) and Kuest ULIDs.
 */
export function isSyntheticConditionId(conditionId: string): boolean {
  return SYNTHETIC_CONDITION_PREFIXES.some(prefix => conditionId.startsWith(prefix))
}
