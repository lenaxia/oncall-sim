import React, {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
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
} from "@shared/types/events";
import type { MockSSEConnection } from "../testutil/mock-sse";

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
  clockAnchorMs: number; // Unix ms that corresponds to simTime=0
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
}

const INITIAL_STATE: SessionState = {
  connected: false,
  reconnecting: false,
  simTime: 0,
  speed: 1,
  paused: false,
  clockAnchorMs: Date.now(), // updated from snapshot on first connect
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
};

// ── Reducer ───────────────────────────────────────────────────────────────────

type Action =
  | { type: "SSE_EVENT"; event: SimEvent }
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

    case "SSE_EVENT": {
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
                    stages: p.stages.map((s) =>
                      s.id === ev.stage.id ? ev.stage : s,
                    ),
                  }
                : p,
            ),
          };

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

// ── Provider ──────────────────────────────────────────────────────────────────

export interface SessionProviderProps {
  sessionId: string;
  /** Injected SSE connection — uses real EventSource if omitted (production); MockSSEConnection in tests */
  sseConnection?: MockSSEConnection;
  onExpired: () => void;
  onDebriefReady: () => void;
  onError: (message: string) => void;
  children: React.ReactNode;
}

export function SessionProvider({
  sessionId,
  sseConnection,
  onExpired,
  onDebriefReady,
  onError,
  children,
}: SessionProviderProps) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const [resolving, setResolving] = React.useState(false);

  // Stable callback refs
  const onExpiredRef = useRef(onExpired);
  const onDebriefReadyRef = useRef(onDebriefReady);
  const onErrorRef = useRef(onError);
  onExpiredRef.current = onExpired;
  onDebriefReadyRef.current = onDebriefReady;
  onErrorRef.current = onError;

  // SSE wiring — supports both injected mock and real EventSource
  useEffect(() => {
    function handleEvent(event: SimEvent) {
      if (event.type === "session_expired") {
        dispatch({ type: "SSE_EVENT", event });
        onExpiredRef.current();
        return;
      }
      if (event.type === "debrief_ready") {
        onDebriefReadyRef.current();
        return;
      }
      dispatch({ type: "SSE_EVENT", event });
    }

    if (sseConnection) {
      // Test path: use injected mock
      sseConnection.setHandler(handleEvent);
      return () => {};
    }

    // Production path: real EventSource with reconnect
    let es: EventSource | null = null;
    let backoff = 1000;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      es = new EventSource(`/api/sessions/${sessionId}/events`);
      es.onmessage = (e: MessageEvent<string>) => {
        if (e.data.startsWith(":")) return;
        try {
          const parsed = JSON.parse(e.data) as SimEvent;
          backoff = 1000; // reset on success
          dispatch({ type: "SET_RECONNECTING", reconnecting: false });
          handleEvent(parsed);
        } catch {
          /* ignore malformed */
        }
      };
      es.onerror = () => {
        if (cancelled) return;
        es?.close();
        dispatch({ type: "SET_RECONNECTING", reconnecting: true });
        timeoutId = setTimeout(() => {
          backoff = Math.min(backoff * 2, 30000);
          connect();
        }, backoff);
      };
    }
    connect();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      es?.close();
    };
  }, [sessionId, sseConnection]);

  // ── API helpers ───────────────────────────────────────────────────────────

  async function post(path: string, body: unknown): Promise<void> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      onErrorRef.current(`Request failed (${res.status})`);
    }
  }

  function dispatchAction(
    type: ActionType,
    params: Record<string, unknown> = {},
  ): void {
    if (state.status !== "active") return;
    post(`/api/sessions/${sessionId}/actions`, { action: type, params }).catch(
      () => {
        onErrorRef.current(
          `Action failed — ${type} could not be submitted. Try again.`,
        );
      },
    );
  }

  function postChatMessage(channel: string, text: string): void {
    if (state.status !== "active") return;
    post(`/api/sessions/${sessionId}/chat`, { channel, text }).catch(() => {
      onErrorRef.current("Chat message could not be sent. Try again.");
    });
  }

  function replyEmail(threadId: string, body: string): void {
    if (state.status !== "active") return;
    post(`/api/sessions/${sessionId}/email/reply`, { threadId, body }).catch(
      () => {
        onErrorRef.current("Reply could not be sent. Try again.");
      },
    );
  }

  function setSpeed(speed: 1 | 2 | 5 | 10): void {
    dispatch({ type: "SET_SPEED", speed });
    post(`/api/sessions/${sessionId}/speed`, { speed }).catch(() => {});
  }

  function setPaused(paused: boolean): void {
    dispatch({ type: "SET_PAUSED", paused });
    post(`/api/sessions/${sessionId}/speed`, { paused }).catch(() => {});
  }

  async function resolveSession(): Promise<void> {
    setResolving(true);
    const res = await fetch(`/api/sessions/${sessionId}/resolve`, {
      method: "POST",
    });
    if (!res.ok) {
      setResolving(false);
      onErrorRef.current("Could not end simulation. Please try again.");
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
