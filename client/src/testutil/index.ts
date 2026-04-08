// Client-side test utilities used by all UI phases.

import React from 'react'
import { render, type RenderResult } from '@testing-library/react'
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

// ── Mock SSE connection ───────────────────────────────────────────────────────

export interface MockSSEConnection {
  // Push a SimEvent directly into the registered event handler.
  emit(event: SimEvent): void
  // Simulate a connection drop — calls registered onDisconnect if any.
  disconnect(): void
  // Simulate a reconnection — calls registered onReconnect if any.
  reconnect(): void
  // Register the event consumer (set by useSSE hook in tests).
  setHandler(fn: (event: SimEvent) => void): void
  // Register a disconnect callback.
  setOnDisconnect(fn: () => void): void
  // Register a reconnect callback.
  setOnReconnect(fn: () => void): void
  isConnected: boolean
}

/**
 * Creates a mock SSE connection for testing useSSE and SessionContext
 * without a running server. Wire the mock into the hook/component by
 * passing buildMockSSE() and calling setHandler with the event processor.
 */
export function buildMockSSE(): MockSSEConnection {
  let _handler:     ((event: SimEvent) => void) | null = null
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

// ── Render helper ─────────────────────────────────────────────────────────────

interface RenderOptions {
  snapshot?: Partial<SessionSnapshot>
  sessionId?: string
}

/**
 * Renders a React element wrapped in all required providers.
 * Phase 7 will expand this to include SessionProvider, ScenarioProvider, etc.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  _options: RenderOptions = {}
): RenderResult {
  return render(ui)
}
