import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

/**
 * Per-game Polymarket discovery sidecar (Phase B). Sibling to
 * `discovered_polymarket_events` (Phase A v2 futures); separate table because
 * lifecycle scopes differ (yearly future vs. ~daily game), additional fields
 * (game_start_time, league, team labels, is_archived), and per-cron cadence
 * differs.
 *
 * Populated by:
 *   - `/api/sync/polymarket-games-discovery` (per-league discovery, every
 *     hour at :13 — finds new games, archives stale ones)
 *   - `/api/sync/polymarket-games-refresh` (per-game payload refresh, every
 *     5 min for active in-window rows)
 *
 * Default-off in MVP via `POLYMARKET_GAMES_DISCOVERY_ENABLED` env var. The
 * route returns `{ disabled: true }` immediately when the flag is false; the
 * render-side dispatch returns `null` so the page falls through to 404.
 */
export const discovered_polymarket_games = pgTable(
  'discovered_polymarket_games',
  {
    slug: text().primaryKey(),
    league: text().notNull(),
    polymarket_event_id: text().notNull(),
    title: text().notNull(),
    home_team_label: text(),
    away_team_label: text(),
    game_start_time: timestamp({ withTimezone: true }).notNull(),
    is_active: boolean().notNull().default(true),
    is_closed: boolean().notNull().default(false),
    is_archived: boolean().notNull().default(false),
    end_date: timestamp({ withTimezone: true }),
    markets_payload: text().notNull(),
    last_synced_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    last_sync_status: text().notNull().default('ok'),
    last_sync_error: text(),
  },
  table => [
    // Discovery query: list active games for a league, ordered by start time
    index('discovered_polymarket_games_league_starttime_idx').on(
      table.league,
      table.game_start_time,
    ),
    // Refresh window query: rows where game_start_time BETWEEN now-2h AND now+24h, is_archived=false
    index('discovered_polymarket_games_active_window_idx').on(
      table.game_start_time,
      table.is_archived,
    ),
  ],
)
