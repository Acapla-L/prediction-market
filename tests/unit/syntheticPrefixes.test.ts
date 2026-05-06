import { describe, expect, it } from 'vitest'
import {
  isSyntheticConditionId,
  SYNTHETIC_CONDITION_PREFIXES,
} from '@/lib/polymarket/synthetic-prefixes'

describe('synthetic condition_id prefix recognition', () => {
  it('lists exactly two synthetic prefixes (Phase A v2 + Phase B)', () => {
    expect([...SYNTHETIC_CONDITION_PREFIXES]).toEqual([
      'polymarket-discovered:',
      'polymarket-discovered-game:',
    ])
  })

  it('recognizes Phase A v2 futures synthetic IDs', () => {
    expect(isSyntheticConditionId('polymarket-discovered:2026-nba-champion:lakers-nba')).toBe(true)
    expect(isSyntheticConditionId('polymarket-discovered:uefa-champions-league-winner:arsenal-mkt')).toBe(true)
  })

  it('recognizes Phase B per-game synthetic IDs', () => {
    expect(isSyntheticConditionId('polymarket-discovered-game:mlb-tex-nyy-2026-05-05:moneyline')).toBe(true)
    expect(isSyntheticConditionId('polymarket-discovered-game:mlb-cin-chc-2026-05-05:moneyline')).toBe(true)
  })

  it('rejects non-synthetic condition IDs (Kuest hex/ULID)', () => {
    expect(isSyntheticConditionId('0x11e9a09023ace3097de216497c6fc01a57a57d63df7370543f288b40251dda00')).toBe(false)
    expect(isSyntheticConditionId('01KQ0K7H3XVZSBQERZ8K40JQWF')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isSyntheticConditionId('')).toBe(false)
  })

  it('rejects strings that contain the prefix elsewhere but do not start with it', () => {
    expect(isSyntheticConditionId('xpolymarket-discovered:foo')).toBe(false)
    expect(isSyntheticConditionId('foo-polymarket-discovered:bar')).toBe(false)
  })

  it('rejects partial matches (Phase A v2 prefix is NOT a prefix of Phase B IDs)', () => {
    // 'polymarket-discovered-game:' has '-' at position 21, while 'polymarket-discovered:' has ':'
    // Phase A v2 prefix MUST NOT incorrectly match Phase B IDs (the second prefix in the list catches them).
    const phaseBId = 'polymarket-discovered-game:mlb-tex-nyy-2026-05-05:moneyline'
    expect(phaseBId.startsWith('polymarket-discovered:')).toBe(false)
    // But the helper still returns true because the SECOND prefix matches:
    expect(isSyntheticConditionId(phaseBId)).toBe(true)
  })
})
