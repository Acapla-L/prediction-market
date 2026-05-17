-- Cron stagger — PR 1 of cascade fix sequence (manual operator tool, NOT auto-applied)
--
-- Companion plan: docs/plans/cascade-fix-plan-2026-05-15.md §PR 1
-- Rollback tag:   pre-cron-stagger-2026-05-15 → ebf134704d23360511c20230e364d172a67c9e74
--
-- WHY THIS FILE IS HERE (not in src/lib/db/migrations/):
--   src/lib/db/migrations/*.sql is auto-applied by scripts/migrate.js on every deploy.
--   This file is intended for MANUAL one-shot apply via Supabase MCP / dashboard SQL editor
--   BEFORE the deploy that ships the matching migrate.js edits. After deploy lands, the
--   migrate.js re-registration (cron.unschedule + cron.schedule) is the steady-state path.
--   Keeping the SQL outside the auto-applied directory avoids racing with migrate.js
--   inside the same deploy.
--
-- WHEN TO USE THIS FILE:
--   Recommended deploy sequence is SQL-first:
--     1. Wait until UTC clock is NOT within 5 min of :04 / :22 / :42 (heavy job ticks).
--     2. Apply this block via Supabase MCP `execute_sql` (or dashboard SQL editor).
--        NOTE: prefer `execute_sql` over `apply_migration` for this file. This is a
--        one-off operator action that is intentionally placed OUTSIDE the auto-applied
--        `src/lib/db/migrations/` directory (see WHY THIS FILE IS HERE above). Using
--        `execute_sql` keeps it out of the Supabase migration tracker, which is
--        reserved for permanent state-conveying schema migrations. The steady-state
--        path for future deploys is `scripts/migrate.js`'s own `cron.unschedule +
--        cron.schedule` re-registration on `npm run db:push`.
--     3. Verify with `SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname`.
--        DO NOT run `SELECT *` — that column-leaks the CRON_SECRET bearer token in `command`.
--     4. Watch ≥5 min for any immediate fallout in Vercel runtime logs.
--     5. Merge the PR to `production`.
--     6. Trigger Vercel "Production Deploy" hook manually (auto-deploy doesn't fire on this branch).
--
-- COMPLEMENTARY ROLLBACK BLOCK:
--   Defined inline in cascade-fix-plan-2026-05-15.md §PR 1 Rollback (Path 2).
--   Path 1 (preferred) is `git revert` of the migrate.js commit + redeploy.
--
-- ATOMICITY:
--   BEGIN/COMMIT wrap so any single alter_job failure aborts the whole block, leaving
--   cron in its prior state. Without this, a mid-block failure would split jobs between
--   old and new schedules at unintended minutes — which is the exact failure mode this
--   PR is closing.
--
-- QUERY BY jobname (NOT jobid):
--   migrate.js uses cron.unschedule + cron.schedule for registration. JobIds churn on
--   every deploy that runs db:push. Querying by jobname survives churn.

BEGIN;

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'sync-events'),
  schedule := '9,19,29,39,49,59 * * * *'
);
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'sync-resolution'),
  schedule := '8,18,28,38,48,58 * * * *'
);
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'sync-event-creations'),
  schedule := '11,41 * * * *'
);
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'sync-translations'),
  schedule := '2,32 * * * *'
);
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'sync-volume'),
  schedule := '6,36 * * * *'
);
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'sync-polymarket-discovery'),
  schedule := '4 * * * *'
);
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'sync-polymarket-games-discovery'),
  schedule := '22 * * * *'
);
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'sync-polymarket-teams'),
  schedule := '42 * * * *'
);
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'clean-jobs'),
  schedule := '14 * * * *'
);

-- INTENTIONALLY UNCHANGED:
--   clean-cron-details         (0 0 * * *)        daily — light DB delete, no cascade impact
--   sync-polymarket-games-refresh (*/5 * * * *)  every 5 min DB-only write, no revalidation (PR #21 §F-1)

COMMIT;
