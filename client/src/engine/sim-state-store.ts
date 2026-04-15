import type {
  ChatMessage,
  EmailMessage,
  Ticket,
  TicketComment,
  LogEntry,
  Alarm,
  AlarmStatus,
  Deployment,
  PageAlert,
  Pipeline,
  PipelineStage,
  ActiveThrottle,
} from "@shared/types/events";

// ── Pending deployment queue ──────────────────────────────────────────────────
//
// Tracks a rollback or emergency deploy that is working its way through the
// pipeline stages one at a time with realistic sim-time delays between each
// stage transition (in_progress → succeeded).
//
// The game-loop tick advances each pending deployment based on elapsed sim-time.

export interface StageScheduleEntry {
  stageId: string;
  /** Sim-seconds from the moment the deployment was initiated at which this stage starts. */
  startAtSim: number;
  /** How many sim-seconds this stage takes to complete once it starts. */
  durationSecs: number;
}

export interface PendingDeployment {
  pipelineId: string;
  /** Ordered stage schedule — one entry per pipeline stage. */
  stageSchedule: StageScheduleEntry[];
  /** Index of the stage currently being processed (0-based). */
  currentStageIndex: number;
  /** Sim-seconds when the deployment was initiated (clock.getSimTime() at dispatch). */
  initiatedAtSim: number;
  version: string;
  previousVersion: string | null;
  commitMessage: string;
  author: string;
  /** True for emergency_deploy — skips intermediate pipeline stages, but still
   *  respects manual promotion blockers on the target stage. */
  isEmergency: boolean;
}

export interface SimStateStoreSnapshot {
  emails: EmailMessage[];
  chatChannels: Record<string, ChatMessage[]>;
  tickets: Ticket[];
  ticketComments: Record<string, TicketComment[]>;
  logs: LogEntry[];
  alarms: Alarm[];
  deployments: Record<string, Deployment[]>;
  pipelines: Pipeline[];
  pages: PageAlert[];
  throttles: ActiveThrottle[];
}

export interface SimStateStore {
  // ── Chat ──────────────────────────────────────────────────────────────────
  addChatMessage(channel: string, message: ChatMessage): void;
  ensureChannel(channel: string): void;
  getChatChannel(channel: string): ChatMessage[];
  getAllChatChannels(): Record<string, ChatMessage[]>;

  // ── Email ─────────────────────────────────────────────────────────────────
  addEmail(email: EmailMessage): void;
  getEmailThread(threadId: string): EmailMessage[];
  getAllEmails(): EmailMessage[];

  // ── Tickets ───────────────────────────────────────────────────────────────
  addTicket(ticket: Ticket): void;
  updateTicket(ticketId: string, changes: Partial<Ticket>): void;
  addTicketComment(ticketId: string, comment: TicketComment): void;
  getTicket(ticketId: string): Ticket | null;
  getAllTickets(): Ticket[];
  getTicketComments(ticketId: string): TicketComment[];

  // ── Logs ──────────────────────────────────────────────────────────────────
  addLogEntry(entry: LogEntry): void;
  getAllLogs(): LogEntry[];

  // ── Alarms ────────────────────────────────────────────────────────────────
  addAlarm(alarm: Alarm): void;
  updateAlarmStatus(alarmId: string, status: AlarmStatus): void;
  getAllAlarms(): Alarm[];

  // ── Deployments ───────────────────────────────────────────────────────────
  addDeployment(service: string, deployment: Deployment): void;
  getDeployments(service: string): Deployment[];
  getAllDeployments(): Record<string, Deployment[]>;

  // ── Pipelines ─────────────────────────────────────────────────────────────
  addPipeline(pipeline: Pipeline): void;
  updateStage(
    pipelineId: string,
    stageId: string,
    changes: Partial<PipelineStage>,
  ): void;
  getPipeline(pipelineId: string): Pipeline | null;
  getAllPipelines(): Pipeline[];

  // ── Pages ─────────────────────────────────────────────────────────────────
  addPage(page: PageAlert): void;
  getAllPages(): PageAlert[];

  // ── Throttles ─────────────────────────────────────────────────────────────
  // Apply or replace a throttle. Two throttles on the same targetId+customerId
  // are treated as the same slot — the newer one replaces the older.
  applyThrottle(throttle: ActiveThrottle): void;
  // Remove a throttle. customerId=undefined matches a non-customer throttle.
  removeThrottle(targetId: string, customerId: string | undefined): void;
  getThrottle(
    targetId: string,
    customerId: string | undefined,
  ): ActiveThrottle | null;
  getAllThrottles(): ActiveThrottle[];

