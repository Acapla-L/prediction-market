import { connection, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/auth-cron'
import { snapshotModuleCaches } from '@/lib/db/utils/module-cache'

/**
 * Debug endpoint for per-instance module-cache observability (PR 2 of the
 * cascade-fix sequence, RC-1).
 *
 * Permanent endpoint behind CRON_SECRET bearer auth. Reports the current
 * stats for every registered module-cache plus an instance identifier so
 * the operator can correlate probes across the Vercel fleet (each probe
 * may land on a different warm instance with different cache state).
 *
 * Stable response shape — consumed by ad-hoc tooling, future PR 5 (UCL
 * teams-cache wrapper), and any Tier 2 module-cache expansion:
 *
 *   {
 *     "instance": {
 *       "region": "iad1",
 *       "uptimeMs": 123456,
 *       "buildId": "7c1d7fab..."
 *     },
 *     "caches": [
 *       { "name": "settings", "ttlMs": 60000, "hits": 12450, "misses": 23, "fills": 23, "hitRate": 0.998, "size": 1 },
 *       { "name": "main-tags", "ttlMs": 60000, "hits": 8923, "misses": 18, "fills": 18, "hitRate": 0.998, "size": 6 }
 *     ],
 *     "asOf": "2026-05-18T20:00:00.000Z"
 *   }
 *
 * Usage:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://wirepredictions.vercel.app/api/debug/module-cache-stats
 *
 * Plan: docs/plans/cascade-fix-plan-2026-05-15.md §PR 2
 * Confirmation memo: docs/audits/pr2-plan-confirmation-2026-05-18.md
 */
export async function GET(request: Request): Promise<NextResponse> {
  // Cache Components: opt this route out of static rendering — auth header
  // and per-request module-cache state make the response per-request.
  await connection()

  const auth = request.headers.get('authorization')
  if (!isCronAuthorized(auth, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 })
  }

  return NextResponse.json({
    instance: {
      region: process.env.VERCEL_REGION ?? null,
      uptimeMs: Math.round(process.uptime() * 1000),
      buildId: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    },
    caches: snapshotModuleCaches(),
    asOf: new Date().toISOString(),
  })
}
