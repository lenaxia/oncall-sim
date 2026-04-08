// Server-side test utilities used by all phases.
// Phase 1 provides all helpers defined in LLD 01 §8.
// Phase 5 fulfills getMockLLMProvider / buildMockLLMProvider bodies.

import path from 'path'
import fs from 'fs'
import yaml from 'js-yaml'
import { expect } from 'vitest'
import type {
  SessionSnapshot,
  TimeSeriesPoint,
  AuditEntry,
  ActionType,
  SimEvent,
  ChatMessage,
  EmailMessage,
  Ticket,
  TicketComment,
  LogEntry,
  Alarm,
  Deployment,
  CoachMessage,
} from '@shared/types/events'
import type { LoadedScenario, AlarmConfig, RemediationActionConfig } from '../scenario/types'

// ── Fixture paths ─────────────────────────────────────────────────────────────

export function getFixtureScenarioDir(): string {
  return path.resolve(__dirname, '../../../scenarios/_fixture')
}

// Returns the parsed, validated fixture scenario. Cached after first load.
// NOTE: This is a raw parse of the YAML — the loader (Phase 3) does the full
// transform. For Phase 1/2/4 tests that need a LoadedScenario we cast the
// parsed YAML to LoadedScenario via a minimal transform. Full loader tests
// use loadScenario() directly.
let _cachedFixture: LoadedScenario | null = null

export function getFixtureScenario(): LoadedScenario {
  if (_cachedFixture) return _cachedFixture
  const yamlPath = path.join(getFixtureScenarioDir(), 'scenario.yaml')
  const raw = yaml.load(fs.readFileSync(yamlPath, 'utf8')) as Record<string, unknown>
  // Minimal camelCase transform sufficient for unit tests in Phases 2–4.
  // The full transform is validated in Phase 3 loader tests.
  _cachedFixture = rawToLoadedScenario(raw)
  return _cachedFixture
}

/** Clears the fixture cache — useful if a test mutates the returned object. */
export function clearFixtureCache(): void {
  _cachedFixture = null
}

