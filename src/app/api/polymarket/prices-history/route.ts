import { unstable_cache } from 'next/cache'
import { connection, NextResponse } from 'next/server'
import { z } from 'zod'
import { fetchPolymarketPriceHistory } from '@/lib/polymarket/client'

// Cache Components compliance (CLAUDE.md "Server/Client Boundary" guardrail):
// This file MUST NOT export any of:
//   dynamic, runtime, revalidate, fetchCache, dynamicParams, preferredRegion
// Use `await connection()` inside the handler and function-level `unstable_cache`
// around the data fetch instead. This file has been hand-audited to be free of
// route segment configs.

const INTERVAL_VALUES = ['1h', '6h', '1d', '1w', '1m', 'max'] as const

const QuerySchema = z.object({
  token: z.string().min(1),
  interval: z.enum(INTERVAL_VALUES),
  fidelity: z.coerce.number().int().positive().optional(),
  startTs: z.coerce.number().int().nonnegative().optional(),
  endTs: z.coerce.number().int().nonnegative().optional(),
})

type PriceHistoryParams = z.infer<typeof QuerySchema>

/**
 * Wrap the upstream fetch in `unstable_cache` keyed by the full query tuple.
 *
 * The cache key array MUST include every input that changes the upstream URL,
 * otherwise distinct `(token, interval, fidelity, startTs, endTs)` tuples would
 * collide and return stale data for one another. See "plan discrepancy" in
 * the commit message — the plan stub used a 4-entry key that only covered
 * `token + interval + fidelity`; `startTs` and `endTs` were added to close
 * that collision.
 *
 * Tag is per-token so a future admin action could revalidate all histories
 * for one token (e.g., Spain YES) independently of other tokens.
 */
function fetchAndCacheHistory(params: PriceHistoryParams) {
  const { token, interval, fidelity, startTs, endTs } = params
  const cached = unstable_cache(
    () => fetchPolymarketPriceHistory({ token, interval, fidelity, startTs, endTs }),
    [
      'polymarket-prices-history-v1',
      token,
      interval,
      String(fidelity ?? ''),
      String(startTs ?? ''),
      String(endTs ?? ''),
    ],
    {
      revalidate: 30,
      tags: [`polymarket:history:${token}`],
    },
  )
  return cached()
}

export async function GET(request: Request): Promise<Response> {
  // Cache Components: force dynamic at the handler boundary.
  await connection()

  const { searchParams } = new URL(request.url)
  const parsed = QuerySchema.safeParse(Object.fromEntries(searchParams))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query params', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const result = await fetchAndCacheHistory(parsed.data)
  if (!result) {
    // Upstream unavailable or validation failed — chart hook renders empty
    // and Revision 4's cold-cache fallback in useEventPriceHistory takes
    // over on the next render.
    return NextResponse.json({ history: [] }, { status: 502 })
  }

  return NextResponse.json(result)
}
