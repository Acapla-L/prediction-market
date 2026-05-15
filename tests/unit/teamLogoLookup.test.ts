import type { TeamCacheRow } from '@/lib/db/queries/teams-cache'
import { describe, expect, it } from 'vitest'
import { buildTeamLogoLookup } from '@/lib/polymarket/team-logo-lookup'

function makeRow(partial: Partial<TeamCacheRow> & Pick<TeamCacheRow, 'league' | 'name' | 'abbreviation' | 'logoUrl'>): TeamCacheRow {
  return {
    teamId: partial.teamId ?? 'team-id',
    alias: partial.alias ?? null,
    color: partial.color ?? null,
    record: partial.record ?? null,
    lastSyncedAt: partial.lastSyncedAt ?? '2026-05-14T00:00:00.000Z',
    lastSyncStatus: partial.lastSyncStatus ?? 'ok',
    lastSyncError: partial.lastSyncError ?? null,
    ...partial,
  }
}

describe('buildTeamLogoLookup — MLB (exact name match)', () => {
  const rows: TeamCacheRow[] = [
    makeRow({ league: 'mlb', name: 'Toronto Blue Jays', abbreviation: 'tor', logoUrl: 'mlb-blue-jays.png' }),
    makeRow({ league: 'mlb', name: 'Athletics', abbreviation: 'oak', logoUrl: 'mlb-athletics.png' }),
    makeRow({ league: 'mlb', name: 'St. Louis Cardinals', abbreviation: 'stl', logoUrl: 'mlb-cardinals.png' }),
  ]
  const lookup = buildTeamLogoLookup(rows, 'mlb')

  it('matches full team name case-insensitively', () => {
    expect(lookup.find('Toronto Blue Jays')).toBe('mlb-blue-jays.png')
    expect(lookup.find('toronto blue jays')).toBe('mlb-blue-jays.png')
  })

  it('matches single-word team name', () => {
    expect(lookup.find('Athletics')).toBe('mlb-athletics.png')
  })

  it('matches name with punctuation', () => {
    expect(lookup.find('St. Louis Cardinals')).toBe('mlb-cardinals.png')
  })

  it('returns null for "Other" placeholder', () => {
    expect(lookup.find('Other')).toBeNull()
  })

  it('returns null for unrelated text', () => {
    expect(lookup.find('Yankees')).toBeNull()
  })
})

describe('buildTeamLogoLookup — NBA (endsWith last-word match)', () => {
  const rows: TeamCacheRow[] = [
    makeRow({ league: 'nba', name: 'Hawks', abbreviation: 'atl', logoUrl: 'nba-hawks.png' }),
    makeRow({ league: 'nba', name: 'Lakers', abbreviation: 'lal', logoUrl: 'nba-lakers.png' }),
    makeRow({ league: 'nba', name: 'Trail Blazers', abbreviation: 'por', logoUrl: 'nba-blazers.png' }),
    makeRow({ league: 'nba', name: '76ers', abbreviation: 'phi', logoUrl: 'nba-76ers.png' }),
  ]
  const lookup = buildTeamLogoLookup(rows, 'nba')

  it('matches "Atlanta Hawks" via endsWith " Hawks"', () => {
    expect(lookup.find('Atlanta Hawks')).toBe('nba-hawks.png')
  })

  it('matches "Los Angeles Lakers" via endsWith " Lakers"', () => {
    expect(lookup.find('Los Angeles Lakers')).toBe('nba-lakers.png')
  })

  it('matches multi-word team names like "Portland Trail Blazers"', () => {
    expect(lookup.find('Portland Trail Blazers')).toBe('nba-blazers.png')
  })

  it('matches numeric-prefix team names like "Philadelphia 76ers"', () => {
    expect(lookup.find('Philadelphia 76ers')).toBe('nba-76ers.png')
  })

  it('matches exact bare team name', () => {
    expect(lookup.find('Hawks')).toBe('nba-hawks.png')
  })

  it('returns null for "Other" placeholder', () => {
    expect(lookup.find('Other')).toBeNull()
  })

  it('does NOT match partial-word collisions (e.g., a city name that contains a team name)', () => {
    // Defensive: leading space requirement prevents "Hawksbury" matching "Hawks"
    expect(lookup.find('Hawksbury')).toBeNull()
  })
})

