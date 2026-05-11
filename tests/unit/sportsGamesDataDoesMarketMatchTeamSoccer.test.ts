/**
 * Step 2F — soccer 1X2 leg-resolution verification (LOCK TEST, no source change).
 *
 * `doesMarketMatchTeam`, `isDrawMarket`, `isStandaloneDrawMarket`, and
 * `buildMoneylineButtons` are NOT exported from `sports-games-data.ts`. Per the
 * execution plan's fallback directive, this suite exercises them through the
 * public `buildSportsGamesCardGroups` entry point: a soccer per-game card built
 * from three synthetic 1X2 leg markets must resolve to exactly 3 moneyline
 * buttons in [home, draw, away] order with the correct team-abbreviation labels
 * and tones. That outcome is only reachable if:
 *   - `doesMarketMatchTeam(homeLeg, homeTeam)` is true and
 *     `doesMarketMatchTeam(homeLeg, awayTeam)` is false (→ team1 button = home leg)
 *   - the same, mirrored, for the away leg (→ team2 button = away leg)
 *   - `isDrawMarket(drawLeg)` / `isStandaloneDrawMarket(drawLeg)` are true so the
 *     draw leg is excluded from the team-matching `nonDrawMarkets` pool and
 *     placed as the dedicated DRAW button, and `doesMarketMatchTeam(drawLeg, ...)`
 *     short-circuits to false for both teams.
 *
 * Real fixture data drives the La Liga / EPL / MLS / FIFA WC root-match cases;
 * the same-city-derby (Atlético vs Real Madrid) and country-name cases are
 * hand-written minimal stubs.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildSportsGamesCardGroups } from '@/app/[locale]/(platform)/sports/_utils/sports-games-data'

const FIXTURES_DIR = join(__dirname, '..', 'fixtures')

function readFixture(name: string): { data?: unknown[] } | unknown[] {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'))
}

function fixtureEvents(name: string): Array<Record<string, any>> {
  const parsed = readFixture(name)
  const events = Array.isArray(parsed) ? parsed : (parsed as { data: unknown[] }).data
  return events as Array<Record<string, any>>
}

interface LegSpec {
  slug: string
  groupItemTitle: string
}

interface MatchSpec {
  eventSlug: string
  eventTitle: string
  homeTeam: { name: string, abbreviation: string }
  awayTeam: { name: string, abbreviation: string }
  homeLeg: LegSpec
  drawLeg: LegSpec
  awayLeg: LegSpec
}

/**
 * Replicate the relevant subset of `synthesize-sports-card.ts`'s `buildMarket`
 * output for one 1X2 leg: `title === short_title === groupItemTitle`, no
 * `sports_group_item_title`, `slug` carries the `-{abbr}` / `-draw` suffix,
 * `outcomes` is binary Yes/No, `sports_market_type: 'moneyline'`.
 */
function buildLegMarket(eventId: string, leg: LegSpec): Record<string, any> {
  const conditionId = `polymarket-discovered-game:${eventId}:${leg.slug}`
  return {
    condition_id: conditionId,
    question_id: '',
    event_id: eventId,
    title: leg.groupItemTitle,
    slug: leg.slug,
    short_title: leg.groupItemTitle,
    icon_url: '',
    is_active: true,
    is_resolved: false,
    block_number: 0,
    block_timestamp: '2026-05-11T00:00:00.000Z',
    sports_market_type: 'moneyline',
    volume_24h: 0,
    volume: 100,
    end_time: null,
    created_at: '2026-05-11T00:00:00.000Z',
    updated_at: '2026-05-11T00:00:00.000Z',
    price: 0.5,
    probability: 50,
    outcomes: [
      {
        condition_id: conditionId,
        outcome_text: 'Yes',
        outcome_index: 0,
        token_id: `${conditionId}-0`,
        polymarket_token_id: `${conditionId}-0`,
        is_winning_outcome: false,
        buy_price: 0.5,
        sell_price: 0.5,
        created_at: '2026-05-11T00:00:00.000Z',
        updated_at: '2026-05-11T00:00:00.000Z',
      },
      {
        condition_id: conditionId,
        outcome_text: 'No',
        outcome_index: 1,
        token_id: `${conditionId}-1`,
        polymarket_token_id: `${conditionId}-1`,
        is_winning_outcome: false,
        buy_price: 0.5,
        sell_price: 0.5,
        created_at: '2026-05-11T00:00:00.000Z',
        updated_at: '2026-05-11T00:00:00.000Z',
      },
    ],
    condition: {
      id: conditionId,
      oracle: '',
      question_id: '',
      outcome_slot_count: 2,
      resolved: false,
      volume: 0,
      open_interest: 0,
      active_positions_count: 0,
      created_at: '2026-05-11T00:00:00.000Z',
      updated_at: '2026-05-11T00:00:00.000Z',
    },
  }
}

