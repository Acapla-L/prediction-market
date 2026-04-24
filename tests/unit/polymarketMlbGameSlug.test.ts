import { describe, expect, it } from 'vitest'
import { isMlbGameSlug, MLB_GAME_SLUGS } from '@/lib/polymarket/constants'

/**
 * Bootstrap + scope-lock guard for the MLB_GAME_SLUGS allowlist.
 *
 * The Phase 2 scope is "FIFA byte-for-byte unchanged + exactly one MLB game
 * live, nothing else". If a future session accidentally adds an extra slug
 * to MLB_GAME_SLUGS, this test notices — intentional adds must update both
 * the constant AND this test's expected set.
 */

describe('mLB_GAME_SLUGS + isMlbGameSlug — scope-lock bootstrap', () => {
  it('is a Set (readonly membership)', () => {
    expect(MLB_GAME_SLUGS).toBeInstanceOf(Set)
  })

  it('contains the pilot slug mlb-chc-lad-2026-04-24', () => {
    expect(MLB_GAME_SLUGS.has('mlb-chc-lad-2026-04-24')).toBe(true)
    expect(isMlbGameSlug('mlb-chc-lad-2026-04-24')).toBe(true)
  })

  it('has exactly 1 entry (pilot scope — extend deliberately)', () => {
    expect(MLB_GAME_SLUGS.size).toBe(1)
  })

  it('does NOT include the expired reference slug mlb-atl-laa-2026-04-07', () => {
    expect(MLB_GAME_SLUGS.has('mlb-atl-laa-2026-04-07')).toBe(false)
    expect(isMlbGameSlug('mlb-atl-laa-2026-04-07')).toBe(false)
  })

  it('does NOT include the backup pilot slug mlb-det-cin-2026-04-24', () => {
    // Intentional: we researched this as a backup option but only activated
    // CHC-LAD for Phase 2. Adding DET-CIN must be a deliberate code change.
    expect(MLB_GAME_SLUGS.has('mlb-det-cin-2026-04-24')).toBe(false)
  })

  it('does NOT include the FIFA slug (different module, different code path)', () => {
    expect(MLB_GAME_SLUGS.has('2026-fifa-world-cup-winner-595')).toBe(false)
  })

  it('rejects arbitrary strings', () => {
    expect(isMlbGameSlug('')).toBe(false)
    expect(isMlbGameSlug('random-event')).toBe(false)
    expect(isMlbGameSlug('mlb-')).toBe(false)
    expect(isMlbGameSlug('nba-bos-phi-2026-04-24')).toBe(false)
  })
})
