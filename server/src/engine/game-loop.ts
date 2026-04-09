import { randomUUID } from "crypto";
import type { LoadedScenario } from "../scenario/types";
import type {
  SessionSnapshot,
  SimEvent,
  TimeSeriesPoint,
  ActionType,
  ChatMessage,
  EmailMessage,
  CoachMessage,
  AuditEntry,
  PageAlert,
  SimEventLogEntry,
} from "@shared/types/events";
import type { SimClock } from "./sim-clock";
import type { EventScheduler, ScriptedEvent } from "./event-scheduler";
import type { AuditLog } from "./audit-log";
import type { MetricStore } from "../metrics/metric-store";
import {
  computeMetricSummary,
  type MetricSummary,
} from "../metrics/metric-summary";
import { logger } from "../logger";

const log = logger.child({ component: "game-loop" });
import type {
  ConversationStore,
  ConversationStoreSnapshot,
} from "./conversation-store";
import type { Evaluator, EvaluationState } from "./evaluator";

// ── StakeholderContext (Phase 5 consumes this) ────────────────────────────────

export interface StakeholderContext {
  sessionId: string;
  scenario: LoadedScenario;
  simTime: number;
  auditLog: AuditEntry[];
  conversations: ConversationStoreSnapshot;
  personaCooldowns: Record<string, number>;
  directlyAddressed: Set<string>; // persona IDs directly messaged since last LLM tick
  metricSummary: MetricSummary; // grounded metric state — current values, trends, history
}

// ── GameLoop ──────────────────────────────────────────────────────────────────

// Event types recorded in the simulation event log.
// sim_time (heartbeat) and session_snapshot are excluded — too frequent/large.
const LOGGABLE_EVENT_TYPES = new Set<SimEvent["type"]>([
  "email_received",
  "chat_message",
  "ticket_created",
  "ticket_updated",
  "ticket_comment",
  "log_entry",
  "alarm_fired",
  "alarm_silenced",
  "deployment_update",
  "pipeline_stage_updated",
  "page_sent",
  "coach_message",
]);
const EVENT_LOG_MAX_SIZE = 500;

export interface GameLoop {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  setSpeed(speed: 1 | 2 | 5 | 10): void;
  handleAction(action: ActionType, params: Record<string, unknown>): void;
  handleChatMessage(channel: string, text: string): void;
  handleEmailReply(threadId: string, body: string): void;
  getConversationSnapshot(): ConversationStoreSnapshot;
  handleCoachMessage(message: CoachMessage): void;
  getSnapshot(): SessionSnapshot;
  getEvaluationState(): EvaluationState;
  /** Returns the simulation event log for use in the debrief. */
  getEventLog(): SimEventLogEntry[];
  onEvent(handler: (event: SimEvent) => void): () => void;
}

export interface GameLoopDependencies {
  scenario: LoadedScenario;
  sessionId: string;
  clock: SimClock;
  scheduler: EventScheduler;
  auditLog: AuditLog;
  store: ConversationStore;
  evaluator: Evaluator;
  metrics: Record<string, Record<string, TimeSeriesPoint[]>>; // plain series for alarm detection
  metricStore?: MetricStore; // optional: when present, streams metric_update events and provides snapshot
  clockAnchorMs: number;
  onDirtyTick?: (context: StakeholderContext) => Promise<SimEvent[]>;
  onCoachTick?: (context: StakeholderContext) => Promise<CoachMessage | null>;
}

// Read-only MetricStore built from a plain series Record when no full MetricStore
// is provided. Supports getAllSeries and getCurrentValue; reactive overlay
// methods are no-ops (no resolvedParams available).
function _buildFallbackStore(
  metrics: Record<string, Record<string, TimeSeriesPoint[]>>,
): MetricStore {
  return {
    getAllSeries() {
      const result: Record<string, Record<string, TimeSeriesPoint[]>> = {};
      for (const [service, metricMap] of Object.entries(metrics)) {
        result[service] = {};
        for (const [metricId, pts] of Object.entries(metricMap)) {
          result[service][metricId] = pts.map((p) => ({ t: p.t, v: p.v }));
        }
      }
      return result;
    },
    getCurrentValue(service, metricId, simTime) {
      const pts = metrics[service]?.[metricId];
      if (!pts) return null;
      let best: TimeSeriesPoint | null = null;
      for (const pt of pts) {
        if (pt.t <= simTime) best = pt;
        else break;
      }
      return best?.v ?? null;
    },
    applyReactiveOverlay() {
      /* no-op: no resolvedParams in fallback store */
    },
    getPointsInWindow() {
      return [];
    },
    getResolvedParams() {
      return null;
    },
    listMetrics() {
      const result: Array<{ service: string; metricId: string }> = [];
      for (const [service, metricMap] of Object.entries(metrics)) {
        for (const metricId of Object.keys(metricMap)) {
          result.push({ service, metricId });
        }
      }
      return result;
    },
  };
}