  // ── Pending deployments ───────────────────────────────────────────────────
  /**
   * Enqueue a new deployment that will be advanced stage-by-stage each tick.
   * The `currentStageIndex` is set to 0 by the store; `initiatedAtSim` must be
   * provided by the caller (clock.getSimTime() at dispatch time).
   */
  enqueuePendingDeployment(
    deployment: Omit<PendingDeployment, "currentStageIndex">,
  ): void;
  /** Advance the current stage index for the named pipeline's pending deployment. */
  updatePendingDeploymentProgress(pipelineId: string, newIndex: number): void;
  /**
   * Rebase the pending deployment's timing so the current stage starts fresh
   * from `nowSim`. Called when a blocker is removed and the deployment resumes —
   * prevents stages from instantly completing because their original startAtSim
   * has already elapsed.
   */
  rebasePendingDeployment(pipelineId: string, nowSim: number): void;
  /** Remove the pending deployment once all stages have completed. */
  completePendingDeployment(pipelineId: string): void;
  /** Returns all pending deployments (read-only copy). */
  getPendingDeployments(): PendingDeployment[];

  // ── Snapshot ──────────────────────────────────────────────────────────────
  snapshot(): SimStateStoreSnapshot;
}

export function createSimStateStore(): SimStateStore {
  const _chat: Record<string, ChatMessage[]> = {};
  const _emails: EmailMessage[] = [];
  const _tickets: Map<string, Ticket> = new Map();
  const _comments: Map<string, TicketComment[]> = new Map();
  const _logs: LogEntry[] = [];
  const _alarms: Map<string, Alarm> = new Map();
  const _deployments: Record<string, Deployment[]> = {};
  const _pipelines: Map<string, Pipeline> = new Map();
  const _pages: PageAlert[] = [];
  // Key: `${targetId}:${customerId ?? ""}` — unique slot per target+customer
  const _throttles: Map<string, ActiveThrottle> = new Map();
  // Pending deployments — a FIFO queue per pipeline. The head ([0]) is the
  // active deployment being driven by tickPendingDeployments. New deployments
  // are appended to the tail and start automatically when the head completes.
  const _pendingDeployments: Map<string, PendingDeployment[]> = new Map();

  function deepClone<T>(val: T): T {
    return JSON.parse(JSON.stringify(val)) as T;
  }

  function throttleKey(
    targetId: string,
    customerId: string | undefined,
  ): string {
    return `${targetId}:${customerId ?? ""}`;
  }

  return {
    // ── Chat ────────────────────────────────────────────────────────────────
    addChatMessage(channel, message) {
      if (!_chat[channel]) _chat[channel] = [];
      _chat[channel].push(message);
    },
    ensureChannel(channel) {
      if (!_chat[channel]) _chat[channel] = [];
    },
    getChatChannel(channel) {
      return deepClone(_chat[channel] ?? []);
    },
    getAllChatChannels() {
      return deepClone(_chat);
    },

    // ── Email ──────────────────────────────────────────────────────────────
    addEmail(email) {
      _emails.push(email);
    },
    getEmailThread(threadId) {
      return deepClone(_emails.filter((e) => e.threadId === threadId));
    },
    getAllEmails() {
      return deepClone(_emails);
    },

    // ── Tickets ────────────────────────────────────────────────────────────
    addTicket(ticket) {
      _tickets.set(ticket.id, ticket);
    },
    updateTicket(ticketId, changes) {
      const existing = _tickets.get(ticketId);
      if (existing) _tickets.set(ticketId, { ...existing, ...changes });
    },
    addTicketComment(ticketId, comment) {
      const existing = _comments.get(ticketId) ?? [];
      _comments.set(ticketId, [...existing, comment]);
    },
    getTicket(ticketId) {
      const t = _tickets.get(ticketId);
      return t ? deepClone(t) : null;
    },
    getAllTickets() {
      return deepClone([..._tickets.values()]);
    },
    getTicketComments(ticketId) {
      return deepClone(_comments.get(ticketId) ?? []);
    },

    // ── Logs ───────────────────────────────────────────────────────────────
    addLogEntry(entry) {
      _logs.push(entry);
    },
    getAllLogs() {
      return deepClone(_logs);
    },

    // ── Alarms ─────────────────────────────────────────────────────────────
    addAlarm(alarm) {
      _alarms.set(alarm.id, alarm);
    },
    updateAlarmStatus(alarmId, status) {
      const existing = _alarms.get(alarmId);
      if (existing) _alarms.set(alarmId, { ...existing, status });
    },
    getAllAlarms() {
      return deepClone([..._alarms.values()]);
    },

    // ── Deployments ────────────────────────────────────────────────────────
    addDeployment(service, deployment) {
      if (!_deployments[service]) _deployments[service] = [];
      _deployments[service].push(deployment);
    },
    getDeployments(service) {
      return deepClone(_deployments[service] ?? []);
    },
    getAllDeployments() {
      return deepClone(_deployments);
    },

    // ── Pipelines ──────────────────────────────────────────────────────────
    addPipeline(pipeline) {
      _pipelines.set(pipeline.id, deepClone(pipeline));
    },
    updateStage(pipelineId, stageId, changes) {
      const pipeline = _pipelines.get(pipelineId);
      if (!pipeline) return;
      _pipelines.set(pipelineId, {
        ...pipeline,
        stages: pipeline.stages.map((s) =>
          s.id === stageId ? { ...s, ...changes } : s,
        ),
      });
    },
    getPipeline(pipelineId) {
      const p = _pipelines.get(pipelineId);
      return p ? deepClone(p) : null;
    },
    getAllPipelines() {
      return deepClone([..._pipelines.values()]);
    },

    // ── Pages ──────────────────────────────────────────────────────────────
    addPage(page) {
      _pages.push(page);
    },
    getAllPages() {
      return deepClone(_pages);
    },

    // ── Throttles ──────────────────────────────────────────────────────────
    applyThrottle(throttle) {
      const key = throttleKey(throttle.targetId, throttle.customerId);
      _throttles.set(key, deepClone(throttle));
    },
    removeThrottle(targetId, customerId) {
      _throttles.delete(throttleKey(targetId, customerId));
    },
    getThrottle(targetId, customerId) {
      const t = _throttles.get(throttleKey(targetId, customerId));
      return t ? deepClone(t) : null;
    },
    getAllThrottles() {
      return deepClone([..._throttles.values()]);
    },

    // ── Pending deployments ────────────────────────────────────────────────
    enqueuePendingDeployment(deployment) {
      const entry: PendingDeployment = { ...deployment, currentStageIndex: 0 };
      const queue = _pendingDeployments.get(deployment.pipelineId);
      if (queue) {
        queue.push(entry); // append to tail — head is still active
      } else {
        _pendingDeployments.set(deployment.pipelineId, [entry]);
      }
    },
    updatePendingDeploymentProgress(pipelineId, newIndex) {
      const head = _pendingDeployments.get(pipelineId)?.[0];
      if (head) head.currentStageIndex = newIndex;
    },
    rebasePendingDeployment(pipelineId, nowSim) {
      const head = _pendingDeployments.get(pipelineId)?.[0];
      if (!head) return;
      const entry = head.stageSchedule[head.currentStageIndex];
      if (!entry) return;
      // Rebase: set initiatedAtSim so that the current stage's startAtSim
      // becomes exactly nowSim — i.e. the stage starts fresh from right now.
      // initiatedAtSim + entry.startAtSim = nowSim
      // → initiatedAtSim = nowSim - entry.startAtSim
      head.initiatedAtSim = nowSim - entry.startAtSim;
    },
    completePendingDeployment(pipelineId) {
      const queue = _pendingDeployments.get(pipelineId);
      if (!queue) return;
      queue.shift(); // remove completed head
      if (queue.length === 0) {
        _pendingDeployments.delete(pipelineId);
      }
      // Next head (if any) will be rebased by the game loop after this call.
    },
    getPendingDeployments() {
      // Return only the head of each queue — these are the active deployments.
      const heads: PendingDeployment[] = [];
      for (const queue of _pendingDeployments.values()) {
        if (queue.length > 0) heads.push(deepClone(queue[0]));
      }
      return heads;
    },

    // ── Snapshot ───────────────────────────────────────────────────────────
    snapshot(): SimStateStoreSnapshot {
      const ticketComments: Record<string, TicketComment[]> = {};
      for (const [id, comments] of _comments.entries()) {
        ticketComments[id] = deepClone(comments);
      }
      return {
        emails: deepClone(_emails),
        chatChannels: deepClone(_chat),
        tickets: deepClone([..._tickets.values()]),
        ticketComments,
        logs: deepClone(_logs),
        alarms: deepClone([..._alarms.values()]),
        deployments: deepClone(_deployments),
        pipelines: deepClone([..._pipelines.values()]),
        pages: deepClone(_pages),
        throttles: deepClone([..._throttles.values()]),
      };
    },
  };
}