// Minimal raw→LoadedScenario transform for test purposes only.
// Does NOT validate cross-references or resolve file references.
function rawToLoadedScenario(raw: Record<string, unknown>): LoadedScenario {
  const timeline = raw.timeline as Record<string, unknown>
  const topology = raw.topology as Record<string, unknown>
  const engine   = raw.engine as Record<string, unknown>
  const ops      = raw.ops_dashboard as Record<string, unknown>
  const focalRaw = ops.focal_service as Record<string, unknown>
  const scaleRaw = focalRaw.scale as Record<string, unknown>

  return {
    id:          raw.id as string,
    title:       raw.title as string,
    description: raw.description as string,
    serviceType: raw.service_type as LoadedScenario['serviceType'],
    difficulty:  raw.difficulty as LoadedScenario['difficulty'],
    tags:        (raw.tags as string[]) ?? [],
    timeline: {
      defaultSpeed:    timeline.default_speed as 1 | 2 | 5 | 10,
      durationMinutes: timeline.duration_minutes as number,
    },
    topology: {
      focalService: topology.focal_service as string,
      upstream:     (topology.upstream as string[]) ?? [],
      downstream:   (topology.downstream as string[]) ?? [],
    },
    engine: {
      tickIntervalSeconds: engine.tick_interval_seconds as number,
      llmEventTools:       ((engine.llm_event_tools ?? []) as Array<Record<string, unknown>>).map(t => ({
        tool:           t.tool as string,
        enabled:        t.enabled as boolean | undefined,
        maxCalls:       t.max_calls as number | undefined,
        requiresAction: t.requires_action as string | undefined,
        services:       t.services as string[] | undefined,
      })),
    },
    personas: ((raw.personas ?? []) as Array<Record<string, unknown>>).map(p => ({
      id:                   p.id as string,
      displayName:          p.display_name as string,
      avatarColor:          p.avatar_color as string | undefined,
      initiatesContact:     p.initiates_contact as boolean,
      cooldownSeconds:      p.cooldown_seconds as number,
      silentUntilContacted: p.silent_until_contacted as boolean,
      systemPrompt:         p.system_prompt as string,
    })),
    alarms: ((raw.alarms ?? []) as Array<Record<string, unknown>>).map(a => ({
      id:          a.id as string,
      service:     a.service as string,
      metricId:    a.metric_id as string,
      condition:   a.condition as string,
      severity:    a.severity as AlarmConfig['severity'],
      onsetSecond: a.onset_second as number,
      autoPage:    a.auto_page as boolean,
      pageMessage: a.page_message as string | undefined,
    })),
    remediationActions: ((raw.remediation_actions ?? []) as Array<Record<string, unknown>>).map(r => ({
      id:            r.id as string,
      type:          r.type as RemediationActionConfig['type'],
      service:       r.service as string,
      isCorrectFix:  r.is_correct_fix as boolean,
      sideEffect:    r.side_effect as string | undefined,
      targetVersion: r.target_version as string | undefined,
    })),
    evaluation: (() => {
      const e = raw.evaluation as Record<string, unknown>
      return {
        rootCause:       e.root_cause as string,
        relevantActions: (e.relevant_actions as Array<Record<string, unknown>>).map(a => ({
          action:               a.action as string,
          why:                  a.why as string,
          service:              a.service as string | undefined,
          remediationActionId:  a.remediation_action_id as string | undefined,
        })),
        redHerrings: (e.red_herrings as Array<Record<string, unknown>>).map(a => ({
          action: a.action as string,
          why:    a.why as string,
        })),
        debriefContext: e.debrief_context as string,
      }
    })(),
    emails: ((raw.email ?? []) as Array<Record<string, unknown>>).map(e => ({
      id:       e.id as string,
      atSecond: e.at_second as number,
      threadId: e.thread_id as string,
      from:     e.from as string,
      to:       e.to as string,
      subject:  e.subject as string,
      body:     (e.body ?? '') as string,
    })),
    chat: (() => {
      const c = raw.chat as Record<string, unknown>
      return {
        channels: ((c.channels ?? []) as Array<Record<string, unknown>>).map(ch => ({
          id: ch.id as string, name: ch.name as string,
        })),
        messages: ((c.messages ?? []) as Array<Record<string, unknown>>).map(m => ({
          id:       m.id as string,
          atSecond: m.at_second as number,
          channel:  m.channel as string,
          persona:  m.persona as string,
          text:     m.text as string,
        })),
      }
    })(),
    tickets: ((raw.ticketing ?? []) as Array<Record<string, unknown>>).map(t => ({
      id:          t.id as string,
      title:       t.title as string,
      severity:    t.severity as 'SEV1'|'SEV2'|'SEV3'|'SEV4',
      status:      t.status as 'open'|'in_progress'|'resolved',
      description: (t.description ?? '') as string,
      createdBy:   t.created_by as string,
      atSecond:    t.at_second as number,
    })),
    opsDashboard: {
      preIncidentSeconds: ops.pre_incident_seconds as number,
      resolutionSeconds:  ops.resolution_seconds as number,
      focalService: {
        name:           focalRaw.name as string,
        scale: {
          typicalRps:      scaleRaw.typical_rps as number,
          instanceCount:   scaleRaw.instance_count as number | undefined,
          maxConnections:  scaleRaw.max_connections as number | undefined,
        },
        trafficProfile: focalRaw.traffic_profile as FocalTrafficProfile,
        health:         focalRaw.health as 'healthy'|'degraded'|'flaky',
        incidentType:   focalRaw.incident_type as string,
        metrics:        ((focalRaw.metrics ?? []) as Array<Record<string, unknown>>).map(transformMetric),
      },
      correlatedServices: ((ops.correlated_services ?? []) as Array<Record<string, unknown>>).map(cs => ({
        name:         cs.name as string,
        correlation:  cs.correlation as 'upstream_impact'|'exonerated'|'independent',
        lagSeconds:   cs.lag_seconds as number | undefined,
        impactFactor: cs.impact_factor as number | undefined,
        health:       cs.health as 'healthy'|'degraded'|'flaky',
        overrides:    ((cs.overrides ?? []) as Array<Record<string, unknown>>).map(transformMetric),
      })),
    },
    logs: ((raw.logs ?? []) as Array<Record<string, unknown>>).map(l => ({
      id:       l.id as string,
      atSecond: l.at_second as number,
      level:    l.level as 'DEBUG'|'INFO'|'WARN'|'ERROR',
      service:  l.service as string,
      message:  l.message as string,
    })),
    wiki: (() => {
      const w = raw.wiki as Record<string, unknown>
      return {
        pages: ((w.pages ?? []) as Array<Record<string, unknown>>).map(p => ({
          title:   p.title as string,
          content: (p.content ?? '') as string,
        })),
      }
    })(),
    cicd: (() => {
      const c = raw.cicd as Record<string, unknown>
      return {
        pipelines: ((c.pipelines ?? []) as Array<Record<string, unknown>>).map(p => ({
          id: p.id as string, service: p.service as string, name: p.name as string,
        })),
        deployments: ((c.deployments ?? []) as Array<Record<string, unknown>>).map(d => ({
          service:       d.service as string,
          version:       d.version as string,
          deployedAtSec: d.deployed_at_sec as number,
          status:        d.status as 'active'|'previous'|'rolled_back',
          commitMessage: d.commit_message as string,
          author:        d.author as string,
        })),
      }
    })(),
  }
}