describe('buildTeamLogoLookup — NHL (endsWith)', () => {
  const rows: TeamCacheRow[] = [
    makeRow({ league: 'nhl', name: 'Ducks', abbreviation: 'ana', logoUrl: 'nhl-ducks.png' }),
    makeRow({ league: 'nhl', name: 'Golden Knights', abbreviation: 'vgs', logoUrl: 'nhl-knights.png' }),
    makeRow({ league: 'nhl', name: 'Mammoth', abbreviation: 'utah', logoUrl: 'nhl-mammoth.png' }),
    makeRow({ league: 'nhl', name: 'Blues', abbreviation: 'stl', logoUrl: 'nhl-blues.png' }),
  ]
  const lookup = buildTeamLogoLookup(rows, 'nhl')

  it('matches "Vegas Golden Knights" via endsWith multi-word last name', () => {
    expect(lookup.find('Vegas Golden Knights')).toBe('nhl-knights.png')
  })

  it('matches "Utah Mammoth"', () => {
    expect(lookup.find('Utah Mammoth')).toBe('nhl-mammoth.png')
  })

  it('matches "St. Louis Blues"', () => {
    expect(lookup.find('St. Louis Blues')).toBe('nhl-blues.png')
  })

  it('matches "Anaheim Ducks"', () => {
    expect(lookup.find('Anaheim Ducks')).toBe('nhl-ducks.png')
  })
})

describe('buildTeamLogoLookup — NFL (exact name match)', () => {
  const rows: TeamCacheRow[] = [
    makeRow({ league: 'nfl', name: 'Dallas Cowboys', abbreviation: 'dal', logoUrl: 'nfl-cowboys.png' }),
    makeRow({ league: 'nfl', name: 'San Francisco 49ers', abbreviation: 'sf', logoUrl: 'nfl-49ers.png' }),
  ]
  const lookup = buildTeamLogoLookup(rows, 'nfl')

  it('matches full NFL team name exactly', () => {
    expect(lookup.find('Dallas Cowboys')).toBe('nfl-cowboys.png')
    expect(lookup.find('San Francisco 49ers')).toBe('nfl-49ers.png')
  })

  it('returns null for "Other" placeholder', () => {
    expect(lookup.find('Other')).toBeNull()
  })
})

