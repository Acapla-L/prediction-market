// PR #22 B2 drift-lock for React #418 hydration mismatch on locale-formatted dates.
//
// Date.prototype.toLocaleTimeString and the equivalent
// `new Intl.DateTimeFormat(locale, options).format(date)` BOTH use the
// runtime's default timezone when no explicit timeZone option is passed.
// Server-side renders run in Vercel iad1 UTC; client first renders run in
// the user's local TZ. The resulting text-node disagreement triggers React
// error #418 ("Hydration failed because the initial UI does not match what
// was rendered on the server") and forces React to discard + re-render the
// tree client-side.
//
// Two production-visible sites had this bug:
//  - SportsGamesCenter.tsx: Intl.DateTimeFormat(locale, { hour, minute })
//    in the per-card time badge + group-header date label. Symptom on
//    sport list pages.
//  - EventCardSportsMoneyline.tsx: Date.prototype.toLocaleTimeString /
//    toLocaleDateString inside formatSportsStartTime. Symptom on homepage
//    sport cards.
//
// PR #22 B2 applies the established PR #16 mount-gate pattern at both sites:
// a useState(false) flag flipped true by a useEffect(() => {...}, []),
// with the formatter output sentinelled (empty string or null) until the
// mount tick. SSR HTML and first client render agree byte-for-byte; the
// localized output appears on the second render after useEffect flushes.
//
// This test static-source-locks the pattern at BOTH sites.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SPORTS_GAMES_CENTER_PATH = resolve(
  __dirname,
  '../../src/app/[locale]/(platform)/sports/_components/SportsGamesCenter.tsx',
)
const EVENT_CARD_PATH = resolve(
  __dirname,
  '../../src/app/[locale]/(platform)/(home)/_components/EventCardSportsMoneyline.tsx',
)
const sportsGamesCenterSource = readFileSync(SPORTS_GAMES_CENTER_PATH, 'utf8')
const eventCardSource = readFileSync(EVENT_CARD_PATH, 'utf8')

describe('SportsGamesCenter formatter mount-gate (PR #22 B2)', () => {
  it('declares `hasMounted` state via useState(false)', () => {
    expect(sportsGamesCenterSource).toMatch(
      /const\s+\[hasMounted,\s*setHasMounted\]\s*=\s*useState\(\s*false\s*\)/,
    )
  })

  it('flips hasMounted in a useEffect with empty deps array', () => {
    expect(sportsGamesCenterSource).toMatch(
      /useEffect\(\(\)\s*=>\s*\{\s*setHasMounted\(true\)\s*\}\s*,\s*\[\s*\]\s*\)/s,
    )
  })

  it('gates dateLabelFormatter behind hasMounted with empty-format sentinel pre-mount', () => {
    expect(sportsGamesCenterSource).toMatch(
      /const\s+dateLabelFormatter\s*=\s*useMemo[\s\S]*?hasMounted[\s\S]*?Intl\.DateTimeFormat[\s\S]*?format:\s*\(\)\s*=>\s*['"]{2}/,
    )
  })

  it('gates timeLabelFormatter behind hasMounted with empty-format sentinel pre-mount', () => {
    expect(sportsGamesCenterSource).toMatch(
      /const\s+timeLabelFormatter\s*=\s*useMemo[\s\S]*?hasMounted[\s\S]*?Intl\.DateTimeFormat[\s\S]*?format:\s*\(\)\s*=>\s*['"]{2}/,
    )
  })

  it('includes hasMounted in both formatter useMemo dep arrays', () => {
    const matches = sportsGamesCenterSource.match(/\[hasMounted,\s*locale\]/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })
})

describe('EventCardSportsMoneyline formatSportsStartTime mount-gate (PR #22 B2)', () => {
  it('imports useEffect + useState from react', () => {
    expect(eventCardSource).toMatch(/import\s*\{[^}]*useEffect[^}]*\}\s*from\s*['"]react['"]/)
    expect(eventCardSource).toMatch(/import\s*\{[^}]*useState[^}]*\}\s*from\s*['"]react['"]/)
  })

  it('declares `hasMounted` state via useState(false)', () => {
    expect(eventCardSource).toMatch(
      /const\s+\[hasMounted,\s*setHasMounted\]\s*=\s*useState\(\s*false\s*\)/,
    )
  })

  it('flips hasMounted in a useEffect with empty deps array', () => {
    expect(eventCardSource).toMatch(
      /useEffect\(\(\)\s*=>\s*\{\s*setHasMounted\(true\)\s*\}\s*,\s*\[\s*\]\s*\)/s,
    )
  })

  it('gates the formatSportsStartTime call behind hasMounted with null sentinel pre-mount', () => {
    expect(eventCardSource).toMatch(
      /const\s+startTimeLabel\s*=\s*hasMounted[\s\S]*?formatSportsStartTime\([\s\S]*?:\s*null/,
    )
  })

  it('preserves the formatSportsStartTime function definition (no signature drift)', () => {
    expect(eventCardSource).toMatch(/function\s+formatSportsStartTime\(/)
  })
})