type FocalTrafficProfile = 'business_hours_web'|'business_hours_b2b'|'always_on_api'|'batch_nightly'|'batch_weekly'|'none'

function transformMetric(m: Record<string, unknown>) {
  const ir = m.incident_response as Record<string, unknown> | undefined
  return {
    archetype:          m.archetype as string,
    label:              m.label as string | undefined,
    unit:               m.unit as string | undefined,
    baselineValue:      m.baseline_value as number | undefined,
    warningThreshold:   m.warning_threshold as number | undefined,
    criticalThreshold:  m.critical_threshold as number | undefined,
    noise:              m.noise as 'low'|'medium'|'high'|'extreme' | undefined,
    incidentPeak:       m.incident_peak as number | undefined,
    onsetSecond:        m.onset_second as number | undefined,
    incidentResponse:   ir ? {
      overlay:                   ir.overlay as string,
      onsetSecond:               ir.onset_second as number | undefined,
      peakValue:                 ir.peak_value as number | undefined,
      dropFactor:                ir.drop_factor as number | undefined,
      rampDurationSeconds:       ir.ramp_duration_seconds as number | undefined,
      saturationDurationSeconds: ir.saturation_duration_seconds as number | undefined,
    } : undefined,
    seriesOverride: m.series_override as Array<{t: number; v: number}> | undefined,
  }
}

// ── Session builder ───────────────────────────────────────────────────────────

// Session is defined in LLD 06. TestSession mirrors the full Session interface
// so tests can use buildTestSession() without importing session.ts directly.
import type { Session, DebriefResult, SessionStatus } from '../session/session'
import { createEventScheduler } from '../engine/event-scheduler'
import { createAuditLog as createAL } from '../engine/audit-log'
import { createConversationStore as createCS } from '../engine/conversation-store'
import { createEvaluator as createEV } from '../engine/evaluator'
import { createGameLoop } from '../engine/game-loop'
import { generateAllMetrics } from '../metrics/generator'
export type { Session, DebriefResult, SessionStatus }

