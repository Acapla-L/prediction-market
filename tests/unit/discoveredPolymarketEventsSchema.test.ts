import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { discovered_polymarket_events } from '@/lib/db/schema'

const MIGRATION_PATH = resolve(
  __dirname,
  '..',
  '..',
  'src/lib/db/migrations/2026_05_04_001_discovered_polymarket_events.sql',
)

describe('discovered_polymarket_events schema', () => {
  it('declares exactly the expected columns', () => {
    const { columns } = getTableConfig(discovered_polymarket_events)
    const names = columns.map(c => c.name).sort()

    expect(names).toEqual([
      'end_date',
      'is_active',
      'last_sync_error',
      'last_sync_status',
      'last_synced_at',
      'markets_payload',
      'polymarket_event_id',
      'slug',
      'title',
    ])
  })

  it('uses slug as the primary key', () => {
    const { columns } = getTableConfig(discovered_polymarket_events)
    const slug = columns.find(c => c.name === 'slug')
    expect(slug?.primary).toBe(true)
  })

  it('marks the right columns as NOT NULL', () => {
    const { columns } = getTableConfig(discovered_polymarket_events)
    const notNullByName = Object.fromEntries(columns.map(c => [c.name, c.notNull]))

    expect(notNullByName.slug).toBe(true)
    expect(notNullByName.polymarket_event_id).toBe(true)
    expect(notNullByName.title).toBe(true)
    expect(notNullByName.is_active).toBe(true)
    expect(notNullByName.markets_payload).toBe(true)
    expect(notNullByName.last_synced_at).toBe(true)
    expect(notNullByName.last_sync_status).toBe(true)

    expect(notNullByName.end_date).toBe(false)
    expect(notNullByName.last_sync_error).toBe(false)
  })

  it('targets the discovered_polymarket_events relation', () => {
    const { name } = getTableConfig(discovered_polymarket_events)
    expect(name).toBe('discovered_polymarket_events')
  })
})

describe('discovered_polymarket_events migration', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8')

  it('creates the table idempotently', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS discovered_polymarket_events/)
  })

  it('declares slug as the primary key', () => {
    expect(sql).toMatch(/slug\s+TEXT\s+PRIMARY KEY/)
  })

  it('enables row-level security and a service_role policy', () => {
    expect(sql).toMatch(/ALTER TABLE discovered_polymarket_events\s+ENABLE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/CREATE POLICY "service_role_all_discovered_polymarket_events"/)
    expect(sql).toMatch(/TO "service_role"/)
  })

  it('declares every schema column in the DDL', () => {
    for (const column of [
      'slug',
      'polymarket_event_id',
      'title',
      'is_active',
      'end_date',
      'markets_payload',
      'last_synced_at',
      'last_sync_status',
      'last_sync_error',
    ]) {
      expect(sql).toContain(column)
    }
  })
})
