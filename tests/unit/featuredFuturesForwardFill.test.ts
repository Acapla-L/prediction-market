import { describe, expect, it } from 'vitest'
import { buildForwardFilledDataPoints } from '@/app/[locale]/(platform)/home-v2/_data/fetchFeaturedFuturesData'

describe('buildForwardFilledDataPoints', () => {
  it('carries each series last-known value into every row (no per-series gaps)', () => {
    const lookups = [
      { key: 'A', map: new Map<number, number>([[100, 10], [102, 12], [104, 14]]) },
      { key: 'B', map: new Map<number, number>([[101, 80], [103, 78], [105, 76]]) },
    ]
    const timestamps = [100, 101, 102, 103, 104, 105]
    const rows = buildForwardFilledDataPoints(lookups, timestamps)

    expect(rows).toHaveLength(6)
    expect(rows[0]).toMatchObject({ A: 10 })
    expect(rows[0].B).toBeUndefined()
    for (let i = 1; i < rows.length; i += 1) {
      expect(typeof rows[i].A).toBe('number')
      expect(typeof rows[i].B).toBe('number')
    }
    expect(rows[2]).toMatchObject({ A: 12, B: 80 })
    expect(rows[5]).toMatchObject({ A: 14, B: 76 })
  })

  it('emits no row before any series has a sample', () => {
    const lookups = [{ key: 'A', map: new Map<number, number>([[200, 5]]) }]
    const rows = buildForwardFilledDataPoints(lookups, [200])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ A: 5 })
  })
})
