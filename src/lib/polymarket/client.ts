import type {
  PolymarketEvent,
  PolymarketPriceHistoryResponse,
} from '@/lib/polymarket/types'
import { z } from 'zod'
import {
  FIFA_EVENT_SLUG,
  POLYMARKET_CLOB_BASE_DEFAULT,
  POLYMARKET_GAMMA_BASE_DEFAULT,
} from '@/lib/polymarket/constants'
import 'server-only'

// ---- Zod schemas -----------------------------------------------------------

/**
 * Polymarket's Gamma responses deliver `outcomes`, `outcomePrices`, and
 * `clobTokenIds` as JSON-encoded strings inside the JSON payload. The
 * `z.preprocess` step parses the string before the tuple/length check runs.
 */
const JsonStringTuple = z.preprocess(
  (v) => {
    if (typeof v !== 'string') {
      return v
    }
    try {
      return JSON.parse(v)
    }
    catch {
      return v
    }
  },
  z.tuple([z.string(), z.string()]),
)

const JsonStringNumberTuple = z.preprocess(
  (v) => {
    if (typeof v !== 'string') {
      return v
    }
    try {
      return JSON.parse(v)
    }
    catch {
      return v
    }
  },
  z.tuple([z.coerce.number(), z.coerce.number()]),
)

const GammaMarketSchema = z.object({
  id: z.string(),
  conditionId: z.string(),
  groupItemTitle: z.string(),
  active: z.boolean(),
  closed: z.boolean(),
  // Polymarket returns placeholder markets for future qualifying teams
  // (Team AM, Team AI, Other) with these fields undefined. Optional here;
  // filtered in buildFifaOverlay.
  outcomes: JsonStringTuple.optional(),
  outcomePrices: JsonStringNumberTuple.optional(),
  clobTokenIds: JsonStringTuple.optional(),
  bestBid: z.number().nullable().default(null),
  bestAsk: z.number().nullable().default(null),
  lastTradePrice: z.number().nullable().default(null),
  volume: z.coerce.number().default(0),
  volume24hr: z.coerce.number().nullable().default(null),
})

const GammaEventSchema = z.object({
  slug: z.string(),
  markets: z.array(GammaMarketSchema),
})

const GammaResponseSchema = z.array(GammaEventSchema).min(1)

const PriceHistoryPointSchema = z.object({
  t: z.number(),
  p: z.number(),
})

const PriceHistoryResponseSchema = z.object({
  history: z.array(PriceHistoryPointSchema),
})

// ---- Retry helper ----------------------------------------------------------

// Matches platform/src/lib/ai/openrouter.ts:120-165 convention:
// linear 350ms backoff, 2-attempt max, shared retryable-status set.
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])
const RETRY_DELAY_MS = 350
const MAX_ATTEMPTS = 2

async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response | null> {
  let lastErr: unknown = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        cache: 'no-store',
        headers: {
          'User-Agent': 'WirePredictions/1.0 (+https://wirepredictions.vercel.app)',
          'Accept': 'application/json',
          ...(init?.headers ?? {}),
        },
      })
      if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
        continue
      }
      return res
    }
    catch (err) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
        continue
      }
    }
  }
  console.error('[polymarket] fetchWithRetry exhausted:', url, lastErr)
  return null
}

// ---- Public API ------------------------------------------------------------

function getGammaBase(): string {
  return process.env.POLYMARKET_GAMMA_BASE || POLYMARKET_GAMMA_BASE_DEFAULT
}

function getClobBase(): string {
  return process.env.POLYMARKET_CLOB_BASE || POLYMARKET_CLOB_BASE_DEFAULT
}

/**
 * Fetches the FIFA World Cup Winner event from Polymarket's Gamma API.
 * Returns `null` (never throws) on:
 *   - Network error / timeout
 *   - Non-2xx status after retry exhaustion
 *   - JSON parse failure
 *   - Zod validation failure (including malformed JSON strings inside
 *     `outcomes` / `outcomePrices` / `clobTokenIds`)
 */
export async function fetchFifaGammaEvent(): Promise<PolymarketEvent | null> {
  const url = `${getGammaBase()}/events?slug=${encodeURIComponent(FIFA_EVENT_SLUG)}`
  const res = await fetchWithRetry(url)
  if (!res || !res.ok) {
    return null
  }

  let data: unknown
  try {
    data = await res.json()
  }
  catch (err) {
    console.error('[polymarket] gamma json parse failed:', err)
    return null
  }

  const parsed = GammaResponseSchema.safeParse(data)
  if (!parsed.success) {
    console.error('[polymarket] gamma zod failed:', parsed.error.issues)
    return null
  }

  const first = parsed.data[0]
  return {
    slug: first.slug,
    markets: first.markets.map(m => ({
      id: m.id,
      conditionId: m.conditionId,
      groupItemTitle: m.groupItemTitle,
      active: m.active,
      closed: m.closed,
      outcomes: m.outcomes,
      outcomePrices: m.outcomePrices,
      clobTokenIds: m.clobTokenIds,
      bestBid: m.bestBid,
      bestAsk: m.bestAsk,
      lastTradePrice: m.lastTradePrice,
      volume: m.volume,
      volume24hr: m.volume24hr,
    })),
  }
}

export interface PriceHistoryParams {
  token: string
  /** Optional. Omitted from the upstream URL when undefined. */
  interval?: string
  fidelity?: number
  startTs?: number
  endTs?: number
}

/**
 * Fetches price history for a Polymarket CLOB token. Returns `{ history: [] }`
 * shape on success. Returns `null` on the same failure modes as
 * `fetchFifaGammaEvent` above.
 */
export async function fetchPolymarketPriceHistory(
  params: PriceHistoryParams,
): Promise<PolymarketPriceHistoryResponse | null> {
  const qs = new URLSearchParams({ market: params.token })
  if (params.interval) {
    qs.set('interval', params.interval)
  }
  if (params.fidelity !== undefined) {
    qs.set('fidelity', String(params.fidelity))
  }
  if (params.startTs !== undefined) {
    qs.set('startTs', String(params.startTs))
  }
  if (params.endTs !== undefined) {
    qs.set('endTs', String(params.endTs))
  }

  const url = `${getClobBase()}/prices-history?${qs.toString()}`
  const res = await fetchWithRetry(url)
  if (!res || !res.ok) {
    return null
  }

  let data: unknown
  try {
    data = await res.json()
  }
  catch (err) {
    console.error('[polymarket] clob json parse failed:', err)
    return null
  }

  const parsed = PriceHistoryResponseSchema.safeParse(data)
  if (!parsed.success) {
    console.error('[polymarket] clob zod failed:', parsed.error.issues)
    return null
  }

  return { history: parsed.data.history }
}
