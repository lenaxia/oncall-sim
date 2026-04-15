const randomUUID = () => globalThis.crypto.randomUUID();
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
import type { CoachContext, CoachTriggerReason } from "./coach-engine";
import {
  PASSIVE_ACTIONS,
  DEFERRED_METRIC_REACT_ACTIONS,
} from "./metric-reaction-engine";
import { logger } from "../logger";

const log = logger.child({ component: "game-loop" });
import type { SimStateStore, SimStateStoreSnapshot } from "./sim-state-store";
import type { PendingDeployment } from "./sim-state-store";
import type { Evaluator, EvaluationState } from "./evaluator";

// ── StakeholderContext (Phase 5 consumes this) ────────────────────────────────

export interface StakeholderContext {
  sessionId: string;
  scenario: LoadedScenario;
  simTime: number;
  auditLog: AuditEntry[];
  simState: SimStateStoreSnapshot;
  personaCooldowns: Record<string, number>;
  directlyAddressed: Set<string>; // persona IDs directly messaged since last LLM tick
  metricSummary: MetricSummary; // grounded metric state — current values, trends, history
  triggeredByAction: boolean; // true only when dirty tick was caused by a trainee action/chat/email
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
  getSimStateSnapshot(): SimStateStoreSnapshot;
  handleCoachMessage(message: CoachMessage): void;
  getSnapshot(): SessionSnapshot;
  getEvaluationState(): EvaluationState;
  /** Returns the simulation event log for use in the debrief. */
  getEventLog(): SimEventLogEntry[];
  onEvent(handler: (event: SimEvent) => void): () => void;
  /** FOR TESTING ONLY — directly invoke one tick at the given sim time. */
  _testTick(simTimeSec: number): void;
}

export interface GameLoopDependencies {
  scenario: LoadedScenario;
  sessionId: string;
  clock: SimClock;
  scheduler: EventScheduler;
  auditLog: AuditLog;
  store: SimStateStore;
  evaluator: Evaluator;
  metrics: Record<string, Record<string, TimeSeriesPoint[]>>; // plain series for alarm detection
  metricStore?: MetricStore; // optional: when present, streams metric_update events and provides snapshot
  clockAnchorMs: number;
  onDirtyTick?: (context: StakeholderContext) => Promise<SimEvent[]>;
  onMetricReact?: (context: StakeholderContext) => Promise<void>;
  onCoachTick?: (context: CoachContext) => Promise<CoachMessage | null>;
}

