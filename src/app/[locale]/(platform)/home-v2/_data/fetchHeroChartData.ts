import type { Event } from '@/types'
import type { DataPoint } from '@/types/PredictionChartTypes'
import { EventRepository } from '@/lib/db/queries/event'

interface SeriesMapItem {
  series_slug: string
  instrument: string
  interval: string
  source: string
}

interface PriceReferenceHistoryRow {
  instrument: string
  interval: string
  window_end_ms: number
  settlement_price: number
  source: string
}

export const HERO_CHART_SERIES_KEY = 'price'

const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000
const HISTORY_INTERVAL = '5m'
const HISTORY_LIMIT = 288

let seriesMapCache: Map<string, SeriesMapItem> | null = null
let seriesMapCachedAt = 0
const SERIES_MAP_TTL_MS = 5 * 60 * 1000

async function fetchSeriesMap(baseUrl: string): Promise<Map<string, SeriesMapItem>> {
  const now = Date.now()
  if (seriesMapCache && now - seriesMapCachedAt < SERIES_MAP_TTL_MS) {
    return seriesMapCache
  }

  try {
    const response = await fetch(`${baseUrl}/series-map`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) {
      return seriesMapCache ?? new Map()
    }

    const payload = await response.json() as { series?: SeriesMapItem[] }
    const map = new Map<string, SeriesMapItem>()
    for (const item of payload.series ?? []) {
      const slug = item.series_slug?.trim().toLowerCase()
      if (slug) {
        map.set(slug, item)
      }
    }

    seriesMapCache = map
    seriesMapCachedAt = now
    return map
  }
  catch {
    return seriesMapCache ?? new Map()
  }
}

async function fetchMarksHistory(
  baseUrl: string,
  instrument: string,
  fromMs: number,
  toMs: number,
): Promise<PriceReferenceHistoryRow[]> {
  try {
    const params = new URLSearchParams({
      instrument,
      interval: HISTORY_INTERVAL,
      from: String(fromMs),
      to: String(toMs),
      limit: String(HISTORY_LIMIT),
    })
    const response = await fetch(`${baseUrl}/marks/history?${params}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) {
      return []
    }
    const payload = await response.json() as { rows?: PriceReferenceHistoryRow[] }
    return payload.rows ?? []
  }
  catch {
    return []
  }
}

export interface HeroChartEntry {
  eventId: string
  data: DataPoint[]
  lineColor: string
}

export async function fetchHeroChartData(events: Event[]): Promise<Record<string, HeroChartEntry>> {
  const baseUrl = process.env.PRICE_REFERENCE_URL
  if (!baseUrl) {
    return {}
  }

  const seriesMap = await fetchSeriesMap(baseUrl)
  const now = Date.now()
  const from = now - HISTORY_WINDOW_MS

  const entries = await Promise.all(
    events.map(async (event): Promise<[string, HeroChartEntry] | null> => {
      const seriesSlug = event.series_slug?.trim().toLowerCase()
      if (!seriesSlug) {
        return null
      }

      const config = seriesMap.get(seriesSlug)
      if (!config) {
        return null
      }

      const rows = await fetchMarksHistory(baseUrl, config.instrument, from, now)

      const points: DataPoint[] = rows
        .filter(r => Number.isFinite(r.settlement_price) && Number.isFinite(r.window_end_ms))
        .sort((a, b) => a.window_end_ms - b.window_end_ms)
        .map(row => ({
          date: new Date(row.window_end_ms),
          [HERO_CHART_SERIES_KEY]: row.settlement_price,
        }))

      // Pull the per-asset chart line color from event_live_chart_configs
      let lineColor = 'var(--primary)'
      try {
        const configResult = await EventRepository.getLiveChartConfigBySeriesSlug(seriesSlug)
        if (configResult.data?.line_color) {
          lineColor = configResult.data.line_color
        }
      }
      catch {
        // Fall through to theme primary
      }

      return [event.id, { eventId: event.id, data: points, lineColor }]
    }),
  )

  return Object.fromEntries(entries.filter((entry): entry is [string, HeroChartEntry] => entry !== null))
}
