-- ===========================================
-- Discovered Polymarket events sidecar table
-- Populated by /api/sync/polymarket-discovery from a hardcoded slug allowlist.
-- Lives separately from events/markets/outcomes to avoid Kuest sync coupling.
-- ===========================================

CREATE TABLE IF NOT EXISTS discovered_polymarket_events (
  slug TEXT PRIMARY KEY,
  polymarket_event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  end_date TIMESTAMPTZ,
  markets_payload TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_status TEXT NOT NULL DEFAULT 'ok',
  last_sync_error TEXT
);

ALTER TABLE discovered_polymarket_events
  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_discovered_polymarket_events" ON "discovered_polymarket_events";
CREATE POLICY "service_role_all_discovered_polymarket_events"
  ON "discovered_polymarket_events"
  AS PERMISSIVE
  FOR ALL
  TO "service_role"
  USING (TRUE)
  WITH CHECK (TRUE);
