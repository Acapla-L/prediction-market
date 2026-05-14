// PR #23 Fix D drift-lock (2026-05-14) — Polymarket-style window-scroll layout.
//
// The sports layout previously used `<main overflow-hidden h-[calc(100dvh-7.25rem)]>`
// at viewport >= 1200px and a nested `<section data-sports-scroll-pane="center"
// overflow-y-auto>` as the actual scroll container. That defeated Next.js App
// Router's scroll-target walker (which bypasses non-scrollable elements per
// the official Next.js docs) and caused `window.scrollY` from a prior route
// to carry over and clamp to the new document's scrollMax — landing the user
// at the footer after "View all" navigation.
//
// PR #23 adopted Polymarket's pattern (verified live): window scrolls,
// sidebars use position:sticky, <main> has overflow:visible. With <main>
// overflow:visible, Next.js's walker finds the page-scroll element and
// resets window.scrollY to 0 natively. The wheel-handler hack (PR #22 B1)
// and the pathname-keyed scroll-reset useEffect are both unnecessary by
// construction.
//
// This test static-source-locks the new invariants so an accidental upstream
// merge or refactor cannot silently re-introduce the overflow-hidden parent
// or the JS workarounds it required.
//
// Reference:
//   docs/audits/scroll-landing-investigation-2026-05-14.md
//   docs/audits/polymarket-layout-comparison-2026-05-14.md

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SHELL_PATH = resolve(
  __dirname,
  '../../src/app/[locale]/(platform)/sports/_components/SportsLayoutShell.tsx',
)
const GAMES_CENTER_PATH = resolve(
  __dirname,
  '../../src/app/[locale]/(platform)/sports/_components/SportsGamesCenter.tsx',
)
const EVENT_CENTER_PATH = resolve(
  __dirname,
  '../../src/app/[locale]/(platform)/sports/_components/SportsEventCenter.tsx',
)
const SIDEBAR_PATH = resolve(
  __dirname,
  '../../src/app/[locale]/(platform)/sports/_components/SportsSidebarMenu.tsx',
)

const shellSource = readFileSync(SHELL_PATH, 'utf8')
const gamesCenterSource = readFileSync(GAMES_CENTER_PATH, 'utf8')
const eventCenterSource = readFileSync(EVENT_CENTER_PATH, 'utf8')
const sidebarSource = readFileSync(SIDEBAR_PATH, 'utf8')

