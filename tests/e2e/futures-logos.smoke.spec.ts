/**
 * Deploy-gate smoke test for the Bundle B futures-logos fix
 * (`docs/plans/post-pr23-investigation-and-bundles-plan-2026-05-14.md`).
 *
 * For each of the 5 Phase A v2 discovery slugs, asserts that the rendered
 * outcome rows show MULTIPLE DISTINCT `<img>` src values. Pre-Bundle-B,
 * Polymarket Gamma returned the same generic event banner for every market on
 * these slugs — every outcome row rendered the same image (the site-health
 * audit-2026-05-14 §B confirmed this empirically: 14 of 17 outcome images on
 * `/event/2026-nba-champion` were the identical `nba-finals-points-leader-…`
 * banner). Post-Bundle-B, `buildSyntheticMarket` overrides `icon_url` with
 * the per-team logo from `teams_cache` — so a healthy page renders ~30
 * distinct logos.
 *
 * Coverage threshold:
 *   - NBA/NHL/MLB/NFL: ≥ 90% of outcomes have unique logos
 *   - UCL:             ≥ 80% (composite matcher + 5-entry alias table; if
 *                      coverage drops below this, add an alias-table entry)
 *
 * Run via:
 *   SMOKE_BASE_URL=https://<deployment>.vercel.app \
 *   SITE_ACCESS_CODE=<code> \
 *   npm run test:smoke
 *
 * Add `VERCEL_PROTECTION_BYPASS=<token>` if the deployment is gated by Vercel
 * Deployment Protection.
 */
import { expect, test } from '@playwright/test'

const ACCESS_COOKIE_NAME = 'wp_access'
const ACCESS_COOKIE_STATIC_SALT = 'wirepredictions:access-gate:v1'

interface SmokeCase {
  slug: string
  expectedTeamCount: number
  uniqueLogoRatio: number
}

const CASES: readonly SmokeCase[] = [
  // Expected counts include placeholders ("Other", "Team A".."Team T") that
  // are filtered out of tradeable markets — so actual rendered counts may be
  // 1-21 less. The ratio assertions are over the rendered count.
  { slug: '2026-nba-champion', expectedTeamCount: 30, uniqueLogoRatio: 0.9 },
  { slug: 'mlb-world-series-champion-2026', expectedTeamCount: 30, uniqueLogoRatio: 0.9 },
  { slug: '2026-nhl-stanley-cup-champion', expectedTeamCount: 32, uniqueLogoRatio: 0.9 },
  { slug: 'big-game-champion-2027', expectedTeamCount: 32, uniqueLogoRatio: 0.9 },
  { slug: 'uefa-champions-league-winner', expectedTeamCount: 30, uniqueLogoRatio: 0.8 },
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

test.describe('Bundle B — futures-page outcome rows render per-team logos', () => {
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

  for (const { slug, expectedTeamCount, uniqueLogoRatio } of CASES) {
    test(`/event/${slug} renders ≥${Math.round(uniqueLogoRatio * 100)}% unique outcome-row logos`, async ({ page }) => {
      const response = await page.goto(`/en/event/${slug}`, { waitUntil: 'domcontentloaded' })
      expect(response, `navigation response for ${slug}`).not.toBeNull()
      expect(response!.status(), `final HTTP status for ${slug}`).toBeLessThan(400)

      // Wait for the EventMarkets list to mount — the outcome rows render
      // their per-market icons via `<EventIconImage>` whose underlying <img>
      // has `sizes="42px"`. This selector is more specific than counting
      // every <img> on the page (which would include header logo, footer
      // images, share icons, etc.).
      await expect.poll(
        async () => page.evaluate(() => {
          return document.querySelectorAll('img[sizes*="42"]').length
        }),
        { message: `outcome-row icons mounted for ${slug}`, timeout: 15_000 },
      ).toBeGreaterThanOrEqual(Math.floor(expectedTeamCount * 0.5))

      const { totalIcons, uniqueIcons, sampleSrcs } = await page.evaluate(() => {
        const icons = Array.from(
          document.querySelectorAll('img[sizes*="42"]'),
        ) as HTMLImageElement[]
        const srcs = icons.map((i) => {
          // Normalize wsrv.nl image-proxy URLs to extract the underlying source.
          const raw = i.getAttribute('src') ?? ''
          try {
            const u = new URL(raw)
            return u.searchParams.get('url') ?? raw
          }
          catch {
            return raw
          }
        }).filter(s => s.length > 0)
        return {
          totalIcons: srcs.length,
          uniqueIcons: new Set(srcs).size,
          sampleSrcs: srcs.slice(0, 5),
        }
      })

      expect(totalIcons, `outcome icons rendered for ${slug}`).toBeGreaterThanOrEqual(10)
      const ratio = uniqueIcons / totalIcons
      expect(
        ratio,
        `unique-logo ratio for ${slug}: ${uniqueIcons}/${totalIcons} = ${ratio.toFixed(2)} (expected ≥ ${uniqueLogoRatio}). Sample srcs: ${sampleSrcs.join(' | ')}`,
      ).toBeGreaterThanOrEqual(uniqueLogoRatio)
    })
  }
})
