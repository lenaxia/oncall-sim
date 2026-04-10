// Canonical SSE event types and core data shapes.
// Both server and client import from here via the @shared path alias.
// No executable logic — types only.

// ── Reactive metric overlay types ─────────────────────────────────────────────

// The 8 runtime-applied overlay patterns for apply_metric_response.
export type ReactiveOverlayType =
  | "smooth_decay" // exponential curve toward target
  | "stepped" // 4 discrete drops at equal intervals
  | "queue_burndown" // plateau at current value, then sharp cliff once backlog clears
  | "oscillating" // bounces — damping toward resolved or sustained indefinitely
  | "blip_then_decay" // brief spike above current, then smooth decay
  | "cascade_clear" // metrics recover in sequence: infra → quality → business
  | "sawtooth_rebound" // decays to target, re-degrades, repeats — fix buys time only
  | "cliff"; // near-instant jump — circuit breaker, hard failover

// Speed tier → sim-second mapping
// '1m'=60  '5m'=300  '15m'=900  '30m'=1800  '60m'=3600
export type ReactiveSpeedTier = "1m" | "5m" | "15m" | "30m" | "60m";

export interface TimeSeriesPoint {
  t: number; // sim seconds relative to t=0; negative = pre-incident
  v: number; // metric value
}

export interface AuditEntry {
  simTime: number; // sim seconds from scenario start
  action: ActionType;
  params: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  channel: string; // '#incidents' | 'dm:<persona-id>' | etc.
  persona: string; // persona id or 'trainee'
  text: string;
  simTime: number;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string; // markdown
  simTime: number;
}

export interface Ticket {
  id: string;
  title: string;
  severity: TicketSeverity;
  status: TicketStatus;
  description: string; // markdown
  createdBy: string; // persona id or 'pagerduty-bot'
  assignee: string; // persona id or 'trainee' — always set
  simTime: number;
}

export interface TicketComment {
  id: string;
  ticketId: string;
  author: string; // persona id or 'trainee'
  body: string;
  simTime: number;
}

export interface LogEntry {
  id: string;
  simTime: number;
  level: LogLevel;
  service: string;
  message: string;
}

export interface Alarm {
  id: string;
  service: string;
  metricId: string;
  condition: string; // human-readable, shown in UI
  value: number; // current value that triggered
  severity: AlarmSeverity;
  status: AlarmStatus;
  simTime: number;
}

export interface Deployment {
  version: string;
  deployedAtSec: number; // sim seconds; negative = pre-scenario
  status: DeploymentStatus;
  commitMessage: string;
  author: string;
}

// ── Pipeline model ────────────────────────────────────────────────────────────

export type StageStatus =
  | "not_started"
  | "in_progress"
  | "succeeded"
  | "failed"
  | "blocked";
export type BlockerType =
  | "alarm"
  | "time_window"
  | "manual_approval"
  | "test_failure";
export type TestStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "skipped";

export interface StageBlocker {
  type: BlockerType;
  alarmId?: string; // references Alarm.id — message derived from alarm.condition + service
  message: string;
  /** simTime after which a suppressed alarm re-instates the blocker */
  suppressedUntil?: number;
}

export interface StageTest {
  name: string;
  status: TestStatus;
  url?: string; // link to test run results
  note?: string;
}

export interface PromotionEvent {
  version: string;
  simTime: number;
  status: "succeeded" | "failed" | "blocked";
  note: string; // e.g. "AutoPromote: approved" | "Blocked: alarm firing" | "Rollback to v2.4.0"
}

export interface PipelineStage {
  id: string;
  name: string;
  type: "build" | "deploy";
  currentVersion: string;
  previousVersion: string | null;
  status: StageStatus;
  deployedAtSec: number;
  commitMessage: string;
  author: string;
  /** Active blockers — can be more than one (alarm + time_window simultaneously) */
  blockers: StageBlocker[];
  /** Alarm IDs that dynamically block promotion when firing (configured watches) */
  alarmWatches: string[];
  /** Current test results for this stage (integration/regression tests) */
  tests: StageTest[];
  /** Recent promotion history (last 5 events, newest first) */
  promotionEvents: PromotionEvent[];
}

export interface Pipeline {
  id: string;
  name: string;
  service: string;
  stages: PipelineStage[];
}

export interface CoachMessage {
  id: string;
  text: string;
  simTime: number;
  proactive: boolean; // true = coach initiated; false = response to trainee question
}

/**
 * A page sent by the trainee to a persona via the page_user action.
 * Models a real PagerDuty page: the paged persona receives an alert and their
 * on-call app fires a notification. The persona's system prompt handles responding.
 */
export interface PageAlert {
  id: string;
  personaId: string; // who was paged
  message: string; // the page message written by the trainee
  simTime: number;
}

/**
 * A significant simulation event recorded for the debrief timeline.
 * Captures every meaningful event that occurred during the session —
 * both simulation-driven events (alarms, emails, LLM messages) and
 * trainee-triggered events — for display in the post-incident debrief.
 * `sim_time` heartbeats and `session_snapshot` are excluded (too noisy).
 */
export interface SimEventLogEntry {
  recordedAt: number; // sim seconds when this event was recorded
  event: SimEvent;
}

// ── Enumerations ──────────────────────────────────────────────────────────────