describe('SportsLayoutShell Fix D invariants (PR #23)', () => {
  it('<main> does NOT have overflow-hidden anywhere on its className', () => {
    // Catches the exact pattern from before Fix D:
    //   className={cn('container py-4', useIndependentColumns && 'min-[1200px]:h-[calc(100dvh-7.25rem)] min-[1200px]:overflow-hidden')}
    // And any future variant of overflow-hidden on <main>.
    // Match only a JSX <main> tag (one with a className= or ref= attribute
    // immediately following), not the literal string "<main" that may appear
    // in comments referring to the element.
    const mainBlock = shellSource.match(/<main\s+(?:ref|className)=[\s\S]*?>/)
    expect(mainBlock).not.toBeNull()
    expect(mainBlock![0]).not.toMatch(/overflow-hidden/)
    // Also: the height-clamp pattern must NOT come back as a fixed height
    // (we use min-h-[…] instead of h-[…] — the former allows growth, the
    // latter locks the layout). Negative lookbehind excludes the legitimate
    // `min-h-[calc(100dvh-…)]` form.
    expect(mainBlock![0]).not.toMatch(/(?<!min-)h-\[calc\(100dvh/)
  })

  it('<main> uses min-h (not h) to preserve a minimum visual height without locking scroll', () => {
    // Match only a JSX <main> tag (one with a className= or ref= attribute
    // immediately following), not the literal string "<main" that may appear
    // in comments referring to the element.
    const mainBlock = shellSource.match(/<main\s+(?:ref|className)=[\s\S]*?>/)
    expect(mainBlock![0]).toMatch(/min-h-\[calc\(100dvh-7\.25rem\)\]/)
  })

  it('SportsLayoutShell has no mainRef remnant (deleted with wheel handler)', () => {
    expect(shellSource).not.toMatch(/\bmainRef\b/)
  })

  it('SportsLayoutShell has no wheel listener (handleLayoutWheel / addEventListener("wheel"))', () => {
    expect(shellSource).not.toMatch(/addEventListener\(\s*['"]wheel['"]/)
    expect(shellSource).not.toMatch(/handleLayoutWheel|handleWindowWheel/)
  })

  it('SportsLayoutShell has no pathname-keyed scrollTo on data-sports-scroll-pane', () => {
    // The old reset useEffect did: querySelector('[data-sports-scroll-pane="…"]').scrollTo(...)
    expect(shellSource).not.toMatch(/data-sports-scroll-pane[\s\S]{0,200}scrollTo/)
  })

  it('SportsLayoutShell has no useIndependentColumns derived flag', () => {
    expect(shellSource).not.toMatch(/useIndependentColumns/)
  })

  // Fix D follow-up: the structural CSS change alone does NOT cause Next.js
  // to reset window.scrollY on soft navigation in this codebase (see comment
  // block in SportsLayoutShell.tsx for the why). A useLayoutEffect resets
  // window.scrollY on pathname change, with a popstate-flag escape hatch so
  // back/forward navigation's native scroll restoration is preserved.
  it('SportsLayoutShell has a useLayoutEffect that resets window.scrollY on pathname change', () => {
    expect(shellSource).toMatch(
      /useLayoutEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?window\.scrollTo\(\s*0\s*,\s*0\s*\)[\s\S]*?\}\s*,\s*\[\s*pathname\s*\]\s*\)/,
    )
  })

  it('SportsLayoutShell uses a popstate listener + ref flag to detect back/forward navigation', () => {
    // The popstate flag is essential — without it, the useLayoutEffect would
    // override the browser's native scroll restoration on back-button, losing
    // the user's prior position on the route they came from.
    expect(shellSource).toMatch(/isPopNavigation\s*=\s*useRef\(\s*false\s*\)/)
    expect(shellSource).toMatch(/addEventListener\(\s*['"]popstate['"]/)
    expect(shellSource).toMatch(/isPopNavigation\.current\s*=\s*true/)
    // And the useLayoutEffect must gate its scrollTo on the flag.
    expect(shellSource).toMatch(
      /if\s*\(\s*!\s*isPopNavigation\.current\s*\)\s*\{[\s\S]*?window\.scrollTo/,
    )
    // Flag MUST reset after every effect run (one-shot signal).
    expect(shellSource).toMatch(/isPopNavigation\.current\s*=\s*false/)
  })
})

describe('SportsSidebarMenu Fix D invariants (PR #23)', () => {
  it('SportsSidebarMenu no longer accepts an independentScroll prop', () => {
    expect(sidebarSource).not.toMatch(/independentScroll/)
  })

  it('SportsSidebarMenu aside is always sticky at top-22 with viewport-bounded height', () => {
    // The aside is the sport-list nav rail. It must use the Polymarket-style
    // sticky pattern (top:navbar-height, height:calc(viewport-navbar)).
    expect(sidebarSource).toMatch(/min-\[1200px\]:sticky/)
    expect(sidebarSource).toMatch(/min-\[1200px\]:top-22/)
    expect(sidebarSource).toMatch(/min-\[1200px\]:h-\[calc\(100vh-5\.5rem\)\]/)
  })
})

describe('SportsGamesCenter Fix D invariants (PR #23)', () => {
  it('center pane does NOT carry an overflow-y-auto (the window is the scroll container)', () => {
    // Match the specific data-sports-scroll-pane="center" block in SportsGamesCenter.
    // The previous CSS was: min-[1200px]:overflow-y-auto min-[1200px]:overscroll-contain
    const centerBlock = gamesCenterSource.match(
      /<section[\s\S]{0,200}?data-sports-scroll-pane="center"[\s\S]*?className=[`"][\s\S]*?[`"]/,
    )
    expect(centerBlock).not.toBeNull()
    expect(centerBlock![0]).not.toMatch(/overflow-y-auto/)
    expect(centerBlock![0]).not.toMatch(/overscroll-contain/)
  })

  it('aside pane sticky-anchors at top-22 with a viewport-bounded max-h cap', () => {
    // Polymarket-style: sticky top:navbar-height, max-h:calc(viewport-navbar),
    // so the order panel stays visible without growing past the viewport.
    const asideBlock = gamesCenterSource.match(
      /<aside[\s\S]{0,200}?data-sports-scroll-pane="aside"[\s\S]*?className=[`"][\s\S]*?[`"]/,
    )
    expect(asideBlock).not.toBeNull()
    expect(asideBlock![0]).toMatch(/min-\[1200px\]:sticky/)
    expect(asideBlock![0]).toMatch(/min-\[1200px\]:top-22/)
    expect(asideBlock![0]).toMatch(/min-\[1200px\]:max-h-\[calc\(100vh-5\.5rem\)\]/)
    expect(asideBlock![0]).not.toMatch(/min-\[1200px\]:max-h-full/)
  })
})

describe('SportsEventCenter Fix D invariants (PR #23)', () => {
  it('center pane does NOT carry overflow-y-auto', () => {
    const centerBlock = eventCenterSource.match(
      /<section[\s\S]{0,200}?data-sports-scroll-pane="center"[\s\S]*?className=[`"][\s\S]*?[`"]/,
    )
    expect(centerBlock).not.toBeNull()
    expect(centerBlock![0]).not.toMatch(/overflow-y-auto/)
    expect(centerBlock![0]).not.toMatch(/overscroll-contain/)
  })

  it('aside pane sticky-anchors at top-22 with viewport-bounded max-h cap', () => {
    const asideBlock = eventCenterSource.match(
      /<aside[\s\S]{0,200}?data-sports-scroll-pane="aside"[\s\S]*?className=[`"][\s\S]*?[`"]/,
    )
    expect(asideBlock).not.toBeNull()
    expect(asideBlock![0]).toMatch(/min-\[1200px\]:sticky/)
    expect(asideBlock![0]).toMatch(/min-\[1200px\]:top-22/)
    expect(asideBlock![0]).toMatch(/min-\[1200px\]:max-h-\[calc\(100vh-5\.5rem\)\]/)
    expect(asideBlock![0]).not.toMatch(/min-\[1200px\]:max-h-full/)
  })
})
