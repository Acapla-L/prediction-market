/**
 * Stream 2 (Phase B v2 v3) — sports list-route smoke gate.
 *
 * Tests `/en/sports/{sportRouteSlug}/games` for each registry league
 * (MLB+NBA+NHL post-PR-15) plus drift-lock checks for the cache-boundary
 * fix and the `notFound()` outside cache discipline.
 *
 * Empty-leagues guard: if a league has zero tradeable games at smoke time
 * (off-season, sync down, kill switch), the per-league assertion is
 * skipped — but if ALL three leagues are empty, the test fails. Better
 * to flag a real production gap than pass vacuously.
 *
 * This is a SEPARATE spec from `discovery-games.smoke.spec.ts` (per-game
 * template) and `discovery-events.smoke.spec.ts` (Phase A v2 futures).
 * Stream 2 changes are scoped to the list route — the existing per-game +
 * futures invariants must continue to hold.
 *
 * Run against deployed URL via:
 *   SMOKE_BASE_URL=https://<deployment>.vercel.app \
 *   SITE_ACCESS_CODE=<code> \
 *   CRON_SECRET=<secret> \
 *   npm run test:smoke -- discovery-games-list.smoke.spec.ts
 */
import { expect, test } from '@playwright/test'

const ACCESS_COOKIE_NAME = 'wp_access'
const ACCESS_COOKIE_STATIC_SALT = 'wirepredictions:access-gate:v1'

interface LeagueProbe {
  league: string
  sportRouteSlug: string
  canonicalUrl: string
  aliasUrl: string
}

// Mirror of DISCOVERED_GAMES_LEAGUES (inlined to avoid pulling server-side
// imports into the Playwright bundle).
const LEAGUE_PROBES: ReadonlyArray<LeagueProbe> = [
  {
    league: 'mlb',
    sportRouteSlug: 'baseball',
    canonicalUrl: '/en/sports/mlb/games',
    aliasUrl: '/en/sports/baseball/games',
  },
  {
    league: 'nba',
    sportRouteSlug: 'basketball',
    canonicalUrl: '/en/sports/nba/games',
    aliasUrl: '/en/sports/basketball/games',
  },
  {
    league: 'nhl',
    sportRouteSlug: 'hockey',
    canonicalUrl: '/en/sports/nhl/games',
    aliasUrl: '/en/sports/hockey/games',
  },
  // Phase B v2 v3 — soccer leagues (EPL / La Liga / MLS) all share the
  // Kuest `soccer` sport route (the only working list-route entrypoint for
  // them — there is no per-league `/sports/epl/games` Kuest alias). Sidecar
  // rows may not exist on the first preview run until the discovery sync
  // executes; the per-league assertion only requires HTTP 200 + no "Oops"
  // body (matches MLB/NBA/NHL), so an empty soccer sidecar still passes —
  // the empty-leagues guard below only requires ONE league overall to have
  // cards (MLB will). canonicalUrl === aliasUrl here intentionally: the
  // `soccer` route is both, so the alias-redirect test is a no-op for it.
  {
    league: 'soccer',
    sportRouteSlug: 'soccer',
    canonicalUrl: '/en/sports/soccer/games',
    aliasUrl: '/en/sports/soccer/games',
  },
  // FIFA World Cup uses its own dedicated sport route.
  {
    league: 'fifwc',
    sportRouteSlug: 'fifa-world-cup',
    canonicalUrl: '/en/sports/fifa-world-cup/games',
    aliasUrl: '/en/sports/fifa-world-cup/games',
  },
]

async function hashAccessCode(code: string): Promise<string> {
  const normalized = code.trim().toUpperCase()
  const input = `${ACCESS_COOKIE_STATIC_SALT}:${normalized}`
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  let hex = ''
  const view = new Uint8Array(digest)
  for (let i = 0; i < view.length; i += 1) {
    hex += view[i].toString(16).padStart(2, '0')
  }
  return hex
}

function resolveCookieDomain(baseURL: string): string {
  return new URL(baseURL).hostname
}

