import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Drift-lock: the static-route (`[locale]`-only) sports pages that fetch the
 * heavy `EventRepository.listEvents` fat-lateral-join — `/sports/soon` and
 * `/sports/live` — MUST defer that uncached data access into a `<Suspense>`
 * boundary, and MUST NOT carry a module-level `'use cache'` directive.
 *
 * Why: under Next.js 16's parallel 400+-page static-gen pass, that query
 * repeatedly failed to fill within the build-time prerender cache-fill timeout
 * — producing `USE_CACHE_TIMEOUT` build failures on `/en/sports/soon`
 * ("Filling a cache during prerender timed out") that twice killed the
 * production build (2026-05-12, after the soccer re-ship enlarged the page
 * set). A first remediation attempt (drop `'use cache'`, add `await
 * connection()`) traded that for a different build error: "Uncached data was
 * accessed outside of <Suspense>". The Cache-Components-correct fix is PPR:
 * the page renders a static shell (chrome + a `<Suspense fallback={...}>`),
 * and the slow uncached fetch lives in an async child INSIDE that boundary —
 * it streams at request time instead of being prerendered at build time. A
 * module-level `'use cache'` is incompatible (a cached module can't read the
 * fresh, request-time data these pages need).
 *
 * If a future edit re-adds `'use cache'` to these page modules (or removes the
 * `<Suspense>` boundary / inlines the data fetch into the page component), the
 * build-time-timeout / uncached-outside-Suspense risk returns. This static-
 * source check is the regression detector; the production build succeeding is
 * the runtime proof.
 *
 * Pattern mirror: `sportsCacheNotFoundBoundary.test.ts` (static brace-/regex-
 * level source checks instead of running the Next prerender pipeline).
 */

const SOON_PAGE = resolve(
  __dirname,
  '..',
  '..',
  'src/app/[locale]/(platform)/sports/soon/page.tsx',
)
const LIVE_PAGE = resolve(
  __dirname,
  '..',
  '..',
  'src/app/[locale]/(platform)/sports/live/page.tsx',
)

function readSource(path: string): string {
  return readFileSync(path, 'utf8')
}

describe.each([
  ['sports/soon/page.tsx', SOON_PAGE],
  ['sports/live/page.tsx', LIVE_PAGE],
])('%s — must render heavy data inside <Suspense>, not build-time prerender', (label, path) => {
  const source = readSource(path)

  it(`${label} does NOT have a module-level 'use cache' directive`, () => {
    // A module-level directive is the first non-empty, non-comment statement
    // in the file. Reject `'use cache'` (or "use cache") as line 1-ish.
    const firstMeaningfulLine = source
      .split('\n')
      .map(l => l.trim())
      .find(l => l.length > 0 && !l.startsWith('//') && !l.startsWith('/*') && !l.startsWith('*'))
    expect(firstMeaningfulLine).not.toMatch(/^['"]use cache['"]/)
  })

  it(`${label} imports Suspense from 'react'`, () => {
    expect(source).toMatch(/import\s*\{[^}]*\bSuspense\b[^}]*\}\s*from\s*['"]react['"]/)
  })

  it(`${label} wraps a deferred child in a <Suspense> boundary with a fallback`, () => {
    expect(source).toMatch(/<Suspense\b[\s\S]*?fallback=/)
  })

  it(`${label} keeps the heavy EventRepository.listEvents call out of the default page export`, () => {
    // The fat-lateral-join must live in the async child component, not the
    // page component itself (otherwise it's prerendered at build time).
    const defaultExportIdx = source.search(/export\s+default\s+async\s+function/)
    expect(defaultExportIdx).toBeGreaterThan(-1)
    const afterDefaultExport = source.slice(defaultExportIdx)
    expect(afterDefaultExport).not.toMatch(/EventRepository\.listEvents/)
  })
})
