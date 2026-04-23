import type { FifaOverlayMarket, FifaOverlayResult } from '@/lib/polymarket/types'
import type { Outcome } from '@/types'
import { describe, expect, it } from 'vitest'
import {
  FIFA_EVENT_SLUG,
  POLYMARKET_CLOB_BASE_DEFAULT,
  POLYMARKET_GAMMA_BASE_DEFAULT,
} from '@/lib/polymarket/constants'

describe('polymarket module bootstrap (constants + types)', () => {
  it('fIFA_EVENT_SLUG matches the live production event slug', () => {
    expect(FIFA_EVENT_SLUG).toBe('2026-fifa-world-cup-winner-595')
  })

  it('pOLYMARKET_GAMMA_BASE_DEFAULT points at the Gamma API root', () => {
    expect(POLYMARKET_GAMMA_BASE_DEFAULT).toBe('https://gamma-api.polymarket.com')
  })

  it('pOLYMARKET_CLOB_BASE_DEFAULT points at the CLOB API root', () => {
    expect(POLYMARKET_CLOB_BASE_DEFAULT).toBe('https://clob.polymarket.com')
  })

  it('fifaOverlayMarket accepts the shape the loader stitches onto each market', () => {
    const sample: FifaOverlayMarket = {
      country: 'Spain',
      yesPrice: 0.16,
      noPrice: 0.84,
      volume: 12345,
      closed: false,
      yesTokenId: 'polymarket-yes-token',
      noTokenId: 'polymarket-no-token',
    }
    expect(sample.country).toBe('Spain')
    expect(sample.yesPrice).toBe(0.16)
  })

  it('fifaOverlayResult carries marketsByCountry + stale + lastUpdatedAt', () => {
    const sample: FifaOverlayResult = {
      marketsByCountry: {},
      stale: false,
      lastUpdatedAt: new Date('2026-04-22T00:00:00Z'),
    }
    expect(sample.stale).toBe(false)
    expect(sample.lastUpdatedAt.toISOString()).toBe('2026-04-22T00:00:00.000Z')
  })

  it('outcome accepts optional polymarket_token_id without losing any existing field (Revision 1 regression guard)', () => {
    // Revision 1 of the plan: polymarket_token_id lives ALONGSIDE token_id, not
    // in place of it. If a future edit accidentally replaces token_id or drops
    // polymarket_token_id, this test fails at compile time and at runtime.
    const out: Outcome = {
      condition_id: 'cond-1',
      outcome_text: 'Yes',
      outcome_index: 0,
      token_id: 'kuest-token-preserved',
      polymarket_token_id: 'polymarket-token-added',
      is_winning_outcome: false,
      created_at: '2026-04-22T00:00:00Z',
      updated_at: '2026-04-22T00:00:00Z',
    }
    expect(out.token_id).toBe('kuest-token-preserved')
    expect(out.polymarket_token_id).toBe('polymarket-token-added')
  })

  it('outcome still typechecks without polymarket_token_id (the field is optional)', () => {
    const out: Outcome = {
      condition_id: 'cond-2',
      outcome_text: 'No',
      outcome_index: 1,
      token_id: 'kuest-only',
      is_winning_outcome: false,
      created_at: '2026-04-22T00:00:00Z',
      updated_at: '2026-04-22T00:00:00Z',
    }
    expect(out.polymarket_token_id).toBeUndefined()
  })
})
