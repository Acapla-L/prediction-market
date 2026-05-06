-- ===========================================
-- Discovered Polymarket per-game sidecar (Phase B)
-- Populated by /api/sync/polymarket-games-discovery (per-league hourly) and
-- /api/sync/polymarket-games-refresh (per-game 5-min for active in-window).
-- Sibling to discovered_polymarket_events (Phase A v2 futures); separate
-- table because lifecycle differs and additional fields are needed.
-- Default-off via POLYMARKET_GAMES_DISCOVERY_ENABLED env var.
-- ===========================================

CREATE TABLE IF NOT EXISTS discovered_polymarket_games (
  slug TEXT PRIMARY KEY,
  league TEXT NOT NULL,
  polymarket_event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  home_team_label TEXT,
  away_team_label TEXT,
  game_start_time TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  end_date TIMESTAMPTZ,
  markets_payload TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_status TEXT NOT NULL DEFAULT 'ok',
  last_sync_error TEXT
);

-- Discovery query: list active games for a league, ordered by start time
CREATE INDEX IF NOT EXISTS discovered_polymarket_games_league_starttime_idx
  ON discovered_polymarket_games (league, game_start_time);

-- Refresh-window query: rows where game_start_time is within +/- relevant
-- window AND is_archived = false. Index on (game_start_time, is_archived)
-- covers the common scan; PostgreSQL uses the leading column for range scans.
CREATE INDEX IF NOT EXISTS discovered_polymarket_games_active_window_idx
  ON discovered_polymarket_games (game_start_time, is_archived);

ALTER TABLE discovered_polymarket_games
  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_discovered_polymarket_games" ON "discovered_polymarket_games";
CREATE POLICY "service_role_all_discovered_polymarket_games"
  ON "discovered_polymarket_games"
  AS PERMISSIVE
  FOR ALL
  TO "service_role"
  USING (TRUE)
  WITH CHECK (TRUE);