export function buildTestSession(overrides: Partial<Session> = {}): Session {
  const sessionId = overrides.id ?? 'test-session-id'
  const scenario  = overrides.scenario ?? getFixtureScenario()
  const clock     = overrides.gameLoop ? undefined : buildTestClock(0)
  const gameLoop  = overrides.gameLoop ?? createGameLoop({
    scenario,
    sessionId,
    clock:     clock!,
    scheduler:  createEventScheduler(scenario),
    auditLog:   createAL(),
    store:      createCS(),
    evaluator:  createEV(),
    metrics:    generateAllMetrics(scenario, sessionId),
  })
  return {
    id:         sessionId,
    scenarioId: scenario.id,
    scenario,
    gameLoop,
    debrief:    null,
    createdAt:  Date.now(),
    lastSseAt:  Date.now(),
    status:     'active',
    ...overrides,
  }
}

// ── Sim clock ─────────────────────────────────────────────────────────────────

// TestSimClock implements the SimClock interface from LLD 04 engine/sim-clock.ts.
// It extends the interface with advance() and setSimTime() for deterministic
// test control, and provides no-op implementations of pause/resume/speed.
import type { SimClock } from '../engine/sim-clock'

export interface TestSimClock extends SimClock {
  /** Advance sim time by the given number of sim seconds (test helper). */
  advance(simSeconds: number): void
  /** Set sim time to an absolute value (test helper). */
  setSimTime(simSeconds: number): void
}

export function buildTestClock(initialSimTime = 0): TestSimClock {
  let _simTime = initialSimTime
  let _speed:  1 | 2 | 5 | 10 = 1
  let _paused  = false

  return {
    advance(simSeconds: number)    { _simTime += simSeconds },
    setSimTime(simSeconds: number) { _simTime = simSeconds },

    // SimClock interface
    getSimTime()                   { return _simTime },
    tick(realElapsedMs: number)    { if (!_paused) _simTime += (realElapsedMs / 1000) * _speed },
    setSpeed(speed)                { _speed = speed },
    getSpeed()                     { return _speed },
    pause()                        { _paused = true },
    resume()                       { _paused = false },
    isPaused()                     { return _paused },
    toSimTimeEvent()               { return { type: 'sim_time' as const, simTime: _simTime, speed: _speed, paused: _paused } },
  }
}

// ── Audit log helpers ─────────────────────────────────────────────────────────

export function buildAuditLog(entries: Partial<AuditEntry>[]): AuditEntry[] {
  return entries.map((e, i) => ({
    simTime: e.simTime ?? i * 10,
    action:  e.action  ?? 'open_tab',
    params:  e.params  ?? {},
  }))
}

export function buildAuditEntry(
  action: ActionType,
  params: Record<string, unknown> = {},
  simTime = 0
): AuditEntry {
  return { simTime, action, params }
}

// ── Assertion helpers ─────────────────────────────────────────────────────────

export function expectEvent<T extends SimEvent['type']>(
  events: SimEvent[],
  type: T
): Extract<SimEvent, { type: T }> {
  const found = events.find(e => e.type === type)
  expect(found, `Expected event of type '${type}' in events array`).toBeDefined()
  return found as Extract<SimEvent, { type: T }>
}

export function expectNoEvent(events: SimEvent[], type: SimEvent['type']): void {
  const found = events.find(e => e.type === type)
  expect(found, `Expected no event of type '${type}' but found one`).toBeUndefined()
}

export function expectAction(log: AuditEntry[], action: ActionType): AuditEntry {
  const found = log.find(e => e.action === action)
  expect(found, `Expected action '${action}' in audit log`).toBeDefined()
  return found!
}

// ── Time-series builders ──────────────────────────────────────────────────────

export function buildFlatSeries(
  value: number,
  fromSecond: number,
  toSecond: number,
  resolutionSeconds = 15
): TimeSeriesPoint[] {
  const points: TimeSeriesPoint[] = []
  for (let t = fromSecond; t <= toSecond; t += resolutionSeconds) {
    points.push({ t, v: value })
  }
  return points
}

export function buildRampSeries(
  fromValue: number,
  toValue: number,
  fromSecond: number,
  toSecond: number,
  resolutionSeconds = 15
): TimeSeriesPoint[] {
  const points: TimeSeriesPoint[] = []
  const duration = toSecond - fromSecond
  for (let t = fromSecond; t <= toSecond; t += resolutionSeconds) {
    const fraction = duration === 0 ? 1 : (t - fromSecond) / duration
    points.push({ t, v: fromValue + fraction * (toValue - fromValue) })
  }
  return points
}

