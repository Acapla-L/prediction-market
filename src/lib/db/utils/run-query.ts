import type { QueryResult } from '@/types'
import { DEFAULT_ERROR_MESSAGE } from '@/lib/constants'

export async function runQuery<T>(queryFn: () => Promise<QueryResult<T>>): Promise<QueryResult<T>> {
  try {
    return await queryFn()
  }
  catch (e) {
    // Preserve the original error context (postgres.js attaches `.query` /
    // `.params` for "Failed query" errors and `.code` / `.severity_local`
    // for backend errors) in the server logs. The generic fallback below
    // intentionally hides it from the API response, but post-mortems need
    // the SQL + Postgres error code. (P0-incident follow-up.)
    console.error('[runQuery] DB query failed:', e)
    return {
      data: null,
      error: DEFAULT_ERROR_MESSAGE,
    }
  }
}