describe('buildTeamLogoLookup — UCL (composite: alias + exact + normalize-contains + last-token)', () => {
  // Subset chosen to exercise every tier of the composite matcher.
  const rows: TeamCacheRow[] = [
    // Tier 1: alias-table hits
    makeRow({ league: 'ucl', name: 'FC Internazionale Milano', abbreviation: 'int', logoUrl: 'ucl-inter.png' }),
    makeRow({ league: 'ucl', name: 'Manchester City FC', abbreviation: 'mnc', logoUrl: 'ucl-mancity.png' }),
    makeRow({ league: 'ucl', name: 'Paris Saint-Germain FC', abbreviation: 'psg', logoUrl: 'ucl-psg.png' }),
    // Tier 2: exact match
    makeRow({ league: 'ucl', name: 'PSV', abbreviation: 'psv', logoUrl: 'ucl-psv.png' }),
    makeRow({ league: 'ucl', name: 'Athletic Club', abbreviation: 'ath', logoUrl: 'ucl-athletic.png' }),
    // Tier 3: normalize-accents + contains
    makeRow({ league: 'ucl', name: 'Club Atlético de Madrid', abbreviation: 'atm', logoUrl: 'ucl-atletico.png' }),
    makeRow({ league: 'ucl', name: 'FK Bodø/Glimt', abbreviation: 'bod', logoUrl: 'ucl-bodo.png' }),
    makeRow({ league: 'ucl', name: 'Fenerbahçe SK', abbreviation: 'fen', logoUrl: 'ucl-fenerbahce.png' }),
    makeRow({ league: 'ucl', name: 'Olympiakós SFP', abbreviation: 'oly', logoUrl: 'ucl-olympiakos.png' }),
    makeRow({ league: 'ucl', name: 'FC Bayern München', abbreviation: 'bay', logoUrl: 'ucl-bayern.png' }),
    // Plain contains (no accent normalization needed)
    makeRow({ league: 'ucl', name: 'Arsenal FC', abbreviation: 'ars', logoUrl: 'ucl-arsenal.png' }),
    makeRow({ league: 'ucl', name: 'Real Madrid CF', abbreviation: 'rma', logoUrl: 'ucl-realmadrid.png' }),
    makeRow({ league: 'ucl', name: 'BV Borussia 09 Dortmund', abbreviation: 'dor', logoUrl: 'ucl-dortmund.png' }),
    makeRow({ league: 'ucl', name: 'SK Slavia Praha', abbreviation: 'slp', logoUrl: 'ucl-slavia.png' }),
    // Tier 4: last-token fallback (must not collide with "1. FC Union Berlin")
    makeRow({ league: 'ucl', name: '1. FC Union Berlin', abbreviation: 'unb', logoUrl: 'ucl-unionberlin.png' }),
    makeRow({ league: 'ucl', name: 'RU Saint-Gilloise', abbreviation: 'usg', logoUrl: 'ucl-saint-gilloise.png' }),
  ]
  const lookup = buildTeamLogoLookup(rows, 'ucl')

  it('alias-table: "Inter" → FC Internazionale Milano', () => {
    expect(lookup.find('Inter')).toBe('ucl-inter.png')
  })

  it('alias-table: "Man City" → Manchester City FC', () => {
    expect(lookup.find('Man City')).toBe('ucl-mancity.png')
  })

  it('alias-table: "PSG" → Paris Saint-Germain FC', () => {
    expect(lookup.find('PSG')).toBe('ucl-psg.png')
  })

  it('exact match: "PSV"', () => {
    expect(lookup.find('PSV')).toBe('ucl-psv.png')
  })

  it('exact match: "Athletic Club"', () => {
    expect(lookup.find('Athletic Club')).toBe('ucl-athletic.png')
  })

  it('normalize-accents + contains: "Atletico Madrid" → Club Atlético de Madrid', () => {
    expect(lookup.find('Atletico Madrid')).toBe('ucl-atletico.png')
  })

  it('normalize slash: "Bodo Glimt" → FK Bodø/Glimt', () => {
    expect(lookup.find('Bodo Glimt')).toBe('ucl-bodo.png')
  })

  it('normalize accents: "Fenerbahce" → Fenerbahçe SK', () => {
    expect(lookup.find('Fenerbahce')).toBe('ucl-fenerbahce.png')
  })

  it('normalize accents: "Olympiakos" → Olympiakós SFP', () => {
    expect(lookup.find('Olympiakos')).toBe('ucl-olympiakos.png')
  })

  it('normalize accents: "Bayern Munich" → FC Bayern München', () => {
    expect(lookup.find('Bayern Munich')).toBe('ucl-bayern.png')
  })

  it('contains (no normalize): "Arsenal" → Arsenal FC', () => {
    expect(lookup.find('Arsenal')).toBe('ucl-arsenal.png')
  })

  it('contains: "Real Madrid" → Real Madrid CF', () => {
    expect(lookup.find('Real Madrid')).toBe('ucl-realmadrid.png')
  })

  it('contains: "Dortmund" → BV Borussia 09 Dortmund', () => {
    expect(lookup.find('Dortmund')).toBe('ucl-dortmund.png')
  })

  it('contains (truncated sidecar value): "Slavia Pragu" → SK Slavia Praha (matches via "Slavia")', () => {
    expect(lookup.find('Slavia Pragu')).toBe('ucl-slavia.png')
  })

  it('last-token fallback: "Union Saint-Gilloise" → RU Saint-Gilloise (NOT "1. FC Union Berlin")', () => {
    expect(lookup.find('Union Saint-Gilloise')).toBe('ucl-saint-gilloise.png')
  })

  it('returns null for "Other" placeholder', () => {
    expect(lookup.find('Other')).toBeNull()
  })

  it('returns null for "Team A" through "Team T" placeholders', () => {
    for (const letter of ['A', 'B', 'F', 'M', 'T']) {
      expect(lookup.find(`Team ${letter}`)).toBeNull()
    }
  })

  it('returns null for completely unrelated text', () => {
    expect(lookup.find('NOT A REAL TEAM NAME')).toBeNull()
  })
})

describe('buildTeamLogoLookup — edge cases', () => {
  it('returns null when row has null logoUrl', () => {
    const rows: TeamCacheRow[] = [
      makeRow({ league: 'mlb', name: 'Toronto Blue Jays', abbreviation: 'tor', logoUrl: null }),
    ]
    const lookup = buildTeamLogoLookup(rows, 'mlb')
    expect(lookup.find('Toronto Blue Jays')).toBeNull()
  })

  it('returns null for empty shortTitle', () => {
    const rows: TeamCacheRow[] = [
      makeRow({ league: 'mlb', name: 'Toronto Blue Jays', abbreviation: 'tor', logoUrl: 'mlb-blue-jays.png' }),
    ]
    const lookup = buildTeamLogoLookup(rows, 'mlb')
    expect(lookup.find('')).toBeNull()
  })

  it('returns null for unknown league (uses default exact-name matcher)', () => {
    const rows: TeamCacheRow[] = [
      makeRow({ league: 'unknown', name: 'Some Team', abbreviation: 'unk', logoUrl: 'unknown.png' }),
    ]
    const lookup = buildTeamLogoLookup(rows, 'unknown')
    expect(lookup.find('Some Team')).toBe('unknown.png')
    expect(lookup.find('Unrelated')).toBeNull()
  })
})
