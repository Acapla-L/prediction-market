// platform/src/app/[locale]/(platform)/event/[slug]/_utils/polymarketMarketCache.ts
import type { Market } from '@/types'

const YES_OUTCOME_INDEX = 0

export interface YesTokenMapping {
  tokenIds: string[]
  tokenIdToConditionId: Map<string, string>
}

export function buildYesTokenMapping(markets: Market[]): YesTokenMapping {
  const tokenIdToConditionId = new Map<string, string>()
  const seen = new Set<string>()
  const tokenIds: string[] = []

  for (const market of markets) {
    if (!market?.condition_id || market.is_active === false || market.is_resolved === true) {
      continue
    }
    const yes = market.outcomes?.find(o => o.outcome_index === YES_OUTCOME_INDEX)
    const tokenId = yes?.polymarket_token_id ? String(yes.polymarket_token_id) : null
    if (!tokenId || seen.has(tokenId)) {
      continue
    }
    seen.add(tokenId)
    tokenIds.push(tokenId)
    tokenIdToConditionId.set(tokenId, market.condition_id)
  }
  return { tokenIds, tokenIdToConditionId }
}