export function createGameLoop(deps: GameLoopDependencies): GameLoop {
  const {
    scenario,
    sessionId,
    clock,
    scheduler,
    auditLog,
    store,
    evaluator,
    metrics,
    clockAnchorMs,
  } = deps;

  // If a MetricStore was provided (Phase 10 full wiring), use it for reactive
  // overlay streaming and snapshots. Otherwise build a minimal read-only store
  // from the plain metrics Record so computeMetricSummary always has a valid store.
  const metricStore: MetricStore =
    deps.metricStore ?? _buildFallbackStore(metrics);

  const onDirtyTick = deps.onDirtyTick ?? (() => Promise.resolve([]));
  const onCoachTick = deps.onCoachTick ?? (() => Promise.resolve(null));

  const _eventHandlers: Array<(event: SimEvent) => void> = [];
  let _dirty = false;
  let _inFlight = false;
  let _intervalId: ReturnType<typeof setInterval> | null = null;
  let _lastRealMs = 0;
  let _coachTickCount = 0;
  const _coachMessages: CoachMessage[] = [];
  const _personaCooldowns: Record<string, number> = {};
  const _eventLog: SimEventLogEntry[] = [];
  const _directlyAddressed = new Set<string>(); // cleared after each LLM tick

  const COACH_TICK_INTERVAL = 3; // call onCoachTick every 3 dirty ticks

  function emit(event: SimEvent): void {
    // Record significant events in the simulation event log (for debrief)
    if (LOGGABLE_EVENT_TYPES.has(event.type)) {
      if (_eventLog.length >= EVENT_LOG_MAX_SIZE) _eventLog.shift();
      _eventLog.push({ recordedAt: clock.getSimTime(), event });
    }
    for (const h of _eventHandlers) h(event);
  }

  function buildStakeholderContext(): StakeholderContext {
    return {
      sessionId,
      scenario,
      simTime: clock.getSimTime(),
      auditLog: auditLog.getAll(),
      conversations: store.snapshot(),
      personaCooldowns: { ..._personaCooldowns },
      directlyAddressed: new Set(_directlyAddressed),
      metricSummary: computeMetricSummary(
        scenario,
        metricStore,
        clock.getSimTime(),
      ),
    };
  }

  function handleScriptedEvent(se: ScriptedEvent): void {
    switch (se.kind) {
      case "email":
        store.addEmail(se.email);
        emit({ type: "email_received", email: se.email });
        break;
      case "chat_message":
        store.addChatMessage(se.channel, se.message);
        emit({
          type: "chat_message",
          channel: se.channel,
          message: se.message,
        });
        break;
      case "log_entry":
        store.addLogEntry(se.entry);
        emit({ type: "log_entry", entry: se.entry });
        break;
      case "alarm_fired":
        store.addAlarm(se.alarm);
        emit({ type: "alarm_fired", alarm: se.alarm });
        break;
      case "ticket":
        store.addTicket(se.ticket);
        emit({ type: "ticket_created", ticket: se.ticket });
        break;
      case "deployment":
        store.addDeployment(se.service, se.deployment);
        emit({
          type: "deployment_update",
          service: se.service,
          deployment: se.deployment,
        });
        break;
    }
  }

  function applySimEventToStore(ev: SimEvent): void {
    switch (ev.type) {
      case "chat_message":
        store.addChatMessage(ev.channel, ev.message);
        break;
      case "email_received":
        store.addEmail(ev.email);
        break;
      case "ticket_comment":
        store.addTicketComment(ev.ticketId, ev.comment);
        break;
      case "alarm_fired":
        store.addAlarm(ev.alarm);
        break;
      case "alarm_silenced":
        store.updateAlarmStatus(ev.alarmId, "suppressed");
        break;
      case "log_entry":
        store.addLogEntry(ev.entry);
        break;
      case "deployment_update":
        store.addDeployment(ev.service, ev.deployment);
        break;
      case "pipeline_stage_updated":
        store.updateStage(ev.pipelineId, ev.stage.id, ev.stage);
        break;
      case "ticket_created":
        store.addTicket(ev.ticket);
        break;
      case "page_sent":
        store.addPage(ev.alert);
        break;
      // All other event types (sim_time, coach_message, etc.) don't affect the store
    }
  }

  function triggerDirtyTick(): void {
    if (_inFlight) return;
    _inFlight = true;
    _dirty = false;
    _coachTickCount++;

    const ctx = buildStakeholderContext();
    _directlyAddressed.clear(); // context captured; clear so next round starts fresh

    // Stakeholder tick
    onDirtyTick(ctx)
      .then((events) => {
        for (const ev of events) {
          applySimEventToStore(ev);
          emit(ev);
        }
        // Do NOT set _dirty here — LLM output is already applied.
        // _dirty is only set by external inputs (actions, chat, ticks with scripted events).
      })
      .catch((err) => {
        log.error({ err }, "onDirtyTick error");
      })
      .finally(() => {
        _inFlight = false;
        // Re-trigger only if external input arrived while we were in-flight
        if (_dirty) triggerDirtyTick();
      });

    // Coach tick (every N dirty ticks)
    if (_coachTickCount % COACH_TICK_INTERVAL === 0) {
      onCoachTick(ctx)
        .then((msg) => {
          if (msg) {
            _coachMessages.push(msg);
            emit({ type: "coach_message", message: msg });
          }
        })
        .catch((err) => {
          log.error({ err }, "onCoachTick error");
        });
    }
  }

  function tick(): void {
    const now = Date.now();
    const realElapsedMs = _lastRealMs > 0 ? now - _lastRealMs : 0;
    _lastRealMs = now;

    // Step 1: advance clock
    const previousSimTime = clock.getSimTime();
    clock.tick(realElapsedMs);
    const simTime = clock.getSimTime();

    // Step 2: fire due scripted events
    const due = scheduler.tick(simTime);
    for (const se of due) {
      handleScriptedEvent(se);
      _dirty = true;
    }

    // Step 3: computed alarm threshold detection
    // Check autoFire alarms — fire when metric value first crosses threshold
    const firedAlarmIds = new Set(store.snapshot().alarms.map((a) => a.id));
    for (const alarmConfig of scenario.alarms) {
      if (!alarmConfig.autoFire || firedAlarmIds.has(alarmConfig.id)) continue;
      const threshold = alarmConfig.threshold;
      if (threshold == null) continue;

      const series = metrics[alarmConfig.service]?.[alarmConfig.metricId];
      if (!series || series.length === 0) continue;
      const point = [...series].reverse().find((p) => p.t <= simTime);
      if (!point) continue;

      if (point.v >= threshold) {
        const alarm: import("@shared/types/events").Alarm = {
          id: alarmConfig.id,
          service: alarmConfig.service,
          metricId: alarmConfig.metricId,
          condition: alarmConfig.condition,
          value: point.v,
          severity: alarmConfig.severity,
          status: "firing",
          simTime,
        };
        applySimEventToStore({ type: "alarm_fired", alarm });
        emit({ type: "alarm_fired", alarm });
        _dirty = true;

        if (alarmConfig.autoPage && alarmConfig.pageMessage) {
          const msg = alarmConfig.pageMessage;
          const svc = alarmConfig.service;
          const pageEmail: import("@shared/types/events").EmailMessage = {
            id: `auto-page-email-${alarmConfig.id}`,
            threadId: `page-${alarmConfig.id}`,
            from: "pagerduty-bot",
            to: "trainee",
            subject: `[ALERT] ${svc}: ${msg}`,
            body: `**PagerDuty Alert**\n\nService: ${svc}\nSeverity: ${alarm.severity}\n\n${msg}\n\nAcknowledge this alert to stop further escalation.`,
            simTime,
          };
          applySimEventToStore({ type: "email_received", email: pageEmail });
          emit({ type: "email_received", email: pageEmail });

          const botMsg: import("@shared/types/events").ChatMessage = {
            id: `auto-page-chat-${alarmConfig.id}`,
            channel: "#incidents",
            persona: "pagerduty-bot",
            text: `🔔 **${alarm.severity}** | ${svc} | ${msg}`,
            simTime,
          };
          applySimEventToStore({
            type: "chat_message",
            channel: "#incidents",
            message: botMsg,
          });
          emit({
            type: "chat_message",
            channel: "#incidents",
            message: botMsg,
          });
        }
      }
    }

    // Step 3b: pipeline alarm-blocker synchronisation
    // For each pipeline stage:
    //   - If an alarm in alarmWatches fires → add an alarm blocker (if not already present)
    //   - If a suppressed alarm blocker's suppressedUntil has expired → reinstate it
    //   - If all alarm blockers are cleared (alarm no longer firing) → remove them
    const currentAlarms = store.snapshot().alarms;
    const alarmMap = new Map(currentAlarms.map((a) => [a.id, a]));

    for (const pipeline of store.getAllPipelines()) {
      for (const stage of pipeline.stages) {
        let changed = false;
        let updatedStage: import("@shared/types/events").PipelineStage = {
          ...stage,
          blockers: [...stage.blockers],
        };

        // 1. Add blockers from alarmWatches for any newly-firing alarm
        for (const watchId of stage.alarmWatches) {
          const alarm = alarmMap.get(watchId);
          if (!alarm) continue;

          const existingBlocker = updatedStage.blockers.find(
            (b) => b.alarmId === watchId,
          );

          if (alarm.status === "firing") {
            if (!existingBlocker) {
              // Alarm just fired — add blocker
              updatedStage = {
                ...updatedStage,
                status: "blocked",
                blockers: [
                  ...updatedStage.blockers,
                  {
                    type: "alarm" as const,
                    alarmId: watchId,
                    message: `Alarm firing: ${alarm.condition} on ${alarm.service}`,
                  },
                ],
              };
              changed = true;
            } else if (
              existingBlocker.suppressedUntil != null &&
              simTime >= existingBlocker.suppressedUntil
            ) {
              // Suppression window expired — reinstate blocker
              updatedStage = {
                ...updatedStage,
                status: "blocked",
                blockers: updatedStage.blockers.map((b) =>
                  b.alarmId === watchId
                    ? { ...b, suppressedUntil: undefined }
                    : b,
                ),
              };
              changed = true;
            }
          } else if (alarm.status === "suppressed") {
            // Suppressed — remove the active blocker (let promotion proceed temporarily)
            if (existingBlocker && existingBlocker.suppressedUntil == null) {
              updatedStage = {
                ...updatedStage,
                blockers: updatedStage.blockers.filter(
                  (b) => b.alarmId !== watchId,
                ),
              };
              // If no more blockers, mark stage as succeeded
              if (updatedStage.blockers.length === 0) {
                updatedStage = { ...updatedStage, status: "succeeded" };
              }
              changed = true;
            }
          } else {
            // Alarm gone (no longer in store / no longer firing) — remove blocker
            if (existingBlocker) {
              updatedStage = {
                ...updatedStage,
                blockers: updatedStage.blockers.filter(
                  (b) => b.alarmId !== watchId,
                ),
              };
              if (
                updatedStage.blockers.length === 0 &&
                updatedStage.status === "blocked"
              ) {
                updatedStage = { ...updatedStage, status: "succeeded" };
              }
              changed = true;
            }
          }
        }

        if (changed) {
          store.updateStage(pipeline.id, stage.id, updatedStage);
          emit({
            type: "pipeline_stage_updated",
            pipelineId: pipeline.id,
            stage: updatedStage,
          });
        }
      }
    }

    // Step 4: broadcast sim_time
    emit(clock.toSimTimeEvent());

    // Step 4b: stream newly-visible reactive overlay points.
    // Uses metricStore.listMetrics() — returns key pairs only, no series data —
    // instead of getAllSeries() which deep-copies every array on every tick.
    if (metricStore) {
      for (const { service, metricId } of metricStore.listMetrics()) {
        const newPoints = metricStore.getPointsInWindow(
          service,
          metricId,
          previousSimTime,
          simTime,
        );
        for (const point of newPoints) {
          emit({ type: "metric_update", service, metricId, point });
        }
      }
    }

    // Step 5: dirty tick
    if (_dirty) triggerDirtyTick();
  }

  return {
    start() {
      _lastRealMs = Date.now();
      // Fire t=0 scripted events immediately on start (don't wait for first tick interval)
      tick();
      const intervalMs = scenario.engine.tickIntervalSeconds * 1000;
      _intervalId = setInterval(tick, intervalMs);
    },

    stop() {
      if (_intervalId) {
        clearInterval(_intervalId);
        _intervalId = null;
      }
    },

    pause() {
      clock.pause();
    },
    resume() {
      clock.resume();
    },
    setSpeed(speed) {
      clock.setSpeed(speed);
    },

    handleAction(action, params) {
      auditLog.record(action, params, clock.getSimTime());
      evaluator.evaluate(auditLog, scenario);

      // Update conversation store for state-affecting actions
      switch (action) {
        case "update_ticket": {
          const ticketId = params["ticketId"] as string | undefined;
          const changes = params["changes"] as
            | Partial<import("@shared/types/events").Ticket>
            | undefined;
          if (ticketId && changes) {
            store.updateTicket(ticketId, changes);
            emit({ type: "ticket_updated", ticketId, changes });
          }
          break;
        }
        case "add_ticket_comment": {
          const ticketId = params["ticketId"] as string | undefined;
          // Client sends { ticketId, body } — server constructs the TicketComment
          const body = params["body"] as string | undefined;
          if (ticketId && body) {
            const comment: import("@shared/types/events").TicketComment = {
              id: randomUUID(),
              ticketId,
              author: "trainee",
              body,
              simTime: clock.getSimTime(),
            };
            store.addTicketComment(ticketId, comment);
            emit({ type: "ticket_comment", ticketId, comment });
          }
          break;
        }
        case "trigger_rollback": {
          const pipelineId = params["pipelineId"] as string | undefined;
          const stageId = params["stageId"] as string | undefined;
          if (pipelineId && stageId) {
            const pipeline = store.getPipeline(pipelineId);
            const stage = pipeline?.stages.find((s) => s.id === stageId);
            if (stage && stage.previousVersion) {
              const promotionEvent: import("@shared/types/events").PromotionEvent =
                {
                  version: stage.previousVersion,
                  simTime: clock.getSimTime(),
                  status: "succeeded",
                  note: `Rollback to ${stage.previousVersion}`,
                };
              const rolledBackStage: import("@shared/types/events").PipelineStage =
                {
                  ...stage,
                  previousVersion: stage.currentVersion,
                  currentVersion: stage.previousVersion,
                  status: "in_progress",
                  deployedAtSec: clock.getSimTime(),
                  commitMessage: `Rollback to ${stage.previousVersion}`,
                  blockers: [],
                  promotionEvents: [
                    promotionEvent,
                    ...stage.promotionEvents,
                  ].slice(0, 5),
                };
              store.updateStage(pipelineId, stageId, rolledBackStage);
              emit({
                type: "pipeline_stage_updated",
                pipelineId,
                stage: rolledBackStage,
              });
            }
          }
          break;
        }
        case "override_blocker": {
          // Suppress alarm blockers for 30 sim-minutes; let promotion through
          const SUPPRESSION_WINDOW = 30 * 60;
          const pipelineId = params["pipelineId"] as string | undefined;
          const stageId = params["stageId"] as string | undefined;
          if (pipelineId && stageId) {
            const pipeline = store.getPipeline(pipelineId);
            const stage = pipeline?.stages.find((s) => s.id === stageId);
            if (stage && stage.blockers.length > 0) {
              const overriddenStage: import("@shared/types/events").PipelineStage =
                {
                  ...stage,
                  status: "succeeded",
                  blockers: stage.blockers
                    .map((b) =>
                      b.type === "alarm"
                        ? {
                            ...b,
                            suppressedUntil:
                              clock.getSimTime() + SUPPRESSION_WINDOW,
                          }
                        : b,
                    )
                    .filter(
                      (b) =>
                        b.type !== "manual_approval" &&
                        b.type !== "time_window",
                    ),
                };
              store.updateStage(pipelineId, stageId, overriddenStage);
              emit({
                type: "pipeline_stage_updated",
                pipelineId,
                stage: overriddenStage,
              });
            }
          }
          break;
        }
        case "approve_gate": {
          const pipelineId = params["pipelineId"] as string | undefined;
          const stageId = params["stageId"] as string | undefined;
          if (pipelineId && stageId) {
            const pipeline = store.getPipeline(pipelineId);
            const stage = pipeline?.stages.find((s) => s.id === stageId);
            if (
              stage &&
              stage.blockers.some((b) => b.type === "manual_approval")
            ) {
              const approvedStage: import("@shared/types/events").PipelineStage =
                {
                  ...stage,
                  status: "in_progress",
                  blockers: stage.blockers.filter(
                    (b) => b.type !== "manual_approval",
                  ),
                };
              store.updateStage(pipelineId, stageId, approvedStage);
              emit({
                type: "pipeline_stage_updated",
                pipelineId,
                stage: approvedStage,
              });
            }
          }
          break;
        }
        case "block_promotion": {
          const pipelineId = params["pipelineId"] as string | undefined;
          const stageId = params["stageId"] as string | undefined;
          const reason =
            (params["reason"] as string | undefined) ?? "Manually blocked";
          if (pipelineId && stageId) {
            const pipeline = store.getPipeline(pipelineId);
            const stage = pipeline?.stages.find((s) => s.id === stageId);
            if (stage) {
              const blockedStage: import("@shared/types/events").PipelineStage =
                {
                  ...stage,
                  status: "blocked",
                  blockers: [
                    ...stage.blockers,
                    { type: "manual_approval", message: reason },
                  ],
                };
              store.updateStage(pipelineId, stageId, blockedStage);
              emit({
                type: "pipeline_stage_updated",
                pipelineId,
                stage: blockedStage,
              });
            }
          }
          break;
        }
        // ── Remediation actions ──────────────────────────────────────────────
        // All five resolve against scenario.remediationActions by id.
        // They emit a deployment_update so the CICD tab reflects the action,
        // and inject a log entry with the scenario-authored side_effect text
        // so the trainee sees realistic feedback in the Logs tab.

        case "emergency_deploy": {
          const actionId = params["remediationActionId"] as string | undefined;
          const ra = actionId
            ? scenario.remediationActions.find((r) => r.id === actionId)
            : scenario.remediationActions.find(
                (r) =>
                  r.type === "emergency_deploy" &&
                  r.service === (params["service"] as string | undefined),
              );
          if (ra) {
            const version = ra.targetVersion ?? "hotfix";
            const deployment: import("@shared/types/events").Deployment = {
              version,
              deployedAtSec: clock.getSimTime(),
              status: "active",
              commitMessage: ra.label ?? `Emergency deploy: ${version}`,
              author: "trainee",
            };
            store.addDeployment(ra.service, deployment);
            emit({
              type: "deployment_update",
              service: ra.service,
              deployment,
            });
            if (ra.sideEffect) {
              const entry: import("@shared/types/events").LogEntry = {
                id: randomUUID(),
                simTime: clock.getSimTime(),
                level: "INFO",
                service: ra.service,
                message: ra.sideEffect,
              };
              store.addLogEntry(entry);
              emit({ type: "log_entry", entry });
            }
          }
          break;
        }

        case "restart_service": {
          const actionId = params["remediationActionId"] as string | undefined;
          const service = params["service"] as string | undefined;
          const ra = actionId
            ? scenario.remediationActions.find((r) => r.id === actionId)
            : scenario.remediationActions.find(
                (r) => r.type === "restart_service" && r.service === service,
              );
          const targetService = ra?.service ?? service;
          if (targetService) {
            const restartEntry: import("@shared/types/events").LogEntry = {
              id: randomUUID(),
              simTime: clock.getSimTime(),
              level: "INFO",
              service: targetService,
              message: ra?.sideEffect ?? `Service restart initiated`,
            };
            store.addLogEntry(restartEntry);
            emit({ type: "log_entry", entry: restartEntry });
            // Brief in_progress then back to active to show the bounce
            const existingDeployments =
              store.snapshot().deployments[targetService];
            const current = existingDeployments?.[0];
            if (current) {
              const bouncing: import("@shared/types/events").Deployment = {
                ...current,
                status: "active",
                deployedAtSec: clock.getSimTime(),
                commitMessage: `Restart: ${current.version}`,
              };
              store.addDeployment(targetService, bouncing);
              emit({
                type: "deployment_update",
                service: targetService,
                deployment: bouncing,
              });
            }
          }
          break;
        }

        case "scale_cluster": {
          const actionId  = params["remediationActionId"] as string | undefined;
          const service   = params["service"] as string | undefined;
          const direction = (params["direction"] as "up" | "down" | undefined) ?? "up";
          const count     = (params["count"] as number | undefined) ?? 1;
          const ra = actionId
            ? scenario.remediationActions.find((r) => r.id === actionId)
            : scenario.remediationActions.find(
                (r) => r.type === "scale_cluster" && r.service === service,
              );
          const targetService = ra?.service ?? service;
          if (targetService) {
            const scaleEntry: import("@shared/types/events").LogEntry = {
              id:      randomUUID(),
              simTime: clock.getSimTime(),
              level:   "INFO",
              service: targetService,
              message: ra?.sideEffect ??
                `Scale ${direction}: ${count} instance(s) requested for ${targetService}`,
            };
            store.addLogEntry(scaleEntry);
            emit({ type: "log_entry", entry: scaleEntry });
          }
          break;
        }

        case "throttle_traffic": {
          const actionId = params["remediationActionId"] as string | undefined;
          const service = params["service"] as string | undefined;
          const ra = actionId
            ? scenario.remediationActions.find((r) => r.id === actionId)
            : scenario.remediationActions.find(
                (r) => r.type === "throttle_traffic" && r.service === service,
              );
          const targetService = ra?.service ?? service;
          if (targetService) {
            const throttleEntry: import("@shared/types/events").LogEntry = {
              id: randomUUID(),
              simTime: clock.getSimTime(),
              level: "WARN",
              service: targetService,
              message:
                ra?.sideEffect ??
                `Traffic throttle applied — rate limiting active`,
            };
            store.addLogEntry(throttleEntry);
            emit({ type: "log_entry", entry: throttleEntry });
          }
          break;
        }

        case "toggle_feature_flag": {
          const actionId = params["remediationActionId"] as string | undefined;
          const flagId = params["flagId"] as string | undefined;
          const enabled = params["enabled"] as boolean | undefined;
          const ra = actionId
            ? scenario.remediationActions.find((r) => r.id === actionId)
            : scenario.remediationActions.find(
                (r) => r.type === "toggle_feature_flag" && r.flagId === flagId,
              );
          const resolvedFlagId = ra?.flagId ?? flagId;
          const resolvedEnabled = ra?.flagEnabled ?? enabled ?? false;
          if (resolvedFlagId) {
            const flagEntry: import("@shared/types/events").LogEntry = {
              id: randomUUID(),
              simTime: clock.getSimTime(),
              level: "INFO",
              service: ra?.service ?? "system",
              message:
                ra?.sideEffect ??
                `Feature flag '${resolvedFlagId}' set to ${resolvedEnabled ? "enabled" : "disabled"}`,
            };
            store.addLogEntry(flagEntry);
            emit({ type: "log_entry", entry: flagEntry });
          }
          break;
        }

        case "suppress_alarm": {
          const alarmId = params["alarmId"] as string | undefined;
          if (alarmId) {
            store.updateAlarmStatus(alarmId, "suppressed");
            emit({ type: "alarm_silenced", alarmId });
          }
          break;
        }
        case "ack_page": {
          const alarmId = params["alarmId"] as string | undefined;
          if (alarmId) {
            store.updateAlarmStatus(alarmId, "acknowledged");
          }
          break;
        }
        case "page_user": {
          // The trainee pages a persona. This sends a real page (not a chat message).
          // The PageAlert is stored so it appears in the Ops dashboard page history.
          // The paged persona is marked as engaged (for silentUntilContacted personas).
          // A dirty tick is triggered so the persona's LLM can respond to being paged.
          const personaId = params["personaId"] as string | undefined;
          const message = params["message"] as string | undefined;
          if (personaId && message) {
            const alert: PageAlert = {
              id: randomUUID(),
              personaId,
              message,
              simTime: clock.getSimTime(),
            };
            store.addPage(alert);
            emit({ type: "page_sent", alert });
            // Mark persona as engaged regardless of silentUntilContacted
            _personaCooldowns[personaId] = clock.getSimTime();
          }
          break;
        }
      }

      // Emit a sim_time event so the client clock stays in sync after any action
      emit({
        type: "sim_time",
        simTime: clock.getSimTime(),
        speed: clock.getSpeed(),
        paused: clock.isPaused(),
      });

      _dirty = true;
      triggerDirtyTick();
    },

    handleChatMessage(channel, text) {
      const msg: ChatMessage = {
        id: randomUUID(),
        channel,
        persona: "trainee",
        text,
        simTime: clock.getSimTime(),
      };
      auditLog.record(
        "post_chat_message",
        { channel, text },
        clock.getSimTime(),
      );
      store.addChatMessage(channel, msg);
      emit({ type: "chat_message", channel, message: msg });

      // If DM to a persona, mark them as engaged and directly addressed
      if (channel.startsWith("dm:")) {
        const personaId = channel.slice(3);
        _personaCooldowns[personaId] = clock.getSimTime();
        _directlyAddressed.add(personaId);
      }

      // @mention detection: find any persona whose displayName appears after @
      // Also engages silent_until_contacted personas — being @mentioned counts as contact.
      const lowerText = text.toLowerCase();
      for (const persona of scenario.personas) {
        if (
          lowerText.includes("@" + persona.displayName.toLowerCase()) ||
          lowerText.includes("@" + persona.id.toLowerCase())
        ) {
          _directlyAddressed.add(persona.id);
          // Engage silent_until_contacted personas so they stay eligible on future ticks
          if (_personaCooldowns[persona.id] == null) {
            _personaCooldowns[persona.id] = clock.getSimTime();
          }
        }
      }

      _dirty = true;
      triggerDirtyTick();
    },

    handleEmailReply(threadId, body) {
      const thread = store.getEmailThread(threadId);
      const original = thread[0];
      const email: EmailMessage = {
        id: randomUUID(),
        threadId,
        from: "trainee",
        to: original?.from ?? "unknown",
        subject: `Re: ${original?.subject ?? ""}`,
        body,
        simTime: clock.getSimTime(),
      };
      auditLog.record("reply_email", { threadId }, clock.getSimTime());
      store.addEmail(email);
      emit({ type: "email_received", email });

      _dirty = true;
      triggerDirtyTick();
    },

    getConversationSnapshot() {
      return store.snapshot();
    },

    handleCoachMessage(message) {
      _coachMessages.push(message);
      emit({ type: "coach_message", message });
    },

    getSnapshot(): SessionSnapshot {
      const storeSnap = store.snapshot();
      return {
        sessionId,
        scenarioId: scenario.id,
        simTime: clock.getSimTime(),
        speed: clock.getSpeed(),
        paused: clock.isPaused(),
        clockAnchorMs,
        emails: storeSnap.emails,
        chatChannels: storeSnap.chatChannels,
        tickets: storeSnap.tickets,
        ticketComments: storeSnap.ticketComments,
        logs: storeSnap.logs,
        metrics: metricStore ? metricStore.getAllSeries() : metrics,
        alarms: storeSnap.alarms,
        deployments: storeSnap.deployments,
        pipelines: storeSnap.pipelines,
        pages: storeSnap.pages,
        auditLog: auditLog.getAll(),
        coachMessages: [..._coachMessages],
      };
    },

    getEvaluationState() {
      return evaluator.evaluate(auditLog, scenario);
    },

    getEventLog() {
      return [..._eventLog];
    },

    onEvent(handler) {
      _eventHandlers.push(handler);
      return () => {
        const idx = _eventHandlers.indexOf(handler);
        if (idx !== -1) _eventHandlers.splice(idx, 1);
      };
    },
  };
}