// ── Snapshot builder ──────────────────────────────────────────────────────────

export function buildTestSnapshot(
  overrides: Partial<SessionSnapshot> = {}
): SessionSnapshot {
  return {
    sessionId:      'test-session-id',
    scenarioId:     '_fixture',
    simTime:        0,
    speed:          1,
    paused:         false,
    emails:         [],
    chatChannels:   {},
    tickets:        [],
    ticketComments: {},
    logs:           [],
    metrics:        {},
    alarms:         [],
    deployments:    {},
    auditLog:       [],
    coachMessages:  [],
    ...overrides,
  }
}

// ── Entity builders ───────────────────────────────────────────────────────────

let _idCounter = 0
function nextId(prefix = 'id'): string {
  return `${prefix}-${++_idCounter}`
}

export function resetIdCounter(): void {
  _idCounter = 0
}

export function buildChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id:      nextId('msg'),
    channel: '#incidents',
    persona: 'fixture-persona',
    text:    'test message',
    simTime: 0,
    ...overrides,
  }
}

export function buildEmail(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id:       nextId('email'),
    threadId: 'thread-001',
    from:     'fixture-persona',
    to:       'trainee',
    subject:  'Test email',
    body:     'Test email body.',
    simTime:  0,
    ...overrides,
  }
}

export function buildTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id:          nextId('ticket'),
    title:       'Test ticket',
    severity:    'SEV2',
    status:      'open',
    description: 'Test description.',
    createdBy:   'fixture-persona',
    simTime:     0,
    ...overrides,
  }
}

export function buildTicketComment(
  ticketId: string,
  overrides: Partial<TicketComment> = {}
): TicketComment {
  return {
    id:       nextId('comment'),
    ticketId,
    author:   'trainee',
    body:     'Test comment.',
    simTime:  0,
    ...overrides,
  }
}

export function buildLogEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id:      nextId('log'),
    simTime: 0,
    level:   'ERROR',
    service: 'fixture-service',
    message: 'Test log entry.',
    ...overrides,
  }
}

export function buildAlarm(overrides: Partial<Alarm> = {}): Alarm {
  return {
    id:        nextId('alarm'),
    service:   'fixture-service',
    metricId:  'error_rate',
    condition: 'error_rate > 5%',
    value:     12.0,
    severity:  'SEV2',
    status:    'firing',
    simTime:   0,
    ...overrides,
  }
}

export function buildDeployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    version:       'v1.0.1',
    deployedAtSec: -300,
    status:        'active',
    commitMessage: 'test commit',
    author:        'fixture-persona',
    ...overrides,
  }
}

export function buildCoachMessage(overrides: Partial<CoachMessage> = {}): CoachMessage {
  return {
    id:        nextId('coach'),
    text:      'Test coach message.',
    simTime:   0,
    proactive: true,
    ...overrides,
  }
}

// ── Metrics test helpers (Phase 2) ───────────────────────────────────────────

// Re-exported so metric tests can use them without importing from implementation modules.
export { createSeededPRNG } from '../metrics/patterns/noise'
export type { SeededPRNG } from '../metrics/patterns/noise'

// ── Mock LLM (Phase 5 implementation) ────────────────────────────────────────

import { MockProvider, loadMockResponses } from '../llm/mock-provider'
export type { MockLLMProvider, MockLLMResponses } from '../llm/mock-provider'
export { MockProvider } from '../llm/mock-provider'

export function getMockLLMProvider(): MockProvider {
  const responses = loadMockResponses(getFixtureScenarioDir())
  return new MockProvider(responses)
}

export function buildMockLLMProvider(
  responses: import('../llm/mock-provider').MockLLMResponses
): MockProvider {
  return new MockProvider(responses)
}
