import { describe, it, expect, beforeEach } from 'vitest'
import { createSessionStore } from '../../src/session/session-store'
import { buildTestSession, clearFixtureCache } from '../../src/testutil/index'

beforeEach(() => clearFixtureCache())

describe('createSessionStore', () => {
  it('create and get returns the session', () => {
    const store   = createSessionStore()
    const session = buildTestSession()
    store.create(session)
    expect(store.get(session.id)).toBe(session)
  })

  it('get unknown id returns null', () => {
    expect(createSessionStore().get('nonexistent')).toBeNull()
  })

  it('delete removes session', () => {
    const store   = createSessionStore()
    const session = buildTestSession()
    store.create(session)
    store.delete(session.id)
    expect(store.get(session.id)).toBeNull()
  })

  it('getAll returns all sessions', () => {
    const store = createSessionStore()
    const s1 = buildTestSession({ id: 's1' })
    const s2 = buildTestSession({ id: 's2' })
    store.create(s1)
    store.create(s2)
    expect(store.getAll().length).toBe(2)
  })

  it('evictExpired removes sessions with lastSseAt > expiry threshold', () => {
    const store   = createSessionStore(1000)
    const session = buildTestSession({ lastSseAt: Date.now() - 2000 })
    store.create(session)
    store.evictExpired()
    expect(store.get(session.id)).toBeNull()
  })

  it('evictExpired does not remove recently-connected sessions', () => {
    const store   = createSessionStore(60_000)
    const session = buildTestSession({ lastSseAt: Date.now() })
    store.create(session)
    store.evictExpired()
    expect(store.get(session.id)).not.toBeNull()
  })

  it('evicted session has status=expired', () => {
    const store   = createSessionStore(1000)
    const session = buildTestSession({ lastSseAt: Date.now() - 2000 })
    store.create(session)
    store.evictExpired()
    expect(session.status).toBe('expired')
  })
})
