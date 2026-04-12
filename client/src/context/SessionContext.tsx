import React, {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import type {
  SessionSnapshot,
  SimEvent,
  ActionType,
  Ticket,
  Alarm,
  TicketComment,
  Deployment,
  Pipeline,
  PipelineStage,
  PageAlert,
  ChatMessage,
  EmailMessage,
  LogEntry,
  CoachMessage,
  AuditEntry,
  TimeSeriesPoint,
  DebriefResult,
  ActiveThrottle,
} from "@shared/types/events";
import type { LoadedScenario } from "../scenario/types";
import type { GameLoop } from "../engine/game-loop";
import { createGameLoop } from "../engine/game-loop";
import { createSimClock } from "../engine/sim-clock";
import { createEventScheduler } from "../engine/event-scheduler";
import { createAuditLog } from "../engine/audit-log";
import { createSimStateStore } from "../engine/sim-state-store";
import { createEvaluator } from "../engine/evaluator";
import { generateAllMetrics } from "../metrics/generator";
import { createMetricStore } from "../metrics/metric-store";
import { createLLMClient } from "../llm/llm-client";
import type { LLMClient } from "../llm/llm-client";
import { createStakeholderEngine } from "../engine/stakeholder-engine";
import { createMetricReactionEngine } from "../engine/metric-reaction-engine";

// ── Tab IDs ───────────────────────────────────────────────────────────────────

export type TabId =
  | "email"
  | "chat"
  | "tickets"
  | "ops"
  | "logs"
  | "wiki"
  | "cicd";

// ── State shape ───────────────────────────────────────────────────────────────

export interface SessionState {
  connected: boolean;
  reconnecting: boolean;
  simTime: number;
  speed: 1 | 2 | 5 | 10;
  paused: boolean;
  clockAnchorMs: number;
  status: "active" | "resolved" | "expired";

  tickets: Ticket[];
  alarms: Alarm[];
  emails: EmailMessage[];
  chatMessages: Record<string, ChatMessage[]>;
  ticketComments: Record<string, TicketComment[]>;
  logs: LogEntry[];
  deployments: Record<string, Deployment[]>;
  pipelines: Pipeline[];
  metrics: Record<string, Record<string, TimeSeriesPoint[]>>;
  pages: PageAlert[];
  auditLog: AuditEntry[];
  coachMessages: CoachMessage[];
  throttles: ActiveThrottle[];
}

const INITIAL_STATE: SessionState = {
  connected: false,
  reconnecting: false,
  simTime: 0,
  speed: 1,
  paused: false,
  clockAnchorMs: Date.now(),
  status: "active",
  tickets: [],
  alarms: [],
  emails: [],
  chatMessages: {},
  ticketComments: {},
  logs: [],
  deployments: {},
  pipelines: [],
  metrics: {},
  pages: [],
  auditLog: [],
  coachMessages: [],
  throttles: [],
};

// ── Reducer ───────────────────────────────────────────────────────────────────

type Action =
  | { type: "ENGINE_EVENT"; event: SimEvent }
  | { type: "SET_STATUS"; status: SessionState["status"] }
  | { type: "SET_RECONNECTING"; reconnecting: boolean }
  | { type: "SET_SPEED"; speed: 1 | 2 | 5 | 10 }
  | { type: "SET_PAUSED"; paused: boolean };

function isTraineeEcho(
  emails: EmailMessage[],
  candidate: EmailMessage,
): boolean {
  if (candidate.from !== "trainee") return false;
  return emails.some(
    (e) =>
      e.from === "trainee" &&
      e.threadId === candidate.threadId &&
      e.body === candidate.body &&
      Math.abs(e.simTime - candidate.simTime) < 5,
  );
}

function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case "SET_STATUS":
      return { ...state, status: action.status };
    case "SET_RECONNECTING":
      return { ...state, reconnecting: action.reconnecting };
    case "SET_SPEED":
      return { ...state, speed: action.speed, paused: false };
    case "SET_PAUSED":
      return { ...state, paused: action.paused };

    case "ENGINE_EVENT": {
      const ev = action.event;
      switch (ev.type) {
        case "session_snapshot": {
          const snap: SessionSnapshot = ev.snapshot;
          return {
            ...state,
            connected: true,
            reconnecting: false,
            simTime: snap.simTime,
            speed: snap.speed,
            paused: snap.paused,
            clockAnchorMs: snap.clockAnchorMs,
            tickets: snap.tickets,
            alarms: snap.alarms,
            emails: snap.emails,
            chatMessages: snap.chatChannels,
            ticketComments: snap.ticketComments,
            logs: snap.logs,
            deployments: snap.deployments,
            pipelines: snap.pipelines ?? [],
            metrics: snap.metrics,
            pages: snap.pages ?? [],
            auditLog: snap.auditLog,
            coachMessages: snap.coachMessages,
            throttles: snap.throttles ?? [],
          };
        }

        case "sim_time":
          return {
            ...state,
            simTime: ev.simTime,
            speed: ev.speed,
            paused: ev.paused,
          };

        case "chat_message": {
          const prev = state.chatMessages[ev.channel] ?? [];
          return {
            ...state,
            chatMessages: {
              ...state.chatMessages,
              [ev.channel]: [...prev, ev.message],
            },
          };
        }

        case "email_received": {
          if (isTraineeEcho(state.emails, ev.email)) return state;
          return { ...state, emails: [...state.emails, ev.email] };
        }

        case "log_entry":
          return { ...state, logs: [...state.logs, ev.entry] };

        case "alarm_fired":
          return { ...state, alarms: [...state.alarms, ev.alarm] };

        case "alarm_silenced":
          return {
            ...state,
            alarms: state.alarms.map((a) =>
              a.id === ev.alarmId ? { ...a, status: "suppressed" as const } : a,
            ),
          };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        case "alarm_acknowledged" as SimEvent["type"]:
          return {
            ...state,
            alarms: state.alarms.map((a) =>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              a.id === (ev as any).alarmId
                ? { ...a, status: "acknowledged" as const }
                : a,
            ),
          };

        case "ticket_created":
          return { ...state, tickets: [...state.tickets, ev.ticket] };

        case "ticket_updated":
          return {
            ...state,
            tickets: state.tickets.map((t) =>
              t.id === ev.ticketId ? { ...t, ...ev.changes } : t,
            ),
          };

        case "ticket_comment": {
          const prev = state.ticketComments[ev.ticketId] ?? [];
          return {
            ...state,
            ticketComments: {
              ...state.ticketComments,
              [ev.ticketId]: [...prev, ev.comment],
            },
          };
        }

        case "deployment_update": {
          const prev = state.deployments[ev.service] ?? [];
          return {
            ...state,
            deployments: {
              ...state.deployments,
              [ev.service]: [...prev, ev.deployment],
            },
          };
        }

        case "pipeline_stage_updated":
          return {
            ...state,
            pipelines: state.pipelines.map((p) =>
              p.id === ev.pipelineId
                ? {
                    ...p,
                    stages: p.stages.map((s: PipelineStage) =>
                      s.id === ev.stage.id ? ev.stage : s,
                    ),
                  }
                : p,
            ),
          };

        case "metric_update": {
          const { service, metricId, point } = ev;
          const serviceSeries = state.metrics[service];
          if (!serviceSeries) return state;
          const existing = serviceSeries[metricId];
          if (!existing) return state;
          // Replace point at same t if it exists, otherwise insert in order
          let updated: TimeSeriesPoint[];
          const idx = existing.findIndex((p) => p.t === point.t);
          if (idx !== -1) {
            updated = existing.slice();
            updated[idx] = point;
          } else {
            const insertAt = existing.findIndex((p) => p.t > point.t);
            if (insertAt === -1) {
              updated = [...existing, point];
            } else {
              updated = [
                ...existing.slice(0, insertAt),
                point,
                ...existing.slice(insertAt),
              ];
            }
          }
          return {
            ...state,
            metrics: {
              ...state.metrics,
              [service]: { ...serviceSeries, [metricId]: updated },
            },
          };
        }

        case "metrics_tick": {
          // Batch update — apply every point in a single state transition so
          // React only schedules one re-render for the entire tick regardless
          // of how many metrics produced a point.
          let metrics = state.metrics;
          for (const { service, metricId, point } of ev.updates) {
            const serviceSeries = metrics[service];
            if (!serviceSeries) continue;
            const existing = serviceSeries[metricId];
            if (!existing) continue;

            let updated: TimeSeriesPoint[];
            const idx = existing.findIndex((p) => p.t === point.t);
            if (idx !== -1) {
              updated = existing.slice();
              updated[idx] = point;
            } else {
              // New points from generatePoint always arrive at the tail of the
              // series (they are generated in ascending t order), so a simple
              // append is the common path. Fall back to sorted insert only if
              // the point somehow arrives out of order.
              const last = existing[existing.length - 1];
              if (!last || point.t > last.t) {
                updated = [...existing, point];
              } else {
                const insertAt = existing.findIndex((p) => p.t > point.t);
                updated =
                  insertAt === -1
                    ? [...existing, point]
                    : [
                        ...existing.slice(0, insertAt),
                        point,
                        ...existing.slice(insertAt),
                      ];
              }
            }

            // Only allocate a new object when the array actually changed
            if (updated !== existing) {
              metrics =
                metrics === state.metrics ? { ...state.metrics } : metrics;
              metrics[service] =
                metrics[service] === state.metrics[service]
                  ? { ...serviceSeries }
                  : metrics[service];
              metrics[service][metricId] = updated;
            }
          }
          return metrics === state.metrics ? state : { ...state, metrics };
        }

        case "page_sent":
          return { ...state, pages: [...state.pages, ev.alert] };

        case "coach_message":
          return {
            ...state,
            coachMessages: [...state.coachMessages, ev.message],
          };

        case "session_expired":
          return { ...state, status: "expired" };

        case "error":
          console.error(ev.code, ev.message);
          return state;

        case "debrief_ready":
        default:
          return state;
      }
    }
  }
}

