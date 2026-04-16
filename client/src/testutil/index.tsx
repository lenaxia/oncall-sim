// Client-side test utilities — updated for engine-direct architecture.

import React from "react";
import { render, type RenderResult } from "@testing-library/react";
import { expect } from "vitest";
import { SessionProvider } from "../context/SessionContext";
import { ScenarioProvider } from "../context/ScenarioContext";
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
  DebriefResult,
  SimEvent,
} from "@shared/types/events";
import type { LoadedScenario } from "../scenario/types";
import type { GameLoop } from "../engine/game-loop";
import type { SimStateStoreSnapshot } from "../engine/sim-state-store";
import type { EvaluationState } from "../engine/evaluator";
import type { SimClock } from "../engine/sim-clock";

// Fixture YAML imported at build/test time as raw string — no FS access in browser
import fixtureYaml from "../../../scenarios/_fixture/scenario.yaml?raw";
import { loadScenarioFromText, isScenarioLoadError } from "../scenario/loader";
export { createSeededPRNG } from "../metrics/patterns/noise";
export type { SeededPRNG } from "../metrics/patterns/noise";

// ── Fixture scenario ──────────────────────────────────────────────────────────
// Loads the _fixture scenario via the browser loader + ?raw import.
// Cached after first load; use clearFixtureCache() between tests that mutate.

let _cachedFixture: LoadedScenario | null = null;

