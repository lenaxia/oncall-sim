import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSSEBroker } from '../../src/sse/sse-broker'
import { createSessionStore } from '../../src/session/session-store'
import { buildTestSession, clearFixtureCache } from '../../src/testutil/index'
import type { Response } from 'express'
import type { SimEvent } from '@shared/types/events'

beforeEach(() => clearFixtureCache())

function makeResponse(): { res: Response; written: string[] } {
  const written: string[] = []
  const res = {
    setHeader:     vi.fn(),
    flushHeaders:  vi.fn(),
    write:         vi.fn((data: string) => { written.push(data) }),
    end:           vi.fn(),
    on:            vi.fn(),
  } as unknown as Response
  return { res, written }
}

function makeSession(id = 'session-1') {
  return buildTestSession({ id })
}

function parseEvents(written: string[]): SimEvent[] {
  return written
    .filter(w => w.startsWith('data:'))
    .map(w => JSON.parse(w.replace('data: ', '').trim()) as SimEvent)
}

describe('SSEBroker — connect', () => {
  it('first event sent is session_snapshot', () => {
    const store = createSessionStore()
    const session = makeSession()
    store.create(session)

    const broker = createSSEBroker(store)
    const { res, written } = makeResponse()
    broker.connect(session.id, res)

    const events = parseEvents(written)
    expect(events[0].type).toBe('session_snapshot')
  })

  it('session_snapshot contains correct sessionId', () => {
    const store = createSessionStore()
    const session = makeSession('my-session')
    store.create(session)

    const broker = createSSEBroker(store)
    const { res, written } = makeResponse()
    broker.connect(session.id, res)

    const events = parseEvents(written)
    const snap = events.find(e => e.type === 'session_snapshot')
    expect(snap).toBeDefined()
    if (snap?.type === 'session_snapshot') {
      expect(snap.snapshot.sessionId).toBe('my-session')
      // Fresh session starts at simTime=0 (clock initialised to 0, no ticks yet)
      expect(snap.snapshot.simTime).toBe(0)
    }
  })

  it('connect to unknown session sends session_expired event', () => {
    const store  = createSessionStore()
    const broker = createSSEBroker(store)
    const { res, written } = makeResponse()
    broker.connect('ghost-id', res)

    const events = parseEvents(written)
    expect(events[0].type).toBe('session_expired')
  })

  it('cleanup function called on disconnect removes event handler', () => {
    const store = createSessionStore()
    const session = makeSession()
    store.create(session)

    const broker = createSSEBroker(store)
    const { res } = makeResponse()
    const cleanup = broker.connect(session.id, res)

    expect(broker.connectionCount(session.id)).toBe(1)
    cleanup()
    expect(broker.connectionCount(session.id)).toBe(0)
  })

  it('after cleanup, game loop no longer emits to the disconnected response', () => {
    const store = createSessionStore()
    const session = makeSession()
    store.create(session)

    const broker = createSSEBroker(store)
    const { res, written } = makeResponse()
    const cleanup = broker.connect(session.id, res)
    const countAfterConnect = written.length

    cleanup()

    // Emit an event through the game loop directly — should not reach the closed res
    session.gameLoop.handleAction('open_tab', { tab: 'logs' })

    // written count must not increase after cleanup
    expect(written.length).toBe(countAfterConnect)
  })

  it('updates lastSseAt on connect', () => {
    const store = createSessionStore()
    const session = makeSession()
    const oldTime = session.lastSseAt = Date.now() - 5000
    store.create(session)

    const broker = createSSEBroker(store)
    const { res } = makeResponse()
    broker.connect(session.id, res)

    expect(session.lastSseAt).toBeGreaterThan(oldTime)
  })
})

describe('SSEBroker — broadcast', () => {
  it('event delivered to all active connections for session', () => {
    const store = createSessionStore()
    const session = makeSession()
    store.create(session)

    const broker = createSSEBroker(store)
    const { res: res1, written: w1 } = makeResponse()
    const { res: res2, written: w2 } = makeResponse()
    broker.connect(session.id, res1)
    broker.connect(session.id, res2)

    const event: SimEvent = { type: 'sim_time', simTime: 10, speed: 1, paused: false }
    broker.broadcast(session.id, event)

    const e1 = parseEvents(w1).find(e => e.type === 'sim_time')
    const e2 = parseEvents(w2).find(e => e.type === 'sim_time')
    expect(e1).toBeDefined()
    expect(e2).toBeDefined()
  })

  it('event not delivered to connections for other sessions', () => {
    const store = createSessionStore()
    const s1 = makeSession('s1')
    const s2 = makeSession('s2')
    store.create(s1)
    store.create(s2)

    const broker = createSSEBroker(store)
    const { res: r2, written: w2 } = makeResponse()
    broker.connect(s2.id, r2)
    const initialCount = w2.length

    const event: SimEvent = { type: 'sim_time', simTime: 10, speed: 1, paused: false }
    broker.broadcast('s1', event)  // broadcast to s1 only

    expect(w2.length).toBe(initialCount)  // s2 should not receive it
  })
})