// ── Context value ─────────────────────────────────────────────────────────────

export interface SessionContextValue {
  state: SessionState;
  dispatchAction: (type: ActionType, params?: Record<string, unknown>) => void;
  postChatMessage: (channel: string, text: string) => void;
  replyEmail: (threadId: string, body: string) => void;
  setSpeed: (speed: 1 | 2 | 5 | 10) => void;
  setPaused: (paused: boolean) => void;
  resolveSession: () => Promise<void>;
  resolving: boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

// ── Session factory ───────────────────────────────────────────────────────────

interface SessionInstance {
  gameLoop: GameLoop;
  llmClient: LLMClient;
}

function createSession(
  scenario: LoadedScenario,
  getLLMClient: () => LLMClient,
): SessionInstance {
  const sessionId = globalThis.crypto.randomUUID();
  const clockAnchorMs = Date.now();

  const clock = createSimClock(
    scenario.timeline.defaultSpeed,
    scenario.timeline.preIncidentSeconds,
  );
  const scheduler = createEventScheduler(scenario);
  const auditLog = createAuditLog();
  const store = createSimStateStore();
  const evaluator = createEvaluator();

  // Pre-generate all metrics and wire the MetricStore
  const { series, resolvedParams } = generateAllMetrics(scenario, sessionId);
  const metricStore = createMetricStore(series, resolvedParams);

  // Wire pipelines from scenario into store
  for (const pipeline of scenario.cicd.pipelines) {
    store.addPipeline({
      id: pipeline.id,
      name: pipeline.name,
      service: pipeline.service,
      stages: pipeline.stages.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        currentVersion: s.currentVersion,
        previousVersion: s.previousVersion,
        status: s.status,
        deployedAtSec: s.deployedAtSec,
        commitMessage: s.commitMessage,
        author: s.author,
        blockers: s.blockers.map((b) => ({
          type: b.type,
          alarmId: b.alarmId,
          message: b.message ?? "",
        })),
        alarmWatches: s.alarmWatches,
        tests: s.tests,
        promotionEvents: s.promotionEvents.map((e) => ({
          version: e.version,
          simTime: e.simTime,
          status: e.status,
          note: e.note,
        })),
      })),
    });
  }

  // Wire chat channels
  for (const channel of scenario.chat.channels) {
    store.ensureChannel(channel.id);
  }

  // Build stakeholder engine
  const stakeholderEngine = createStakeholderEngine(
    getLLMClient,
    scenario,
    metricStore,
  );

  // Build metric reaction engine — decoupled from persona gating, fires on trainee actions only
  const metricReactionEngine = createMetricReactionEngine(
    getLLMClient,
    scenario,
    metricStore,
    () => clock.getSimTime(),
  );

  const gameLoop = createGameLoop({
    scenario,
    sessionId,
    clock,
    scheduler,
    auditLog,
    store,
    evaluator,
    metrics: series,
    metricStore,
    clockAnchorMs,
    onDirtyTick: (ctx) => stakeholderEngine.tick(ctx),
    onMetricReact: (ctx) => metricReactionEngine.react(ctx),
    onCoachTick: () => Promise.resolve(null),
  });

  return { gameLoop, llmClient: getLLMClient() };
}

