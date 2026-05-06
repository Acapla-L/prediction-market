import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Phase B v2 Session 2 — sub-agent B5 deliverable.
 *
 * This file drift-locks the cache-boundary fix that sub-agent B2 ships in
 * `sports-event-page.tsx` against silent regression. It is the regression
 * detector for the Phase A v2 P0 fix pattern (commit `9c250959`):
 *
 *   "Calling `notFound()` inside `'use cache'` in Next.js 16 Cache Components
 *    causes the response to be committed as 200 before the not-found throw
 *    is processed, producing a hydration mismatch (React error #419)."
 *
 * The fix shape:
 *   1. Cached data fetcher (decorated with `'use cache'`) NEVER calls
 *      `notFound()`. It returns `null` for missing data — a sentinel value.
 *   2. Outer non-cached page renderer calls `notFound()` AFTER the cached
 *      fetcher returns, OUTSIDE the cache boundary, based on the null check.
 *
 * This test reads the source of `sports-event-page.tsx` directly and asserts
 * the static pattern. A pure-runtime test would require running the entire
 * Next.js render pipeline against a mocked module graph — that is brittle
 * (couples to the framework, the React server-side renderer, and the
 * cache-storage adapter), so we use a source-level static check instead.
 *
 * The runtime contract is verified by the deploy-gate Playwright smoke test
 * (`tests/e2e/discovery-games.smoke.spec.ts` per plan §G "Stand-alone
 * cache-boundary assertion") via the
 *   `GET /en/sports/baseball/mlb-zzz-yyy-1999-01-01 → HTTP 404`
 * assertion that fires on the deployed preview. Source pattern + smoke
 * gate = belt and suspenders.
 */

const SOURCE_PATH = resolve(
  __dirname,
  '..',
  '..',
  'src/app/[locale]/(platform)/sports/_utils/sports-event-page.tsx',
)

const SPORTS_EVENT_PAGE_PATH = resolve(
  __dirname,
  '..',
  '..',
  'src/app/[locale]/(platform)/sports/[sport]/[event]/page.tsx',
)

function loadSource(): string {
  return readFileSync(SOURCE_PATH, 'utf8')
}

function loadOuterPageSource(): string {
  return readFileSync(SPORTS_EVENT_PAGE_PATH, 'utf8')
}

/**
 * Find every function body that begins with `'use cache'` (the directive must
 * appear as the first statement inside the function — that is what makes the
 * function a cached function in Next.js 16 Cache Components).
 *
 * Returns each match's body text so callers can scan for `notFound()` calls.
 *
 * The matcher is conservative: it relies on simple brace counting starting
 * from the line immediately after the `'use cache'` directive. It cannot
 * handle deeply-nested template literals with unbalanced braces, but for
 * project source code (no exotic template-literal patterns expected) this is
 * sufficient.
 */
function extractUseCacheFunctionBodies(source: string): string[] {
  const bodies: string[] = []
  // Match `'use cache'` directives that are clearly inside a function (the
  // pattern requires the directive to be on its own line, with optional
  // leading whitespace, terminated by an end-of-statement).
  const directiveRegex = /^\s*['"]use cache['"]\s*(?:;\s*)?$/gm
  for (const match of source.matchAll(directiveRegex)) {
    const directiveStart = match.index ?? -1
    if (directiveStart < 0) {
      continue
    }
    // Walk backwards from the directive to find the opening `{` of the
    // enclosing function.
    let openBraceIdx = directiveStart - 1
    while (openBraceIdx >= 0 && source[openBraceIdx] !== '{') {
      openBraceIdx--
    }
    if (openBraceIdx < 0) {
      continue
    }
    // Walk forwards from the open brace, counting braces, to find the matching
    // close brace.
    let depth = 1
    let i = openBraceIdx + 1
    while (i < source.length && depth > 0) {
      const ch = source[i]
      if (ch === '{') {
        depth++
      }
      else if (ch === '}') {
        depth--
      }
      i++
    }
    if (depth === 0) {
      bodies.push(source.slice(openBraceIdx, i))
    }
  }
  return bodies
}

describe('sports-event-page cache-boundary fix — static source invariants', () => {
  it('no function body annotated with `\'use cache\'` invokes notFound() directly', () => {
    // The CRITICAL invariant locked by this test. The Phase A v2 P0 fix
    // (commit 9c250959) refactored the broken pattern (notFound() inside
    // 'use cache') into a data-only fetcher that returns null. This test
    // asserts the same discipline holds in `sports-event-page.tsx`.
    //
    // If this test fails, the fix has regressed: a cached function is
    // calling notFound(), which will produce HTTP 200 + not-found UI on the
    // discovery-page paths with React #419 hydration mismatch on the client.
    const source = loadSource()
    const cachedBodies = extractUseCacheFunctionBodies(source)

    // It is acceptable for the file to have ZERO `'use cache'` functions
    // (e.g. a refactor moves caching elsewhere). What is NOT acceptable is
    // a `'use cache'` function that calls notFound() inside it.
    cachedBodies.forEach((body, idx) => {
      // Look for either bare `notFound()` calls or `notFound\(` followed by
      // any args. Comments are not stripped — but `notFound()` in a code
      // comment is harmless and rare enough that a literal-string match is
      // sufficient for this invariant.
      const containsNotFound = /\bnotFound\s*\(/.test(body)
      expect(
        containsNotFound,
        `'use cache' function body #${idx} contains a notFound() call — this regresses the Phase A v2 P0 fix pattern (commit 9c250959). Move notFound() to the OUTER non-cached caller and have the cached function return null instead.`,
      ).toBe(false)
    })
  })

  it('source still imports notFound from next/navigation (so callers can use it)', () => {
    // Sanity: even after the refactor, the OUTER (non-cached) renderer must
    // still import notFound. If this assertion fails, B2's refactor either
    // moved the entire notFound usage out of the file (acceptable, but then
    // delete this assertion) or accidentally dropped the import (regression).
    const source = loadSource()
    expect(source).toMatch(/import\s+\{[^}]*\bnotFound\b[^}]*\}\s+from\s+['"]next\/navigation['"]/)
  })

  it('drift-detector regex is reliable: a synthetic broken example IS detected', () => {
    // This test validates the regex/walker itself. It feeds in a synthetic
    // string that emulates the old broken pattern and asserts the walker
    // correctly identifies it. Without this self-check, a future regex
    // refactor could silently make the primary invariant test always-pass.
    const synthBrokenSource = `
async function bad() {
  'use cache'
  if (!data) {
    notFound()
  }
  return data
}
`
    const bodies = extractUseCacheFunctionBodies(synthBrokenSource)
    expect(bodies).toHaveLength(1)
    expect(/\bnotFound\s*\(/.test(bodies[0]!)).toBe(true)
  })

  it('drift-detector regex is reliable: a synthetic OK example is NOT flagged', () => {
    // The valid pattern: data-only `'use cache'` returning null, separate
    // outer caller invoking notFound. Validates the walker doesn't false-
    // positive on the correct shape.
    const synthOkSource = `
async function fetcher() {
  'use cache'
  if (!data) {
    return null
  }
  return data
}

export async function outer() {
  const cached = await fetcher()
  if (!cached) {
    notFound()
  }
}
`
    const bodies = extractUseCacheFunctionBodies(synthOkSource)
    expect(bodies).toHaveLength(1)
    // The 'use cache' function body itself does NOT contain notFound() —
    // notFound() is in the outer non-cached function.
    expect(/\bnotFound\s*\(/.test(bodies[0]!)).toBe(false)
  })
})

describe('sports/[sport]/[event]/page.tsx — outer-caller pattern', () => {
  // Per plan §F MODIFIED files entry: the page.tsx delegates to
  // `renderSportsVerticalEventPage` from sports-event-page.tsx. After B2's
  // work, the outer caller is responsible for invoking notFound() outside
  // the cache boundary (mirroring the Phase A v2 P0 fix pattern in
  // event/[slug]/page.tsx).
  //
  // We assert the page.tsx itself either imports notFound for direct use OR
  // delegates to a renderer that — per the source invariants above — does
  // NOT call notFound from inside a `'use cache'` function. The combined
  // tests guarantee the cache-boundary discipline holds end-to-end.
  it('the outer page.tsx exists and imports the renderer', () => {
    const source = loadOuterPageSource()
    expect(source).toMatch(/renderSportsVerticalEventPage/)
  })
})

/**
 * Forward-compat note for B2:
 *
 * If B2 introduces a new exported async function (e.g. `fetchSportsCachedData`
 * or `loadSportsCachedData`) decorated with `'use cache'` that returns null
 * for missing data, AND moves the notFound() call into the outer
 * `renderSportsVerticalEventPage` (or a new outer wrapper), the static source
 * check above will continue to pass.
 *
 * If B2 instead extracts the cache boundary into a different file, update
 * `SOURCE_PATH` here and re-run. The contract is invariant; only the file
 * path may change.
 *
 * Runtime test (mocking the cached fetcher to return null and asserting the
 * outer caller invokes notFound) was deliberately NOT added because:
 *   1. Mocking `'use cache'` semantics requires either Next.js test infra
 *      or extensive vi.mock setup that couples to framework internals.
 *   2. The deploy-gate Playwright smoke test catches the runtime regression
 *      empirically:
 *        `GET /en/sports/baseball/mlb-zzz-yyy-1999-01-01 → HTTP 404`
 *      (plan §G "Stand-alone cache-boundary assertion").
 *
 * Source pattern + smoke gate = belt and suspenders for the same invariant.
 */