export type TicketSeverity = "SEV1" | "SEV2" | "SEV3" | "SEV4";
export type TicketStatus = "open" | "in_progress" | "resolved";
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
export type AlarmSeverity = "SEV1" | "SEV2" | "SEV3" | "SEV4";
export type AlarmStatus = "firing" | "acknowledged" | "suppressed";
export type DeploymentStatus = "active" | "previous" | "rolled_back";

// ── Action types ──────────────────────────────────────────────────────────────

export type ActionType =
  // Incident management
  | "ack_page"
  | "page_user" // page a specific persona with a message (replaces escalate_page)
  | "update_ticket"
  | "add_ticket_comment"
  | "mark_resolved"
  | "investigate_alert" // evaluation-tracked: trainee examined this alarm
  // Communication
  | "post_chat_message"
  | "reply_email"
  | "direct_message_persona"
  // Investigation
  | "open_tab"
  | "search_logs"
  | "view_metric"
  | "read_wiki_page"
  | "view_deployment_history"
  // Remediation
  | "trigger_rollback"
  | "trigger_roll_forward"
  | "override_blocker" // force-promote through an alarm/time-window blocker
  | "approve_gate" // approve a manual_approval gate
  | "block_promotion" // halt further promotion from a stage
  | "view_pipeline" // evaluation-tracked: trainee viewed a pipeline
  | "restart_service"
  | "scale_cluster"
  | "throttle_traffic"
  | "suppress_alarm"
  | "emergency_deploy"
  | "toggle_feature_flag"
  // Monitoring
  | "monitor_recovery";

// ── Session snapshot ──────────────────────────────────────────────────────────

export interface SessionSnapshot {
  sessionId: string;
  scenarioId: string;
  simTime: number; // current sim seconds
  speed: 1 | 2 | 5 | 10;
  paused: boolean;
  clockAnchorMs: number; // Unix ms that corresponds to simTime=0
  emails: EmailMessage[];
  chatChannels: Record<string, ChatMessage[]>; // channel → messages
  tickets: Ticket[];
  ticketComments: Record<string, TicketComment[]>; // ticketId → comments
  logs: LogEntry[];
  metrics: Record<string, Record<string, TimeSeriesPoint[]>>; // service → metricId → series
  alarms: Alarm[];
  deployments: Record<string, Deployment[]>; // service → deployments (kept for debrief compat)
  pipelines: Pipeline[]; // full pipeline+stage state
  pages: PageAlert[]; // pages sent by trainee
  auditLog: AuditEntry[];
  coachMessages: CoachMessage[];
  throttles: ActiveThrottle[];
}

// ── Evaluation and debrief types ──────────────────────────────────────────────

export interface EvaluationState {
  relevantActionsTaken: Array<{
    action: string;
    service?: string;
    why: string;
    takenAt: number;
  }>;
  redHerringsTaken: Array<{
    action: string;
    why: string;
    takenAt: number;
  }>;
  resolved: boolean;
}

export interface DebriefResult {
  narrative: string;
  evaluationState: EvaluationState;
  auditLog: AuditEntry[];
  eventLog: SimEventLogEntry[];
  resolvedAtSimTime: number;
}

// ── Throttle state ────────────────────────────────────────────────────────────

export type ThrottleScope =
  | "endpoint" // HTTP path or named API surface
  | "customer" // per-tenant / per-API-key (trainee supplies customer ID at apply time)
  | "consumer" // queue consumer group or stream consumer
  | "concurrent" // max simultaneous executions (Lambda, goroutines)
  | "global"; // service-wide catch-all

export type ThrottleUnit = "rps" | "msg_per_sec" | "concurrent";

// An active throttle applied by the trainee during a session.
export interface ActiveThrottle {
  remediationActionId: string;
  targetId: string; // matches ThrottleTargetConfig.id
  scope: ThrottleScope;
  label: string; // display label from scenario
  unit: ThrottleUnit;
  limitRate: number; // the limit the trainee set
  appliedAtSimTime: number;
  customerId?: string; // only for scope=customer
}

// ── SSE event discriminated union ─────────────────────────────────────────────

export type SimEvent =
  | { type: "session_snapshot"; snapshot: SessionSnapshot }
  | { type: "session_expired"; reason: string }
  | {
      type: "sim_time";
      simTime: number;
      speed: 1 | 2 | 5 | 10;
      paused: boolean;
    }
  | { type: "email_received"; email: EmailMessage }
  | { type: "chat_message"; channel: string; message: ChatMessage }
  | { type: "ticket_created"; ticket: Ticket }
  | { type: "ticket_updated"; ticketId: string; changes: Partial<Ticket> }
  | { type: "ticket_comment"; ticketId: string; comment: TicketComment }
  | { type: "log_entry"; entry: LogEntry }
  | {
      type: "metric_update";
      service: string;
      metricId: string;
      point: TimeSeriesPoint;
    }
  | { type: "alarm_fired"; alarm: Alarm }
  | { type: "alarm_silenced"; alarmId: string }
  | { type: "deployment_update"; service: string; deployment: Deployment }
  | { type: "pipeline_stage_updated"; pipelineId: string; stage: PipelineStage }
  | { type: "page_sent"; alert: PageAlert } // trainee paged a persona
  | { type: "coach_message"; message: CoachMessage }
  | { type: "debrief_ready"; sessionId: string }
  | { type: "error"; code: string; message: string };