function buildSoccerEvent(spec: MatchSpec): Record<string, any> {
  const markets = [
    buildLegMarket(spec.eventSlug, spec.homeLeg),
    buildLegMarket(spec.eventSlug, spec.drawLeg),
    buildLegMarket(spec.eventSlug, spec.awayLeg),
  ]
  return {
    id: spec.eventSlug,
    slug: spec.eventSlug,
    title: spec.eventTitle,
    creator: '',
    icon_url: '',
    show_market_icons: true,
    status: 'active',
    sports_event_slug: spec.eventSlug,
    sports_sport_slug: 'soccer',
    sports_section: 'games',
    sports_start_time: '2026-05-11T18:00:00.000Z',
    sports_teams: [
      {
        name: spec.homeTeam.name,
        abbreviation: spec.homeTeam.abbreviation,
        host_status: 'home',
        record: null,
        color: null,
        logo_url: null,
      },
      {
        name: spec.awayTeam.name,
        abbreviation: spec.awayTeam.abbreviation,
        host_status: 'away',
        record: null,
        color: null,
        logo_url: null,
      },
    ],
    sports_team_logo_urls: [],
    sports_event_id: null,
    sports_parent_event_id: null,
    active_markets_count: markets.length,
    total_markets_count: markets.length,
    volume: 0,
    start_date: '2026-05-11T18:00:00.000Z',
    end_date: null,
    created_at: '2026-05-11T00:00:00.000Z',
    updated_at: '2026-05-11T00:00:00.000Z',
    markets,
    tags: [],
    main_tag: 'sports',
    is_bookmarked: false,
    is_trending: false,
  }
}

function moneylineButtons(spec: MatchSpec) {
  const groups = buildSportsGamesCardGroups([buildSoccerEvent(spec)] as any)
  expect(groups).toHaveLength(1)
  const card = groups[0]!.primaryCard
  return card.buttons.filter(button => button.marketType === 'moneyline')
}

/** Extract the root (no sub-event suffix) match from a soccer per-game fixture. */
function rootMatchFromFixture(fixtureName: string): MatchSpec {
  const events = fixtureEvents(fixtureName)
  const match = events.find((e) => {
    const ml = (e.markets ?? []).filter((m: any) => m.sportsMarketType === 'moneyline')
    return ml.length === 3
  })
  if (!match) {
    throw new Error(`No 3-leg moneyline root match in ${fixtureName}`)
  }
  const ml = (match.markets as any[]).filter(m => m.sportsMarketType === 'moneyline')
  const drawLeg = ml.find(m => m.slug.endsWith('-draw'))!
  const teamLegs = ml.filter(m => !m.slug.endsWith('-draw'))
  // event.teams ordering is not guaranteed to be [home, away]; derive home/away
  // from the event title "Home vs. Away" and match legs by groupItemTitle.
  const vsIndex = match.title.toLowerCase().indexOf(' vs')
  const afterVs = vsIndex >= 0 ? match.title.slice(vsIndex + 3).replace(/^\.?\s+/, '') : ''
  const homeName = vsIndex >= 0 ? match.title.slice(0, vsIndex).trim() : (match.teams?.[0]?.name ?? '')
  const awayName = vsIndex >= 0 ? afterVs.trim() : (match.teams?.[1]?.name ?? '')
  const homeLeg = teamLegs.find(m => m.groupItemTitle === homeName) ?? teamLegs[0]!
  const awayLeg = teamLegs.find(m => m !== homeLeg)!
  function teamByName(name: string) {
    return (match.teams ?? []).find((t: any) => t.name === name)
  }
  const homeAbbr = teamByName(homeName)?.abbreviation
    ?? /-([a-z0-9]+)$/i.exec(homeLeg.slug)?.[1]
    ?? 'hom'
  const awayAbbr = teamByName(awayName)?.abbreviation
    ?? /-([a-z0-9]+)$/i.exec(awayLeg.slug)?.[1]
    ?? 'awy'
  return {
    eventSlug: match.slug,
    eventTitle: match.title,
    homeTeam: { name: homeName, abbreviation: homeAbbr },
    awayTeam: { name: awayName, abbreviation: awayAbbr },
    homeLeg: { slug: homeLeg.slug, groupItemTitle: homeLeg.groupItemTitle },
    drawLeg: { slug: drawLeg.slug, groupItemTitle: drawLeg.groupItemTitle },
    awayLeg: { slug: awayLeg.slug, groupItemTitle: awayLeg.groupItemTitle },
  }
}

