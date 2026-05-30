import type { Market } from '@/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PolymarketSocketProvider from '@/app/[locale]/(platform)/event/[slug]/_components/PolymarketSocketProvider'

class MockWS {
  static instances: MockWS[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readyState = MockWS.CONNECTING
  url: string
  sent: string[] = []
  listeners: Record<string, ((e: any) => void)[]> = {}
  constructor(url: string) {
    this.url = url
    MockWS.instances.push(this)
  }

  addEventListener(t: string, cb: (e: any) => void) {
    (this.listeners[t] ??= []).push(cb)
  }

  removeEventListener(t: string, cb: (e: any) => void) {
    this.listeners[t] = (this.listeners[t] ?? []).filter(x => x !== cb)
  }

  send(d: string) {
    this.sent.push(d)
  }

  close() {
    this.readyState = MockWS.CLOSED
    this.emit('close', { code: 1000 })
  }

  emit(t: string, e: any) {
    (this.listeners[t] ?? []).forEach(cb => cb(e))
  }

  open() {
    this.readyState = MockWS.OPEN
    this.emit('open', {})
  }
}

function yesMarket(cid: string, tok: string): Market {
  return {
    condition_id: cid,
    is_active: true,
    is_resolved: false,
    outcomes: [
      { condition_id: cid, outcome_index: 0, token_id: tok, polymarket_token_id: tok, outcome_text: 'Yes' },
      { condition_id: cid, outcome_index: 1, token_id: `${tok}n`, polymarket_token_id: `${tok}n`, outcome_text: 'No' },
    ],
  } as unknown as Market
}

function renderProvider(markets: Market[]) {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <PolymarketSocketProvider markets={markets}><div>child</div></PolymarketSocketProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  MockWS.instances = []
  vi.stubGlobal('WebSocket', MockWS as any)
  vi.stubEnv('POLYMARKET_WS_MARKET_URL', 'wss://test.example/ws')
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('polymarketSocketProvider', () => {
  it('does NOT open a socket when there are no polymarket tokens (Kuest-native no-op)', () => {
    const kuest = { condition_id: 'k', is_active: true, is_resolved: false, outcomes: [{ condition_id: 'k', outcome_index: 0, token_id: 'KT', polymarket_token_id: null }] } as unknown as Market
    renderProvider([kuest])
    expect(MockWS.instances).toHaveLength(0)
  })

  it('opens ONE socket and subscribes with YES tokens + custom_feature_enabled', () => {
    renderProvider([yesMarket('c1', 'Y1'), yesMarket('c2', 'Y2')])
    expect(MockWS.instances).toHaveLength(1)
    MockWS.instances[0].open()
    const sub = JSON.parse(MockWS.instances[0].sent.find(s => s.startsWith('{'))!)
    expect(sub).toMatchObject({ type: 'market', custom_feature_enabled: true })
    expect(sub.assets_ids.sort()).toEqual(['Y1', 'Y2'])
    expect(sub.assets_ids).not.toContain('Y1n')
  })

  it('sends a PING heartbeat ~every 10s after open', () => {
    renderProvider([yesMarket('c1', 'Y1')])
    MockWS.instances[0].open()
    MockWS.instances[0].sent.length = 0
    vi.advanceTimersByTime(10_000)
    expect(MockWS.instances[0].sent).toContain('PING')
  })

  it('unmount closes the socket and clears the PING interval (no leak)', () => {
    const { unmount } = renderProvider([yesMarket('c1', 'Y1')])
    const ws = MockWS.instances[0]
    ws.open()
    unmount()
    expect(ws.readyState).toBe(MockWS.CLOSED)
    ws.sent.length = 0
    vi.advanceTimersByTime(30_000)
    expect(ws.sent).not.toContain('PING')
  })

  it('schedules a reconnect on close', () => {
    renderProvider([yesMarket('c1', 'Y1')])
    const first = MockWS.instances[0]
    first.open()
    first.close()
    vi.advanceTimersByTime(2000)
    expect(MockWS.instances.length).toBeGreaterThanOrEqual(2)
  })

  it('does NOT count a visibility-driven close (document.hidden) toward the reconnect cap', () => {
    renderProvider([yesMarket('c1', 'Y1')])
    const ws = MockWS.instances[0]
    ws.open()
    const before = MockWS.instances.length
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    try {
      ws.close() // socket closes while the tab is hidden
      vi.advanceTimersByTime(60_000)
      // no reconnect is scheduled while hidden — the visibility handler resumes on un-hide
      expect(MockWS.instances.length).toBe(before)
    }
    finally {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    }
  })
})
