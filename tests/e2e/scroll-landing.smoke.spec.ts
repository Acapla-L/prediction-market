/**
 * PR #23 Fix D drift-lock — "View all" navigation lands at top of new page.
 *
 * Reproduces the bug the previous architecture had: the user scrolls the
 * homepage down, clicks "View all" on a sport section, and is taken to the
 * sport list page — but with `<main overflow-hidden h-[calc(100dvh-7.25rem)]>`
 * the new page's `window.scrollY` carried over the pre-nav value, clamped
 * to the new doc's scrollMax, and the user landed at the footer.
 *
 * Fix D removed the overflow-hidden + height clamp and adopted Polymarket's
 * window-scroll + sticky-sidebars pattern. With <main> overflow:visible,
 * Next.js App Router's scroll-target walker finds the new page's content
 * as the scrollable Page element and resets window.scrollY to 0 natively.
 *
 * This test exercises the EXACT bug repro path:
 *   1. Navigate to `/`
 *   2. Scroll the window deep (near footer)
 *   3. Click a "View all" link to `/sports/{sport}/games`
 *   4. Assert: on the new page, window.scrollY === 0
 *
 * Without Fix D, step 4 fails — the user lands at footer with windowScrollY
 * clamped to the new scrollMax.
 *
 * Run against deployed URL via:
 *   SMOKE_BASE_URL=https://<deployment>.vercel.app \
 *   SITE_ACCESS_CODE=<code> \
 *   npm run test:smoke -- scroll-landing.smoke.spec.ts
 */
import { expect, test } from '@playwright/test'

const ACCESS_COOKIE_NAME = 'wp_access'
const ACCESS_COOKIE_STATIC_SALT = 'wirepredictions:access-gate:v1'

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

test.describe('Fix D scroll-landing — Link nav from scrolled homepage lands at top', () => {
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

  test('clicking "View all" from a scrolled homepage lands at scrollY=0 on /sports/{sport}/games', async ({ page, baseURL }) => {
    if (!baseURL) {
      throw new Error('SMOKE_BASE_URL / baseURL required')
    }
    // Desktop viewport at >=1200px to exercise the previously-overflow-hidden code path.
    await page.setViewportSize({ width: 1464, height: 873 })
    test.setTimeout(60_000)

    // Step 1: load homepage
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})

    // Step 2: scroll window deep (mimics the user's pre-click position)
    await page.evaluate(() => {
      window.scrollTo({ top: 99999, behavior: 'auto' })
    })
    await page.waitForTimeout(200)

    const preNavScrollY = await page.evaluate(() => window.scrollY)
    expect(preNavScrollY).toBeGreaterThan(500) // we are definitely scrolled

    // Step 3: locate a "View all" link to a sport list page. The homepage has
    // 5 such links (Baseball / Basketball / Hockey / Soccer / FIFA WC). Any
    // of them exercises the same layout transition.
    const viewAllHref = await page.evaluate(() => {
      const link = Array.from(document.querySelectorAll('a'))
        .find(a => /view all/i.test(a.textContent || '')
          && /^\/sports\/[^/]+\/games$/.test(a.getAttribute('href') || ''))
      return link ? link.getAttribute('href') : null
    })
    expect(viewAllHref).not.toBeNull()

    // Step 4: click via Locator (Playwright's strict real-event dispatch,
    // closest to a user click on a Next.js <Link>).
    await page.locator(`a[href="${viewAllHref}"]`).first().click()

    // Step 5: wait for the new page to commit + initial render
    await page.waitForURL(/\/sports\/[^/]+\/games$/)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500)

    // Step 6: assert window.scrollY === 0 on the new page.
    // Pre-Fix-D, this asserted ~785 (the new doc's scrollMax) because the
    // overflow-hidden parent prevented Next.js's scroll-target walker from
    // finding the page-scroll element.
    const postNavState = await page.evaluate(() => ({
      url: location.pathname,
      windowScrollY: window.scrollY,
      documentHeight: document.documentElement.scrollHeight,
      mainOverflow: getComputedStyle(document.querySelector('main')!).overflow,
    }))

    expect(postNavState.windowScrollY).toBe(0)
    // Forward drift-lock against an accidental re-introduction of
    // overflow-hidden on <main>.
    expect(postNavState.mainOverflow).toBe('visible')
  })
})
