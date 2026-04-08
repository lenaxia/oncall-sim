import { describe, it, expect, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import {
  getFixtureScenarioDir,
  getFixtureScenario,
  clearFixtureCache,
  buildTestSession,
  buildTestClock,
  buildFlatSeries,
  buildRampSeries,
  buildAuditLog,
  buildAuditEntry,
  buildTestSnapshot,
  expectEvent,
  expectNoEvent,
  expectAction,
  buildChatMessage,
  buildEmail,
  buildTicket,
  buildTicketComment,
  buildLogEntry,
  buildAlarm,
  buildDeployment,
  buildCoachMessage,
  resetIdCounter,
  getMockLLMProvider,
  buildMockLLMProvider,
} from './index'
import {
  FIXTURE_SCENARIO_ID,
  FIXTURE_SESSION_ID,
  FIXTURE_PERSONA,
  FIXTURE_ALARM,
  FIXTURE_REMEDIATION_ACTION,
} from './fixtures'
import type { SimEvent } from '@shared/types/events'

// ── getFixtureScenarioDir ─────────────────────────────────────────────────────

describe('getFixtureScenarioDir', () => {
  it('returns a path that exists', () => {
    expect(fs.existsSync(getFixtureScenarioDir())).toBe(true)
  })

  it('contains scenario.yaml', () => {
    expect(fs.existsSync(path.join(getFixtureScenarioDir(), 'scenario.yaml'))).toBe(true)
  })

  it('contains mock-llm-responses.yaml', () => {
    expect(fs.existsSync(path.join(getFixtureScenarioDir(), 'mock-llm-responses.yaml'))).toBe(true)
  })
})

// ── getFixtureScenario ────────────────────────────────────────────────────────

describe('getFixtureScenario', () => {
  beforeEach(() => clearFixtureCache())

  it('returns a LoadedScenario with the correct id', () => {
    const scenario = getFixtureScenario()
    expect(scenario.id).toBe('_fixture')
  })

  it('returns cached instance on second call', () => {
    const a = getFixtureScenario()
    const b = getFixtureScenario()
    expect(a).toBe(b)
  })

  it('has at least one persona', () => {
    expect(getFixtureScenario().personas.length).toBeGreaterThan(0)
  })

  it('has opsDashboard with focalService', () => {
    const s = getFixtureScenario()
    expect(s.opsDashboard).toBeDefined()
    expect(s.opsDashboard.focalService.name).toBe('fixture-service')
  })

  it('has at least one alarm', () => {
    expect(getFixtureScenario().alarms.length).toBeGreaterThan(0)
  })

  it('has at least one remediation action', () => {
    expect(getFixtureScenario().remediationActions.length).toBeGreaterThan(0)
  })

  it('evaluation.relevantActions is non-empty', () => {
    expect(getFixtureScenario().evaluation.relevantActions.length).toBeGreaterThan(0)
  })
})

// ── buildTestSession ──────────────────────────────────────────────────────────

describe('buildTestSession', () => {
  it('returns a session with fixture scenario by default', () => {
    const session = buildTestSession()
    expect(session.scenarioId).toBe('_fixture')
    expect(session.status).toBe('active')
  })

  it('accepts overrides', () => {
    const session = buildTestSession({ id: 'custom-id', status: 'resolved' })
    expect(session.id).toBe('custom-id')
    expect(session.status).toBe('resolved')
  })
})

// ── buildTestClock ────────────────────────────────────────────────────────────

describe('buildTestClock', () => {
  it('starts at 0 by default', () => {
    expect(buildTestClock().getSimTime()).toBe(0)
  })

  it('starts at given initial time', () => {
    expect(buildTestClock(60).getSimTime()).toBe(60)
  })

  it('advance() increments sim time', () => {
    const clock = buildTestClock(0)
    clock.advance(30)
    expect(clock.getSimTime()).toBe(30)
    clock.advance(15)
    expect(clock.getSimTime()).toBe(45)
  })

  it('setSimTime() sets absolute time', () => {
    const clock = buildTestClock(0)
    clock.setSimTime(120)
    expect(clock.getSimTime()).toBe(120)
  })
})

// ── buildFlatSeries ───────────────────────────────────────────────────────────

describe('buildFlatSeries', () => {
  it('all values equal the given value', () => {
    const series = buildFlatSeries(42, 0, 60, 15)
    for (const point of series) {
      expect(point.v).toBe(42)
    }
  })

  it('length is (toSecond - fromSecond) / resolutionSeconds + 1', () => {
    expect(buildFlatSeries(1, 0, 60, 15)).toHaveLength(5)
  })

  it('t values match expected range', () => {
    expect(buildFlatSeries(1, -30, 30, 15).map(p => p.t)).toEqual([-30, -15, 0, 15, 30])
  })

  it('works with negative fromSecond', () => {
    const s = buildFlatSeries(5, -120, 0, 60)
    expect(s.map(p => p.t)).toEqual([-120, -60, 0])
  })

  it('single point when fromSecond === toSecond', () => {
    expect(buildFlatSeries(10, 30, 30)).toHaveLength(1)
  })

  it('uses default resolutionSeconds of 15', () => {
    expect(buildFlatSeries(1, 0, 30).map(p => p.t)).toEqual([0, 15, 30])
  })
})

// ── buildRampSeries ───────────────────────────────────────────────────────────

describe('buildRampSeries', () => {
  it('first value equals fromValue', () => {
    expect(buildRampSeries(0, 100, 0, 60, 15)[0].v).toBe(0)
  })

  it('last value equals toValue', () => {
    const s = buildRampSeries(0, 100, 0, 60, 15)
    expect(s[s.length - 1].v).toBe(100)
  })

  it('values are monotonically increasing when toValue > fromValue', () => {
    const s = buildRampSeries(0, 100, 0, 60, 15)
    for (let i = 1; i < s.length; i++) {
      expect(s[i].v).toBeGreaterThan(s[i - 1].v)
    }
  })
})

// ── buildAuditLog ─────────────────────────────────────────────────────────────

describe('buildAuditLog', () => {
  it('fills in defaults for missing fields', () => {
    const log = buildAuditLog([{ action: 'view_metric' }])
    expect(log[0].action).toBe('view_metric')
    expect(log[0].simTime).toBe(0)
    expect(log[0].params).toEqual({})
  })

  it('auto-increments simTime for each entry (i*10)', () => {
    const log = buildAuditLog([{}, {}, {}])
    expect(log.map(e => e.simTime)).toEqual([0, 10, 20])
  })

  it('uses provided simTime when given', () => {
    const log = buildAuditLog([{ simTime: 99, action: 'trigger_rollback' }])
    expect(log[0].simTime).toBe(99)
  })
})

// ── buildTestSnapshot ─────────────────────────────────────────────────────────

describe('buildTestSnapshot', () => {
  it('returns valid defaults', () => {
    const snap = buildTestSnapshot()
    expect(snap.sessionId).toBe('test-session-id')
    expect(snap.simTime).toBe(0)
    expect(snap.emails).toEqual([])
  })

  it('applies overrides', () => {
    const snap = buildTestSnapshot({ simTime: 120, paused: true })
    expect(snap.simTime).toBe(120)
    expect(snap.paused).toBe(true)
  })
})

// ── expectEvent ───────────────────────────────────────────────────────────────

describe('expectEvent', () => {
  const events: SimEvent[] = [
    { type: 'sim_time', simTime: 10, speed: 1, paused: false },
    { type: 'log_entry', entry: { id: 'l1', simTime: 5, level: 'ERROR', service: 'svc', message: 'boom' } },
  ]

  it('returns the matched event', () => {
    const e = expectEvent(events, 'sim_time')
    expect(e.simTime).toBe(10)
  })

  it('throws when event type not found', () => {
    expect(() => expectEvent(events, 'alarm_fired')).toThrow()
  })
})

describe('expectNoEvent', () => {
  const events: SimEvent[] = [
    { type: 'sim_time', simTime: 0, speed: 1, paused: false },
  ]

  it('passes when event type not in array', () => {
    expect(() => expectNoEvent(events, 'alarm_fired')).not.toThrow()
  })

  it('throws when event type is found', () => {
    expect(() => expectNoEvent(events, 'sim_time')).toThrow()
  })
})

describe('expectAction', () => {
  it('returns the matching audit entry', () => {
    const log = buildAuditLog([{ action: 'trigger_rollback', simTime: 60 }])
    const entry = expectAction(log, 'trigger_rollback')
    expect(entry.simTime).toBe(60)
  })

  it('throws when action not found', () => {
    expect(() => expectAction([], 'trigger_rollback')).toThrow()
  })
})

// ── Entity builders ───────────────────────────────────────────────────────────

describe('entity builders', () => {
  beforeEach(() => resetIdCounter())

  it('buildChatMessage returns defaults', () => {
    const msg = buildChatMessage()
    expect(msg.channel).toBe('#incidents')
    expect(msg.persona).toBe('fixture-persona')
    expect(typeof msg.id).toBe('string')
  })

  it('buildChatMessage accepts overrides', () => {
    const msg = buildChatMessage({ channel: 'dm:persona-1', text: 'hi' })
    expect(msg.channel).toBe('dm:persona-1')
    expect(msg.text).toBe('hi')
  })

  it('buildEmail returns defaults', () => {
    expect(buildEmail().from).toBe('fixture-persona')
  })

  it('buildTicket returns defaults', () => {
    const t = buildTicket()
    expect(t.severity).toBe('SEV2')
    expect(t.status).toBe('open')
  })

  it('buildTicketComment requires ticketId', () => {
    expect(buildTicketComment('ticket-001').ticketId).toBe('ticket-001')
  })

  it('buildLogEntry returns defaults', () => {
    expect(buildLogEntry().level).toBe('ERROR')
  })

  it('buildAlarm returns defaults', () => {
    expect(buildAlarm().status).toBe('firing')
  })

  it('buildDeployment returns defaults', () => {
    expect(buildDeployment().status).toBe('active')
  })

  it('buildCoachMessage returns defaults', () => {
    expect(buildCoachMessage().proactive).toBe(true)
  })

  it('sequential builders produce unique ids', () => {
    expect(buildChatMessage().id).not.toBe(buildChatMessage().id)
  })

  it('resetIdCounter causes ids to restart', () => {
    const a = buildChatMessage()
    resetIdCounter()
    const b = buildChatMessage()
    expect(a.id).toBe(b.id)
  })
})

// ── buildAuditEntry ───────────────────────────────────────────────────────────

describe('buildAuditEntry', () => {
  it('builds entry with given action and defaults', () => {
    const entry = buildAuditEntry('view_metric')
    expect(entry.action).toBe('view_metric')
    expect(entry.simTime).toBe(0)
    expect(entry.params).toEqual({})
  })

  it('accepts params and simTime', () => {
    const entry = buildAuditEntry('trigger_rollback', { service: 'svc' }, 42)
    expect(entry.params).toEqual({ service: 'svc' })
    expect(entry.simTime).toBe(42)
  })
})

// ── fixtures.ts constants ─────────────────────────────────────────────────────

describe('fixture constants', () => {
  it('FIXTURE_SCENARIO_ID is _fixture', () => {
    expect(FIXTURE_SCENARIO_ID).toBe('_fixture')
  })

  it('FIXTURE_SESSION_ID is test-session-id', () => {
    expect(FIXTURE_SESSION_ID).toBe('test-session-id')
  })

  it('FIXTURE_PERSONA has correct shape', () => {
    expect(FIXTURE_PERSONA.id).toBe('fixture-persona')
    expect(FIXTURE_PERSONA.systemPrompt.length).toBeGreaterThan(0)
  })

  it('FIXTURE_ALARM has correct shape', () => {
    expect(FIXTURE_ALARM.service).toBe('fixture-service')
    expect(FIXTURE_ALARM.metricId).toBe('error_rate')
    expect(FIXTURE_ALARM.autoPage).toBe(true)
  })

  it('FIXTURE_REMEDIATION_ACTION is rollback with isCorrectFix=true', () => {
    expect(FIXTURE_REMEDIATION_ACTION.type).toBe('rollback')
    expect(FIXTURE_REMEDIATION_ACTION.isCorrectFix).toBe(true)
  })
})

// ── getMockLLMProvider / buildMockLLMProvider (Phase 5 fulfilled) ─────────────

describe('mock LLM provider', () => {
  it('getMockLLMProvider returns a working MockProvider', async () => {
    const provider = getMockLLMProvider()
    expect(provider).toBeDefined()
    expect(typeof provider.call).toBe('function')
    const resp = await provider.call({
      role: 'debrief', messages: [], tools: [], sessionId: 'test',
    })
    expect(typeof resp.text).toBe('string')
  })

  it('buildMockLLMProvider builds provider with given responses', async () => {
    const responses = {
      stakeholder_responses: [],
      coach_responses:       [],
      debrief_response:      { narrative: 'custom narrative' },
    }
    const provider = buildMockLLMProvider(responses)
    const resp = await provider.call({ role: 'debrief', messages: [], tools: [], sessionId: 's' })
    expect(resp.text).toBe('custom narrative')
  })
})
