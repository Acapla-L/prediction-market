'use client'

import type { Market } from '@/types'
import { useQueryClient } from '@tanstack/react-query'
import { createContext, use, useEffect, useMemo, useState } from 'react'
import { applyPolymarketMessage, buildYesTokenMapping } from '@/app/[locale]/(platform)/event/[slug]/_utils/polymarketMarketCache'
import { createWebSocketReconnectController } from '@/lib/websocket-reconnect'

type PolymarketSocketStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'failed'

const HEARTBEAT_MS = 10_000
const MAX_SUBSCRIBED_TOKENS = 90
const MAX_RECONNECT_ATTEMPTS = 6
const BACKOFF_BASE_MS = 1000
const BACKOFF_CAP_MS = 30_000

// Distinct context — intentionally NOT the Kuest MarketChannelContext (no shadowing). Observability only.
const PolymarketSocketContext = createContext<PolymarketSocketStatus>('idle')

function PolymarketSocketProvider({ markets, children }: { markets: Market[], children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<PolymarketSocketStatus>('idle')

  const mapping = useMemo(() => buildYesTokenMapping(markets), [markets])
  const subscribedTokens = useMemo(() => {
    if (mapping.tokenIds.length > MAX_SUBSCRIBED_TOKENS) {
      console.warn(`[polymarket-ws] ${mapping.tokenIds.length} tokens exceeds cap ${MAX_SUBSCRIBED_TOKENS}; subscribing to first ${MAX_SUBSCRIBED_TOKENS}`)
      return mapping.tokenIds.slice(0, MAX_SUBSCRIBED_TOKENS)
    }
    return mapping.tokenIds
  }, [mapping])

  const wsUrl = process.env.POLYMARKET_WS_MARKET_URL
  const tokenSignature = subscribedTokens.join(',')
  const hasChannel = subscribedTokens.length > 0 && Boolean(wsUrl)

  // Derive idle during render so we don't call setStatus inside the effect
  // when props change — avoids the react-you-might-not-need-an-effect lint rule.
  const effectiveStatus: PolymarketSocketStatus = hasChannel ? status : 'idle'

  useEffect(() => {
    if (!hasChannel) {
      return
    }

    let isActive = true
    let ws: WebSocket | null = null
    let pingInterval: ReturnType<typeof setInterval> | null = null
    let failures = 0

    // Mutable reference so event-handler closures can call controller methods
    // even though the controller is constructed after the handler definitions.
    let controllerRef: ReturnType<typeof createWebSocketReconnectController> | null = null

    function clearPing() {
      if (pingInterval != null) {
        clearInterval(pingInterval)
        pingInterval = null
      }
    }

    function handleOpen() {
      if (!ws) {
        return
      }
      failures = 0
      controllerRef?.resetBackoff()
      setStatus('connecting')
      ws.send(JSON.stringify({ type: 'market', assets_ids: subscribedTokens, custom_feature_enabled: true }))
      clearPing()
      pingInterval = setInterval(() => {
        try {
          ws?.send('PING')
        }
        catch {}
      }, HEARTBEAT_MS)
    }

    function handleMessage(eventMessage: MessageEvent<string>) {
      if (!isActive) {
        return
      }
      if (eventMessage.data === 'PONG') {
        return
      }
      setStatus('live')
      let payload: unknown
      try {
        payload = JSON.parse(eventMessage.data)
      }
      catch {
        return
      }
      const items = Array.isArray(payload) ? payload : [payload]
      for (const item of items) {
        applyPolymarketMessage(queryClient, mapping, item)
      }
    }

    function handleError() {
      if (isActive) {
        setStatus('reconnecting')
      }
    }

    function handleClose() {
      if (!isActive) {
        return
      }
      clearPing()
      // A visibility-driven close (tab hidden) is NOT a network failure — do not
      // count it toward the reconnect cap or schedule a reconnect here; the
      // visibility handler resumes the socket on un-hide. This prevents a
      // permanent `failed` latch from repeated tab-switching (review 2026-05-30).
      if (typeof document !== 'undefined' && document.hidden) {
        return
      }
      failures += 1
      if (failures >= MAX_RECONNECT_ATTEMPTS) {
        setStatus('failed')
        return
      }
      setStatus('reconnecting')
      controllerRef?.scheduleReconnect()
    }

    function connect() {
      if (!isActive || ws || (typeof document !== 'undefined' && document.hidden)) {
        return
      }
      setStatus('connecting')
      ws = new WebSocket(`${wsUrl}/ws/market`)
      ws.addEventListener('open', handleOpen)
      ws.addEventListener('message', handleMessage)
      ws.addEventListener('error', handleError)
      ws.addEventListener('close', handleClose)
    }

    controllerRef = createWebSocketReconnectController({
      connect,
      getDelayMs: (attempt) => {
        const base = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS)
        return base / 2 + Math.floor((base / 2) * Math.random())
      },
      getWebSocket: () => ws,
      isActive: () => isActive && failures < MAX_RECONNECT_ATTEMPTS,
      resetWebSocket: () => {
        ws = null
      },
    })

    const controller = controllerRef

    function handleVisibilityChange() {
      if (typeof document !== 'undefined' && document.hidden) {
        clearPing()
        ws?.close()
      }
      else {
        controller.handleVisibilityChange()
      }
    }

    connect()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      isActive = false
      controller.clearReconnect()
      clearPing()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (ws) {
        ws.removeEventListener('open', handleOpen)
        ws.removeEventListener('message', handleMessage)
        ws.removeEventListener('error', handleError)
        ws.removeEventListener('close', handleClose)
        ws.close()
      }
    }
  }, [hasChannel, queryClient, mapping, subscribedTokens, tokenSignature, wsUrl])

  return <PolymarketSocketContext value={effectiveStatus}>{children}</PolymarketSocketContext>
}

export function usePolymarketSocketStatus(): PolymarketSocketStatus {
  return use(PolymarketSocketContext)
}

export default PolymarketSocketProvider