export async function getFixtureScenario(): Promise<LoadedScenario> {
  if (_cachedFixture) return _cachedFixture;

  // Build a static file map from the fixture directory for resolveFile
  const fixtureFiles = import.meta.glob("../../../scenarios/_fixture/**/*", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  const resolveFile = (relativePath: string): Promise<string> => {
    // Try various prefix patterns since glob keys include the full path
    const suffixes = [
      `../../../scenarios/_fixture/${relativePath}`,
      relativePath,
    ];
    for (const key of suffixes) {
      if (fixtureFiles[key] !== undefined)
        return Promise.resolve(fixtureFiles[key]);
    }
    return Promise.reject(new Error(`Fixture file not found: ${relativePath}`));
  };

  const result = await loadScenarioFromText(fixtureYaml, resolveFile);
  if (isScenarioLoadError(result)) {
    throw new Error(
      `Fixture scenario failed validation: ${JSON.stringify(result.errors)}`,
    );
  }
  _cachedFixture = result;
  return result;
}

export function clearFixtureCache(): void {
  _cachedFixture = null;
}

// ── TestSimClock ──────────────────────────────────────────────────────────────

export interface TestSimClock extends SimClock {
  advance(simSeconds: number): void;
  setSimTime(simSeconds: number): void;
}

export function buildTestClock(initialSimTime = 0): TestSimClock {
  let _simTime = initialSimTime;
  let _speed: 1 | 2 | 5 | 10 = 1;
  let _paused = false;

  return {
    advance(simSeconds: number) {
      _simTime += simSeconds;
    },
    setSimTime(simSeconds: number) {
      _simTime = simSeconds;
    },
    getSimTime() {
      return _simTime;
    },
    tick(realElapsedMs: number) {
      if (!_paused) _simTime += (realElapsedMs / 1000) * _speed;
    },
    setSpeed(speed) {
      _speed = speed;
    },
    getSpeed() {
      return _speed;
    },
    pause() {
      _paused = true;
    },
    resume() {
      _paused = false;
    },
    isPaused() {
      return _paused;
    },
    toSimTimeEvent() {
      return {
        type: "sim_time" as const,
        simTime: _simTime,
        speed: _speed,
        paused: _paused,
      };
    },
  };
}

// ── Assertion helpers ─────────────────────────────────────────────────────────

export function expectEvent<T extends SimEvent["type"]>(
  events: SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }> {
  const found = events.find((e) => e.type === type);
  expect(
    found,
    `Expected event of type '${type}' in events array`,
  ).toBeDefined();
  return found as Extract<SimEvent, { type: T }>;
}

export function expectNoEvent(
  events: SimEvent[],
  type: SimEvent["type"],
): void {
  const found = events.find((e) => e.type === type);
  expect(
    found,
    `Expected no event of type '${type}' but found one`,
  ).toBeUndefined();
}

export function expectAction(
  log: AuditEntry[],
  action: ActionType,
): AuditEntry {
  const found = log.find((e) => e.action === action);
  expect(found, `Expected action '${action}' in audit log`).toBeDefined();
  return found!;
}

// ── Audit log helper ──────────────────────────────────────────────────────────

export function buildAuditLog(entries: Partial<AuditEntry>[]): AuditEntry[] {
  return entries.map((e, i) => ({
    simTime: e.simTime ?? i * 10,
    action: e.action ?? "open_tab",
    params: e.params ?? {},
  }));
}

// ── MockProvider helpers ──────────────────────────────────────────────────────

import {
  MockProvider,
  createFixtureMockProvider,
  createMockProviderFromYaml,
} from "../llm/mock-provider";
import type { MockLLMResponses } from "../llm/mock-provider";
export type { MockLLMResponses };
export { MockProvider } from "../llm/mock-provider";

export function getMockLLMProvider(): MockProvider {
  return createFixtureMockProvider();
}

export function buildMockLLMProvider(
  responses: MockLLMResponses,
): MockProvider {
  return new MockProvider(responses);
}

// ── Ramp series helper ────────────────────────────────────────────────────────

export function buildRampSeries(
  fromValue: number,
  toValue: number,
  fromSecond: number,
  toSecond: number,
  resolutionSeconds = 15,
): TimeSeriesPoint[] {
  const points: TimeSeriesPoint[] = [];
  const duration = toSecond - fromSecond;
  for (let t = fromSecond; t <= toSecond; t += resolutionSeconds) {
    const fraction = duration === 0 ? 1 : (t - fromSecond) / duration;
    points.push({ t, v: fromValue + fraction * (toValue - fromValue) });
  }
  return points;
}

// ── MockGameLoop ──────────────────────────────────────────────────────────────

export interface MockGameLoop extends GameLoop {
  /** Push a SimEvent directly into subscribers (replaces sse.emit in tests). */
  emit(event: SimEvent): void;
}

export function buildMockGameLoop(
  overrides: Partial<GameLoop> = {},
): MockGameLoop {
  const _handlers: Array<(event: SimEvent) => void> = [];
  const _snapshot: SessionSnapshot = buildTestSnapshot();

  const mock: MockGameLoop = {
    emit(event: SimEvent) {
      for (const h of _handlers) h(event);
    },
    start() {
      /* no-op */
    },
    stop() {
      /* no-op */
    },
    pause() {
      /* no-op */
    },
    resume() {
      /* no-op */
    },
    setSpeed() {
      /* no-op */
    },
    handleAction() {
      /* no-op */
    },
    handleChatMessage() {
      /* no-op */
    },
    handleEmailReply() {
      /* no-op */
    },
    handleCoachMessage() {
      /* no-op */
    },
    _testTick() {
      /* no-op in mock */
    },
    getSimStateSnapshot(): SimStateStoreSnapshot {
      return {
        emails: [],
        chatChannels: {},
        tickets: [],
        ticketComments: {},
        logs: [],
        alarms: [],
        deployments: {},
        pipelines: [],
        pages: [],
        throttles: [],
      };
    },
    getSnapshot(): SessionSnapshot {
      return _snapshot;
    },
    getEvaluationState(): EvaluationState {
      return {
        relevantActionsTaken: [],
        redHerringsTaken: [],
        resolved: false,
      };
    },
    getEventLog(): SimEventLogEntry[] {
      return [];
    },
    onEvent(handler) {
      _handlers.push(handler);
      return () => {
        const idx = _handlers.indexOf(handler);
        if (idx !== -1) _handlers.splice(idx, 1);
      };
    },
    ...overrides,
  };
  return mock;
}

// ── Snapshot builder ──────────────────────────────────────────────────────────

export function buildTestSnapshot(
  overrides: Partial<SessionSnapshot> = {},
): SessionSnapshot {
  return {
    sessionId: "test-session-id",
    scenarioId: "_fixture",
    simTime: 0,
    speed: 1,
    paused: false,
    clockAnchorMs: 0,
    emails: [],
    chatChannels: {},
    tickets: [],
    ticketComments: {},
    logs: [],
    metrics: {},
    alarms: [],
    deployments: {},
    pipelines: [],
    pages: [],
    auditLog: [],
    coachMessages: [],
    throttles: [],
    ...overrides,
  };
}

// ── Time-series builder ───────────────────────────────────────────────────────

export function buildFlatSeries(
  value: number,
  fromSecond: number,
  toSecond: number,
  resolutionSeconds = 15,
): TimeSeriesPoint[] {
  const points: TimeSeriesPoint[] = [];
  for (let t = fromSecond; t <= toSecond; t += resolutionSeconds) {
    points.push({ t, v: value });
  }
  return points;
}

// ── Small builders ────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(prefix = "id"): string {
  return `${prefix}-${++_idCounter}`;
}

