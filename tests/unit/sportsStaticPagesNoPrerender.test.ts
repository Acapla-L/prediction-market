import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Drift-lock: the static-route (`[locale]`-only) sports pages that fetch the
 * heavy `EventRepository.listEvents` fat-lateral-join — `/sports/soon` and
 * `/sports/live` — MUST opt out of build-time static prerendering via
 * `await connection()` (from `next/server`) and MUST NOT carry a module-level
 * `'use cache'` directive.
 *
 * Why: under Next.js 16's parallel 400+-page static-gen pass, that query
 * repeatedly failed to fill within the build-time prerender cache-fill timeout
 * — producing `USE_CACHE_TIMEOUT` build failures on `/en/sports/soon`
 * ("Filling a cache during prerender timed out") that twice killed the
 * production build (2026-05-12, after the soccer re-ship enlarged the page
 * set). `connection()` is the documented Cache-Components way to force a route
 * to render on-demand at request time (CLAUDE.md "Cache Components forbids
 * route segment configs … To force dynamic behavior, call `await connection()`
 * from `next/server` inside the handler/page") — and it's incompatible with a
 * module-level `'use cache'` (a cached module can't read dynamic data).
 *
 * If a future edit re-adds `'use cache'` to these page modules (or drops the
 * `connection()` call), the build-time-timeout risk returns. This static-source
 * check is the regression detector; the production build succeeding is the
 * runtime proof.
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
])('%s — must render on-demand, not build-time prerender', (label, path) => {
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

  it(`${label} imports connection from 'next/server'`, () => {
    expect(source).toMatch(/import\s*\{[^}]*\bconnection\b[^}]*\}\s*from\s*['"]next\/server['"]/)
  })

  it(`${label} calls 'await connection()' in the default page export`, () => {
    expect(source).toMatch(/await\s+connection\s*\(\s*\)/)
  })
})
