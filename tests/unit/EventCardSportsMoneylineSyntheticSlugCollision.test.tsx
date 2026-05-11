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
