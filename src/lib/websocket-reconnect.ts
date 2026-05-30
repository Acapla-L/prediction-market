const DEFAULT_RECONNECT_DELAY_MS = 1500

interface CreateWebSocketReconnectControllerOptions {
  connect: () => void
  delayMs?: number
  getDelayMs?: (attempt: number) => number // NEW: 1-based attempt; overrides delayMs when provided
  getWebSocket: () => WebSocket | null
  isActive: () => boolean
  resetWebSocket: () => void
}

export function createWebSocketReconnectController({
  connect,
  delayMs = DEFAULT_RECONNECT_DELAY_MS,
  getDelayMs,
  getWebSocket,
  isActive,
  resetWebSocket,
}: CreateWebSocketReconnectControllerOptions) {
  let reconnectTimeout: number | null = null
  let attempt = 0 // NEW

  function shouldReconnect() {
    const ws = getWebSocket()
    return !ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING
  }

  function clearReconnect() {
    if (reconnectTimeout != null) {
      window.clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }
  }

  function resetBackoff() { // NEW
    attempt = 0
  }

  function reconnectIfNeeded() {
    if (!isActive() || !shouldReconnect()) {
      return
    }
    resetWebSocket()
    connect()
  }

  function scheduleReconnect() {
    clearReconnect()
    attempt += 1 // NEW
    const delay = getDelayMs ? getDelayMs(attempt) : delayMs // NEW
    reconnectTimeout = window.setTimeout(() => {
      reconnectIfNeeded()
    }, delay)
  }

  function handleVisibilityChange() {
    if (!document.hidden) {
      reconnectIfNeeded()
    }
  }

  return {
    clearReconnect,
    handleVisibilityChange,
    resetBackoff, // NEW
    scheduleReconnect,
  }
}