function assertThreeWayResolution(spec: MatchSpec) {
  const buttons = moneylineButtons(spec)
  expect(buttons).toHaveLength(3)
  const [team1Btn, drawBtn, team2Btn] = buttons

  // team1 button must point at the HOME leg's market (proves
  // doesMarketMatchTeam(homeLeg, homeTeam)=true, doesMarketMatchTeam(awayLeg/drawLeg, homeTeam)=false).
  expect(team1Btn!.tone).toBe('team1')
  expect(team1Btn!.label).toBe(spec.homeTeam.abbreviation.toUpperCase())
  expect(team1Btn!.conditionId).toContain(spec.homeLeg.slug)

  // draw button must point at the -draw leg (proves isStandaloneDrawMarket / isDrawMarket).
  expect(drawBtn!.tone).toBe('draw')
  expect(drawBtn!.label).toBe('DRAW')
  expect(drawBtn!.conditionId).toContain(spec.drawLeg.slug)

  // team2 button must point at the AWAY leg's market.
  expect(team2Btn!.tone).toBe('team2')
  expect(team2Btn!.label).toBe(spec.awayTeam.abbreviation.toUpperCase())
  expect(team2Btn!.conditionId).toContain(spec.awayLeg.slug)

  // The draw leg never gets a team tone — would happen if doesMarketMatchTeam
  // failed to short-circuit on isDrawMarket.
  expect(buttons.filter(b => b.conditionId.includes(spec.drawLeg.slug) && b.tone !== 'draw')).toHaveLength(0)
}

describe('soccer 1X2 leg resolution via buildSportsGamesCardGroups (Step 2F lock)', () => {
  it('la Liga root match resolves home / draw / away in order', () => {
    assertThreeWayResolution(rootMatchFromFixture('polymarket-gamma-laliga-per-game-response.json'))
  })

  it('ePL root match resolves home / draw / away in order', () => {
    assertThreeWayResolution(rootMatchFromFixture('polymarket-gamma-epl-per-game-response.json'))
  })

  it('mLS root match resolves home / draw / away in order', () => {
    assertThreeWayResolution(rootMatchFromFixture('polymarket-gamma-mls-per-game-response.json'))
  })

  it('fIFA World Cup root match (country names) resolves home / draw / away in order', () => {
    assertThreeWayResolution(rootMatchFromFixture('polymarket-gamma-fifwc-per-game-response.json'))
  })

  it('same-city derby — Atlético de Madrid vs Real Madrid — resolves without cross-match', () => {
    // "madrid" is shared across both names → dropped from each side's distinctive
    // token set → no cross-match; the full-name substring path resolves each leg.
    assertThreeWayResolution({
      eventSlug: 'lal-atm-rea-2026-01-01',
      eventTitle: 'Club Atlético de Madrid vs. Real Madrid CF',
      homeTeam: { name: 'Club Atlético de Madrid', abbreviation: 'atm' },
      awayTeam: { name: 'Real Madrid CF', abbreviation: 'rea' },
      homeLeg: { slug: 'lal-atm-rea-2026-01-01-atm', groupItemTitle: 'Club Atlético de Madrid' },
      drawLeg: {
        slug: 'lal-atm-rea-2026-01-01-draw',
        groupItemTitle: 'Draw (Club Atlético de Madrid vs. Real Madrid CF)',
      },
      awayLeg: { slug: 'lal-atm-rea-2026-01-01-rea', groupItemTitle: 'Real Madrid CF' },
    })
  })

  it('country-name match with diacritics resolves correctly', () => {
    // normalizeText strips diacritics; "korea republic" vs "united states" share no tokens.
    assertThreeWayResolution({
      eventSlug: 'fifwc-usa-kor-2026-06-20',
      eventTitle: 'United States vs. Korea Republic',
      homeTeam: { name: 'United States', abbreviation: 'usa' },
      awayTeam: { name: 'Korea Republic', abbreviation: 'kor' },
      homeLeg: { slug: 'fifwc-usa-kor-2026-06-20-usa', groupItemTitle: 'United States' },
      drawLeg: {
        slug: 'fifwc-usa-kor-2026-06-20-draw',
        groupItemTitle: 'Draw (United States vs. Korea Republic)',
      },
      awayLeg: { slug: 'fifwc-usa-kor-2026-06-20-kor', groupItemTitle: 'Korea Republic' },
    })
  })
})
