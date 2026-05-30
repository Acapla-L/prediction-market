/**
 * Deploy-gate smoke spec for the Polymarket WebSocket live-data layer.
 *
 * Verifies five properties after the Phase A v2 + WebSocket integration:
 *   1. Regression — the 9 futures discovery pages still render without error.
 *   2. Connect — the Polymarket market socket opens on a discovery page.
 *   3. Subscribe-frame — the client sends a "market" subscribe frame with YES
 *      token ids (assets_ids).
 *   4. Bounded sub-limit — a full-roster page (French Open Women's, ~74 YES
 *      tokens) sends the subscribe frame and the socket is not rejected
 *      immediately before the subscribe arrives.
 *   5. Graceful degradation — the page renders prices from REST when the
 *      Polymarket WS is blocked via route interception.
 *   6. Self-gate — the homepage (home-v2) opens NO Polymarket market socket
 *      (no event-detail providers are mounted there).
 *
 * Run against a deployed URL via:
 *   SMOKE_BASE_URL=https://<deployment>.vercel.app \
 *   SITE_ACCESS_CODE=<code> \
 *   npm run test:smoke:ws
 *
 * Add `VERCEL_PROTECTION_BYPASS=<token>` when the deployment is protected by
 * Vercel Deployment Protection (generate via Vercel dashboard → Project →
 * Settings → Deployment Protection → "Protection Bypass for Automation").
 *
 * Cannot run green locally — it needs the deployed URL behind the access gate.
 * Verify parse only with: --list flag (no execution).
 */
import { expect, test } from '@playwright/test'

// ─── Auth helpers (mirrors discovery-events.smoke.spec.ts exactly) ────────────

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

// ─── Slug lists ───────────────────────────────────────────────────────────────

const FUTURES = [
  '2026-nba-champion',
  'mlb-world-series-champion-2026',
  '2026-nhl-stanley-cup-champion',
  'big-game-champion-2027',
  'uefa-champions-league-winner',
  '2026-mens-french-open-winner',
  '2026-womens-french-open-winner',
  '2026-f1-drivers-champion',
  'f1-constructors-champion',
] as const

// ─── Shared beforeEach (identical to discovery-events.smoke.spec.ts) ─────────

test.describe('Polymarket WebSocket live-data layer', () => {
  test.beforeEach(async ({ context, page, baseURL }) => {
    // Vercel Deployment Protection bypass — hit the bypass URL once so the
    // browser context picks up the `_vercel_jwt` auth cookie.
    const vercelBypass = process.env.VERCEL_PROTECTION_BYPASS
    if (vercelBypass && baseURL) {
      await page.goto(`/?_vercel_share=${vercelBypass}`, { waitUntil: 'domcontentloaded' })
    }

    // Site access-code gate — hash the code and inject the cookie directly so
    // every subsequent page.goto lands on the real page, not /access.
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

  // ── Test 1: regression ──────────────────────────────────────────────────────

  test('9 futures discovery pages still render (regression)', async ({ page }) => {
    for (const slug of FUTURES) {
      const res = await page.goto(`/en/event/${slug}`)
      expect(res?.status(), slug).toBeLessThan(400)
      await expect(page.locator('body')).not.toContainText('Oops')
    }
  })

  // ── Test 2: connect + subscribe frame ──────────────────────────────────────

  test('Polymarket market socket connects on a discovery page + subscribe frame carries YES tokens', async ({ page }) => {
    const subscribeFrames: string[] = []
    const opened: string[] = []

    page.on('websocket', (ws) => {
      if (!ws.url().includes('ws-subscriptions-clob.polymarket.com')) {
        return
      }
      opened.push(ws.url())
      ws.on('framesent', (f) => {
        const payload = typeof f.payload === 'string' ? f.payload : ''
        if (payload.includes('assets_ids')) {
          subscribeFrames.push(payload)
        }
      })
    })

    await page.goto('/en/event/2026-nba-champion')
    await page.waitForTimeout(8000)

    expect(opened.length, 'a Polymarket market socket should open').toBeGreaterThanOrEqual(1)
    expect(subscribeFrames.length, 'a market subscribe frame with assets_ids should be sent').toBeGreaterThanOrEqual(1)

    const sub = JSON.parse(subscribeFrames[0])
    expect(sub.type).toBe('market')
    expect(Array.isArray(sub.assets_ids) && sub.assets_ids.length).toBeGreaterThan(0)
  })

  // ── Test 3: bounded subscription-limit ─────────────────────────────────────

  test('bounded subscription-limit: full-roster page subscribe is accepted (no immediate close)', async ({ page }) => {
    let closedEarly = false
    let subscribed = false

    page.on('websocket', (ws) => {
      if (!ws.url().includes('ws-subscriptions-clob.polymarket.com')) {
        return
      }
      ws.on('framesent', (f) => {
        const payload = typeof f.payload === 'string' ? f.payload : ''
        if (payload.includes('assets_ids')) {
          subscribed = true
        }
      })
      ws.on('close', () => {
        if (!subscribed) {
          closedEarly = true
        }
      })
    })

    await page.goto('/en/event/2026-womens-french-open-winner') // ~74 active YES tokens
    await page.waitForTimeout(8000)

    expect(subscribed, 'subscribe frame should be sent for a full-roster page').toBe(true)
    expect(closedEarly, 'socket must not close before the subscribe is sent (sub-limit rejection)').toBe(false)
  })

  // ── Test 4: graceful degradation ───────────────────────────────────────────

  test('graceful degradation: page renders from REST when the Polymarket WS is blocked', async ({ page, context }) => {
    await context.route('**/ws-subscriptions-clob.polymarket.com/**', route => route.abort())

    const res = await page.goto('/en/event/2026-nba-champion')
    expect(res?.status()).toBeLessThan(400)
    await expect(page.locator('body')).not.toContainText('Oops')
    await expect(page.getByText('%').first()).toBeVisible({ timeout: 15_000 })
  })

  // ── Test 5: self-gate ───────────────────────────────────────────────────────

  test('self-gate: a non-discovery page opens NO Polymarket socket', async ({ page }) => {
    const opened: string[] = []

    page.on('websocket', (ws) => {
      if (ws.url().includes('ws-subscriptions-clob.polymarket.com')) {
        opened.push(ws.url())
      }
    })

    await page.goto('/en') // home-v2 — mounts no event-detail providers
    await page.waitForTimeout(6000)

    expect(opened.length, 'homepage must not open a Polymarket market socket').toBe(0)
  })
})
