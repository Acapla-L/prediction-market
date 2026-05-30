import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWebSocketReconnectController } from '@/lib/websocket-reconnect'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function harness(opts: Partial<Parameters<typeof createWebSocketReconnectController>[0]> = {}) {
  const connect = vi.fn()
  let ws: WebSocket | null = null
  const ctrl = createWebSocketReconnectController({
    connect,
    getWebSocket: () => ws,
    isActive: () => true,
    resetWebSocket: () => {
      ws = null
    },
    ...opts,
  })
  return { connect, ctrl }
}

describe('reconnect backoff extension', () => {
  it('uses getDelayMs(attempt) for each scheduled reconnect', () => {
    const delays: number[] = []
    const { connect, ctrl } = harness({
      getDelayMs: (attempt) => {
        delays.push(attempt)
        return attempt * 1000
      },
    })
    ctrl.scheduleReconnect()
    vi.advanceTimersByTime(1000)
    expect(connect).toHaveBeenCalledTimes(1)
    ctrl.scheduleReconnect()
    vi.advanceTimersByTime(1000)
    expect(connect).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(delays).toEqual([1, 2])
  })

  it('resetBackoff() returns the attempt counter to 0', () => {
    const seen: number[] = []
    const { ctrl } = harness({
      getDelayMs: (a) => {
        seen.push(a)
        return 10
      },
    })
    ctrl.scheduleReconnect()
    vi.advanceTimersByTime(10)
    ctrl.scheduleReconnect()
    vi.advanceTimersByTime(10)
    ctrl.resetBackoff()
    ctrl.scheduleReconnect()
    vi.advanceTimersByTime(10)
    expect(seen).toEqual([1, 2, 1])
  })

  it('without getDelayMs, falls back to fixed delayMs (Kuest default unchanged)', () => {
    const { connect, ctrl } = harness()
    ctrl.scheduleReconnect()
    vi.advanceTimersByTime(1499)
    expect(connect).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(connect).toHaveBeenCalledTimes(1)
  })
})
