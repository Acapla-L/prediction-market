/**
 * Deploy-gate smoke test for the 6 high-stakes event pages (1 FIFA via Kuest +
 * 5 discovery slugs via the Polymarket sidecar). Asserts each page renders with
 * the expected event title in the document title — would have caught the
 * 2026-05-05 regression where discovery pages flipped to "Oops" mid-render
 * (React #419 hydration mismatch caused by `notFound()` firing inside
 * `generateMetadata`).
 *
 * Run against a deployed URL via:
 *   SMOKE_BASE_URL=https://<deployment>.vercel.app \
 *   SITE_ACCESS_CODE=<code> \
 *   npm run test:smoke
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
  { slug: 'big-game-champion-2027', expectedTitleSubstring: 'Super Bowl' },
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

test.describe('discovery + FIFA event pages render with expected title', () => {
  test.beforeEach(async ({ context, baseURL }) => {
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
    test(`/event/${slug} title contains "${expectedTitleSubstring}"`, async ({ page }) => {
      const consoleErrors: string[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text())
        }
      })

      const response = await page.goto(`/en/event/${slug}`, { waitUntil: 'domcontentloaded' })
      expect(response, `navigation response for ${slug}`).not.toBeNull()
      expect(response!.status(), `final HTTP status for ${slug}`).toBeLessThan(400)

      // Title is set by generateMetadata. If generateMetadata calls notFound()
      // for a discovery slug (the 2026-05-05 regression), the title falls back
      // to the generic site title and this assertion fails — exactly the gate
      // we want.
      await expect(page).toHaveTitle(new RegExp(expectedTitleSubstring, 'i'))

      // Body must NOT contain the not-found message. Belt-and-suspenders: if a
      // future regression flips the React tree to NotFound but the metadata
      // somehow still resolves (or the title check is satisfied by some other
      // path), this catches the visual outcome the user actually sees.
      await expect(page.getByText(/Oops\.\.\.we didn't forecast this/i)).toHaveCount(0)

      // React #419 (hydration mismatch) is the canonical signature of the bug
      // even when the page LOOKS correct. Fail if it shows up in the console.
      const hydrationErrors = consoleErrors.filter(text => text.includes('Minified React error #419') || text.includes('hydration'))
      expect(hydrationErrors, `hydration / React #419 errors for ${slug}`).toEqual([])
    })
  }
})
