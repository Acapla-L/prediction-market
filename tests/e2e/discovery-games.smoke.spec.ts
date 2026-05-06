/**
 * Smoke gate stability via fix-list-once.
 *
 * IMPORTANT: do NOT re-query the sidecar mid-test. The active per-game slug
 * list is fixed once at `beforeAll` and held for the entire test run.
 *
 * Why: per-game slugs are short-lived (hours, not days). A game could complete
 * between test stages — a slug that passed an earlier assertion would then
 * fail a later assertion not because of a regression but because the data
 * legitimately changed. Pinning the slug list at setup means every assertion
 * within a test run sees the same data.
 *
 * If a slug becomes invalid mid-run (e.g., game completes and is archived
 * within the 60s test window), assertions on that slug may fail. That's
 * acceptable: smoke retries on next deploy, and the stable-list approach
 * prevents the worse failure mode of inconsistent assertions across stages.
 *
 * Empty-list guard: an empty active-games list throws at setup rather than
 * passing vacuously. A passing smoke gate with zero coverage is worse than
 * a failing one — silent absence of coverage lets real regressions slip
 * through during off-season, sync outages, or kill-switch-off windows.
 *
 * This is a SEPARATE smoke spec from `discovery-events.smoke.spec.ts` (the
 * Phase A v2 + FIFA gate, 6 hardcoded futures cases). Per plan §G — clean
 * diffs; the existing spec stays untouched.
 *
 * Run against a deployed URL via:
 *   SMOKE_BASE_URL=https://<deployment>.vercel.app \
 *   SITE_ACCESS_CODE=<code> \
 *   CRON_SECRET=<secret> \
 *   npm run test:smoke -- discovery-games.smoke.spec.ts
 *
 * Add `VERCEL_PROTECTION_BYPASS=<token>` if the deployment is gated by Vercel
 * Deployment Protection.
 */
import { expect, test } from '@playwright/test'

const ACCESS_COOKIE_NAME = 'wp_access'
const ACCESS_COOKIE_STATIC_SALT = 'wirepredictions:access-gate:v1'

interface SmokeCase {
  slug: string
  league: string
  sportRouteSlug: string
}

interface SyncRouteResultRow {
  slug: string
  league: string
  status: string
  market_count?: number
  error?: string
}

// Map of league slug → Kuest sport route slug (mirrors DISCOVERED_GAMES_LEAGUES).
// Inlined here to avoid pulling server-side imports into the Playwright bundle.
const LEAGUE_TO_SPORT_ROUTE: Readonly<Record<string, string>> = {
  mlb: 'baseball',
  nba: 'basketball',
  nhl: 'hockey',
  nfl: 'football',
  epl: 'soccer',
}

// FIXED at test setup. DO NOT re-query during the test run. If games complete
// or new games appear between stages, we want every test to see the same slug
// list — otherwise we get spurious "this slug existed at setup but doesn't
// now" failures that aren't real regressions.
let SMOKE_CASES: ReadonlyArray<SmokeCase> | null = null

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

function resolveSportRouteSlug(league: string): string {
  const sport = LEAGUE_TO_SPORT_ROUTE[league.toLowerCase()]
  if (!sport) {
    throw new Error(
      `Unknown league "${league}" returned by discovery sync route. Update LEAGUE_TO_SPORT_ROUTE map.`,
    )
  }
  return sport
}

