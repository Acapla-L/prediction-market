import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Platform fix — scroll position stuck on "View all" / nav-link navigation to
 * sports list pages.
 *
 * The sports pages use a Polymarket-style 3-column layout where, at viewport
 * width >= 1200px, the document does NOT scroll — instead an inner
 * `<section data-sports-scroll-pane="center">` (rendered by SportsGamesCenter /
 * SportsEventCenter) is the scroll context, with a sibling
 * `<aside data-sports-scroll-pane="aside">` order-panel rail. The
 * `<main className="... min-[1200px]:overflow-hidden">` lives in
 * `SportsLayoutShell.tsx`.
 *
 * Next.js App Router scroll restoration (and a default `<Link>` navigation,
 * which is `scroll={true}`) scrolls `window` / `document.documentElement` on a
 * route change. It does NOT reset the `scrollTop` of an arbitrary nested
 * `overflow-y-auto` element — and that nested element's DOM node PERSISTS
 * across navigations within the same `sports/` layout segment, so its
 * `scrollTop` carries over. Result: navigating to `/sports/baseball/games`
 * (etc.) lands mid-page / at the bottom.
 *
 * The fix: a `useEffect` keyed on `usePathname()` in `SportsLayoutShell.tsx`
 * (which is already `'use client'` and already imports `usePathname`) that
 * resets the inner scroll panes' scrollTop to 0 on every route change within
 * the sports layout — and on first mount, which handles the initial mid-page
 * landing.
 *
 * A pure-runtime test would require mounting the Next App Router + jsdom scroll
 * APIs (brittle, couples to framework internals). So — mirroring the codebase's
 * existing static-source drift-lock style (`sportsCacheNotFoundBoundary.test.ts`)
 * — this test reads the source of `SportsLayoutShell.tsx` and asserts the
 * static pattern.
 */

const SHELL_PATH = resolve(
  __dirname,
  '..',
  '..',
  'src/app/[locale]/(platform)/sports/_components/SportsLayoutShell.tsx',
)

const GAMES_CENTER_PATH = resolve(
  __dirname,
  '..',
  '..',
  'src/app/[locale]/(platform)/sports/_components/SportsGamesCenter.tsx',
)

function readSource(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('sports list page scroll-reset fix', () => {
  it('SportsLayoutShell is a client component using usePathname', () => {
    const source = readSource(SHELL_PATH)
    expect(source).toMatch(/^'use client'/)
    expect(source).toMatch(/usePathname/)
  })

  it('SportsLayoutShell resets the center scroll pane to top on route change', () => {
    const source = readSource(SHELL_PATH)

    // There must be a useEffect that depends on `pathname` (the route-change
    // signal). We assert the dependency array contains `pathname`.
    const pathnameEffect = /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[[^\]]*\bpathname\b[^\]]*\]\s*\)/m
    expect(source).toMatch(pathnameEffect)

    // The effect (or a helper it calls) must target the center scroll pane and
    // reset its vertical scroll position to 0.
    expect(source).toMatch(/\[data-sports-scroll-pane="center"\]/)
    expect(source).toMatch(/scrollTo\(\s*\{\s*top:\s*0[\s\S]*?\}\s*\)|scrollTop\s*=\s*0/)
  })

  it('SportsLayoutShell also resets the aside (order-panel) scroll pane', () => {
    const source = readSource(SHELL_PATH)
    expect(source).toMatch(/\[data-sports-scroll-pane="aside"\]/)
  })

  it('the scroll-reset selectors still match the rendered DOM markers in SportsGamesCenter', () => {
    const gamesCenter = readSource(GAMES_CENTER_PATH)
    expect(gamesCenter).toMatch(/data-sports-scroll-pane="center"/)
    expect(gamesCenter).toMatch(/data-sports-scroll-pane="aside"/)
  })
})