export function resetIdCounter(): void {
  _idCounter = 0;
}

export function buildAuditEntry(
  action: ActionType,
  params: Record<string, unknown> = {},
  simTime = 0,
): AuditEntry {
  return { simTime, action, params };
}

export function buildChatMessage(
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: nextId("msg"),
    channel: "#incidents",
    persona: "fixture-persona",
    text: "test message",
    simTime: 0,
    ...overrides,
  };
}

export function buildEmail(
  overrides: Partial<EmailMessage> = {},
): EmailMessage {
  return {
    id: nextId("email"),
    threadId: "thread-001",
    from: "fixture-persona",
    to: "trainee",
    subject: "Test email",
    body: "Test email body.",
    simTime: 0,
    ...overrides,
  };
}

export function buildTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: nextId("ticket"),
    title: "Test ticket",
    severity: "SEV2",
    status: "open",
    description: "Test description.",
    createdBy: "fixture-persona",
    assignee: "trainee",
    simTime: 0,
    ...overrides,
  };
}

export function buildTicketComment(
  ticketId: string,
  overrides: Partial<TicketComment> = {},
): TicketComment {
  return {
    id: nextId("comment"),
    ticketId,
    author: "trainee",
    body: "Test comment.",
    simTime: 0,
    ...overrides,
  };
}

export function buildLogEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: nextId("log"),
    simTime: 0,
    level: "ERROR",
    service: "fixture-service",
    message: "Test log entry.",
    ...overrides,
  };
}

export function buildAlarm(overrides: Partial<Alarm> = {}): Alarm {
  return {
    id: nextId("alarm"),
    service: "fixture-service",
    metricId: "error_rate",
    condition: "error_rate > 5%",
    value: 12.0,
    severity: "SEV2",
    status: "firing",
    simTime: 0,
    ...overrides,
  };
}

export function buildDeployment(
  overrides: Partial<Deployment> = {},
): Deployment {
  return {
    version: "v1.0.1",
    deployedAtSec: -300,
    status: "active",
    commitMessage: "test commit",
    author: "fixture-persona",
    ...overrides,
  };
}

export function buildCoachMessage(
  overrides: Partial<CoachMessage> = {},
): CoachMessage {
  return {
    id: nextId("coach"),
    text: "Test coach message.",
    simTime: 0,
    proactive: true,
    ...overrides,
  };
}

// ── Scenario builders ─────────────────────────────────────────────────────────

export interface ScenarioSummary {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  tags: string[];
}

export function buildScenarioSummary(
  overrides: Partial<ScenarioSummary> = {},
): ScenarioSummary {
  return {
    id: "_fixture",
    title: "Fixture Scenario",
    description: "A minimal test scenario.",
    difficulty: "medium",
    tags: ["fixture"],
    ...overrides,
  };
}