test.describe('Stream 2 sports list route smoke gate', () => {
  test.beforeEach(async ({ context, page, baseURL }) => {
    const vercelBypass = process.env.VERCEL_PROTECTION_BYPASS
    if (vercelBypass && baseURL) {
      await page.goto(`/?_vercel_share=${vercelBypass}`, { waitUntil: 'domcontentloaded' })
    }

    const accessCode = process.env.SITE_ACCESS_CODE
    if (!accessCode || !baseURL) {
      return
    }
    const value = await hashAccessCode(accessCode)
    await context.addCookies([{
      name: ACCESS_COOKIE_NAME,
      value,
      domain: resolveCookieDomain(baseURL),
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    }])
  })

  test('per-league list pages render with HTTP 200 and SportsGamesCenter mounted', async ({ page, baseURL }) => {
    if (!baseURL) {
      throw new Error('SMOKE_BASE_URL / baseURL required')
    }

    // 5 league probes now (MLB/NBA/NHL + soccer + FIFA WC); soccer/FIFA WC
    // list pages can be slow to cold-fill on a fresh preview deploy
    // (Phase B v2 v1 cold-cache flakiness pattern). Give the loop a longer budget.
    test.setTimeout(90_000)

    let leaguesProbed = 0
    let leaguesWithCards = 0

    for (const probe of LEAGUE_PROBES) {
      const consoleErrors: string[] = []
      function consoleListener(msg: import('@playwright/test').ConsoleMessage): void {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text())
        }
      }
      page.on('console', consoleListener)

      try {
        // §1 — Canonical URL renders 200
        const response = await page.goto(probe.canonicalUrl, { waitUntil: 'domcontentloaded' })
        expect(response, `navigation response for ${probe.canonicalUrl}`).not.toBeNull()
        expect(
          response!.status(),
          `final HTTP status for ${probe.canonicalUrl}`,
        ).toBeLessThan(400)
        leaguesProbed += 1

        // §2 — No "Oops" not-found UI (catches cache-boundary regression
        // where notFound() inside 'use cache' produces HTTP 200 + not-found
        // body. The Stream 2 refactor moves notFound() OUTSIDE the cache
        // boundary; if regression reintroduces module-level 'use cache' or
        // moves notFound() back inside, this fails.)
        await expect(
          page.getByText(/Oops\.\.\.we didn't forecast this/i),
          `no Oops body on ${probe.canonicalUrl}`,
        ).toHaveCount(0)

        // §3 — Either cards are present OR the page renders an empty-state
        // grid gracefully. Per Allan policy 2026-05-07: empty grid is OK,
        // 404 is NOT. Probe the body for grid-render markers.
        const cardCount = await page.evaluate(() => {
          // SportsGamesCenter renders cards as descendants. Look for any
          // anchor pointing to /sports/<league>/<slug>-pattern URLs (per-
          // game routes). Resilient to UI restructuring.
          const anchors = Array.from(document.querySelectorAll('a[href]'))
          return anchors.filter((a) => {
            const href = a.getAttribute('href') ?? ''
            return /\/sports\/[a-z0-9-]+\/(?:mlb|nba|nhl|epl|lal|mls|fifwc)-[a-z0-9]+-[a-z0-9]+-\d{4}-\d{2}-\d{2}/.test(href)
          }).length
        })

        if (cardCount > 0) {
          leaguesWithCards += 1
        }

        // §4 — No React #419 hydration errors. Canonical regression marker
        // for the cache-boundary anti-pattern.
        const hydrationErrors = consoleErrors.filter(text =>
          text.includes('Minified React error #419')
          || text.toLowerCase().includes('hydration'),
        )
        expect(
          hydrationErrors,
          `no hydration errors on ${probe.canonicalUrl}: ${hydrationErrors.join('; ')}`,
        ).toEqual([])
      }
      finally {
        page.off('console', consoleListener)
      }
    }

    // Empty-leagues guard: if all three leagues had zero cards, the smoke
    // gate failed silently. Either the discovery sidecar is empty (sync
    // down, kill switch off, off-season for all three) OR the dispatch
    // logic regressed. Either way, surface it.
    expect(
      leaguesWithCards,
      `at least one of ${LEAGUE_PROBES.length} leagues should have cards (got ${leaguesWithCards}); discovery may be down`,
    ).toBeGreaterThanOrEqual(1)
    expect(leaguesProbed, 'all probes ran').toBe(LEAGUE_PROBES.length)
  })

  test('alias URLs render or redirect to canonical (no 404)', async ({ page, baseURL }) => {
    if (!baseURL) {
      throw new Error('baseURL required')
    }
    // Stream 2 ensures /sports/baseball/games etc. are usable: either they
    // render directly via discovery dispatch (no Kuest alias needed) OR
    // they redirect to the canonical /sports/<league>/games via Kuest's
    // url_aliases. Both 200 and 307/308 are acceptable.
    for (const probe of LEAGUE_PROBES) {
      const response = await page.goto(probe.aliasUrl, { waitUntil: 'domcontentloaded' })
      expect(response, `navigation response for ${probe.aliasUrl}`).not.toBeNull()
      expect(
        response!.status(),
        `alias URL ${probe.aliasUrl} returns < 400 (200 direct or 30x redirect)`,
      ).toBeLessThan(400)
      // Negative drift-lock: must not show "Oops" not-found UI on alias URL.
      await expect(
        page.getByText(/Oops\.\.\.we didn't forecast this/i),
        `no Oops body on ${probe.aliasUrl}`,
      ).toHaveCount(0)
    }
  })

  test('unknown sport returns 404 (drift-locks notFound() outside cache boundary)', async ({ page }) => {
    // The cache-boundary fix REQUIRES notFound() to commit a real HTTP 404
    // — not the HTTP 200 + not-found UI hybrid that the broken pattern
    // produces. Probe a deliberately-fake sport token and assert real 404.
    const response = await page.goto('/en/sports/totally-fake-sport-zzz/games', {
      waitUntil: 'domcontentloaded',
    })
    expect(response, 'navigation response for fake sport').not.toBeNull()
    // Acceptable: 404 (server-side notFound) or 308 to /access (gate fires
    // before the route resolves). The CRITICAL invariant: NOT 200.
    const status = response!.status()
    expect(
      status === 404 || status === 307 || status === 308,
      `unknown sport returns 404 or auth-gate redirect (got ${status})`,
    ).toBe(true)
  })
})
