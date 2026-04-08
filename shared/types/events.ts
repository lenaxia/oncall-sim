// Canonical SSE event types and core data shapes.
// Both server and client import from here via the @shared path alias.
// No executable logic — types only.

export interface TimeSeriesPoint {
  t: number  // sim seconds relative to t=0; negative = pre-incident
  v: number  // metric value
}

export interface AuditEntry {
  simTime: number                    // sim seconds from scenario start
  action: ActionType
  params: Record<string, unknown>
}

export interface ChatMessage {
  id: string
  channel: string                    // '#incidents' | 'dm:<persona-id>' | etc.
  persona: string                    // persona id or 'trainee'
  text: string
  simTime: number
}

export interface EmailMessage {
  id: string
  threadId: string
  from: string
  to: string
  subject: string
  body: string                       // markdown
  simTime: number
}

export interface Ticket {
  id: string
  title: string
  severity: TicketSeverity
  status: TicketStatus
  description: string                // markdown
  createdBy: string                  // persona id or 'pagerduty-bot'
  simTime: number
}

export interface TicketComment {
  id: string
  ticketId: string
  author: string                     // persona id or 'trainee'
  body: string
  simTime: number
}

export interface LogEntry {
  id: string
  simTime: number
  level: LogLevel
  service: string
  message: string
}

export interface Alarm {
  id: string
  service: string
  metricId: string
  condition: string                  // human-readable, shown in UI
  value: number                      // current value that triggered
  severity: AlarmSeverity
  status: AlarmStatus
  simTime: number
}

export interface Deployment {
  version: string
  deployedAtSec: number              // sim seconds; negative = pre-scenario
  status: DeploymentStatus
  commitMessage: string
  author: string
}

export interface CoachMessage {
  id: string
  text: string
  simTime: number
  proactive: boolean                 // true = coach initiated; false = response to trainee question
}

// ── Enumerations ──────────────────────────────────────────────────────────────

export type TicketSeverity    = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4'
export type TicketStatus      = 'open' | 'in_progress' | 'resolved'
export type LogLevel          = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
export type AlarmSeverity     = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4'
export type AlarmStatus       = 'firing' | 'acknowledged' | 'suppressed'
export type DeploymentStatus  = 'active' | 'previous' | 'rolled_back'

// ── Action types ──────────────────────────────────────────────────────────────

export type ActionType =
  // Incident management
  | 'ack_page'
  | 'escalate_page'
  | 'update_ticket'
  | 'add_ticket_comment'
  | 'mark_resolved'
  // Communication
  | 'post_chat_message'
  | 'reply_email'
  | 'direct_message_persona'
  // Investigation
  | 'open_tab'
  | 'search_logs'
  | 'view_metric'
  | 'read_wiki_page'
  | 'view_deployment_history'
  // Remediation
  | 'trigger_rollback'
  | 'trigger_roll_forward'
  | 'restart_service'
  | 'scale_cluster'
  | 'throttle_traffic'
  | 'suppress_alarm'
  | 'emergency_deploy'
  | 'toggle_feature_flag'
  // Monitoring
  | 'monitor_recovery'

// ── Session snapshot ──────────────────────────────────────────────────────────

export interface SessionSnapshot {
  sessionId: string
  scenarioId: string
  simTime: number                                             // current sim seconds
  speed: 1 | 2 | 5 | 10
  paused: boolean
  emails: EmailMessage[]
  chatChannels: Record<string, ChatMessage[]>                // channel → messages
  tickets: Ticket[]
  ticketComments: Record<string, TicketComment[]>            // ticketId → comments
  logs: LogEntry[]
  metrics: Record<string, Record<string, TimeSeriesPoint[]>> // service → metricId → series
  alarms: Alarm[]
  deployments: Record<string, Deployment[]>                  // service → deployments
  auditLog: AuditEntry[]
  coachMessages: CoachMessage[]
}

// ── SSE event discriminated union ─────────────────────────────────────────────

export type SimEvent =
  | { type: 'session_snapshot';  snapshot: SessionSnapshot }
  | { type: 'session_expired';   reason: string }
  | { type: 'sim_time';          simTime: number; speed: 1 | 2 | 5 | 10; paused: boolean }
  | { type: 'email_received';    email: EmailMessage }
  | { type: 'chat_message';      channel: string; message: ChatMessage }
  | { type: 'ticket_created';    ticket: Ticket }
  | { type: 'ticket_updated';    ticketId: string; changes: Partial<Ticket> }
  | { type: 'ticket_comment';    ticketId: string; comment: TicketComment }
  | { type: 'log_entry';         entry: LogEntry }
  | { type: 'metric_update';     service: string; metricId: string; point: TimeSeriesPoint }  // Phase 2
  | { type: 'alarm_fired';       alarm: Alarm }
  | { type: 'alarm_silenced';    alarmId: string }
  | { type: 'deployment_update'; service: string; deployment: Deployment }
  | { type: 'coach_message';     message: CoachMessage }
  | { type: 'debrief_ready';     sessionId: string }
  | { type: 'error';             code: string; message: string }