// ── Provider ──────────────────────────────────────────────────────────────────

export interface SessionProviderProps {
  scenario: LoadedScenario;
  onExpired: () => void;
  onDebriefReady: (result: DebriefResult) => void;
  onError: (message: string) => void;
  children: React.ReactNode;
  /** Test-only: inject a mock game loop. Bypasses engine creation. */
  _testGameLoop?: GameLoop;
}

export function SessionProvider({
  scenario,
  onExpired,
  onDebriefReady,
  onError,
  children,
  _testGameLoop,
}: SessionProviderProps) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const [resolving, setResolving] = useState(false);

  // Stable callback refs
  const onExpiredRef = useRef(onExpired);
  const onDebriefReadyRef = useRef(onDebriefReady);
  const onErrorRef = useRef(onError);
  onExpiredRef.current = onExpired;
  onDebriefReadyRef.current = onDebriefReady;
  onErrorRef.current = onError;

  const llmClientRef = useRef<LLMClient | null>(null);
  const sessionRef = useRef<SessionInstance | null>(null);

  // When a test game loop is injected, create a minimal session wrapper around it.
  // Otherwise create the full session with the real engine.
  if (sessionRef.current === null) {
    if (_testGameLoop) {
      const tempLlm: LLMClient = {
        call: () => Promise.resolve({ toolCalls: [] }),
      };
      sessionRef.current = { gameLoop: _testGameLoop, llmClient: tempLlm };
    } else {
      const tempLlm: LLMClient = {
        call: () => Promise.resolve({ toolCalls: [] }),
      };
      // Pass a getter so the stakeholder engine always uses the latest client.
      // llmClientRef is initialised before this getter is ever invoked.
      sessionRef.current = createSession(
        scenario,
        () => llmClientRef.current ?? tempLlm,
      );
    }
  }

  // Wire real LLM client once available (skipped in test mode — _testGameLoop implies mock LLM)
  useEffect(() => {
    if (_testGameLoop) return;
    let cancelled = false;
    void createLLMClient()
      .then((client) => {
        if (!cancelled) llmClientRef.current = client;
      })
      .catch((err) => {
        if (!cancelled)
          onErrorRef.current(`Failed to initialise LLM client: ${String(err)}`);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start game loop, wire event dispatch, stop on unmount
  useEffect(() => {
    const { gameLoop } = sessionRef.current!;
    const clockAnchorMs = Date.now();

    // Emit initial snapshot so state.connected=true and UI can render.
    // In test mode the test controls when snapshots arrive via mockLoop.emit().
    if (!_testGameLoop) {
      const snapshot = gameLoop.getSnapshot();
      dispatch({
        type: "ENGINE_EVENT",
        event: {
          type: "session_snapshot",
          snapshot: { ...snapshot, clockAnchorMs },
        },
      });
    }

    const unsubscribe = gameLoop.onEvent((event: SimEvent) => {
      if (event.type === "session_expired") {
        dispatch({ type: "ENGINE_EVENT", event });
        onExpiredRef.current();
        return;
      }
      dispatch({ type: "ENGINE_EVENT", event });
    });

    if (!_testGameLoop) gameLoop.start();

    return () => {
      if (!_testGameLoop) gameLoop.stop();
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Action helpers ────────────────────────────────────────────────────────

  function dispatchAction(
    type: ActionType,
    params: Record<string, unknown> = {},
  ): void {
    if (state.status !== "active") return;
    try {
      sessionRef.current!.gameLoop.handleAction(type, params);
    } catch (err) {
      onErrorRef.current(`Action failed — ${type}: ${String(err)}`);
    }
  }

  function postChatMessage(channel: string, text: string): void {
    if (state.status !== "active") return;
    try {
      sessionRef.current!.gameLoop.handleChatMessage(channel, text);
    } catch (err) {
      onErrorRef.current(`Chat message failed: ${String(err)}`);
    }
  }

  function replyEmail(threadId: string, body: string): void {
    if (state.status !== "active") return;
    try {
      sessionRef.current!.gameLoop.handleEmailReply(threadId, body);
    } catch (err) {
      onErrorRef.current(`Email reply failed: ${String(err)}`);
    }
  }

  function setSpeed(speed: 1 | 2 | 5 | 10): void {
    dispatch({ type: "SET_SPEED", speed });
    sessionRef.current!.gameLoop.setSpeed(speed);
  }

  function setPaused(paused: boolean): void {
    dispatch({ type: "SET_PAUSED", paused });
    if (paused) {
      sessionRef.current!.gameLoop.pause();
    } else {
      sessionRef.current!.gameLoop.resume();
    }
  }

  async function resolveSession(): Promise<void> {
    setResolving(true);
    try {
      const { gameLoop, llmClient } = sessionRef.current!;
      const activeLlm = llmClientRef.current ?? llmClient;

      gameLoop.stop();

      const evaluationState = gameLoop.getEvaluationState();
      const snapshot = gameLoop.getSnapshot();
      const eventLog = gameLoop.getEventLog();
      const resolvedAtSimTime = snapshot.simTime;

      let narrative = "";
      try {
        const response = await activeLlm.call({
          role: "debrief",
          messages: [
            {
              role: "user",
              content: JSON.stringify({
                evaluationState,
                auditLog: snapshot.auditLog,
                eventLog,
                scenario: { id: scenario.id, title: scenario.title },
              }),
            },
          ],
          tools: [],
          sessionId: snapshot.sessionId,
        });
        narrative = response.text ?? "";
      } catch {
        /* debrief LLM failure is non-fatal */
      }

      const debriefResult: DebriefResult = {
        narrative,
        evaluationState,
        auditLog: snapshot.auditLog,
        eventLog,
        resolvedAtSimTime,
      };

      onDebriefReadyRef.current(debriefResult);
    } catch (err) {
      setResolving(false);
      onErrorRef.current(`Could not end simulation: ${String(err)}`);
    }
  }

  const value: SessionContextValue = {
    state,
    dispatchAction,
    postChatMessage,
    replyEmail,
    setSpeed,
    setPaused,
    resolveSession,
    resolving,
  };

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (ctx === null) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return ctx;
}
