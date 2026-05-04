import { describe, expect, it } from 'vitest'
import {
  DISCOVERED_POLYMARKET_SLUGS,
  FIFA_EVENT_SLUG,
  POLYMARKET_OVERLAY_SLUGS,
} from '@/lib/polymarket/constants'
import {
  DISCOVERED_SLUG_METADATA,
  getDiscoveredSlugMetadata,
} from '@/lib/polymarket/discovered-slugs'

describe('dISCOVERED_POLYMARKET_SLUGS allowlist', () => {
  it('contains exactly the five day-1 slugs', () => {
    expect([...DISCOVERED_POLYMARKET_SLUGS]).toEqual([
      '2026-nba-champion',
      'mlb-world-series-champion-2026',
      '2026-nhl-stanley-cup-champion',
      'big-game-champion-2027',
      'uefa-champions-league-winner',
    ])
  })

  it('contains no duplicates', () => {
    const seen = new Set<string>()
    for (const slug of DISCOVERED_POLYMARKET_SLUGS) {
      expect(seen.has(slug)).toBe(false)
      seen.add(slug)
    }
  })

  it('does NOT include the FIFA slug (FIFA stays a separate code path)', () => {
    expect(DISCOVERED_POLYMARKET_SLUGS).not.toContain(FIFA_EVENT_SLUG)
  })
})

describe('pOLYMARKET_OVERLAY_SLUGS union', () => {
  it('is FIFA followed by every discovered slug, no duplicates', () => {
    expect(POLYMARKET_OVERLAY_SLUGS).toHaveLength(DISCOVERED_POLYMARKET_SLUGS.length + 1)
    expect(POLYMARKET_OVERLAY_SLUGS[0]).toBe(FIFA_EVENT_SLUG)

    const set = new Set(POLYMARKET_OVERLAY_SLUGS)
    expect(set.size).toBe(POLYMARKET_OVERLAY_SLUGS.length)
  })

  it('contains every discovered slug', () => {
    for (const slug of DISCOVERED_POLYMARKET_SLUGS) {
      expect(POLYMARKET_OVERLAY_SLUGS).toContain(slug)
    }
  })
})

describe('dISCOVERED_SLUG_METADATA', () => {
  it('covers exactly the same slugs as the allowlist (no drift)', () => {
    const metadataSlugs = DISCOVERED_SLUG_METADATA.map(m => m.slug).sort()
    const allowlistSlugs = [...DISCOVERED_POLYMARKET_SLUGS].sort()
    expect(metadataSlugs).toEqual(allowlistSlugs)
  })

  it('every entry has display_label, canonical_title, and league populated', () => {
    for (const meta of DISCOVERED_SLUG_METADATA) {
      expect(meta.display_label.length).toBeGreaterThan(0)
      expect(meta.canonical_title.length).toBeGreaterThan(0)
      expect(meta.league.length).toBeGreaterThan(0)
    }
  })

  it('league values map to recognised sport identifiers', () => {
    const validLeagues = new Set(['nba', 'mlb', 'nhl', 'nfl', 'ucl'])
    for (const meta of DISCOVERED_SLUG_METADATA) {
      expect(validLeagues.has(meta.league)).toBe(true)
    }
  })
})

describe('getDiscoveredSlugMetadata lookup', () => {
  it('returns metadata for an allowlisted slug', () => {
    const meta = getDiscoveredSlugMetadata('uefa-champions-league-winner')
    expect(meta).not.toBeNull()
    expect(meta?.league).toBe('ucl')
  })

  it('returns null for an unknown slug', () => {
    expect(getDiscoveredSlugMetadata('definitely-not-an-allowlisted-slug')).toBeNull()
  })

  it('returns null for the FIFA slug (FIFA does not live in the discovered metadata)', () => {
    expect(getDiscoveredSlugMetadata(FIFA_EVENT_SLUG)).toBeNull()
  })
})
