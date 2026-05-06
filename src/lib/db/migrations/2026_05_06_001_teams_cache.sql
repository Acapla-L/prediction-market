-- ===========================================
-- Teams cache (Phase B v2 sports template)
-- Populated by /api/sync/polymarket-teams (per-league hourly at :17).
-- Per league, fetched from https://gamma-api.polymarket.com/teams?league={leagueSlug}.
-- Looked up by abbreviation parsed from per-game slug (e.g., 'mlb-tor-tb-2026-05-06').
-- Primary key on (league, abbreviation) because abbreviation is the lookup key;
-- team_id is stored as auxiliary metadata (numeric id from Polymarket Gamma).
-- ===========================================

CREATE TABLE IF NOT EXISTS teams_cache (
  league TEXT NOT NULL,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  alias TEXT,
  abbreviation TEXT NOT NULL,
  logo_url TEXT,
  color TEXT,
  record TEXT,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_status TEXT NOT NULL DEFAULT 'ok',
  last_sync_error TEXT,
  PRIMARY KEY (league, abbreviation)
);

-- Diagnostics + listByLeague repository method
CREATE INDEX IF NOT EXISTS teams_cache_league_idx
  ON teams_cache (league);

ALTER TABLE teams_cache
  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_teams_cache" ON "teams_cache";
CREATE POLICY "service_role_all_teams_cache"
  ON "teams_cache"
  AS PERMISSIVE
  FOR ALL
  TO "service_role"
  USING (TRUE)
  WITH CHECK (TRUE);
