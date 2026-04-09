// Client-side test utilities used by all UI phases.

import React from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { SessionProvider } from '../context/SessionContext'
import { ScenarioProvider } from '../context/ScenarioContext'
import type {
  SessionSnapshot,
  TimeSeriesPoint,
  AuditEntry,
  ActionType,
  ChatMessage,
  EmailMessage,
  Ticket,
  TicketComment,
  LogEntry,
  Alarm,
  Deployment,
  CoachMessage,
  SimEventLogEntry,
} from '@shared/types/events'
import { MockSSEConnection, buildMockSSE } from './mock-sse'

export { buildMockSSE } from './mock-sse'
export type { MockSSEConnection } from './mock-sse'

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
    clockAnchorMs:  0,
    emails:         [],
    chatChannels:   {},
    tickets:        [],
    ticketComments: {},
    logs:           [],
    metrics:        {},
    alarms:         [],
    deployments:    {},
    pipelines:      [],
    pages:          [],
    auditLog:       [],
    coachMessages:  [],
    ...overrides,
  }
}

// ── Time-series builder ───────────────────────────────────────────────────────

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

// ── Small builders ────────────────────────────────────────────────────────────

let _idCounter = 0
function nextId(prefix = 'id'): string {
  return `${prefix}-${++_idCounter}`
}

export function resetIdCounter(): void {
  _idCounter = 0
}

export function buildAuditEntry(
  action: ActionType,
  params: Record<string, unknown> = {},
  simTime = 0
): AuditEntry {
  return { simTime, action, params }
}

export function buildChatMessage(
  overrides: Partial<ChatMessage> = {}
): ChatMessage {
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
    assignee:    'trainee',
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

export function buildCoachMessage(
  overrides: Partial<CoachMessage> = {}
): CoachMessage {
  return {
    id:        nextId('coach'),
    text:      'Test coach message.',
    simTime:   0,
    proactive: true,
    ...overrides,
  }
}

// ── Scenario builders ─────────────────────────────────────────────────────────

export interface ScenarioSummary {
  id:          string
  title:       string
  description: string
  serviceType: string
  difficulty:  string
  tags:        string[]
}

export function buildScenarioSummary(
  overrides: Partial<ScenarioSummary> = {}
): ScenarioSummary {
  return {
    id:          '_fixture',
    title:       'Fixture Scenario',
    description: 'A minimal test scenario.',
    serviceType: 'api',
    difficulty:  'medium',
    tags:        ['fixture'],
    ...overrides,
  }
}

export function buildFullScenario(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id:          '_fixture',
    title:       'Fixture Scenario',
    description: 'A minimal test scenario.',
    serviceType: 'api',
    difficulty:  'medium',
    tags:        ['fixture'],
    topology:    { focalService: 'fixture-service', upstream: [], downstream: [] },
    personas:    [{
      id:           'fixture-persona',
      displayName:  'Fixture Persona',
      jobTitle:     'Senior SRE',
      team:         'Platform',
      systemPrompt: 'test',
    }],
    // Server shape: wiki pages are nested under wiki.pages, not top-level wikiPages
    wiki:         { pages: [{ title: 'Architecture', content: '# Architecture\n\nContent here.' }] },
    cicd:         { pipelines: [] },
    featureFlags: [],
    evaluation:   { rootCause: 'test', relevantActions: [], redHerrings: [], debriefContext: '' },
    // Server shape: engine has tickIntervalSeconds, not timelineDurationSeconds/hasFeatureFlags
    engine: {
      defaultTab:          'email',
      tickIntervalSeconds: 15,
    },
    timeline: { durationMinutes: 10 },
    ...overrides,
  }
}

// ── Debrief builder ───────────────────────────────────────────────────────────

export interface DebriefEvaluationState {
  relevantActionsTaken: Array<{ action: string; why: string }>
  redHerringsTaken:     Array<{ action: string; why: string }>
  resolved:             boolean
}

export interface DebriefPayload {
  narrative:          string
  evaluationState:    DebriefEvaluationState
  auditLog:           AuditEntry[]
  eventLog:           SimEventLogEntry[]
  resolvedAtSimTime:  number
}

export function buildDebriefPayload(
  overrides: Partial<DebriefPayload> = {}
): DebriefPayload {
  return {
    narrative:         '',
    evaluationState:   { relevantActionsTaken: [], redHerringsTaken: [], resolved: false },
    auditLog:          [],
    eventLog:          [],
    resolvedAtSimTime: 0,
    ...overrides,
  }
}

// ── Render helper ─────────────────────────────────────────────────────────────

interface RenderOptions {
  snapshot?:    Partial<SessionSnapshot>
  sessionId?:   string
  scenarioId?:  string
  wikiPages?:   Array<{ title: string; content: string }>
  sse?:         MockSSEConnection
  onExpired?:   () => void
  onDebrief?:   () => void
  onError?:     (message: string) => void
}

interface RenderWithProvidersResult extends RenderResult {
  sse: MockSSEConnection
}

/**
 * Renders a React element wrapped in SessionProvider + ScenarioProvider.
 * The sse connection is returned so tests can push events.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderOptions = {}
): RenderWithProvidersResult {
  const sse       = options.sse ?? buildMockSSE()
  const sessionId = options.sessionId ?? 'test-session-id'
  const scenarioId = options.scenarioId ?? '_fixture'

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <ScenarioProvider scenarioId={scenarioId}>
      <SessionProvider
        sessionId={sessionId}
        sseConnection={sse}
        onExpired={options.onExpired ?? (() => {})}
        onDebriefReady={options.onDebrief ?? (() => {})}
        onError={options.onError ?? (() => {})}
      >
        {children}
      </SessionProvider>
    </ScenarioProvider>
  )

  const result = render(ui, { wrapper: Wrapper })
  return { ...result, sse }
}