test.describe('Phase B per-game discovery: sports event pages render with multi-section markets and team logos', () => {
  test.beforeAll(async ({ request, baseURL }) => {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      throw new Error('CRON_SECRET required for Phase B smoke test setup')
    }
    if (!baseURL) {
      throw new Error('SMOKE_BASE_URL / baseURL is required')
    }

    // Vercel deployment protection bypass — same approach as discovery-events.smoke.spec.ts
    const headers: Record<string, string> = {
      authorization: `Bearer ${cronSecret}`,
    }
    const vercelBypass = process.env.VERCEL_PROTECTION_BYPASS
    if (vercelBypass) {
      headers['x-vercel-protection-bypass'] = vercelBypass
      headers['x-vercel-set-bypass-cookie'] = 'true'
    }

    // Query the discovery sync route. Returns `{ ok: true, results: [...] }`.
    // GET is supported by the route handler.
    const response = await request.get(
      `${baseURL}/api/sync/polymarket-games-discovery`,
      { headers },
    )

    if (response.status() >= 400) {
      throw new Error(
        `Discovery sync route returned ${response.status()} during smoke setup`,
      )
    }

    const body: { ok?: boolean, disabled?: boolean, results?: SyncRouteResultRow[] } = await response.json()

    if (body.disabled) {
      throw new Error(
        'Phase B discovery is disabled (POLYMARKET_GAMES_DISCOVERY_ENABLED=false). '
        + 'Smoke gate cannot proceed without active games.',
      )
    }

    const okResults = (body.results ?? []).filter((row): row is SyncRouteResultRow => row.status === 'ok')

    // FIX the list at this moment. The rest of the test run uses this snapshot.
    const cases: SmokeCase[] = okResults.slice(0, 3).map(row => ({
      slug: row.slug,
      league: row.league,
      sportRouteSlug: resolveSportRouteSlug(row.league),
    }))

    // Empty-list guard: a passing smoke gate with zero coverage is worse
    // than a failing one. Throw at setup rather than passing vacuously.
    if (cases.length < 1) {
      throw new Error(
        'Smoke gate setup returned no active games — cannot proceed (off-season, '
        + 'sync down, or kill switch off?). Inspect /api/sync/polymarket-games-discovery '
        + 'and the discovered_polymarket_games sidecar table.',
      )
    }

    SMOKE_CASES = cases
  })

  test.beforeEach(async ({ context, page, baseURL }) => {
    // Vercel deployment protection: when running against a protected preview
    // URL, hit the bypass URL once so the browser context picks up the
    // `_vercel_jwt` auth cookie.
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

  test('per-game pages render with multi-section markets, team logos, and chart', async ({ page, request, baseURL }) => {
    if (!SMOKE_CASES) {
      throw new Error('beforeAll must run first')
    }
    if (!baseURL) {
      throw new Error('baseURL required')
    }

    for (const smokeCase of SMOKE_CASES) {
      const { slug, sportRouteSlug } = smokeCase
      const consoleErrors: string[] = []

      function consoleListener(msg: import('@playwright/test').ConsoleMessage): void {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text())
        }
      }
      page.on('console', consoleListener)

      try {
        const sportsRoute = `/en/sports/${sportRouteSlug}/${slug}`

        // §1 — HTTP < 400 on the sports route
        const response = await page.goto(sportsRoute, { waitUntil: 'domcontentloaded' })
        expect(response, `navigation response for ${slug}`).not.toBeNull()
        expect(response!.status(), `final HTTP status for ${slug}`).toBeLessThan(400)

        // §2 — Title contains team-name marker. Per-game titles are formatted
        // `"{Away Team} vs. {Home Team}"` (see normalize-games-discovery-payload.ts
        // `parseTeamLabels`). The "vs." separator is the stable structural marker
        // — proves the title isn't a generic site-title fallback.
        await expect(page).toHaveTitle(/\bvs\.?\b/i)

        // §3 — No "Oops" body text (catches the cache-boundary regression where
        // notFound() inside `'use cache'` produces HTTP 200 + not-found UI).
        await expect(page.getByText(/Oops\.\.\.we didn't forecast this/i)).toHaveCount(0)

        // §4 — Multi-line chart SVG with ≥10 path commands. Drift-locks the
        // synthetic Event's `enable_neg_risk` flag and the chart hook's
        // historical data fetch. ≥10 SVG path commands means the LineChart
        // curve has rendered real historical data (chart frame paths only
        // have 1-2 commands; data curves have many).
        await expect.poll(
          async () => page.evaluate(() => {
            const paths = Array.from(document.querySelectorAll('svg path'))
            const curveCommandCounts = paths.map((p) => {
              const d = p.getAttribute('d') ?? ''
              return (d.match(/[MLCSQTAZ]/gi) ?? []).length
            })
            return Math.max(0, ...curveCommandCounts)
          }),
          {
            message: `chart has ≥10 path commands for ${slug}`,
            timeout: 10_000,
          },
        ).toBeGreaterThanOrEqual(10)

        // §5 — At least 4 market sections present. Phase B v2 multi-section
        // payload contains moneyline + spreads + totals + nrfi (~5 sections
        // for MLB). Detected via section header text. Sections render as
        // groupings keyed off market_type; each gets a heading element.
        // We probe for distinct section indicators across known market types.
        await expect.poll(
          async () => page.evaluate(() => {
            const text = (document.body.textContent ?? '').toLowerCase()
            // Each token represents a market type / section. At least 4 of
            // these should appear on a fully-projected per-game page.
            const sectionTokens = [
              'moneyline',
              'spread',
              'total',
              'nrfi',
              'over/under',
              'run line',
              'puck line',
            ]
            return sectionTokens.filter(token => text.includes(token)).length
          }),
          {
            message: `≥4 market sections present for ${slug}`,
            timeout: 10_000,
          },
        ).toBeGreaterThanOrEqual(4)

        // §6 — Team logo `<img>` present. Proves teams_cache is populated and
        // the projection layer joined real logo URLs onto the synthesized
        // sports card. Selector covers common patterns: alt or src containing
        // "logo", or img inside a team header section.
        await expect.poll(
          async () => page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('img'))
            return imgs.filter((img) => {
              const alt = (img.getAttribute('alt') ?? '').toLowerCase()
              const src = (img.getAttribute('src') ?? '').toLowerCase()
              return alt.includes('logo') || src.includes('logo') || alt.includes('team')
            }).length
          }),
          {
            message: `team logo <img> present for ${slug}`,
            timeout: 10_000,
          },
        ).toBeGreaterThanOrEqual(1)

        // §7 — 308 redirect from /en/event/<slug> to /en/sports/<sport>/<slug>.
        // PreWork.1 may ship as 307 (temporary) or 308 (permanent). We accept
        // either and verify the Location header points at the sports route.
        // Use request.get with maxRedirects: 0 so we capture the raw redirect
        // status (Playwright's APIRequestContext follows by default).
        const redirectResponse = await request.get(`${baseURL}/en/event/${slug}`, {
          maxRedirects: 0,
        })
        expect(
          [307, 308],
          `redirect status from /en/event/${slug} (PreWork.1 ships either)`,
        ).toContain(redirectResponse.status())
        const location = redirectResponse.headers().location ?? ''
        expect(
          location,
          `Location header points at sports route for ${slug}`,
        ).toContain(`/sports/${sportRouteSlug}/${slug}`)

        // §8 — No React #419 hydration errors. Canonical signature of the
        // cache-boundary metadata regression even when the page LOOKS correct.
        const hydrationErrors = consoleErrors.filter(text =>
          text.includes('Minified React error #419')
          || text.toLowerCase().includes('hydration'),
        )
        expect(
          hydrationErrors,
          `hydration / React #419 errors for ${slug}`,
        ).toEqual([])
      }
      finally {
        page.off('console', consoleListener)
      }
    }
  })

  // Stand-alone cache-boundary 404 drift-lock. NOT per-slug — runs once per
  // smoke run. Drift-locks the `notFound()`-outside-`'use cache'` invariant
  // on the live deploy: if the cache-boundary fix regresses, this assertion
  // catches the HTTP 200 + not-found-UI failure mode that produces React #419.
  test('cache-boundary fix: nonexistent sports slug returns HTTP 404 (not 200 + Oops)', async ({ request, baseURL }) => {
    if (!baseURL) {
      throw new Error('baseURL required')
    }

    // Deliberately nonexistent slug (impossible date, fake teams). The slug
    // pattern must still match the league regex so the route enters the
    // discovery branch — otherwise we'd hit a different not-found code path.
    const nonexistentSlug = 'mlb-zzz-yyy-1999-01-01'
    const response = await request.get(`${baseURL}/en/sports/baseball/${nonexistentSlug}`, {
      maxRedirects: 5,
    })

    // The key signal is HTTP 404 status. Don't assert body content — the
    // not-found UI shape is implementation-detail and may change.
    // HTTP 200 here would mean notFound() leaked inside the `'use cache'`
    // boundary (the original P0 bug from commit 9c250959).
    expect(
      response.status(),
      'nonexistent slug must return HTTP 404 — drift-locks notFound()-outside-use-cache invariant',
    ).toBe(404)
  })
})