// Read-only MetricStore built from a plain series Record when no full MetricStore
// is provided. Supports getAllSeries and getCurrentValue; on-demand generation
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
    generatePoint() {
      return [];
    },
    applyActiveOverlay() {
      /* no-op: no resolvedParams in fallback store */
    },
    updateResolvedValue() {
      /* no-op: no resolvedParams in fallback store */
    },
    clearScriptedOverlays() {
      /* no-op: no resolvedParams in fallback store */
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
  const onMetricReact = deps.onMetricReact ?? (() => Promise.resolve());
  const onCoachTick = deps.onCoachTick ?? (() => Promise.resolve(null));

  const _eventHandlers: Array<(event: SimEvent) => void> = [];
  let _dirty = false;
  let _inFlight = false;
  let _intervalId: ReturnType<typeof setInterval> | null = null;
  let _lastRealMs = 0;
  let _lastCoachWallMs = 0; // wall-ms of last coach tick; 0 = never fired
  const COACH_MIN_INTERVAL_MS = 30_000; // at most once every 30 real seconds

  const _coachMessages: CoachMessage[] = [];
  const _personaCooldowns: Record<string, number> = {};
  const _eventLog: SimEventLogEntry[] = [];
  const _directlyAddressed = new Set<string>(); // cleared after each LLM tick
  let _triggeredByAction = false; // true only when dirty tick was caused by trainee input
  // True when the current dirty tick was triggered by a meaningful (non-passive) action.
  // Passive actions (open_tab, search_logs, etc.) should not fire a coach tick — they
  // generate too much noise and carry no signal about whether the trainee needs help.
  let _triggeredByMeaningfulAction = false;

  // ── Coach trigger tracking ────────────────────────────────────────────────
  //
  // Each trigger type fires at most once per "arm" — it must reset before it
  // can fire again.  Wall-clock timestamps are used so inactivity is measured
  // in real time regardless of sim speed.

  /** Wall-ms when the trainee last took a meaningful (non-passive) action. */
  let _lastMeaningfulActionWallMs: number = Date.now();

  /** Passive-browse tracking: count of open_tab actions since last meaningful action. */
  let _passiveBrowseTabCount = 0;
  /** Wall-ms when passive-browse stall window started (set when last meaningful action fired). */
  let _passiveBrowseStartWallMs: number = Date.now();

  // One-shot flags: each flips to true when the trigger fires and back to
  // false when the underlying condition resets.  Guards prevent double-firing.
  let _inactivityFired = false;
  let _passiveBrowseFired = false;
  // SEV1: track which alarm IDs have already triggered a coach ping.
  const _sev1FiredAlarmIds = new Set<string>();
  // Red herring: track which action names have already triggered a coach ping.
  const _redHerringFiredActions = new Set<string>();
  // Resolve-with-alarms: fires once per mark_resolved call while alarms fire.
  let _resolveWithAlarmsFired = false;

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
      simState: store.snapshot(),
      personaCooldowns: { ..._personaCooldowns },
      directlyAddressed: new Set(_directlyAddressed),
      metricSummary: computeMetricSummary(
        scenario,
        metricStore,
        clock.getSimTime(),
      ),
      triggeredByAction: _triggeredByAction,
    };
  }

  function buildCoachContext(reason: CoachTriggerReason): CoachContext {
    return {
      sessionId,
      scenario,
      simTime: clock.getSimTime(),
      auditLog: auditLog.getAll(),
      simState: store.snapshot(),
      triggerReason: reason,
    };
  }

  /**
   * Checks all trigger conditions and returns the highest-priority pending
   * reason, or null if nothing should fire right now.
   *
   * Priority order (highest first):
   *   1. resolve_with_alarms_firing   — objective mistake, all levels
   *   2. red_herring                  — just went down the wrong path
   *   3. sev1_unacknowledged          — urgency escalated
   *   4. passive_browse_stall         — browsing without a plan
   *   5. inactivity                   — nothing happening
   */
  function computeCoachTrigger(): CoachTriggerReason | null {
    const nowMs = Date.now();
    const snap = store.snapshot();
    const allEntries = auditLog.getAll();
    const evalState = evaluator.evaluate(auditLog, scenario);

    // 1. resolve_with_alarms_firing
    if (!_resolveWithAlarmsFired) {
      const justResolved =
        allEntries[allEntries.length - 1]?.action === "mark_resolved";
      if (justResolved) {
        const firingCount = snap.alarms.filter(
          (a) => a.status === "firing",
        ).length;
        if (firingCount > 0) {
          _resolveWithAlarmsFired = true;
          return {
            type: "resolve_with_alarms_firing",
            firingAlarmCount: firingCount,
          };
        }
      }
    }

    // 2. red_herring — fire once per unique red-herring action
    for (const rh of evalState.redHerringsTaken) {
      if (!_redHerringFiredActions.has(rh.action)) {
        _redHerringFiredActions.add(rh.action);
        return { type: "red_herring", action: rh.action, why: rh.why };
      }
    }

    // 3. sev1_unacknowledged — fire once per SEV1 alarm that fired
    for (const alarm of snap.alarms) {
      if (
        alarm.severity === "SEV1" &&
        alarm.status === "firing" &&
        !_sev1FiredAlarmIds.has(alarm.id)
      ) {
        _sev1FiredAlarmIds.add(alarm.id);
        return {
          type: "sev1_unacknowledged",
          alarmId: alarm.id,
          service: alarm.service,
          condition: alarm.condition,
        };
      }
    }

    // 4. passive_browse_stall
    if (!_passiveBrowseFired) {
      const wallSecondsStalled = (nowMs - _passiveBrowseStartWallMs) / 1000;
      if (_passiveBrowseTabCount > 0 && wallSecondsStalled > 0) {
        // Thresholds are checked by shouldFireForLevel in the engine —
        // we always pass the raw values here.
        return {
          type: "passive_browse_stall",
          tabsSwitched: _passiveBrowseTabCount,
          wallSecondsStalled,
        };
      }
    }

    // 5. inactivity
    if (!_inactivityFired) {
      const wallSecondsSinceLastAction =
        (nowMs - _lastMeaningfulActionWallMs) / 1000;
      if (wallSecondsSinceLastAction > 0) {
        return { type: "inactivity", wallSecondsSinceLastAction };
      }
    }

    return null;
  }

  /** Called whenever the trainee takes a meaningful action — resets inactivity
   *  and passive-browse state so those triggers can arm again. */
  function onMeaningfulAction(): void {
    const nowMs = Date.now();
    _lastMeaningfulActionWallMs = nowMs;
    // Reset inactivity trigger so it can fire again after next silence period
    _inactivityFired = false;
    // Reset passive-browse counters
    _passiveBrowseTabCount = 0;
    _passiveBrowseStartWallMs = nowMs;
    _passiveBrowseFired = false;
    // resolve_with_alarms resets on each new mark_resolved attempt
    _resolveWithAlarmsFired = false;
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

    // Capture whether this tick was triggered by a meaningful action before resetting.
    const triggeredByMeaningful = _triggeredByMeaningfulAction;

    // Build context BEFORE resetting _triggeredByAction so it captures the correct value.
    const ctx = buildStakeholderContext();
    _directlyAddressed.clear();
    _triggeredByAction = false; // reset after capture
    _triggeredByMeaningfulAction = false; // reset after capture
    // Stakeholder tick owns _inFlight — serialised because it mutates shared store state.
    // onMetricReact is NOT included here — it runs independently (see triggerMetricReact).
    onDirtyTick(ctx)
      .then((events) => {
        for (const ev of events) {
          applySimEventToStore(ev);
          emit(ev);
        }
      })
      .catch((err) => {
        log.error({ err }, "onDirtyTick error");
      })
      .finally(() => {
        _inFlight = false;
        // Re-trigger only if external input arrived while we were in-flight.
        if (_dirty) triggerDirtyTick();
      });

    // Coach tick — at most once every 30 real seconds, only on meaningful dirty ticks.
    const wallNow = Date.now();
    if (
      triggeredByMeaningful &&
      wallNow - _lastCoachWallMs >= COACH_MIN_INTERVAL_MS
    ) {
      const reason = computeCoachTrigger();
      if (reason !== null) {
        _lastCoachWallMs = wallNow;
        const coachCtx = buildCoachContext(reason);
        onCoachTick(coachCtx)
          .then((msg) => {
            if (msg) {
              // Mark the trigger as fired so it doesn't re-fire until reset
              if (reason.type === "inactivity") _inactivityFired = true;
              if (reason.type === "passive_browse_stall")
                _passiveBrowseFired = true;
              _coachMessages.push(msg);
              emit({ type: "coach_message", message: msg });
            }
          })
          .catch((err) => {
            log.error({ err }, "onCoachTick error");
          });
      }
    }
  }

  // Metric reaction fires independently of the stakeholder tick.
  // It has its own internal _isInFlight lock and pending-context queue,
  // so it never blocks persona responses and is never blocked by them.
  // Called directly whenever a trainee action is dispatched.
  function triggerMetricReact(): void {
    const ctx = { ...buildStakeholderContext(), triggeredByAction: true };
    onMetricReact(ctx).catch((err) => {
      log.error({ err }, "onMetricReact error");
    });
  }

  // ── Stage duration defaults ───────────────────────────────────────────────
  // How many sim-seconds each stage type takes to complete.
  const STAGE_DURATION_SECS: Record<"build" | "deploy", number> = {
    build: 120, // 2 sim-minutes
    deploy: 180, // 3 sim-minutes
  };

  /**
   * On every simTime broadcast, check all in_progress stages and emit
   * pipeline_stage_updated if their phase has changed since the last emit.
   * This fires phase transitions promptly without waiting for a full tick.
   */
  /**
   * Advance all pending deployments based on current sim-time.
   * Returns true if at least one prod stage completed this tick — used to
   * trigger the (delayed) metric reaction.
   */
  function tickPendingDeployments(simTime: number): boolean {
    const pending = store.getPendingDeployments();
    let prodStageCompleted = false;

    for (const pd of pending) {
      const pipeline = store.getPipeline(pd.pipelineId);
      if (!pipeline) {
        store.completePendingDeployment(pd.pipelineId);
        continue;
      }

      const elapsed = simTime - pd.initiatedAtSim;
      let currentIndex = pd.currentStageIndex;

      // Process stages that are now due
      while (currentIndex < pd.stageSchedule.length) {
        const entry = pd.stageSchedule[currentIndex];
        // Always re-fetch the stage fresh from the store — the pipeline snapshot
        // taken above may be stale if block_promotion or approve_gate mutated it
        // earlier this tick or in a prior action dispatch.
        const liveStage = store
          .getPipeline(pd.pipelineId)
          ?.stages.find((s) => s.id === entry.stageId);
        if (!liveStage) {
          currentIndex++;
          continue;
        }

        // Check if this stage should start yet.
        // Use a small epsilon to absorb floating-point overshoot from the prior
        // stage completing at exactly entry.startAtSim — without it, the loop
        // would break and wait a full second before starting the next stage.
        const STAGE_START_EPSILON = 0.5; // sim-seconds
        if (elapsed < entry.startAtSim - STAGE_START_EPSILON) {
          break;
        }

        // Before starting this stage, check if it is still blocked (e.g. the
        // deployment was halted waiting to enter this stage and the blocker has
        // not yet been removed).
        if (
          liveStage.status !== "in_progress" &&
          liveStage.blockers.some(
            (b) =>
              b.type === "alarm" ||
              b.type === "time_window" ||
              b.type === "manual_approval",
          )
        ) {
          break;
        }
        if (
          liveStage.status !== "in_progress" &&
          liveStage.blockers.some(
            (b) =>
              b.type === "alarm" ||
              b.type === "time_window" ||
              b.type === "manual_approval",
          )
        ) {
          break;
        }

        const stageElapsed = elapsed - entry.startAtSim;

        if (stageElapsed < entry.durationSecs) {
          // Stage duration not yet elapsed — ensure it shows in_progress.
          if (liveStage.status !== "in_progress") {
            const runningTests = liveStage.tests.map((t) => ({
              ...t,
              status: "running" as import("@shared/types/events").TestStatus,
            }));
            const blockers = pd.isEmergency ? [] : liveStage.blockers;
            const stageStartedAtSim = pd.initiatedAtSim + entry.startAtSim;
            const updatedStage: import("@shared/types/events").PipelineStage = {
              ...liveStage,
              status: "in_progress",
              currentVersion: pd.version,
              previousVersion: pd.previousVersion ?? liveStage.currentVersion,
              commitMessage: pd.commitMessage,
              author: pd.author,
              stageStartedAtSim,
              stageDurationSecs: entry.durationSecs,
              blockers,
              tests: runningTests,
            };
            store.updateStage(pd.pipelineId, liveStage.id, updatedStage);
            emit({
              type: "pipeline_stage_updated",
              pipelineId: pd.pipelineId,
              stage: updatedStage,
            });
          }
          // Still in progress — don't advance to next stage yet
          break;
        }

        // Stage duration has elapsed — about to promote into the next stage.
        // Read the next stage's live state RIGHT NOW and check blockers.
        // Emergency deploys skip intermediate stages but still respect manual gates.
        const nextEntry = pd.stageSchedule[currentIndex + 1];
        if (nextEntry) {
          const nextLiveStage = store
            .getPipeline(pd.pipelineId)
            ?.stages.find((s) => s.id === nextEntry.stageId);
          if (
            nextLiveStage?.blockers.some(
              (b) =>
                b.type === "alarm" ||
                b.type === "time_window" ||
                b.type === "manual_approval",
            )
          ) {
            // Promotion into next stage is blocked. Mark the current stage
            // succeeded so the UI shows it as done, then advance currentIndex
            // past it so rebasePendingDeployment will target the next stage.
            if (liveStage.status === "in_progress") {
              const passedTests = liveStage.tests.map((t) => ({
                ...t,
                status: "passed" as import("@shared/types/events").TestStatus,
              }));
              const blockedStage: import("@shared/types/events").PipelineStage =
                {
                  ...liveStage,
                  status: "succeeded",
                  currentVersion: pd.version,
                  previousVersion:
                    pd.previousVersion ?? liveStage.currentVersion,
                  commitMessage: pd.commitMessage,
                  author: pd.author,
                  deployedAtSec:
                    pd.initiatedAtSim + entry.startAtSim + entry.durationSecs,
                  stageStartedAtSim: undefined,
                  stageDurationSecs: undefined,
                  tests: passedTests,
                };
              store.updateStage(pd.pipelineId, liveStage.id, blockedStage);
              emit({
                type: "pipeline_stage_updated",
                pipelineId: pd.pipelineId,
                stage: blockedStage,
              });
              currentIndex++;
              store.updatePendingDeploymentProgress(
                pd.pipelineId,
                currentIndex,
              );
            }
            break;
          }
        }

        // Stage duration has elapsed — mark succeeded
        const isProdStage =
          liveStage.type === "deploy" &&
          currentIndex === pd.stageSchedule.length - 1;

        const passedTests = liveStage.tests.map((t) => ({
          ...t,
          status: "passed" as import("@shared/types/events").TestStatus,
        }));

        const promotionNote = pd.isEmergency
          ? `Emergency deploy: ${pd.version}`
          : `Rollback to ${pd.version}`;

        const promotionEvent: import("@shared/types/events").PromotionEvent = {
          version: pd.version,
          simTime: pd.initiatedAtSim + entry.startAtSim + entry.durationSecs,
          status: "succeeded",
          note: promotionNote,
        };

        const succeededStage: import("@shared/types/events").PipelineStage = {
          ...liveStage,
          status: "succeeded",
          currentVersion: pd.version,
          previousVersion: pd.previousVersion ?? liveStage.currentVersion,
          commitMessage: pd.commitMessage,
          author: pd.author,
          deployedAtSec:
            pd.initiatedAtSim + entry.startAtSim + entry.durationSecs,
          // Clear active-deployment tracking fields
          stageStartedAtSim: undefined,
          stageDurationSecs: undefined,
          blockers: [],
          tests: passedTests,
          promotionEvents: [promotionEvent, ...liveStage.promotionEvents].slice(
            0,
            5,
          ),
        };
        store.updateStage(pd.pipelineId, liveStage.id, succeededStage);
        emit({
          type: "pipeline_stage_updated",
          pipelineId: pd.pipelineId,
          stage: succeededStage,
        });

        if (isProdStage) {
          // Prod stage completed — update deployment record and flag for metric react
          const deployment: import("@shared/types/events").Deployment = {
            version: pd.version,
            deployedAtSec:
              pd.initiatedAtSim + entry.startAtSim + entry.durationSecs,
            status: "active",
            commitMessage: pd.commitMessage,
            author: pd.author,
          };
          store.addDeployment(pipeline.service, deployment);
          emit({
            type: "deployment_update",
            service: pipeline.service,
            deployment,
          });
          prodStageCompleted = true;
        }

        currentIndex++;
      }

      // Update progress or complete the deployment
      if (currentIndex >= pd.stageSchedule.length) {
        store.completePendingDeployment(pd.pipelineId);
        // Rebase the new head (if any) so it starts fresh from now rather than
        // inheriting the elapsed time from when it was originally enqueued.
        store.rebasePendingDeployment(pd.pipelineId, simTime);
      } else if (currentIndex !== pd.currentStageIndex) {
        store.updatePendingDeploymentProgress(pd.pipelineId, currentIndex);
      }
    }

    return prodStageCompleted;
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
    // Check autoFire alarms — fire when metric value first crosses threshold.
    // Uses metricStore.getCurrentValue() so live generated points (t > 0) are
    // included — the static `metrics` variable only holds t <= 0 history.
    const firedAlarmIds = new Set(store.snapshot().alarms.map((a) => a.id));
    for (const alarmConfig of scenario.alarms) {
      if (!alarmConfig.autoFire || firedAlarmIds.has(alarmConfig.id)) continue;
      const threshold = alarmConfig.threshold;
      if (threshold == null) continue;

      const currentValue = metricStore.getCurrentValue(
        alarmConfig.service,
        alarmConfig.metricId,
        simTime,
      );
      if (currentValue == null) continue;

      const breaches =
        alarmConfig.thresholdDirection === "low"
          ? currentValue <= threshold
          : currentValue >= threshold;

      if (breaches) {
        const alarm: import("@shared/types/events").Alarm = {
          id: alarmConfig.id,
          service: alarmConfig.service,
          metricId: alarmConfig.metricId,
          condition: alarmConfig.condition,
          value: currentValue,
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

    // Step 3c: advance pending deployments (rollback / emergency deploy progression)
    const prodLanded = tickPendingDeployments(simTime);
    if (prodLanded) {
      // Prod stage just completed — fire the delayed metric reaction now with
      // fresh context (includes any other actions taken while deploy was in-flight).
      triggerMetricReact();
      _dirty = true;
    }

    // Step 4: broadcast sim_time
    emit(clock.toSimTimeEvent());

    // Step 4b: generate metric points for this tick and emit a single batched
    // metrics_tick event. generatePoint advances the store's internal state for
    // ALL due points (needed for alarm checks and getAllSeries), but we only send
    // the LAST generated point per metric to the UI. At speed=1 this is identical
    // to the previous one-point-per-tick behaviour. At higher speeds (where the
    // sim-time jump may span multiple resolutionSeconds intervals), intermediate
    // points are still computed and cached in the store but not dispatched to
    // React, keeping render count constant regardless of speed.
    if (metricStore) {
      const tickUpdates: Array<{
        service: string;
        metricId: string;
        point: import("@shared/types/events").TimeSeriesPoint;
      }> = [];
      for (const { service, metricId } of metricStore.listMetrics()) {
        const points = metricStore.generatePoint(service, metricId, simTime);
        if (points.length > 0) {
          // Only the most-recent point is sent to the UI. Earlier points in the
          // same tick are cached in the store (visible via getAllSeries) but
          // skipping their dispatch prevents N renders per tick at high speed.
          tickUpdates.push({
            service,
            metricId,
            point: points[points.length - 1],
          });
        }
      }
      if (tickUpdates.length > 0) {
        emit({ type: "metrics_tick", updates: tickUpdates });
      }
    }

    // Step 5: dirty tick
    if (_dirty) triggerDirtyTick();
  }

  return {
    start() {
      _lastRealMs = Date.now();
      // Fire t=0 scripted events immediately on start
      tick();
      // Tick interval = 60s sim / speed = one in-game minute per tick.
      // At 1x: 60s real. At 2x: 30s real. At 5x: 12s real. At 10x: 6s real.
      const intervalMs = 1000; // tick every real second regardless of sim speed
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
      // Recreate interval so the cadence adjusts immediately
      if (_intervalId) {
        clearInterval(_intervalId);
        const intervalMs = 1000; // tick every real second regardless of sim speed
        _intervalId = setInterval(tick, intervalMs);
      }
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
          const targetVersion = params["targetVersion"] as string | undefined;
          if (pipelineId && stageId) {
            const pipeline = store.getPipeline(pipelineId);
            const stageIdx = pipeline?.stages.findIndex(
              (s) => s.id === stageId,
            );
            // Use explicit targetVersion if provided (normal deploy from remediations),
            // otherwise fall back to previousVersion (rollback from CICD tab).
            const resolvedVersion =
              targetVersion ??
              (stageIdx !== undefined && stageIdx >= 0
                ? pipeline?.stages[stageIdx].previousVersion
                : undefined);
            if (
              pipeline &&
              stageIdx !== undefined &&
              stageIdx >= 0 &&
              resolvedVersion
            ) {
              const stage = pipeline.stages[stageIdx];
              const version = resolvedVersion;
              const now = clock.getSimTime();

              // Build the stage schedule starting from the triggered stage
              // through to the end of the pipeline, with per-stage durations.
              let cumulativeSim = 0;
              const stageSchedule = pipeline.stages.slice(stageIdx).map((s) => {
                const durationSecs =
                  STAGE_DURATION_SECS[s.type] ?? STAGE_DURATION_SECS.deploy;
                const entry = {
                  stageId: s.id,
                  startAtSim: cumulativeSim,
                  durationSecs,
                };
                cumulativeSim += durationSecs;
                return entry;
              });

              store.enqueuePendingDeployment({
                pipelineId,
                stageSchedule,
                initiatedAtSim: now,
                version,
                previousVersion: stage.currentVersion,
                commitMessage: targetVersion
                  ? `Deploy ${version}`
                  : `Rollback to ${version}`,
                author: "trainee",
                isEmergency: false,
              });
              // Metric reaction is delayed until prod stage completes — do NOT
              // call triggerMetricReact() here.
            }
          }
          break;
        }
        case "trigger_deploy": {
          const pipelineId = params["pipelineId"] as string | undefined;
          const stageId = params["stageId"] as string | undefined;
          const targetVersion = params["targetVersion"] as string | undefined;
          if (pipelineId && stageId && targetVersion) {
            const pipeline = store.getPipeline(pipelineId);
            const stageIdx = pipeline?.stages.findIndex(
              (s) => s.id === stageId,
            );
            if (pipeline && stageIdx !== undefined && stageIdx >= 0) {
              const stage = pipeline.stages[stageIdx];
              const now = clock.getSimTime();
              let cumulativeSim = 0;
              const stageSchedule = pipeline.stages.slice(stageIdx).map((s) => {
                const durationSecs =
                  STAGE_DURATION_SECS[s.type] ?? STAGE_DURATION_SECS.deploy;
                const entry = {
                  stageId: s.id,
                  startAtSim: cumulativeSim,
                  durationSecs,
                };
                cumulativeSim += durationSecs;
                return entry;
              });
              store.enqueuePendingDeployment({
                pipelineId,
                stageSchedule,
                initiatedAtSim: now,
                version: targetVersion,
                previousVersion: stage.currentVersion,
                commitMessage: `Deploy ${targetVersion}`,
                author: "trainee",
                isEmergency: false,
              });
              // Metric reaction is delayed until prod stage completes.
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
              // If there's a pending deployment halted at this stage, rebase
              // its timing so the stage starts fresh from now rather than
              // instantly completing because the original elapsed time has passed.
              const now = clock.getSimTime();
              store.rebasePendingDeployment(pipelineId, now);
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
              const remainingBlockers = stage.blockers.filter(
                (b) => b.type !== "manual_approval",
              );
              // Restore a sensible status now that the manual gate is removed.
              // If there are still other blockers, keep current status;
              // otherwise revert to succeeded (the stage already has a good deployment).
              const restoredStatus =
                remainingBlockers.length > 0 ? stage.status : "succeeded";
              const approvedStage: import("@shared/types/events").PipelineStage =
                {
                  ...stage,
                  status: restoredStatus,
                  blockers: remainingBlockers,
                };
              store.updateStage(pipelineId, stageId, approvedStage);
              emit({
                type: "pipeline_stage_updated",
                pipelineId,
                stage: approvedStage,
              });
              // Rebase any pending deployment so this stage starts fresh from now.
              const now = clock.getSimTime();
              store.rebasePendingDeployment(pipelineId, now);
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
              // Only add the blocker — leave the stage's existing status intact.
              // The stage may be green/succeeded with a good deployment; blocking
              // only gates future promotion into it, not what's already there.
              const blockedStage: import("@shared/types/events").PipelineStage =
                {
                  ...stage,
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
            const commitMessage = ra.label ?? `Emergency deploy: ${version}`;
            const now = clock.getSimTime();

            const pipeline = store
              .getAllPipelines()
              .find((p) => p.service === ra.service);

            if (pipeline) {
              // Emergency deploy: build stage first, then jump straight to the
              // target stage (ra.targetStage), skipping intermediate stages.
              // Defaults to the last pipeline stage if targetStage is not set.
              const buildStage = pipeline.stages[0];
              const targetStageId = ra.targetStage;
              const targetStage = targetStageId
                ? pipeline.stages.find((s) => s.id === targetStageId)
                : pipeline.stages[pipeline.stages.length - 1];

              // Build schedule: [build, targetStage] — two entries only,
              // unless build IS the target stage (single-stage pipeline).
              let cumulativeSim = 0;
              const stageSchedule: import("./sim-state-store").StageScheduleEntry[] =
                [];

              if (buildStage) {
                const buildDuration =
                  STAGE_DURATION_SECS[buildStage.type] ??
                  STAGE_DURATION_SECS.build;
                stageSchedule.push({
                  stageId: buildStage.id,
                  startAtSim: cumulativeSim,
                  durationSecs: buildDuration,
                });
                cumulativeSim += buildDuration;
              }

              // Add target stage and all stages after it (skipping intermediates
              // before the target). This means pre-prod → prod flows naturally
              // after an emergency deploy to pre-prod, unless a blocker is placed.
              if (targetStage && targetStage.id !== buildStage?.id) {
                const targetIdx = pipeline.stages.findIndex(
                  (s) => s.id === targetStage.id,
                );
                const stagesToSchedule = pipeline.stages.slice(
                  targetIdx >= 0 ? targetIdx : pipeline.stages.length - 1,
                );
                for (const s of stagesToSchedule) {
                  const duration =
                    STAGE_DURATION_SECS[s.type] ?? STAGE_DURATION_SECS.deploy;
                  stageSchedule.push({
                    stageId: s.id,
                    startAtSim: cumulativeSim,
                    durationSecs: duration,
                  });
                  cumulativeSim += duration;
                }
              }

              store.enqueuePendingDeployment({
                pipelineId: pipeline.id,
                stageSchedule,
                initiatedAtSim: now,
                version,
                previousVersion: buildStage?.currentVersion ?? null,
                commitMessage,
                author: "trainee",
                isEmergency: true,
              });
              // Metric reaction deferred until prod/target stage lands.
            } else {
              // No pipeline — fall back to instant deployment record
              const deployment: import("@shared/types/events").Deployment = {
                version,
                deployedAtSec: now,
                status: "active",
                commitMessage,
                author: "trainee",
              };
              store.addDeployment(ra.service, deployment);
              emit({
                type: "deployment_update",
                service: ra.service,
                deployment,
              });
            }

            if (ra.sideEffect) {
              const entry: import("@shared/types/events").LogEntry = {
                id: randomUUID(),
                simTime: now,
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
          const actionId = params["remediationActionId"] as string | undefined;
          const service = params["service"] as string | undefined;
          const direction =
            (params["direction"] as "up" | "down" | undefined) ?? "up";
          const count = (params["count"] as number | undefined) ?? 1;
          const ra = actionId
            ? scenario.remediationActions.find((r) => r.id === actionId)
            : scenario.remediationActions.find(
                (r) => r.type === "scale_cluster" && r.service === service,
              );
          const targetService = ra?.service ?? service;
          if (targetService) {
            const desiredCount = params["desiredCount"] as number | undefined;
            const logMessage =
              ra?.sideEffect ??
              (desiredCount != null
                ? `Scale ${targetService}: desired ${desiredCount} instance(s) (${direction === "up" ? "+" : "-"}${count})`
                : `Scale ${direction}: ${count} instance(s) requested for ${targetService}`);
            const scaleEntry: import("@shared/types/events").LogEntry = {
              id: randomUUID(),
              simTime: clock.getSimTime(),
              level: "INFO",
              service: targetService,
              message: logMessage,
            };
            store.addLogEntry(scaleEntry);
            emit({ type: "log_entry", entry: scaleEntry });
          }
          break;
        }

        case "scale_capacity": {
          // params: { componentId: string; writeCapacity?: number; readCapacity?: number;
          //            shardCount?: number; reservedConcurrency?: number }
          // Records the action in the audit log (done by handleAction wrapper).
          // MetricStore updates (updateResolvedValue, clearScriptedOverlays) are
          // done here so buildReactionMenu() sees updated targets in the next tick.
          const componentId = params["componentId"] as string | undefined;
          if (componentId) {
            const writeCapacity = params["writeCapacity"] as number | undefined;
            const readCapacity = params["readCapacity"] as number | undefined;
            const shardCount = params["shardCount"] as number | undefined;
            const reservedConcurrency = params["reservedConcurrency"] as
              | number
              | undefined;
            const service = scenario.opsDashboard.focalService.name;
            // Update MetricStore resolved values for the affected metrics
            if (writeCapacity != null && metricStore) {
              const newResolved =
                writeCapacity *
                (scenario.opsDashboard.focalService.metrics.find(
                  (m) => m.archetype === "write_capacity_used",
                )?.resolvedValue ?? 0.6);
              metricStore.updateResolvedValue(
                service,
                "write_capacity_used",
                newResolved,
              );
              // Switch to on_demand: remove saturation ceiling
              if (params["billingMode"] === "on_demand") {
                metricStore.clearScriptedOverlays(
                  service,
                  "write_capacity_used",
                );
              }
            }
            if (readCapacity != null && metricStore) {
              metricStore.updateResolvedValue(
                service,
                "read_capacity_used",
                readCapacity *
                  (scenario.opsDashboard.focalService.metrics.find(
                    (m) => m.archetype === "read_capacity_used",
                  )?.resolvedValue ?? 0.2),
              );
            }
            if (shardCount != null && metricStore) {
              metricStore.updateResolvedValue(
                service,
                "throughput_bytes",
                shardCount * 1500,
              );
            }
            if (reservedConcurrency != null && metricStore) {
              metricStore.updateResolvedValue(
                service,
                "concurrent_executions",
                reservedConcurrency * 0.35,
              );
            }
            void componentId; // acknowledged
          }
          break;
        }

        case "throttle_traffic": {
          const actionId = params["remediationActionId"] as string | undefined;
          const service = params["service"] as string | undefined;
          const throttle = params["throttle"] as boolean | undefined;
          const targetId = params["targetId"] as string | undefined;
          const scope = params["scope"] as
            | import("@shared/types/events").ThrottleScope
            | undefined;
          const label = params["label"] as string | undefined;
          const unit = params["unit"] as
            | import("@shared/types/events").ThrottleUnit
            | undefined;
          const limitRate = params["limitRate"] as number | undefined;
          const customerId = params["customerId"] as string | undefined;

          const ra = actionId
            ? scenario.remediationActions.find((r) => r.id === actionId)
            : scenario.remediationActions.find(
                (r) => r.type === "throttle_traffic" && r.service === service,
              );
          const targetService = ra?.service ?? service;

          if (targetService && targetId && scope && unit && limitRate != null) {
            const applying = throttle !== false; // default true when param absent

            if (applying) {
              const activeThrottle: import("@shared/types/events").ActiveThrottle =
                {
                  remediationActionId: ra?.id ?? actionId ?? "",
                  targetId,
                  scope,
                  label: label ?? targetId,
                  unit,
                  limitRate,
                  appliedAtSimTime: clock.getSimTime(),
                  customerId,
                };
              store.applyThrottle(activeThrottle);
              const customerClause = customerId ? ` for ${customerId}` : "";
              const logMessage =
                `Throttle applied${customerClause}: ${label ?? targetId} limited to ${limitRate} ${unit}` +
                (ra?.sideEffect ? ` — ${ra.sideEffect}` : "");
              const throttleEntry: import("@shared/types/events").LogEntry = {
                id: randomUUID(),
                simTime: clock.getSimTime(),
                level: "WARN",
                service: targetService,
                message: logMessage,
              };
              store.addLogEntry(throttleEntry);
              emit({ type: "log_entry", entry: throttleEntry });
            } else {
              store.removeThrottle(targetId, customerId);
              const customerClause = customerId ? ` for ${customerId}` : "";
              const logMessage = `Throttle removed${customerClause}: ${label ?? targetId} — full traffic resumed`;
              const removeEntry: import("@shared/types/events").LogEntry = {
                id: randomUUID(),
                simTime: clock.getSimTime(),
                level: "INFO",
                service: targetService,
                message: logMessage,
              };
              store.addLogEntry(removeEntry);
              emit({ type: "log_entry", entry: removeEntry });
            }
          } else if (targetService) {
            // Legacy path: old-style throttle without target detail
            const applying = throttle !== false;
            const logMessage = applying
              ? (ra?.sideEffect ??
                `Traffic throttle applied — rate limiting active`)
              : `Traffic throttle removed`;
            const throttleEntry: import("@shared/types/events").LogEntry = {
              id: randomUUID(),
              simTime: clock.getSimTime(),
              level: applying ? "WARN" : "INFO",
              service: targetService,
              message: logMessage,
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

      _triggeredByAction = true;
      _dirty = true;
      triggerDirtyTick();

      // Track passive vs meaningful for coach trigger system and metric reactions.
      if (!PASSIVE_ACTIONS.has(action)) {
        _triggeredByMeaningfulAction = true;
        onMeaningfulAction();
        // Deployment actions defer metric reaction until prod stage lands —
        // metrics should not react before the fix is actually live in prod.
        if (!DEFERRED_METRIC_REACT_ACTIONS.has(action)) {
          triggerMetricReact();
        }
      } else if (action === "open_tab") {
        // Count tab switches for passive-browse-stall detection.
        _passiveBrowseTabCount++;
      }
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

      _triggeredByAction = true;
      _triggeredByMeaningfulAction = true;
      _dirty = true;
      onMeaningfulAction();
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

      _triggeredByAction = true;
      _triggeredByMeaningfulAction = true;
      _dirty = true;
      onMeaningfulAction();
      triggerDirtyTick();
    },

    getSimStateSnapshot() {
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
        throttles: storeSnap.throttles,
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

    _testTick(simTimeSec: number) {
      // Set clock to target sim time directly, then run tickPendingDeployments
      // in isolation — avoids the realElapsedMs double-advance problem.
      const testClock = clock as { setSimTime?: (t: number) => void };
      if (testClock.setSimTime) {
        testClock.setSimTime(simTimeSec);
        const prodLanded = tickPendingDeployments(simTimeSec);
        if (prodLanded) {
          triggerMetricReact();
          _dirty = true;
        }
      }
    },
  };
}
