import {
  boolean,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

export const discovered_polymarket_events = pgTable(
  'discovered_polymarket_events',
  {
    slug: text().primaryKey(),
    polymarket_event_id: text().notNull(),
    title: text().notNull(),
    is_active: boolean().notNull().default(true),
    end_date: timestamp({ withTimezone: true }),
    markets_payload: text().notNull(),
    last_synced_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    last_sync_status: text().notNull().default('ok'),
    last_sync_error: text(),
  },
)
