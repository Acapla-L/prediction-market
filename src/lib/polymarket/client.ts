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
  // Optional because per-game Moneyline markets have it `undefined` (the
  // market IS the matchup; no team-name to label). Phase A v2 futures
  // markets always have it populated (team name on the bracket). The mapper
  // below defaults missing values to '' so downstream consumers see a string.
  // Verified empirically via `tests/fixtures/polymarket-gamma-mlb-per-game-
  // response.json` (3 of 15 markets — all Moneylines — lack this field).
  groupItemTitle: z.string().optional(),
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
  // Optional fields used by the discovery sidecar; FIFA path ignores them.
  slug: z.string().optional(),
  icon: z.string().nullable().optional(),
  // Phase B per-game tipoff/first-pitch time (ISO-with-offset). At the
  // MARKET level, NOT the event level (counterintuitive but verified
  // against real Gamma response — fixture above). Optional because Phase
  // A v2 futures markets do not include it. Surfaced into the synthetic
  // Event's `created_at` and the sidecar's `game_start_time` column.
  gameStartTime: z.string().optional(),
  // Phase B v2: `sportsMarketType` partitions a game's markets into sections.
  // Polymarket support confirmed this is an OPEN SET — new values appear without
  // notice (esp. finals/knockouts). Relaxed from z.enum() to z.string() so an
  // unknown value doesn't fail the whole event's Zod parse. Observability layer
  // (`KNOWN_SPORTS_MARKET_TYPES`) in normalize-games-discovery-payload.ts warns
  // on unrecognized values; nothing rejects. `line` carries the numeric line
  // value for spreads/totals (null otherwise).
  sportsMarketType: z.string().optional(),
  line: z.number().nullable().optional(),
})

/**
 * One team object from a Polymarket Gamma per-game event's `teams[]` array.
 * Universally populated across MLB/NBA/NHL/La Liga/FIFA WC/UCL/UCol (76/76
 * events probed 2026-05-08). Only `name` is read by `resolveTeamLabels`; the
 * rest is carried for future use (e.g. inline teams_cache population). Schema
 * is permissive — `abbreviation` is nullable+optional (UCol's is unreliable).
 */
const TeamFromEventSchema = z.object({
  id: z.number().optional(),
  name: z.string(),
  league: z.string().optional(),
  abbreviation: z.string().nullable().optional(),
  alias: z.string().nullable().optional(),
  logo: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  record: z.string().nullable().optional(),
  providerId: z.number().nullable().optional(),
})

const GammaEventSchema = z.object({
  slug: z.string(),
  markets: z.array(GammaMarketSchema),
  // Optional fields used by the discovery sidecar; FIFA path ignores them.
  // Gamma serializes `id` as a number — coerce so we can persist as text.
  id: z.coerce.string().optional(),
  title: z.string().optional(),
  endDate: z.string().nullable().optional(),
  // Gamma event creation timestamp. Surfaced into the synthetic Event's
  // `created_at` so the chart's ALL range covers full Polymarket history.
  createdAt: z.string().optional(),
  // Phase B per-game neg-risk flags (always `false` for per-game). Optional
  // because Phase A v2 futures responses set `enableNegRisk: true`. Note:
  // `gameStartTime` is at the MARKET level (see `GammaMarketSchema` above),
  // NOT the event level — verified via real fixture.
  negRisk: z.boolean().optional(),
  enableNegRisk: z.boolean().optional(),
  // Tier 1 source for per-game team labels — universally populated on per-game
  // events. NO .length(2) here: the runtime length check lives in
  // resolveTeamLabels; a strict schema would reject the whole event (incl.
  // the FIFA overlay path) on a malformed teams[]. Phase A v2 futures + the
  // FIFA event don't carry it (optional).
  teams: z.array(TeamFromEventSchema).optional(),
  // Tier 2 (defensive forward-compat): Polymarket support claimed these are
  // reliable on all leagues; empirically absent on 0/76 events probed
  // 2026-05-08. Kept in case Polymarket starts populating them.
  homeTeam: z.string().optional().nullable(),
  awayTeam: z.string().optional().nullable(),
})

const GammaResponseSchema = z.array(GammaEventSchema).min(1)

/**
 * Paginated `/events?series_id=N` response. Empirically the series query
 * returns a BARE JSON array (no `{events, has_more}` envelope — verified via
 * live curls 2026-05-11; see .claude/skills/polymarket-api/SKILL.md). The
 * object form is handled defensively in case Polymarket changes the shape.
 * End-of-pages is detected by ROW COUNT (`page.length < limit`), not `has_more`.
 */
const GammaPaginatedResponseSchema = z.union([
  z.object({
    events: z.array(GammaEventSchema),
    has_more: z.boolean().optional(),
  }),
  z.array(GammaEventSchema),
])

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
 * Fetches a Polymarket Gamma event by slug. Returns `null` (never throws) on:
 *   - Network error / timeout
 *   - Non-2xx status after retry exhaustion (incl. 404)
 *   - JSON parse failure
 *   - Zod validation failure (including malformed JSON strings inside
 *     `outcomes` / `outcomePrices` / `clobTokenIds`)
 *   - Empty Gamma response array (slug not present in Gamma)
 */
export async function fetchPolymarketGammaEvent(slug: string): Promise<PolymarketEvent | null> {
  const url = `${getGammaBase()}/events?slug=${encodeURIComponent(slug)}`
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
  return mapGammaEventToPolymarketEvent(first)
}

