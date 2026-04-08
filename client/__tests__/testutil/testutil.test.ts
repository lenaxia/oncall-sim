import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildTestSnapshot,
  buildFlatSeries,
  buildAuditEntry,
  buildMockSSE,
  buildChatMessage,
  buildEmail,
  buildTicket,
  buildTicketComment,
  buildLogEntry,
  buildAlarm,
  buildDeployment,
  buildCoachMessage,
  resetIdCounter,
} from '../../src/testutil/index'
import type { SimEvent } from '@shared/types/events'

describe('buildTestSnapshot', () => {
  it('returns a valid default snapshot', () => {
    const snap = buildTestSnapshot()
    expect(snap.sessionId).toBe('test-session-id')
    expect(snap.scenarioId).toBe('_fixture')
    expect(snap.simTime).toBe(0)
    expect(snap.speed).toBe(1)
    expect(snap.paused).toBe(false)
    expect(snap.emails).toEqual([])
    expect(snap.chatChannels).toEqual({})
    expect(snap.coachMessages).toEqual([])
  })

  it('applies overrides', () => {
    const snap = buildTestSnapshot({ simTime: 300, speed: 5 })
    expect(snap.simTime).toBe(300)
    expect(snap.speed).toBe(5)
  })
})

describe('buildFlatSeries', () => {
  it('all values equal the given value', () => {
    const series = buildFlatSeries(10, 0, 45, 15)
    expect(series.every(p => p.v === 10)).toBe(true)
  })

  it('produces correct t values', () => {
    const series = buildFlatSeries(1, -30, 30, 15)
    expect(series.map(p => p.t)).toEqual([-30, -15, 0, 15, 30])
  })
})

describe('buildAuditEntry', () => {
  it('returns entry with given action', () => {
    const entry = buildAuditEntry('view_metric', { service: 'svc' }, 60)
    expect(entry.action).toBe('view_metric')
    expect(entry.params).toEqual({ service: 'svc' })
    expect(entry.simTime).toBe(60)
  })
})

describe('buildMockSSE', () => {
  it('starts connected', () => {
    const sse = buildMockSSE()
    expect(sse.isConnected).toBe(true)
  })

  it('emit calls the registered handler', () => {
    const sse = buildMockSSE()
    const received: SimEvent[] = []
    sse.setHandler(e => received.push(e))

    const event: SimEvent = { type: 'sim_time', simTime: 10, speed: 1, paused: false }
    sse.emit(event)
    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(event)
  })

  it('disconnect sets isConnected to false and calls onDisconnect', () => {
    const sse = buildMockSSE()
    let disconnected = false
    sse.setOnDisconnect(() => { disconnected = true })
    sse.disconnect()
    expect(sse.isConnected).toBe(false)
    expect(disconnected).toBe(true)
  })

  it('reconnect sets isConnected to true and calls onReconnect', () => {
    const sse = buildMockSSE()
    sse.disconnect()
    let reconnected = false
    sse.setOnReconnect(() => { reconnected = true })
    sse.reconnect()
    expect(sse.isConnected).toBe(true)
    expect(reconnected).toBe(true)
  })

  it('emit with no handler registered does not throw', () => {
    const sse = buildMockSSE()
    expect(() => sse.emit({ type: 'sim_time', simTime: 0, speed: 1, paused: false })).not.toThrow()
  })
})

describe('entity builders', () => {
  beforeEach(() => resetIdCounter())

  it('buildChatMessage returns defaults', () => {
    const msg = buildChatMessage()
    expect(msg.channel).toBe('#incidents')
    expect(typeof msg.id).toBe('string')
  })

  it('buildEmail returns defaults', () => {
    const email = buildEmail()
    expect(email.from).toBe('fixture-persona')
  })

  it('buildTicket returns defaults', () => {
    const ticket = buildTicket()
    expect(ticket.severity).toBe('SEV2')
    expect(ticket.status).toBe('open')
  })

  it('buildTicketComment binds ticketId', () => {
    const comment = buildTicketComment('ticket-123')
    expect(comment.ticketId).toBe('ticket-123')
  })

  it('buildLogEntry returns defaults', () => {
    const log = buildLogEntry()
    expect(log.level).toBe('ERROR')
  })

  it('buildAlarm returns defaults', () => {
    const alarm = buildAlarm()
    expect(alarm.status).toBe('firing')
  })

  it('buildDeployment returns defaults', () => {
    const dep = buildDeployment()
    expect(dep.status).toBe('active')
  })

  it('buildCoachMessage returns defaults', () => {
    const msg = buildCoachMessage()
    expect(msg.proactive).toBe(true)
  })

  it('sequential builders produce unique ids', () => {
    const a = buildChatMessage()
    const b = buildChatMessage()
    expect(a.id).not.toBe(b.id)
  })

  it('resetIdCounter restarts ids', () => {
    const a = buildChatMessage()
    resetIdCounter()
    const b = buildChatMessage()
    expect(a.id).toBe(b.id)
  })
})
