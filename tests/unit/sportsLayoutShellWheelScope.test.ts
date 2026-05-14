/**
 * PR #22 B1 drift-lock — Sport list page "scroll stuck" at footer.
 *
 * SportsLayoutShell previously attached its wheel listener to `window` and
 * preventDefault'd every wheel event NOT inside an explicitly-allowlisted
 * pane (sidebar/aside/center/wheel-ignore). The footer carries none of
 * those attributes, so wheel-on-footer was redirected to the center pane
 * and the window stayed at footer position — "scroll stuck" UX.
 *
 * PR #22 B1 narrows the listener attach target from `window` to the
 * layout's `<main>` element. Footer / NavigationTabs / Header live OUTSIDE
 * `<main>` and therefore scroll natively after the fix.
 *
 * Static-source brace-walking — durable lock against accidental reversion.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SHELL_PATH = resolve(
  __dirname,
  '../../src/app/[locale]/(platform)/sports/_components/SportsLayoutShell.tsx',
)
const source = readFileSync(SHELL_PATH, 'utf8')

describe('SportsLayoutShell wheel-handler scope (PR #22 B1)', () => {
  it('declares a `mainRef` ref for the layout container', () => {
    expect(source).toMatch(/const\s+mainRef\s*=\s*useRef<HTMLElement>\(\s*null\s*\)/)
  })

  it('attaches the wheel listener to the <main> element, NOT to window', () => {
    // Must reference `mainEl.addEventListener('wheel', ...)`.
    expect(source).toMatch(/mainEl\.addEventListener\(\s*['"]wheel['"]/)
    // And the matching removeEventListener.
    expect(source).toMatch(/mainEl\.removeEventListener\(\s*['"]wheel['"]/)
  })

  it('has NO `window.addEventListener("wheel", ...)` call (regression guard)', () => {
    // The previous bug was `window.addEventListener('wheel', handleWindowWheel, { passive: false })`.
    // Any reintroduction would re-break footer scroll.
    expect(source).not.toMatch(/window\.addEventListener\(\s*['"]wheel['"]/)
    expect(source).not.toMatch(/window\.removeEventListener\(\s*['"]wheel['"]/)
  })

  it('attaches the ref on the <main> element this component renders', () => {
    expect(source).toMatch(/<main\b[^>]*\bref=\{mainRef\}/)
  })

  it('keeps the in-pane allowlist intact (sidebar/aside/center/wheel-ignore)', () => {
    // Narrowing the listener scope does not remove the existing pane-routing
    // logic for in-layout wheel events between columns.
    expect(source).toMatch(/data-sports-scroll-pane="sidebar"/)
    expect(source).toMatch(/data-sports-scroll-pane="aside"/)
    expect(source).toMatch(/data-sports-scroll-pane="center"/)
    expect(source).toMatch(/data-sports-wheel-ignore="true"/)
  })

  it('preserves the center-pane scrollBy redirect for wheel events inside the layout', () => {
    expect(source).toMatch(/centerPane\.scrollBy\(/)
    expect(source).toMatch(/event\.preventDefault\(\)/)
  })

  it('still bails on viewport < 1200px and modifier-key events (UX preserved)', () => {
    expect(source).toMatch(/window\.innerWidth\s*<\s*1200/)
    expect(source).toMatch(/event\.ctrlKey\s*\|\|\s*event\.metaKey/)
  })
})
