// sse-broker.ts — manages SSE connections per session.

import type { Response } from 'express'
import type { SimEvent } from '@shared/types/events'
import type { SessionStore } from '../session/session-store'

export interface SSEBroker {
  // Register a new SSE connection. Immediately sends session_snapshot as first event.
  // Returns cleanup function — call on connection close.
  connect(sessionId: string, res: Response): () => void

  // Broadcast a SimEvent to all active connections for a session.
  broadcast(sessionId: string, event: SimEvent): void

  // Number of active connections for a session (for health checks).
  connectionCount(sessionId: string): number
}

export function createSSEBroker(sessionStore: SessionStore): SSEBroker {
  // sessionId → connectionId → write function
  const _writers = new Map<string, Map<symbol, (event: SimEvent) => void>>()

  function writeEvent(res: Response, event: SimEvent): void {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    } catch {
      // Connection already closed — ignore
    }
  }

  return {
    connect(sessionId, res) {
      // 1. Set SSE headers
      res.setHeader('Content-Type',      'text/event-stream')
      res.setHeader('Cache-Control',     'no-cache')
      res.setHeader('Connection',        'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')  // nginx: disable buffering
      res.flushHeaders()

      // 2. Validate session
      const session = sessionStore.get(sessionId)
      if (!session || session.status === 'expired') {
        writeEvent(res, { type: 'session_expired', reason: 'Session not found or expired' })
        res.end()
        return () => { /* no-op */ }
      }

      // 3. Update lastSseAt
      session.lastSseAt = Date.now()

      // 4. Send session_snapshot as first event
      const snapshot = session.gameLoop.getSnapshot()
      writeEvent(res, { type: 'session_snapshot', snapshot })

      // 5. Register write function
      const connId: symbol = Symbol('sse-conn')
      const writeFn = (event: SimEvent) => writeEvent(res, event)

      if (!_writers.has(sessionId)) {
        _writers.set(sessionId, new Map())
      }
      _writers.get(sessionId)!.set(connId, writeFn)

      // Register with game loop to forward all future events; capture cleanup
      const removeHandler = session.gameLoop.onEvent(writeFn)

      // Heartbeat every 15 real seconds to prevent proxy timeouts.
      // Also refreshes lastSseAt so the session isn't evicted while actively connected.
      const heartbeat = setInterval(() => {
        try {
          res.write(': heartbeat\n\n')
          session.lastSseAt = Date.now()
        } catch { /* closed */ }
      }, 15_000)

      // 6. Return cleanup function
      return () => {
        clearInterval(heartbeat)
        removeHandler()
        const sessionWriters = _writers.get(sessionId)
        if (sessionWriters) {
          sessionWriters.delete(connId)
          if (sessionWriters.size === 0) {
            _writers.delete(sessionId)
          }
        }
      }
    },

    broadcast(sessionId, event) {
      const writers = _writers.get(sessionId)
      if (!writers) return
      for (const write of writers.values()) write(event)
    },

    connectionCount(sessionId) {
      return _writers.get(sessionId)?.size ?? 0
    },
  }
}
