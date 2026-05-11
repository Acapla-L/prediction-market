/* eslint-disable next/no-img-element */

import type { AnchorHTMLAttributes } from 'react'
import { render } from '@testing-library/react'
import EventCardSportsMoneyline from '@/app/[locale]/(platform)/(home)/_components/EventCardSportsMoneyline'

vi.mock('next/image', () => ({
  default: function MockImage({ fill: _fill, ...props }: any) {
    return <img {...props} />
  },
}))

vi.mock('@/components/AppLink', () => ({
  default: function MockAppLink({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
    return (
      <a href={href} data-testid="app-link" {...props}>
        {children}
      </a>
    )
  },
}))

vi.mock('@/app/[locale]/(platform)/event/[slug]/_components/EventBookmark', () => ({
  default: function MockEventBookmark() {
    return <span data-testid="event-bookmark" />
  },
}))

// NOTE: events-routing is intentionally NOT mocked — we want to exercise the
// real path resolver to verify the guard against synthetic slug collision.

describe('eventCardSportsMoneyline — Phase B synthetic per-game slug collision', () => {
  it('drops marketSlug when it equals event.slug (avoids /sports/{sport}/{slug}/{slug} double-slug 404)', () => {
    const eventSlug = 'mlb-tor-tb-2026-05-09'
    const event = {
      slug: eventSlug,
      status: 'open',
      volume: 12345,
      sports_sport_slug: 'baseball',
      sports_event_slug: eventSlug,
      sports_section: 'games',
      sports_start_time: '2026-05-09T23:00:00.000Z',
      // Phase B synthetic events emit market.slug === event.slug
      markets: [
        {
          condition_id: 'cond-tor-tb',
          slug: eventSlug,
        },
      ],
    } as any

    const model = {
      team1: { name: 'Toronto', abbreviation: 'TOR', color: null, logoUrl: null, hostStatus: 'away' },
      team2: { name: 'Tampa Bay', abbreviation: 'TB', color: null, logoUrl: null, hostStatus: 'home' },
      team1Button: { conditionId: 'cond-tor-tb', outcomeIndex: 0, label: 'TOR', tone: 'team1', color: null },
      team2Button: { conditionId: 'cond-tor-tb', outcomeIndex: 1, label: 'TB', tone: 'team2', color: null },
    } as any

    const { container } = render(
      <EventCardSportsMoneyline
        event={event}
        model={model}
        getDisplayChance={() => 50}
      />,
    )

    const anchors = Array.from(container.querySelectorAll('a[data-testid="app-link"]')) as HTMLAnchorElement[]
    expect(anchors.length).toBeGreaterThan(0)

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') ?? ''
      // Must NOT contain the double-slug segment
      expect(href).not.toContain(`${eventSlug}/${eventSlug}`)
      // Should be anchored to the sports base path for this event
      expect(href.startsWith(`/sports/baseball/${eventSlug}`)).toBe(true)
      // Should carry the outcomeIndex query
      expect(href).toMatch(/[?&]outcomeIndex=\d+/)
      // Without marketSlug, conditionId is added as a query param
      expect(href).toContain('conditionId=cond-tor-tb')
    }
  })

  it('drops distinct per-leg marketSlugs when event.slug is a discovery game slug (soccer 1X2 — NEW-8)', () => {
    // La Liga 1X2: event slug `lal-elc-ala-2026-05-09`, market legs carry distinct
    // suffixed slugs (`-elc` / `-draw` / `-ala`). These never equal event.slug, so the
    // old `marketSlug !== event.slug` guard wouldn't fire → routed to the Kuest-only
    // .../[market] route → 404. Widened guard: any discovery game slug → drop marketSlug.
    const eventSlug = 'lal-elc-ala-2026-05-09'
    const event = {
      slug: eventSlug,
      status: 'open',
      volume: 5432,
      sports_sport_slug: 'soccer',
      sports_event_slug: eventSlug,
      sports_section: 'games',
      sports_start_time: '2026-05-09T19:00:00.000Z',
      markets: [
        { condition_id: 'cond-elc', slug: `${eventSlug}-elc` },
        { condition_id: 'cond-draw', slug: `${eventSlug}-draw` },
        { condition_id: 'cond-ala', slug: `${eventSlug}-ala` },
      ],
    } as any

    const model = {
      team1: { name: 'Elche', abbreviation: 'ELC', color: null, logoUrl: null, hostStatus: 'home' },
      team2: { name: 'Alaves', abbreviation: 'ALA', color: null, logoUrl: null, hostStatus: 'away' },
      team1Button: { conditionId: 'cond-elc', outcomeIndex: 0, label: 'ELC', tone: 'team1', color: null },
      drawButton: { conditionId: 'cond-draw', outcomeIndex: 0, label: 'Draw', tone: 'draw', color: null },
      team2Button: { conditionId: 'cond-ala', outcomeIndex: 0, label: 'ALA', tone: 'team2', color: null },
    } as any

    const { container } = render(
      <EventCardSportsMoneyline
        event={event}
        model={model}
        getDisplayChance={() => 50}
      />,
    )

    const anchors = Array.from(container.querySelectorAll('a[data-testid="app-link"]')) as HTMLAnchorElement[]
    expect(anchors.length).toBeGreaterThan(0)

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') ?? ''
      // No leg slug should ever appear as a path segment
      expect(href).not.toContain(`${eventSlug}-elc`)
      expect(href).not.toContain(`${eventSlug}-draw`)
      expect(href).not.toContain(`${eventSlug}-ala`)
      // Routes to the sports base path for this event
      expect(href.startsWith(`/sports/soccer/${eventSlug}`)).toBe(true)
      // Carries outcomeIndex + conditionId query params
      expect(href).toMatch(/[?&]outcomeIndex=\d+/)
      expect(href).toMatch(/[?&]conditionId=cond-(?:elc|draw|ala)/)
    }
  })

  it('preserves marketSlug when it differs from event.slug (non-synthetic path)', () => {
    const event = {
      slug: 'champions-league-final',
      status: 'open',
      volume: 999,
      sports_sport_slug: 'soccer',
      sports_event_slug: 'champions-league-final',
      sports_section: 'games',
      markets: [
        {
          condition_id: 'cond-real-mci',
          slug: 'real-vs-mci-match-winner',
        },
      ],
    } as any

    const model = {
      team1: { name: 'Real', abbreviation: 'RMA', color: null, logoUrl: null, hostStatus: 'home' },
      team2: { name: 'Man City', abbreviation: 'MCI', color: null, logoUrl: null, hostStatus: 'away' },
      team1Button: { conditionId: 'cond-real-mci', outcomeIndex: 0, label: 'RMA', tone: 'team1', color: null },
      team2Button: { conditionId: 'cond-real-mci', outcomeIndex: 1, label: 'MCI', tone: 'team2', color: null },
    } as any

    const { container } = render(
      <EventCardSportsMoneyline
        event={event}
        model={model}
        getDisplayChance={() => 50}
      />,
    )

    const anchors = Array.from(container.querySelectorAll('a[data-testid="app-link"]')) as HTMLAnchorElement[]
    expect(anchors.length).toBeGreaterThan(0)

    // Headline team-row anchors should include the distinct market slug segment
    const headlineHref = anchors[0].getAttribute('href') ?? ''
    expect(headlineHref).toContain('/real-vs-mci-match-winner')
    expect(headlineHref).toMatch(/[?&]outcomeIndex=\d+/)
  })
})
