// Stream 2 (Phase B v2 v3): thin delegator to `_utils/sports-games-list-data.tsx`.
//
// NO module-level `'use cache'` here — the cache boundary lives inside the
// `fetchSportsGamesListCachedData` helper. Outer non-cached functions call
// `notFound()` based on the helper's null sentinel, fixing the latent
// Phase A v2 P0 anti-pattern that lived in this file pre-Stream-2 (see plan
// at docs/plans/stream-2-sports-list-route-implementation-plan-2026-05-07.md
// and reference template at sports/_utils/sports-event-page.tsx).

import type { Metadata } from 'next'
import {
  generateSportsGamesListMetadata,
  renderSportsGamesListPage,
} from '@/app/[locale]/(platform)/sports/_utils/sports-games-list-data'
import { STATIC_PARAMS_PLACEHOLDER } from '@/lib/static-params'

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/sports/[sport]/games'>): Promise<Metadata> {
  const { locale, sport } = await params
  return generateSportsGamesListMetadata({ locale, sport })
}

export async function generateStaticParams() {
  return [{ sport: STATIC_PARAMS_PLACEHOLDER }]
}

export default async function SportsGamesBySportPage({
  params,
}: PageProps<'/[locale]/sports/[sport]/games'>) {
  const { locale, sport } = await params
  return renderSportsGamesListPage({ locale, sport })
}
