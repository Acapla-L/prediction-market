import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

/**
 * Per-league team metadata cache (Phase B v2 sports template).
 *
 * Populated by `/api/sync/polymarket-teams` (per-league hourly at :17 — fetches
 * `https://gamma-api.polymarket.com/teams?league={leagueSlug}&limit=50`).
 * Looked up by abbreviation parsed from per-game slug
 * (e.g. `mlb-tor-tb-2026-05-06` → `away='tor'`, `home='tb'`).
 *
 * Primary key is `(league, abbreviation)` because abbreviation is the lookup
 * key; `team_id` is stored as auxiliary metadata (numeric id from Polymarket
 * Gamma response, kept as TEXT for forward-compat).
 */
export const teams_cache = pgTable(
  'teams_cache',
  {
    league: text().notNull(),
    team_id: text().notNull(),
    name: text().notNull(),
    alias: text(),
    abbreviation: text().notNull(),
    logo_url: text(),
    color: text(),
    record: text(),
    last_synced_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    last_sync_status: text().notNull().default('ok'),
    last_sync_error: text(),
  },
  table => [
    primaryKey({ columns: [table.league, table.abbreviation] }),
    index('teams_cache_league_idx').on(table.league),
  ],
)
