import { describe, expect, it } from 'vitest'
import { isFeaturedCandidateEnded } from '@/app/[locale]/(platform)/home-v2/_data/fetchFeaturedFuturesData'

describe('isFeaturedCandidateEnded', () => {
  const now = Date.parse('2026-06-08T00:00:00Z')
  it('skips an event whose endDate is in the past', () => {
    expect(isFeaturedCandidateEnded('2026-05-31T00:00:00Z', now)).toBe(true)
  })
  it('keeps an event whose endDate is in the future', () => {
    expect(isFeaturedCandidateEnded('2026-07-19T00:00:00Z', now)).toBe(false)
  })
  it('keeps an open-ended (null) event', () => {
    expect(isFeaturedCandidateEnded(null, now)).toBe(false)
  })
  it('keeps an event with an unparseable endDate (defensive)', () => {
    expect(isFeaturedCandidateEnded('not-a-date', now)).toBe(false)
  })
  it('keeps an event whose endDate exactly equals now (strict past)', () => {
    expect(isFeaturedCandidateEnded('2026-06-08T00:00:00Z', now)).toBe(false)
  })
})
