/**
 * PR #22 B4 drift-lock — `[runQuery] DB query failed: Error: Event not found` spam.
 *
 * `src/lib/db/queries/event.ts` previously had 9 `throw new Error('Event not
 * found')` sites inside `runQuery` blocks. The runQuery wrapper at
 * `src/lib/db/utils/run-query.ts:14` catches every throw and emits
 * `console.error('[runQuery] DB query failed:', e)` before returning the
 * generic `DEFAULT_ERROR_MESSAGE` sentinel.
 *
 * With Phase A v2 (futures) and Phase B (per-game) discovery sidecars, a slug
 * not being in the Kuest `events` table is EXPECTED for discovery slugs — the
 * calling code falls through to the discovery branch and the page renders
 * fine. The throws were pure log noise (~16 entries / 15 min observed in
 * Vercel runtime logs) that obscured real DB errors.
 *
 * PR #22 B4-a converts the 9 throws into sentinel returns
 * `{ data: null, error: 'Event not found.' }` — matching the pre-existing
 * pattern at lines 2323/2354/2396. This test asserts the contract:
 *  - `console.error` is NOT called on a missing-event path
 *  - the return shape is the explicit sentinel (not the generic
 *    DEFAULT_ERROR_MESSAGE), so the API route at
 *    `api/events/[slug]/market-metadata/route.ts` can distinguish 404 from 500
 *
 * Static-source brace-walking style: assert the file has 0 throws-on-not-found
 * and ≥12 sentinel returns (3 pre-existing + 9 converted).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const EVENT_QUERIES_PATH = resolve(__dirname, '../../src/lib/db/queries/event.ts')
const source = readFileSync(EVENT_QUERIES_PATH, 'utf8')

describe('EventRepository — sentinel returns for missing events (PR #22 B4)', () => {
  it("has zero `throw new Error('Event not found')` sites — all converted to sentinels", () => {
    const matches = source.match(/throw new Error\('Event not found'\)/g) ?? []
    expect(matches.length).toBe(0)
  })

  it('has at least 12 sentinel `Event not found.` returns (3 pre-existing + 9 converted)', () => {
    const matches = source.match(/return \{ data: null, error: 'Event not found\.' \}/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(12)
  })

  it('all sentinel returns use the canonical message exactly (no message drift)', () => {
    // Catch typos like 'event not found' / 'Event not found' / 'Event not found.' inconsistency.
    const canonical = source.match(/return \{ data: null, error: 'Event not found\.' \}/g) ?? []
    const variants = source.match(/error:\s*'[Ee]vent not found[^']*'/g) ?? []
    expect(variants.length).toBe(canonical.length)
  })

  it('preserves the runQuery wrapper invariant — every Event-not-found return is inside a runQuery block', () => {
    // Sentinel returns sit lexically AFTER an opening `runQuery(async () => {` and BEFORE its closing `})`.
    // Crude but durable static check: every sentinel line must follow `runQuery(` somewhere upstream.
    const lines = source.split('\n')
    const sentinelLines: number[] = []
    lines.forEach((line, idx) => {
      if (line.includes("return { data: null, error: 'Event not found.' }")) {
        sentinelLines.push(idx)
      }
    })
    expect(sentinelLines.length).toBeGreaterThanOrEqual(12)
    for (const sentinelLine of sentinelLines) {
      // Walk back to the nearest `runQuery(async`; assert it exists within the file above this line.
      let foundRunQuery = false
      for (let i = sentinelLine - 1; i >= 0; i--) {
        if (lines[i]!.includes('runQuery(async')) {
          foundRunQuery = true
          break
        }
      }
      expect(foundRunQuery).toBe(true)
    }
  })
})

describe('runQuery wrapper — `console.error` invariant (PR #22 B4)', () => {
  it('logs to console.error on uncaught throws, NOT on graceful sentinel returns', async () => {
    // Functional contract check on the wrapper itself.
    const { runQuery } = await import('@/lib/db/utils/run-query')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      // 1. Sentinel return — should NOT log.
      const sentinelResult = await runQuery(async () => ({ data: null, error: 'Event not found.' }))
      expect(sentinelResult).toEqual({ data: null, error: 'Event not found.' })
      expect(consoleSpy).not.toHaveBeenCalled()

      // 2. Throw — DOES log (preserved diagnostic behavior).
      const throwResult = await runQuery(async () => {
        throw new Error('Real DB error')
      })
      expect(throwResult.data).toBeNull()
      expect(throwResult.error).toBeDefined()
      expect(consoleSpy).toHaveBeenCalled()
    }
    finally {
      consoleSpy.mockRestore()
    }
  })
})