/**
 * Maps a parsed Gamma event (Zod-validated) to the public `PolymarketEvent`
 * shape. Extracted from {@link fetchPolymarketGammaEvent} so the per-series
 * list endpoint can reuse the same per-event mapping.
 */
function mapGammaEventToPolymarketEvent(
  gammaEvent: z.infer<typeof GammaEventSchema>,
): PolymarketEvent {
  return {
    slug: gammaEvent.slug,
    id: gammaEvent.id,
    title: gammaEvent.title,
    endDate: gammaEvent.endDate ?? null,
    createdAt: gammaEvent.createdAt,
    negRisk: gammaEvent.negRisk,
    enableNegRisk: gammaEvent.enableNegRisk,
    teams: gammaEvent.teams ?? null,
    homeTeam: gammaEvent.homeTeam ?? null,
    awayTeam: gammaEvent.awayTeam ?? null,
    markets: gammaEvent.markets.map(m => ({
      id: m.id,
      conditionId: m.conditionId,
      // Default empty string when Gamma omits the field (Phase B per-game
      // Moneyline markets). Phase A v2 futures markets always have a
      // populated team name. Downstream consumers in
      // `normalize-discovery-payload.ts` (Phase A v2) and
      // `normalize-games-discovery-payload.ts` (Phase B) handle empty string
      // safely — Phase B's normalizer falls back to `event.title` via `||`.
      groupItemTitle: m.groupItemTitle ?? '',
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
      slug: m.slug,
      iconUrl: m.icon ?? null,
      // Phase B per-game tipoff time. Undefined for Phase A v2 futures
      // markets and for placeholder markets that Polymarket hasn't yet
      // populated. Required for per-game normalize.
      gameStartTime: m.gameStartTime,
      // Phase B v2 multi-section market fields. Pass through unchanged so
      // `normalize-games-discovery-payload.ts` can preserve them on per-
      // market sidecar entries. Undefined for Phase A v2 futures.
      sportsMarketType: m.sportsMarketType,
      line: m.line ?? null,
    })),
  }
}

const SERIES_PAGE_LIMIT = 50
// Safety: cap total pages so a pathological response can't loop forever.
// MLS at ~156 active events = 4 pages; NFL season ~272 = 6 pages; La Liga ~136 = 3.
// 500 events / 50-per-page = 10 pages. Bump if a league legitimately exceeds.
const SERIES_HARD_CAP_EVENTS = 500

/**
 * Fetches all currently-relevant Polymarket Gamma events for a sport series
 * (Phase B per-game discovery), following offset-based pagination.
 *
 * Filters to active + non-closed at the API level. Detects the last page by
 * row count: a page with fewer than `SERIES_PAGE_LIMIT` rows is the last one
 * (the `?series_id=` query returns a bare JSON array — no `has_more` field;
 * the object form, if it ever appears, is handled defensively).
 *
 * Returns `[]` (not `null`) on an empty first page; returns `null` only on
 * transport failure or schema rejection of the FIRST page (so the sync route
 * can distinguish "nothing to sync" from "Gamma is unhappy"). A failure on a
 * LATER page returns the partial accumulation rather than discarding good rows.
 *
 * `seriesId` is the numeric string from `GET /sports` (e.g. "3" for MLB).
 */
export async function fetchPolymarketGammaEventsBySeriesPaged(
  seriesId: string,
): Promise<readonly PolymarketEvent[] | null> {
  const accumulated: PolymarketEvent[] = []
  let offset = 0

  while (true) {
    const qs = new URLSearchParams({
      series_id: seriesId,
      active: 'true',
      closed: 'false',
      limit: String(SERIES_PAGE_LIMIT),
      offset: String(offset),
    })
    const url = `${getGammaBase()}/events?${qs.toString()}`

    const res = await fetchWithRetry(url)
    if (!res || !res.ok) {
      return offset === 0 ? null : accumulated
    }

    let raw: unknown
    try {
      raw = await res.json()
    }
    catch (err) {
      console.error('[polymarket] gamma series json parse failed:', err)
      return offset === 0 ? null : accumulated
    }

    const parsed = GammaPaginatedResponseSchema.safeParse(raw)
    if (!parsed.success) {
      console.error('[polymarket] gamma series zod failed:', parsed.error.issues)
      return offset === 0 ? null : accumulated
    }

    const page = Array.isArray(parsed.data) ? parsed.data : parsed.data.events
    accumulated.push(...page.map(mapGammaEventToPolymarketEvent))

    // End-of-pages: a short page (fewer rows than the limit) is the last page.
    // An empty page also terminates. (We deliberately ignore any `has_more`
    // field — the bare-array series form doesn't carry one.)
    if (page.length < SERIES_PAGE_LIMIT) {
      break
    }
    if (accumulated.length >= SERIES_HARD_CAP_EVENTS) {
      console.warn('[polymarket] series pagination hit hard cap', {
        seriesId,
        accumulated: accumulated.length,
      })
      break
    }
    offset += SERIES_PAGE_LIMIT
  }

  return accumulated
}

/**
 * Backwards-compatible alias of {@link fetchPolymarketGammaEvent} that targets
 * the FIFA World Cup Winner slug. Preserved so existing FIFA-overlay callers
 * continue to compile unchanged.
 */
export async function fetchFifaGammaEvent(): Promise<PolymarketEvent | null> {
  return fetchPolymarketGammaEvent(FIFA_EVENT_SLUG)
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
