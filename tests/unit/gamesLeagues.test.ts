import { describe, expect, it } from 'vitest'
import {
  DISCOVERED_GAMES_LEAGUES,
  getLeagueForGameSlug,
  isDiscoveryGameSlug,
} from '@/lib/polymarket/games-leagues'

describe('phase B per-game leagues registry', () => {
  it('mLB is the first registry entry (Phase B v2 v1 anchor) and every entry has required fields', () => {
    // Phase B v2 v1 anchor: MLB must be the first entry to preserve original ordering.
    expect(DISCOVERED_GAMES_LEAGUES.length).toBeGreaterThanOrEqual(1)
    expect(DISCOVERED_GAMES_LEAGUES[0].slug).toBe('mlb')
    expect(DISCOVERED_GAMES_LEAGUES[0].seriesId).toBe('3')

    // Every entry has the required fields.
    for (const league of DISCOVERED_GAMES_LEAGUES) {
      expect(typeof league.slug).toBe('string')
      expect(league.slug.length).toBeGreaterThan(0)
      expect(typeof league.seriesId).toBe('string')
      expect(league.seriesId.length).toBeGreaterThan(0)
      expect(league.slugPattern).toBeInstanceOf(RegExp)
      expect(typeof league.mainTag).toBe('string')
      expect(league.mainTag.length).toBeGreaterThan(0)
      expect(typeof league.sportRouteSlug).toBe('string')
      expect(league.sportRouteSlug.length).toBeGreaterThan(0)
    }
  })

  it('isDiscoveryGameSlug recognizes valid MLB game slugs', () => {
    expect(isDiscoveryGameSlug('mlb-tex-nyy-2026-05-05')).toBe(true)
    expect(isDiscoveryGameSlug('mlb-cin-chc-2026-05-05')).toBe(true)
    expect(isDiscoveryGameSlug('mlb-mil-stl-2026-06-15')).toBe(true)
    // 4-letter team abbrs (rare but possible)
    expect(isDiscoveryGameSlug('mlb-cubs-mets-2026-05-05')).toBe(true)
  })

  it('isDiscoveryGameSlug rejects MLB futures slugs (Phase A v2)', () => {
    expect(isDiscoveryGameSlug('mlb-world-series-champion-2026')).toBe(false)
  })

  it('isDiscoveryGameSlug rejects other Phase A v2 futures', () => {
    expect(isDiscoveryGameSlug('2026-nba-champion')).toBe(false)
    expect(isDiscoveryGameSlug('uefa-champions-league-winner')).toBe(false)
    expect(isDiscoveryGameSlug('2026-fifa-world-cup-winner-595')).toBe(false)
  })

  it('isDiscoveryGameSlug rejects Kuest event slugs', () => {
    expect(isDiscoveryGameSlug('what-price-will-bitcoin-hit-on-may-5')).toBe(false)
    expect(isDiscoveryGameSlug('elon-musk-of-tweets-may-5')).toBe(false)
  })

  it('isDiscoveryGameSlug accepts NBA + NHL slugs (Phase B v2 v2 ship), still rejects unregistered leagues', () => {
    // Phase B v2 v2 added NBA + NHL to the registry.
    expect(isDiscoveryGameSlug('nba-min-sas-2026-05-06')).toBe(true)
    expect(isDiscoveryGameSlug('nhl-flo-edm-2026-06-15')).toBe(true)

    // NFL and EPL are still NOT in the registry — preserves locked-out behavior.
    expect(isDiscoveryGameSlug('nfl-kc-buf-2026-09-08')).toBe(false)
    expect(isDiscoveryGameSlug('epl-mci-arn-2026-05-15')).toBe(false)
  })

  it('isDiscoveryGameSlug rejects malformed slugs', () => {
    // No date
    expect(isDiscoveryGameSlug('mlb-tex-nyy')).toBe(false)
    // Wrong date format
    expect(isDiscoveryGameSlug('mlb-tex-nyy-05-05-2026')).toBe(false)
    // Extra segments
    expect(isDiscoveryGameSlug('mlb-tex-nyy-2026-05-05-spread-home-1pt5')).toBe(false)
    // Empty
    expect(isDiscoveryGameSlug('')).toBe(false)
    // League prefix only
    expect(isDiscoveryGameSlug('mlb')).toBe(false)
  })

  it('getLeagueForGameSlug returns the matched league entry', () => {
    const league = getLeagueForGameSlug('mlb-tex-nyy-2026-05-05')
    expect(league).toBeDefined()
    expect(league?.slug).toBe('mlb')
    expect(league?.seriesId).toBe('3')
    expect(league?.mainTag).toBe('mlb')
  })

  it('getLeagueForGameSlug returns undefined for non-discovery slugs', () => {
    expect(getLeagueForGameSlug('mlb-world-series-champion-2026')).toBeUndefined()
    expect(getLeagueForGameSlug('random-slug')).toBeUndefined()
  })
})
