import { describe, expect, it } from 'vitest'
import { normalizePolymarketCountry } from '@/lib/polymarket/fifa-overlay'

/**
 * Exhaustive coverage of the POLYMARKET_TO_DB map. The live curl diff on
 * 2026-04-22 found exactly ONE divergence between Polymarket's
 * `groupItemTitle` values and our DB's `markets.short_title` — the
 * `Czechia` / `Cezchia` DB typo. Every other country matches identity.
 */
describe('normalizePolymarketCountry', () => {
  it('maps Czechia to Cezchia (the single DB typo)', () => {
    expect(normalizePolymarketCountry('Czechia')).toBe('Cezchia')
  })

  it('passes Spain through unchanged', () => {
    expect(normalizePolymarketCountry('Spain')).toBe('Spain')
  })

  it('passes Turkiye through unchanged (no Türkiye variant in live Gamma data)', () => {
    expect(normalizePolymarketCountry('Turkiye')).toBe('Turkiye')
  })

  it('passes USA through unchanged (no United States variant in live Gamma data)', () => {
    expect(normalizePolymarketCountry('USA')).toBe('USA')
  })

  it('passes Bosnia-Herzegovina through unchanged (hyphenated form matches)', () => {
    expect(normalizePolymarketCountry('Bosnia-Herzegovina')).toBe('Bosnia-Herzegovina')
  })

  it('passes Curaçao through unchanged (non-ASCII ç preserved on both sides)', () => {
    expect(normalizePolymarketCountry('Curaçao')).toBe('Curaçao')
  })

  it('passes Congo DR through unchanged (no DR Congo variant in live Gamma data)', () => {
    expect(normalizePolymarketCountry('Congo DR')).toBe('Congo DR')
  })

  it('passes Ivory Coast through unchanged (no Côte d\'Ivoire variant in live Gamma data)', () => {
    expect(normalizePolymarketCountry('Ivory Coast')).toBe('Ivory Coast')
  })

  it('returns unknown names unchanged (identity fallback for any unmapped input)', () => {
    expect(normalizePolymarketCountry('Atlantis')).toBe('Atlantis')
  })

  it('is case-sensitive — lowercase czechia does not hit the map', () => {
    expect(normalizePolymarketCountry('czechia')).toBe('czechia')
  })

  it('returns empty string unchanged', () => {
    expect(normalizePolymarketCountry('')).toBe('')
  })
})
