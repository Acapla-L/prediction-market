import type { TeamCacheRow } from '@/lib/db/queries/teams-cache'

/**
 * Lookup interface that maps a discovery-sidecar `short_title` string to a
 * `teams_cache.logo_url` URL when a match exists, or `null` otherwise. The
 * matching algorithm is per-league because Polymarket's `/teams?league=X`
 * endpoint stores team names in different shapes per league (NBA stores just
 * "Hawks", MLB stores "Toronto Blue Jays", UCL stores "FC Internazionale
 * Milano" while the per-event sidecar uses colloquial English shorthand like
 * "Inter").
 *
 * Bundle B (futures logos) per
 * `docs/plans/post-pr23-investigation-and-bundles-plan-2026-05-14.md`.
 */
export interface TeamLogoLookup {
  find: (shortTitle: string) => string | null
}

type MatcherFactory = (rows: ReadonlyArray<TeamCacheRow>) => TeamLogoLookup

/**
 * Case-insensitive exact match on `row.name`. Skips rows with null `logoUrl`.
 * Used by leagues that store full team names ("Toronto Blue Jays", "Dallas
 * Cowboys") in `teams_cache.name` AND emit the same shape in the discovery
 * sidecar's `short_title` field. MLB + NFL.
 */
function makeExactNameMatcher(rows: ReadonlyArray<TeamCacheRow>): TeamLogoLookup {
  const byName = new Map<string, string>()
  for (const row of rows) {
    if (row.logoUrl === null) {
      continue
    }
    byName.set(row.name.toLowerCase(), row.logoUrl)
  }
  return {
    find(shortTitle) {
      if (!shortTitle) {
        return null
      }
      return byName.get(shortTitle.toLowerCase()) ?? null
    },
  }
}

/**
 * Two-tier match: exact equals on `row.name`, then suffix match where the
 * sidecar value ends with `" " + row.name` (e.g., sidecar "Atlanta Hawks"
 * matches row name "Hawks"). Used by leagues that store SHORT names in
 * `teams_cache.name` ("Hawks", "Lakers", "Trail Blazers", "Golden Knights")
 * while the discovery sidecar emits full names ("Atlanta Hawks", "Los Angeles
 * Lakers"). NBA + NHL.
 *
 * The leading-space requirement on the suffix tier prevents false-positives
 * like "Hawksbury" matching "Hawks".
 *
 * Multi-word last names like "Trail Blazers" and "Golden Knights" are
 * supported — the suffix check uses the full `row.name` literal.
 */
function makeEndsWithMatcher(rows: ReadonlyArray<TeamCacheRow>): TeamLogoLookup {
  interface Entry { lowerName: string, logoUrl: string }
  const entries: Entry[] = []
  for (const row of rows) {
    if (row.logoUrl === null) {
      continue
    }
    entries.push({ lowerName: row.name.toLowerCase(), logoUrl: row.logoUrl })
  }
  return {
    find(shortTitle) {
      if (!shortTitle) {
        return null
      }
      const lower = shortTitle.toLowerCase()
      for (const entry of entries) {
        if (lower === entry.lowerName) {
          return entry.logoUrl
        }
      }
      for (const entry of entries) {
        if (lower.endsWith(` ${entry.lowerName}`)) {
          return entry.logoUrl
        }
      }
      return null
    },
  }
}

/**
 * Hardcoded alias table for UCL shorthand that the discovery sidecar emits.
 * Each entry maps a discovery-sidecar `short_title` (lowercase, as observed
 * in production at audit time 2026-05-14) to a Polymarket
 * `/teams?league=ucl` `abbreviation` field.
 *
 * Three classes of entries currently:
 *   - colloquial English shorthand for non-English club names (psg, man city,
 *     inter)
 *   - sidecar truncations ("slavia pragu" lacks the "ha" in upstream "Praha")
 *   - English vs original-language city names ("bayern munich" vs upstream
 *     "FC Bayern München")
 *
 * Maintenance burden: small — UCL season adds 1-3 entries / year.
 */
const UCL_ALIAS_TABLE: Record<string, string> = {
  'inter': 'int',
  'man city': 'mnc',
  'psg': 'psg',
  'bayern munich': 'bay',
  'slavia pragu': 'slp',
}

/**
 * Explicit Latin-extended character substitutions for code points that do NOT
 * canonically decompose under Unicode NFD (so the `\p{Diacritic}` strip alone
 * doesn't catch them). Notably `ø`/`Ø` (Latin O with stroke) is a base
 * character, not o + combining mark.
 */
const LATIN_EXTENDED_SUBSTITUTIONS: Array<[RegExp, string]> = [
  [/ø/g, 'o'],
  [/Ø/g, 'O'],
  [/ł/g, 'l'],
  [/Ł/g, 'L'],
  [/đ/g, 'd'],
  [/Đ/g, 'D'],
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/Æ/g, 'AE'],
  [/œ/g, 'oe'],
  [/Œ/g, 'OE'],
]

/**
 * Removes diacritical marks (NFD-decomposes then strips combining-mark code
 * points), explicit substitutions for Latin-extended characters that don't
 * decompose, and replaces forward-slashes with spaces. Lowercases at the
 * end. Used in the UCL composite matcher.
 */
