import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTimeRangeFilters } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'

// Fixed reference time: 2026-05-03T23:00:00Z. The fix landed on this date in
// response to the FIFA chart returning 100% 502s once the event aged past
// Polymarket's 14-day [startTs, endTs] limit.
const NOW_MS = Date.UTC(2026, 4, 3, 23, 0, 0)
const DAY_SECONDS = 24 * 60 * 60

function isoDaysBeforeNow(days: number): string {
  return new Date(NOW_MS - days * DAY_SECONDS * 1000).toISOString()
}

describe('buildTimeRangeFilters — Polymarket 14-day span guard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_MS))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('range=ALL', () => {
    it('span=7 days → includes endTs (under the 14-day limit)', () => {
      const filters = buildTimeRangeFilters('ALL', isoDaysBeforeNow(7))
      expect(filters.startTs).toBeDefined()
      expect(filters.endTs).toBeDefined()
      expect(filters.fidelity).toBeDefined()
      expect(filters.interval).toBeUndefined()
    })

    it('span=14 days exactly → includes endTs (boundary: <= is allowed)', () => {
      const filters = buildTimeRangeFilters('ALL', isoDaysBeforeNow(14))
      expect(filters.startTs).toBeDefined()
      expect(filters.endTs).toBeDefined()
    })

    it('span=15 days → omits endTs (Polymarket would reject this window)', () => {
      const filters = buildTimeRangeFilters('ALL', isoDaysBeforeNow(15))
      expect(filters.startTs).toBeDefined()
      expect(filters.endTs).toBeUndefined()
      expect(filters.fidelity).toBeDefined()
    })

    it('span=18 days (FIFA at the time of regression) → omits endTs', () => {
      // FIFA event was created 2026-04-15 21:13 UTC. 2026-05-03 → 18-day span.
      // Direct curl proved Polymarket returns 400 for this window with endTs;
      // omitting endTs returns 200 with full history.
      const filters = buildTimeRangeFilters('ALL', isoDaysBeforeNow(18))
      expect(filters.startTs).toBeDefined()
      expect(filters.endTs).toBeUndefined()
    })

    it('span=90 days → still omits endTs (no upper limit on the omit branch)', () => {
      const filters = buildTimeRangeFilters('ALL', isoDaysBeforeNow(90))
      expect(filters.startTs).toBeDefined()
      expect(filters.endTs).toBeUndefined()
    })

    it('span=18 days WITH resolved anchor → still routes through ALL branch and omits endTs', () => {
      // range='ALL' fires path 1 regardless of hasResolvedAnchor. This pins
      // down the resolved-ALL combination explicitly; without it, a future
      // refactor that moved resolved-ALL into path 3 could silently change
      // behavior.
      const filters = buildTimeRangeFilters(
        'ALL',
        isoDaysBeforeNow(18),
        new Date(NOW_MS).toISOString(),
      )
      expect(filters.startTs).toBeDefined()
      expect(filters.endTs).toBeUndefined()
    })
  })

  describe('range=1M (long-range, no resolved anchor)', () => {
    it('span=5 days (younger than the 1M window) → includes endTs', () => {
      const filters = buildTimeRangeFilters('1M', isoDaysBeforeNow(5))
      expect(filters.startTs).toBeDefined()
      expect(filters.endTs).toBeDefined()
    })

    it('span=18 days (younger than 1M window but older than 14-day limit) → omits endTs', () => {
      const filters = buildTimeRangeFilters('1M', isoDaysBeforeNow(18))
      expect(filters.startTs).toBeDefined()
      expect(filters.endTs).toBeUndefined()
    })

    it('span=40 days (older than 1M window) → falls through to interval-only filters', () => {
      // When ageSeconds >= windowSeconds, the no-anchor branch returns
      // {fidelity, interval} without startTs/endTs at all. This path is
      // unaffected by the span guard but is worth pinning down to prevent
      // regression.
      const filters = buildTimeRangeFilters('1M', isoDaysBeforeNow(40))
      expect(filters.interval).toBe('1m')
      expect(filters.startTs).toBeUndefined()
      expect(filters.endTs).toBeUndefined()
    })
  })

  describe('range=1M (resolved anchor)', () => {
    it('span=5 days resolved → includes endTs', () => {
      const filters = buildTimeRangeFilters(
        '1M',
        isoDaysBeforeNow(5),
        new Date(NOW_MS).toISOString(),
      )
      expect(filters.startTs).toBeDefined()
      expect(filters.endTs).toBeDefined()
    })

    it('span=18 days resolved → omits endTs (the ~14-day window still applies on the resolved branch)', () => {
      const filters = buildTimeRangeFilters(
        '1M',
        isoDaysBeforeNow(18),
        new Date(NOW_MS).toISOString(),
      )
      expect(filters.startTs).toBeDefined()
      expect(filters.endTs).toBeUndefined()
    })

    it('span=40 days resolved → omits endTs (window clamped to 1M = 30d > 14d)', () => {
      const filters = buildTimeRangeFilters(
        '1M',
        isoDaysBeforeNow(40),
        new Date(NOW_MS).toISOString(),
      )
      expect(filters.startTs).toBeDefined()
      expect(filters.endTs).toBeUndefined()
    })
  })

  describe('short ranges (no startTs/endTs path)', () => {
    it('range=1H, span=18 days → uses interval, no startTs/endTs (regression guard)', () => {
      const filters = buildTimeRangeFilters('1H', isoDaysBeforeNow(18))
      expect(filters.interval).toBe('1h')
      expect(filters.startTs).toBeUndefined()
      expect(filters.endTs).toBeUndefined()
    })

    it('range=6H, span=18 days → uses interval, no startTs/endTs', () => {
      const filters = buildTimeRangeFilters('6H', isoDaysBeforeNow(18))
      expect(filters.interval).toBe('6h')
      expect(filters.startTs).toBeUndefined()
      expect(filters.endTs).toBeUndefined()
    })
  })
})
