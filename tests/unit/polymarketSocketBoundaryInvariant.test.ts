import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PROVIDER = join(__dirname, '..', '..', 'src/app/[locale]/(platform)/event/[slug]/_components/PolymarketSocketProvider.tsx')
const CACHE = join(__dirname, '..', '..', 'src/app/[locale]/(platform)/event/[slug]/_utils/polymarketMarketCache.ts')

const SERVER_ONLY_IMPORT = /import\s+['"]server-only['"]|from\s+['"]server-only['"]|from\s+['"]next\/cache['"]|from\s+['"]@\/lib\/drizzle['"]|from\s+['"]@\/lib\/db/

describe('polymarket socket cache-boundary invariants', () => {
  it('provider is a client component', () => {
    expect(readFileSync(PROVIDER, 'utf8').startsWith('\'use client\'')).toBe(true)
  })

  it('mapping subscribes off polymarket_token_id (not token_id) for semantic correctness', () => {
    expect(readFileSync(CACHE, 'utf8')).toMatch(/polymarket_token_id/)
  })

  it('the pure cache module imports nothing server-only / next-cache / drizzle / db', () => {
    expect(readFileSync(CACHE, 'utf8')).not.toMatch(SERVER_ONLY_IMPORT)
  })

  it('the client provider imports nothing server-only / next-cache / drizzle / db', () => {
    expect(readFileSync(PROVIDER, 'utf8')).not.toMatch(SERVER_ONLY_IMPORT)
  })
})
