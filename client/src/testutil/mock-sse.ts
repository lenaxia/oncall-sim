import type { SimEvent } from '@shared/types/events'

export interface MockSSEConnection {
  emit(event: SimEvent): void
  disconnect(): void
  reconnect(): void
  setHandler(fn: (event: SimEvent) => void): void
  setOnDisconnect(fn: () => void): void
  setOnReconnect(fn: () => void): void
  isConnected: boolean
}

export function buildMockSSE(): MockSSEConnection {
  let _handler:      ((event: SimEvent) => void) | null = null
  let _onDisconnect: (() => void) | null = null
  let _onReconnect:  (() => void) | null = null
  let _connected = true

  const mock: MockSSEConnection = {
    get isConnected() { return _connected },
    setHandler(fn) { _handler = fn },
    setOnDisconnect(fn) { _onDisconnect = fn },
    setOnReconnect(fn)  { _onReconnect  = fn },
    emit(event) {
      if (_handler) _handler(event)
    },
    disconnect() {
      _connected = false
      if (_onDisconnect) _onDisconnect()
    },
    reconnect() {
      _connected = true
      if (_onReconnect) _onReconnect()
    },
  }
  return mock
}
