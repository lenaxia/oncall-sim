// session-store.ts — in-memory session registry with expiry.

import type { Session } from './session'
import { logger } from '../logger'

const log = logger.child({ component: 'session-store' })

export interface SessionStore {
  create(session: Session): void
  get(sessionId: string): Session | null
  delete(sessionId: string): void
  getAll(): Session[]
  evictExpired(): void
}

const DEFAULT_EXPIRY_MS = 600_000  // 10 minutes

export function createSessionStore(expiryMs = DEFAULT_EXPIRY_MS): SessionStore {
  const _sessions = new Map<string, Session>()

  return {
    create(session) {
      _sessions.set(session.id, session)
    },

    get(sessionId) {
      return _sessions.get(sessionId) ?? null
    },

    delete(sessionId) {
      _sessions.delete(sessionId)
    },

    getAll() {
      return [..._sessions.values()]
    },

    evictExpired() {
      const now = Date.now()
      for (const [id, session] of _sessions.entries()) {
        if (now - session.lastSseAt > expiryMs) {
          session.gameLoop.stop()
          session.status = 'expired'
          _sessions.delete(id)
          log.info({ sessionId: id }, 'Evicted expired session')
        }
      }
    },
  }
}
