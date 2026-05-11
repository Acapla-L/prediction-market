import { describe, expect, it } from 'vitest'
import {
  DISCOVERED_GAMES_LEAGUES,
  FRIENDLY_DISCOVERY_TITLES,
  getLeagueForGameSlug,
  getLeaguesBySportRouteSlug,
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

  it('preserves the per-league placeholderAbbreviations Sets (source-of-truth)', () => {
    const mlb = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === 'mlb')!
    const nba = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === 'nba')!
    const nhl = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === 'nhl')!

    expect(mlb.placeholderAbbreviations).toBeDefined()
    expect([...mlb.placeholderAbbreviations!].sort()).toEqual(['al', 'nl'])

    expect(nba.placeholderAbbreviations).toBeDefined()
    expect([...nba.placeholderAbbreviations!].sort()).toEqual(
      ['cgs', 'crs', 'kys', 'sog', 'stars', 'stripes', 'world'],
    )

    expect(nhl.placeholderAbbreviations).toBeDefined()
    expect([...nhl.placeholderAbbreviations!].sort()).toEqual(
      ['cannhl', 'finnhl', 'swenhl', 'usanhl'],
    )
  })

  it('opts MLB OUT of the logo+color placeholder heuristic; opts NBA + NHL IN', () => {
    const mlb = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === 'mlb')!
    const nba = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === 'nba')!
    const nhl = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === 'nhl')!

    // MLB: All-Star roster names are exhaustively enumerated in the Set; the
    // heuristic must stay OFF so a future real MLB team with incomplete
    // metadata is not accidentally filtered.
    expect(mlb.applyLogoColorPlaceholderHeuristic).toBeFalsy()

    // NBA + NHL: rotating All-Star / international rosters may add new variants
    // we haven't enumerated — heuristic ON.
    expect(nba.applyLogoColorPlaceholderHeuristic).toBe(true)
    expect(nhl.applyLogoColorPlaceholderHeuristic).toBe(true)
  })

  it('sets teamOrderConvention to away_first for all US-sports leagues (MLB/NBA/NHL)', () => {
    const mlb = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === 'mlb')!
    const nba = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === 'nba')!
    const nhl = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === 'nhl')!
    expect(mlb.teamOrderConvention).toBe('away_first')
    expect(nba.teamOrderConvention).toBe('away_first')
    expect(nhl.teamOrderConvention).toBe('away_first')
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

  it('isDiscoveryGameSlug accepts NBA + NHL + soccer slugs, still rejects unregistered leagues', () => {
    // Phase B v2 v2 added NBA + NHL; Phase B v2 v3 added EPL/La Liga/MLS/FIFA WC.
    expect(isDiscoveryGameSlug('nba-min-sas-2026-05-06')).toBe(true)
    expect(isDiscoveryGameSlug('nhl-flo-edm-2026-06-15')).toBe(true)
    expect(isDiscoveryGameSlug('epl-mci-arn-2026-05-15')).toBe(true)

    // NFL is still NOT in the registry — preserves locked-out behavior.
    expect(isDiscoveryGameSlug('nfl-kc-buf-2026-09-08')).toBe(false)
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

describe('phase B v2 v3 soccer leagues (EPL / La Liga / MLS / FIFA WC)', () => {
  const epl = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === 'epl')!
  const laliga = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === 'laliga')!
  const mls = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === 'mls')!
  const fifwc = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === 'fifwc')!

  it('registers all 4 soccer entries with correct slug / seriesId / sportRouteSlug', () => {
    expect(epl).toBeDefined()
    expect(laliga).toBeDefined()
    expect(mls).toBeDefined()
    expect(fifwc).toBeDefined()

    expect(epl.seriesId).toBe('10188')
    expect(laliga.seriesId).toBe('10193')
    expect(mls.seriesId).toBe('10189')
    expect(fifwc.seriesId).toBe('11433')

    expect(epl.sportRouteSlug).toBe('soccer')
    expect(laliga.sportRouteSlug).toBe('soccer')
    expect(mls.sportRouteSlug).toBe('soccer')
    expect(fifwc.sportRouteSlug).toBe('fifa-world-cup')
  })

  it('only La Liga carries teamsApiCode (=lal); EPL/MLS/FIFA WC omit it', () => {
    expect(laliga.teamsApiCode).toBe('lal')
    expect(epl.teamsApiCode).toBeUndefined()
    expect(mls.teamsApiCode).toBeUndefined()
    expect(fifwc.teamsApiCode).toBeUndefined()
  })

  it('all 4 soccer entries use home_first; US-sports leagues stay away_first', () => {
    expect(epl.teamOrderConvention).toBe('home_first')
    expect(laliga.teamOrderConvention).toBe('home_first')
    expect(mls.teamOrderConvention).toBe('home_first')
    expect(fifwc.teamOrderConvention).toBe('home_first')

    const mlb = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === 'mlb')!
    const nba = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === 'nba')!
    const nhl = DISCOVERED_GAMES_LEAGUES.find(l => l.slug === 'nhl')!
    expect(mlb.teamOrderConvention).toBe('away_first')
    expect(nba.teamOrderConvention).toBe('away_first')
    expect(nhl.teamOrderConvention).toBe('away_first')
  })

  it('soccer entries omit placeholderAbbreviations and applyLogoColorPlaceholderHeuristic', () => {
    for (const league of [epl, laliga, mls, fifwc]) {
      expect(league.placeholderAbbreviations).toBeUndefined()
      expect(league.applyLogoColorPlaceholderHeuristic).toBeUndefined()
    }
  })

  it('getLeaguesBySportRouteSlug aggregates across leagues for a multi-league sport', () => {
    expect(getLeaguesBySportRouteSlug('soccer').map(l => l.slug)).toEqual(['epl', 'laliga', 'mls'])
    expect(getLeaguesBySportRouteSlug('fifa-world-cup').map(l => l.slug)).toEqual(['fifwc'])
    // No regression for single-league sports.
    expect(getLeaguesBySportRouteSlug('baseball').map(l => l.slug)).toEqual(['mlb'])
    expect(getLeaguesBySportRouteSlug('nonexistent')).toEqual([])
  })

  it('getLeagueForGameSlug bridges soccer slug-prefix → registry slug', () => {
    expect(getLeagueForGameSlug('lal-elc-ala-2026-05-09')?.slug).toBe('laliga')
    expect(getLeagueForGameSlug('epl-mac-cry-2026-03-21')?.slug).toBe('epl')
    expect(getLeagueForGameSlug('mls-ner-hou-2026-03-07')?.slug).toBe('mls')
    expect(getLeagueForGameSlug('fifwc-mex-rsa-2026-06-11')?.slug).toBe('fifwc')
  })

  it('isDiscoveryGameSlug recognizes soccer per-game slugs', () => {
    expect(isDiscoveryGameSlug('epl-mac-cry-2026-03-21')).toBe(true)
    expect(isDiscoveryGameSlug('lal-elc-ala-2026-05-09')).toBe(true)
    expect(isDiscoveryGameSlug('mls-ner-hou-2026-03-07')).toBe(true)
    expect(isDiscoveryGameSlug('fifwc-mex-rsa-2026-06-11')).toBe(true)
    // The Phase A v2 FIFA futures slug must NOT match the per-game pattern.
    expect(isDiscoveryGameSlug('2026-fifa-world-cup-winner-595')).toBe(false)
  })

  it('fRIENDLY_DISCOVERY_TITLES carries the FIFA WC h1 fallback', () => {
    expect(FRIENDLY_DISCOVERY_TITLES.fifwc).toBe('FIFA World Cup 2026')
  })
})
