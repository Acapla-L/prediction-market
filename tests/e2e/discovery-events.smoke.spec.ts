/**
 * Deploy-gate smoke test for the 6 high-stakes event pages (1 FIFA via Kuest +
 * 5 discovery slugs via the Polymarket sidecar). For each event asserts:
 *   1. Page renders without flipping to "Oops" (caught the 2026-05-05 metadata
 *      regression — see docs/audits/discovery-chart-gap-2026-05-05.md §A).
 *   2. Document title contains the expected event name (gates the
 *      `generateMetadata` discovery branch — without it, title falls back to
 *      the generic site title).
 *   3. No React #419 hydration errors (the canonical signature of metadata
 *      flipping the rendered tree mid-render).
 *   4. A chart SVG renders (gates the synthetic Event's `enable_neg_risk` flag —
 *      without it, EventChart short-circuits at `shouldHideChart` and produces
 *      no chart even though useEventPriceHistory successfully fetches data;
 *      see docs/audits/discovery-chart-gap-2026-05-05.md §Diag.2).
 *
 * Run against a deployed URL via:
 *   SMOKE_BASE_URL=https://<deployment>.vercel.app \
 *   SITE_ACCESS_CODE=<code> \
 *   npm run test:smoke
 *
 * Add `VERCEL_PROTECTION_BYPASS=<token>` if the deployment is gated by Vercel
 * Deployment Protection (generate via Vercel dashboard → Project → Settings →
 * Deployment Protection → "Protection Bypass for Automation" or via the Vercel
 * MCP `get_access_to_vercel_url` tool).
 */
import { expect, test } from '@playwright/test'

const ACCESS_COOKIE_NAME = 'wp_access'
const ACCESS_COOKIE_STATIC_SALT = 'wirepredictions:access-gate:v1'

interface SmokeCase {
  slug: string
  expectedTitleSubstring: string
}

const CASES: readonly SmokeCase[] = [
  { slug: '2026-fifa-world-cup-winner-595', expectedTitleSubstring: 'FIFA World Cup' },
  { slug: 'uefa-champions-league-winner', expectedTitleSubstring: 'Champions League' },
  { slug: '2026-nba-champion', expectedTitleSubstring: 'NBA' },
  { slug: 'mlb-world-series-champion-2026', expectedTitleSubstring: 'World Series' },
  { slug: '2026-nhl-stanley-cup-champion', expectedTitleSubstring: 'Stanley Cup' },
  // Polymarket uses "NFL Champion" (trademark-safe) not "Super Bowl" in the
  // event title for this slug. Matches the actual sidecar payload.
  { slug: 'big-game-champion-2027', expectedTitleSubstring: 'NFL Champion' },
] as const

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

test.describe('discovery + FIFA event pages render with expected title and chart', () => {
  test.beforeEach(async ({ context, page, baseURL }) => {
    // Vercel deployment protection: when running against a protected preview
    // URL, hit the bypass URL once so the browser context picks up the
    // `_vercel_jwt` auth cookie. Generated via the Vercel MCP
    // `get_access_to_vercel_url` tool or the Vercel dashboard's
    // "Generate Share Link" feature.
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

  for (const { slug, expectedTitleSubstring } of CASES) {
    test(`/event/${slug} renders with title "${expectedTitleSubstring}" and a chart`, async ({ page }) => {
      const consoleErrors: string[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text())
        }
      })

      const response = await page.goto(`/en/event/${slug}`, { waitUntil: 'domcontentloaded' })
      expect(response, `navigation response for ${slug}`).not.toBeNull()
      expect(response!.status(), `final HTTP status for ${slug}`).toBeLessThan(400)

      // §1 — Title gate. If generateMetadata calls notFound() for a discovery
      // slug (the 2026-05-05 metadata regression), the title falls back to the
      // generic site title and this assertion fails.
      await expect(page).toHaveTitle(new RegExp(expectedTitleSubstring, 'i'))

      // §2 — Body must NOT contain the not-found message. Belt-and-suspenders:
      // if a future regression flips the React tree to NotFound but the
      // metadata somehow still resolves, this catches the visual outcome the
      // user actually sees.
      await expect(page.getByText(/Oops\.\.\.we didn't forecast this/i)).toHaveCount(0)

      // §3 — Chart presence. Multi-market discovery events render a chart only
      // when `event.enable_neg_risk` (or `event.neg_risk`) is truthy — see
      // EventChart.tsx:1086 (`shouldHideChart`). A chart-like SVG has multiple
      // path elements and a non-trivial bounding box. Polled up to 10s
      // because Recharts mounts after the initial paint.
      await expect.poll(
        async () => page.evaluate(() => {
          const svgs = Array.from(document.querySelectorAll('svg'))
          return svgs.filter((s) => {
            const rect = s.getBoundingClientRect()
            return rect.width > 100 && rect.height > 100 && s.querySelectorAll('path').length > 1
          }).length
        }),
        { message: `chart SVG present for ${slug}`, timeout: 10_000 },
      ).toBeGreaterThan(0)

      // §3b — Chart time-range gate. The chart should display historical data,
      // not just a degenerate "now" window. Pre-fix, discovery slugs rendered
      // with `event.created_at = lastSyncedAt` (NOW per hourly cron), so the
      // chart's ALL range was ~1 hour. Post-fix, `created_at` comes from the
      // Polymarket Gamma `createdAt` field (months/years ago), so the chart
      // shows the full history.
      //
      // Implementation: count Recharts `path` elements that have a meaningful
      // `d` attribute (i.e. the LineChart curve actually has many segments,
      // not just the chart frame). At minimum 10 distinct path commands —
      // each data point becomes 1 line segment in the curve, so 10+ commands
      // implies at least ~10 historical data points rendered.
      await expect.poll(
        async () => page.evaluate(() => {
          const paths = Array.from(document.querySelectorAll('svg path'))
          // Find chart curve paths (have many SVG path commands like 'L' / 'M' / 'C')
          // — the chart frame paths have only 1-2 commands, real data curves have many.
          const curveCommandCounts = paths.map((p) => {
            const d = p.getAttribute('d') ?? ''
            // Count SVG path command letters (M, L, C, etc.)
            return (d.match(/[MLCSQTAZ]/gi) ?? []).length
          })
          // Largest single-curve command count = approximate data point count.
          return Math.max(0, ...curveCommandCounts)
        }),
        { message: `chart has ≥10 data points for ${slug} (locks the time-range fix)`, timeout: 10_000 },
      ).toBeGreaterThanOrEqual(10)

      // §4 — React #419 (hydration mismatch) is the canonical signature of the
      // metadata bug even when the page LOOKS correct. Fail if it shows up.
      const hydrationErrors = consoleErrors.filter(text =>
        text.includes('Minified React error #419') || text.includes('hydration'),
      )
      expect(hydrationErrors, `hydration / React #419 errors for ${slug}`).toEqual([])
    })
  }
})
