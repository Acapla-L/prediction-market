import type { MlbSportsMarketType } from '@/lib/polymarket/types'
import { describe, expect, it } from 'vitest'
import { makeOverlayKey, normalizeOutcomeLabel } from '@/lib/polymarket/mlb-game-overlay'

/**
 * Pure-function tests for the MLB overlay's two small normalization
 * primitives. Both run on hot paths in `buildMlbGameOverlay` /
 * `applyMlbGameOverlay`, so small mistakes here break the whole overlay
 * silently. These tests lock in current behavior.
 */

describe('normalizeOutcomeLabel — MLB-specific Polymarket→DB mapping', () => {
  it('rewrites NRFI Yes → Yes Run', () => {
    expect(normalizeOutcomeLabel('nrfi', 'Yes')).toBe('Yes Run')
  })

  it('rewrites NRFI No → No Run', () => {
    expect(normalizeOutcomeLabel('nrfi', 'No')).toBe('No Run')
  })

  it('passes moneyline team names through identity', () => {
    expect(normalizeOutcomeLabel('moneyline', 'Chicago Cubs')).toBe('Chicago Cubs')
    expect(normalizeOutcomeLabel('moneyline', 'Los Angeles Dodgers')).toBe('Los Angeles Dodgers')
  })

  it('passes spreads team names through identity (line is orthogonal)', () => {
    expect(normalizeOutcomeLabel('spreads', 'Chicago Cubs')).toBe('Chicago Cubs')
    expect(normalizeOutcomeLabel('spreads', 'Los Angeles Dodgers')).toBe('Los Angeles Dodgers')
  })

  it('passes totals Over/Under through identity', () => {
    expect(normalizeOutcomeLabel('totals', 'Over')).toBe('Over')
    expect(normalizeOutcomeLabel('totals', 'Under')).toBe('Under')
  })

  it('does NOT rewrite a "Yes" that appears on a non-NRFI market (scoped mapping)', () => {
    // Defensive: the normalization lookup is keyed by (marketType, label),
    // so a future market type that happens to use "Yes" as a label would not
    // be silently rewritten to "Yes Run". If someone refactors the lookup
    // to a flat map, this test catches the drop.
    expect(normalizeOutcomeLabel('moneyline' as MlbSportsMarketType, 'Yes')).toBe('Yes')
    expect(normalizeOutcomeLabel('totals' as MlbSportsMarketType, 'Yes')).toBe('Yes')
  })

  it('passes unknown labels through identity (no crash on future labels)', () => {
    expect(normalizeOutcomeLabel('moneyline', 'Some Future Label')).toBe('Some Future Label')
    expect(normalizeOutcomeLabel('totals', '')).toBe('')
  })
})

describe('makeOverlayKey — composite key builder', () => {
  it('returns bare "moneyline" (no line suffix)', () => {
    expect(makeOverlayKey('moneyline', null)).toBe('moneyline')
    // Even if a stray line sneaks in on moneyline, we key without it
    expect(makeOverlayKey('moneyline', 0)).toBe('moneyline')
  })

  it('returns bare "nrfi" (no line suffix)', () => {
    expect(makeOverlayKey('nrfi', null)).toBe('nrfi')
    expect(makeOverlayKey('nrfi', 0)).toBe('nrfi')
  })

  it('returns "spreads:-1.5" for spreads with line', () => {
    expect(makeOverlayKey('spreads', -1.5)).toBe('spreads:-1.5')
  })

  it('returns "spreads:-2.5" for a different spread line', () => {
    expect(makeOverlayKey('spreads', -2.5)).toBe('spreads:-2.5')
  })

  it('returns "totals:9.5" for totals with line', () => {
    expect(makeOverlayKey('totals', 9.5)).toBe('totals:9.5')
  })

  it('returns bare "spreads" when line is null (degenerate case — caller should have filtered)', () => {
    expect(makeOverlayKey('spreads', null)).toBe('spreads')
    expect(makeOverlayKey('totals', null)).toBe('totals')
  })
})
