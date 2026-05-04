import type { DiscoveredPolymarketSlug } from '@/lib/polymarket/constants'
import { DISCOVERED_POLYMARKET_SLUGS } from '@/lib/polymarket/constants'
import 'server-only'

export interface DiscoveredSlugMetadata {
  slug: DiscoveredPolymarketSlug
  /** Human-friendly label for admin / observability surfaces. */
  display_label: string
  /** Fallback title if Gamma returns nothing usable. */
  canonical_title: string
  /** League / category grouping for future listings work. */
  league: string
}

/**
 * Per-slug metadata for the day-1 discovery allowlist. The order here mirrors
 * the order in `DISCOVERED_POLYMARKET_SLUGS`. The set of slugs is enforced
 * identical at runtime (see invariant assertion below).
 */
export const DISCOVERED_SLUG_METADATA: ReadonlyArray<DiscoveredSlugMetadata> = [
  {
    slug: '2026-nba-champion',
    display_label: '2026 NBA Champion',
    canonical_title: 'Which team will win the 2026 NBA Championship?',
    league: 'nba',
  },
  {
    slug: 'mlb-world-series-champion-2026',
    display_label: '2026 MLB World Series Champion',
    canonical_title: 'Which team will win the 2026 MLB World Series?',
    league: 'mlb',
  },
  {
    slug: '2026-nhl-stanley-cup-champion',
    display_label: '2026 NHL Stanley Cup Champion',
    canonical_title: 'Which team will win the 2026 NHL Stanley Cup?',
    league: 'nhl',
  },
  {
    slug: 'big-game-champion-2027',
    display_label: 'Super Bowl LXII Champion (2027)',
    canonical_title: 'Which team will win Super Bowl LXII?',
    league: 'nfl',
  },
  {
    slug: 'uefa-champions-league-winner',
    display_label: 'UEFA Champions League Winner',
    canonical_title: 'Which club will win the UEFA Champions League?',
    league: 'ucl',
  },
]

/**
 * Build-time invariant: the metadata table covers exactly the slugs in the
 * allowlist. Throws on import if either side has drifted.
 */
const metadataSlugs = new Set(DISCOVERED_SLUG_METADATA.map(m => m.slug))
for (const slug of DISCOVERED_POLYMARKET_SLUGS) {
  if (!metadataSlugs.has(slug)) {
    throw new Error(
      `[discovered-slugs] DISCOVERED_POLYMARKET_SLUGS contains '${slug}' with no metadata entry. Add to DISCOVERED_SLUG_METADATA.`,
    )
  }
}
if (DISCOVERED_SLUG_METADATA.length !== DISCOVERED_POLYMARKET_SLUGS.length) {
  throw new Error(
    `[discovered-slugs] metadata length (${DISCOVERED_SLUG_METADATA.length}) does not match allowlist length (${DISCOVERED_POLYMARKET_SLUGS.length}).`,
  )
}

export function getDiscoveredSlugMetadata(slug: string): DiscoveredSlugMetadata | null {
  return DISCOVERED_SLUG_METADATA.find(m => m.slug === slug) ?? null
}