function normalizeAccents(value: string): string {
  let result = value.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  for (const [pattern, replacement] of LATIN_EXTENDED_SUBSTITUTIONS) {
    result = result.replace(pattern, replacement)
  }
  return result.replace(/\//g, ' ').toLowerCase()
}

/**
 * Composite UCL matcher — 5 tiers, first hit wins:
 *
 *   1. Hardcoded alias table (`UCL_ALIAS_TABLE`).
 *
 *   2. Case-insensitive exact match on `row.name`.
 *
 *   3. Accent-normalized contiguous substring containment: lowercase + strip
 *      diacritics + slash→space, then check `normalized(sidecar) ⊂
 *      normalized(row.name)`. Catches "Real Madrid" ⊂ "Real Madrid CF",
 *      "Arsenal" ⊂ "Arsenal FC", "Dortmund" ⊂ "BV Borussia 09 Dortmund".
 *      Sorted longest-name-first so that longer matches win over shorter
 *      ambiguous ones.
 *
 *   4. All-words-present: each whitespace-separated token of the normalized
 *      sidecar must appear as a substring somewhere in the normalized
 *      upstream name. Catches cases where the sidecar omits connector words
 *      ("Atletico Madrid" ⊂ "Club Atlético de Madrid") or where the upstream
 *      adds suffixes between tokens ("Bodo Glimt" ⊂ "FK Bodø/Glimt" after
 *      Latin-extended substitution).
 *
 *   5. Last-token hyphen fallback: if the sidecar contains a hyphen
 *      ("Union Saint-Gilloise"), try matching just the hyphenated token
 *      ("Saint-Gilloise") against upstream names. Prevents the leading word
 *      from false-matching against unrelated rows ("Union" → "1. FC Union
 *      Berlin" would be wrong).
 */
function makeUclMatcher(rows: ReadonlyArray<TeamCacheRow>): TeamLogoLookup {
  interface Entry {
    name: string
    lowerName: string
    normalizedName: string
    abbreviation: string
    logoUrl: string
  }
  const entries: Entry[] = []
  const byAbbreviation = new Map<string, string>()
  for (const row of rows) {
    if (row.logoUrl === null) {
      continue
    }
    const lowerName = row.name.toLowerCase()
    const normalizedName = normalizeAccents(row.name)
    entries.push({
      name: row.name,
      lowerName,
      normalizedName,
      abbreviation: row.abbreviation,
      logoUrl: row.logoUrl,
    })
    byAbbreviation.set(row.abbreviation, row.logoUrl)
  }

  // Sort longest-name-first for the substring-contains tier so e.g. "Real
  // Madrid CF" beats hypothetical short collisions.
  const containsTierEntries = [...entries].sort(
    (a, b) => b.normalizedName.length - a.normalizedName.length,
  )

  return {
    find(shortTitle) {
      if (!shortTitle) {
        return null
      }
      const lower = shortTitle.toLowerCase()

      // Tier 1: alias table
      const aliasAbbr = UCL_ALIAS_TABLE[lower]
      if (aliasAbbr !== undefined) {
        const logo = byAbbreviation.get(aliasAbbr)
        if (logo !== undefined) {
          return logo
        }
      }

      // Tier 2: exact match
      for (const entry of entries) {
        if (lower === entry.lowerName) {
          return entry.logoUrl
        }
      }

      // Tier 3: normalize-accents + contiguous contains
      const normalizedSidecar = normalizeAccents(shortTitle)
      if (normalizedSidecar.length > 0) {
        for (const entry of containsTierEntries) {
          if (entry.normalizedName.includes(normalizedSidecar)) {
            return entry.logoUrl
          }
        }
      }

      // Tier 4: all-words-present (catches cases where the sidecar omits
      // connector words like "de" in "Atletico Madrid" ⊂ "Club Atlético de
      // Madrid"). All whitespace-separated tokens of the normalized sidecar
      // must appear as substrings somewhere in the normalized upstream name.
      const sidecarTokens = normalizedSidecar.split(/\s+/).filter(t => t.length > 1)
      if (sidecarTokens.length >= 2) {
        for (const entry of containsTierEntries) {
          if (sidecarTokens.every(token => entry.normalizedName.includes(token))) {
            return entry.logoUrl
          }
        }
      }

      // Tier 5: last-token fallback (hyphenated sidecar values)
      if (shortTitle.includes('-')) {
        const tokens = shortTitle.split(' ').filter(Boolean)
        // Pick the token containing a hyphen (longest token usually carries
        // the discriminator, e.g., "Saint-Gilloise").
        const hyphenTokens = tokens.filter(t => t.includes('-'))
        for (const token of hyphenTokens) {
          const normalizedToken = normalizeAccents(token)
          if (normalizedToken.length === 0) {
            continue
          }
          for (const entry of containsTierEntries) {
            if (entry.normalizedName.includes(normalizedToken)) {
              return entry.logoUrl
            }
          }
        }
      }

      return null
    },
  }
}

const MATCHERS: Record<string, MatcherFactory> = {
  mlb: makeExactNameMatcher,
  nfl: makeExactNameMatcher,
  nba: makeEndsWithMatcher,
  nhl: makeEndsWithMatcher,
  ucl: makeUclMatcher,
}

/**
 * Builds an in-memory `TeamLogoLookup` for the given league. Called once per
 * page render at the `'use cache'` boundary in `loadDiscoveredEventPageData`;
 * subsequent per-market lookups are pure-synchronous.
 *
 * Unknown leagues fall through to the default exact-name matcher (safe — will
 * return null on misses).
 */
export function buildTeamLogoLookup(rows: ReadonlyArray<TeamCacheRow>, league: string): TeamLogoLookup {
  const factory = MATCHERS[league] ?? makeExactNameMatcher
  return factory(rows)
}
