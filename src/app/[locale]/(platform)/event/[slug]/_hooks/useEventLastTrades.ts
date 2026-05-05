import type { MarketTokenTarget } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useEventPriceHistory'
import type { LastTradePriceEntry } from '@/app/[locale]/(platform)/event/[slug]/_types/EventOrderBookTypes'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { normalizeClobMarketPrice } from '@/lib/clob-price'

const CLOB_BASE_URL = process.env.CLOB_URL
const LAST_TRADE_REFRESH_INTERVAL_MS = 60_000

// Synthetic condition_ids minted by the Polymarket discovery sidecar
// (see `lib/polymarket/discovery.ts:SYNTHETIC_CONDITION_PREFIX`). Filter
// them out so we don't POST invalid token_ids to Kuest's /last-trades-prices.
// Inlined to keep this client hook free of `server-only` imports.
const SYNTHETIC_CONDITION_PREFIX = 'polymarket-discovered:'

function isSyntheticTarget(target: MarketTokenTarget): boolean {
  return target.conditionId.startsWith(SYNTHETIC_CONDITION_PREFIX)
}

function normalizePrice(value: string | undefined) {
  return normalizeClobMarketPrice(value)
}

async function fetchLastTradesByMarket(targets: MarketTokenTarget[]) {
  const kuestTargets = targets.filter(target => !isSyntheticTarget(target))
  const uniqueTokenIds = Array.from(new Set(kuestTargets.map(target => target.tokenId).filter(Boolean)))

  if (!uniqueTokenIds.length) {
    return {}
  }

  if (!CLOB_BASE_URL) {
    throw new Error('CLOB URL is not configured.')
  }

  const response = await fetch(`${CLOB_BASE_URL}/last-trades-prices`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(uniqueTokenIds.map(tokenId => ({ token_id: tokenId }))),
  })

  if (!response.ok) {
    const message = `Failed to fetch last trades (${response.status} ${response.statusText}).`
    console.error(message)
    throw new Error(message)
  }

  const payload = await response.json() as LastTradePriceEntry[]
  const lastTradesByToken = new Map<string, number>()

  payload.forEach((entry) => {
    const normalized = normalizePrice(entry?.price)
    if (normalized != null && entry?.token_id) {
      lastTradesByToken.set(entry.token_id, normalized)
    }
  })

  return kuestTargets.reduce<Record<string, number>>((acc, target) => {
    const lastTrade = lastTradesByToken.get(target.tokenId)
    if (lastTrade != null) {
      acc[target.conditionId] = lastTrade
    }
    return acc
  }, {})
}

export function useEventLastTrades(targets: MarketTokenTarget[]) {
  const tokenSignature = useMemo(
    () => targets.map(target => `${target.conditionId}:${target.tokenId}`).sort().join(','),
    [targets],
  )

  const { data } = useQuery({
    queryKey: ['event-last-trades', tokenSignature],
    queryFn: () => fetchLastTradesByMarket(targets),
    enabled: targets.length > 0,
    staleTime: 'static',
    gcTime: LAST_TRADE_REFRESH_INTERVAL_MS,
    refetchInterval: LAST_TRADE_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    placeholderData: keepPreviousData,
  })

  return data ?? {}
}