// Minimal LoadedScenario for tests that need one
export function buildLoadedScenario(
  overrides: Partial<LoadedScenario> = {},
): LoadedScenario {
  return {
    id: "_fixture",
    title: "Fixture Scenario",
    description: "A minimal test scenario.",
    difficulty: "medium",
    tags: ["fixture"],
    timeline: {
      defaultSpeed: 1,
      durationMinutes: 10,
      preIncidentSeconds: 300,
    },
    topology: {
      focalService: {
        name: "fixture-service",
        description: "Minimal fixture service.",
        components: [],
        incidents: [],
      },
      upstream: [],
      downstream: [],
    },
    engine: { defaultTab: "email", llmEventTools: [] },
    personas: [
      {
        id: "fixture-persona",
        displayName: "Fixture Persona",
        jobTitle: "Senior SRE",
        team: "Platform",
        initiatesContact: false,
        cooldownSeconds: 30,
        silentUntilContacted: false,
        systemPrompt: "test",
      },
    ],
    emails: [],
    chat: {
      channels: [{ id: "#incidents", name: "#incidents" }],
      messages: [],
    },
    tickets: [],
    opsDashboard: {
      preIncidentSeconds: 300,
      focalService: {
        name: "fixture-service",
        scale: { typicalRps: 100 },
        trafficProfile: "always_on_api",
        health: "healthy",
        incidentType: "connection_pool_exhaustion",
        metrics: [
          {
            archetype: "error_rate",
            baselineValue: 0.5,
            incidentPeak: 15,
            criticalThreshold: 10,
          },
        ],
      },
      correlatedServices: [],
    },
    alarms: [],
    logs: [],
    wiki: {
      pages: [
        { title: "Architecture", content: "# Architecture\n\nContent here." },
      ],
    },
    cicd: { pipelines: [], deployments: [] },
    remediationActions: [],
    featureFlags: [],
    hostGroups: [],
    evaluation: {
      rootCause: "test root cause",
      relevantActions: [],
      redHerrings: [],
      debriefContext: "",
    },
    ...overrides,
  };
}

// ── Debrief builder ───────────────────────────────────────────────────────────

export type { DebriefResult };

export function buildDebriefResult(
  overrides: Partial<DebriefResult> = {},
): DebriefResult {
  return {
    narrative: "",
    evaluationState: {
      relevantActionsTaken: [],
      redHerringsTaken: [],
      resolved: false,
    },
    auditLog: [],
    eventLog: [],
    resolvedAtSimTime: 0,
    ...overrides,
  };
}

// ── Render helper ─────────────────────────────────────────────────────────────

interface RenderOptions {
  scenario?: LoadedScenario;
  mockLoop?: MockGameLoop;
  onExpired?: () => void;
  onDebrief?: (result: DebriefResult) => void;
  onError?: (message: string) => void;
}

interface RenderWithProvidersResult extends RenderResult {
  mockLoop: MockGameLoop;
}

/**
 * Renders a React element wrapped in ScenarioProvider + SessionProvider.
 * The mock game loop is returned so tests can push events via mockLoop.emit().
 *
 * Usage:
 *   const { mockLoop } = renderWithProviders(<MyComponent />)
 *   act(() => mockLoop.emit({ type: 'session_snapshot', snapshot: buildTestSnapshot() }))
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderOptions = {},
): RenderWithProvidersResult {
  const scenario = options.scenario ?? buildLoadedScenario();
  const mockLoop = options.mockLoop ?? buildMockGameLoop();

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <ScenarioProvider scenario={scenario}>
      <SessionProvider
        scenario={scenario}
        _testGameLoop={mockLoop}
        onExpired={options.onExpired ?? (() => {})}
        onDebriefReady={options.onDebrief ?? (() => {})}
        onError={options.onError ?? (() => {})}
      >
        {children}
      </SessionProvider>
    </ScenarioProvider>
  );

  const result = render(ui, { wrapper: Wrapper });
  return { ...result, mockLoop };
}
