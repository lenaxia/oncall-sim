// metric-reaction-engine.ts — environment-level metric reaction to trainee actions.
// Decoupled from persona communication — no cooldowns, no eligibility gating.
// Called on every dirty tick triggered by a trainee action; the LLM decides
// whether any metric behavioral state should change.

import type { LoadedScenario } from "../scenario/types";
import type { StakeholderContext } from "./game-loop";
import type { LLMClient, LLMMessage } from "../llm/llm-client";
import { LLMError } from "../llm/llm-client";
import { getMetricReactionTools } from "../llm/tool-definitions";
import { logger } from "../logger";
import type {
  MetricStore,
  ActiveOverlay,
  ActiveOverlayPattern,
} from "../metrics/metric-store";
import {
  REACTIVE_SPEED_SECONDS,
  resolveReactiveTarget,
} from "../metrics/patterns/reactive-overlay";
import type { ReactiveSpeedTier } from "@shared/types/events";
import { buildReactionTemplate } from "../metrics/reaction-menu";
import type {
  ReactionTemplate,
  ReactionOutcome,
} from "../metrics/reaction-menu";

const log = logger.child({ component: "metric-reaction-engine" });

export interface MetricReactionEngine {
  react(context: StakeholderContext): Promise<void>;
}

// Actions that observe state but do not change the environment.
// The metric reaction engine should not fire for these — no LLM call, no cost.
const PASSIVE_ACTIONS = new Set<string>([
  "open_tab",
  "search_logs",
  "view_metric",
  "read_wiki_page",
  "view_deployment_history",
  "view_pipeline",
  "monitor_recovery",
]);

export function createMetricReactionEngine(
  getLLMClient: () => LLMClient,
  scenario: LoadedScenario,
  metricStore: MetricStore,
  getSimTime: () => number,
): MetricReactionEngine {
  // ── Rate-limiting / batching state ─────────────────────────────────────────
  // Only one LLM call is in-flight at a time. If a new react() arrives while
  // one is in-flight, we store the latest context as pending. When the
  // in-flight call completes, we drain the pending context with a single call
  // so the LLM always reasons from the most up-to-date metric state.
  //
  // _lastProcessedAuditLength tracks how many audit entries were in the log
  // when the most recently completed reaction was built. On the next call we
  // show only the entries added since then, keeping the prompt focused.
  let _isInFlight = false;
  let _pendingContext: StakeholderContext | null = null;
  let _lastProcessedAuditLength = 0;

  return {
    async react(context: StakeholderContext): Promise<void> {
      const tools = getMetricReactionTools(scenario);
      if (tools.length === 0) return;
      if (!context.triggeredByAction) return;

      // Skip if ALL new actions since last reaction are passive
      const newActions = context.auditLog.slice(_lastProcessedAuditLength);
      const hasActiveAction = newActions.some(
        (a) => !PASSIVE_ACTIONS.has(a.action),
      );
      if (!hasActiveAction) return;

      if (_isInFlight) {
        // Save the latest context — it will be used once the in-flight call
        // finishes. We always overwrite with the newest context so the batched
        // follow-up call has the most up-to-date metric snapshot and full
        // action window.
        _pendingContext = context;
        return;
      }

      try {
        _isInFlight = true;
        await _react(context, tools);
      } catch (err) {
        log.error({ err }, "Unexpected error in metric reaction");
      } finally {
        _isInFlight = false;
        // Drain any context that accumulated while we were in-flight.
        if (_pendingContext !== null) {
          const pending = _pendingContext;
          _pendingContext = null;
          // Fire-and-forget — the outer finally has already released the lock,
          // and the recursive react() will re-acquire it.
          void this.react(pending);
        }
      }
    },
  };

  async function _react(
    context: StakeholderContext,
    tools: ReturnType<typeof getMetricReactionTools>,
  ): Promise<void> {
    // Collect all active actions since the last completed reaction.
    // These are shown in the prompt so the LLM reasons over the full action
    // window, not just the single triggering action.
    const newActions = context.auditLog
      .slice(_lastProcessedAuditLength)
      .filter((a) => !PASSIVE_ACTIONS.has(a.action));

    if (newActions.length === 0) return;

    // Record how far into the audit log we've processed.
    _lastProcessedAuditLength = context.auditLog.length;

    const template = buildReactionTemplate(
      newActions,
      scenario,
      metricStore,
      getSimTime(),
    );

    // Skip LLM call when no incident metrics are active
    if (template.activeMetrics.length === 0) return;

    const messages = _buildPrompt(context, template, newActions);

    let response;
    try {
      response = await getLLMClient().call({
        role: "stakeholder",
        messages,
        tools,
        sessionId: context.sessionId,
      });
    } catch (err) {
      if (err instanceof LLMError) {
        log.error({ code: err.code, err: err.message }, "LLM error");
        return;
      }
      throw err;
    }

    for (const toolCall of response.toolCalls) {
      if (toolCall.tool !== "select_metric_reaction") continue;

      const metricReactions = toolCall.params["metric_reactions"];
      if (!Array.isArray(metricReactions)) continue;

      // Build a lookup of active metrics for fast validation
      const activeMetricMap = new Map(
        template.activeMetrics.map((m) => [`${m.service}:${m.metricId}`, m]),
      );

      for (const entry of metricReactions as Record<string, unknown>[]) {
        const metricId = entry["metric_id"];
        const outcome = entry["outcome"];
        if (typeof metricId !== "string" || typeof outcome !== "string")
          continue;

        // Find the active metric by metricId across all services
        const metricEntry = [...activeMetricMap.values()].find(
          (m) => m.metricId === metricId,
        );

        if (!metricEntry) {
          log.warn(
            { metricId },
            "select_metric_reaction: unknown metric_id — skipped",
          );
          continue;
        }

        const pattern =
          (entry["pattern"] as ActiveOverlayPattern | undefined) ??
          template.hints[0].suggestedPattern;
        const speedTier =
          (entry["speed"] as ReactiveSpeedTier | undefined) ?? "5m";
        const magnitudeRaw = entry["magnitude"];
        const magnitude =
          typeof magnitudeRaw === "number"
            ? Math.max(0, Math.min(1, magnitudeRaw))
            : undefined;
        const sustained = entry["sustained"] !== false;
        const oscillatingMode =
          (entry["oscillating_mode"] as "damping" | "sustained" | undefined) ??
          "damping";
        const cycleSecondsRaw = entry["cycle_seconds"];
        const cycleSeconds =
          typeof cycleSecondsRaw === "number"
            ? Math.min(300, Math.max(30, cycleSecondsRaw))
            : 60;

        _applyOneMetricReaction(
          outcome as ReactionOutcome,
          pattern,
          speedTier,
          magnitude,
          sustained,
          oscillatingMode,
          cycleSeconds,
          metricEntry,
        );
      }
      break;
    }
  }

  function _applyOneMetricReaction(
    outcome: ReactionOutcome,
    pattern: ActiveOverlayPattern,
    speedTier: ReactiveSpeedTier,
    magnitude: number | undefined,
    sustained: boolean,
    oscillatingMode: "damping" | "sustained",
    cycleSeconds: number,
    m: ReactionTemplate["activeMetrics"][number],
  ): void {
    const VALID_OUTCOMES = new Set([
      "full_recovery",
      "partial_recovery",
      "worsening",
      "no_effect",
    ]);
    if (!VALID_OUTCOMES.has(outcome)) {
      log.warn({ outcome, metricId: m.metricId }, "Unknown outcome — skipped");
      return;
    }
    if (outcome === "no_effect") return;

    const speedSeconds = REACTIVE_SPEED_SECONDS[speedTier] ?? 300;
    const targetValue = computeTargetValue(
      outcome as Exclude<ReactionOutcome, "no_effect">,
      m,
      magnitude,
    );

    const overlay: ActiveOverlay = {
      startSimTime: getSimTime(),
      startValue: m.currentValue,
      targetValue,
      pattern,
      speedSeconds,
      sustained,
      ...(pattern === "oscillating"
        ? { oscillationMode: oscillatingMode, cycleSeconds }
        : {}),
    };

    metricStore.applyActiveOverlay(m.service, m.metricId, overlay);
    log.info(
      {
        service: m.service,
        metricId: m.metricId,
        outcome,
        pattern,
        speed: speedTier,
        magnitude,
        sustained,
        targetValue,
      },
      "select_metric_reaction applied",
    );
  }

  function computeTargetValue(
    outcome: Exclude<ReactionOutcome, "no_effect">,
    m: ReactionTemplate["activeMetrics"][number],
    magnitude: number | undefined,
  ): number {
    switch (outcome) {
      case "full_recovery": {
        // magnitude scales how far toward resolved: 1.0 = full, 0.5 = halfway
        const mag = magnitude ?? 1.0;
        return m.currentValue + (m.resolvedValue - m.currentValue) * mag;
      }
      case "partial_recovery": {
        // magnitude scales how far toward resolved: default 0.5 (halfway)
        const mag = magnitude ?? 0.5;
        return m.currentValue + (m.resolvedValue - m.currentValue) * mag;
      }
      case "worsening": {
        // magnitude scales how far toward peak: default 1.0 (full peak)
        const mag = magnitude ?? 1.0;
        return m.currentValue + (m.peakValue - m.currentValue) * mag;
      }
    }
  }

  function _buildPrompt(
    context: StakeholderContext,
    template: ReactionTemplate,
    newActions: StakeholderContext["auditLog"],
  ): LLMMessage[] {
    const focalService = scenario.opsDashboard.focalService;

    // ── System prompt: stable instructions ──────────────────────────────────
    const serviceLines: string[] = [];
    for (const svc of [
      focalService,
      ...scenario.opsDashboard.correlatedServices,
    ]) {
      const metrics =
        "metrics" in svc
          ? (svc as typeof focalService).metrics
          : ((svc as (typeof scenario.opsDashboard.correlatedServices)[0])
              .overrides ?? focalService.metrics);
      serviceLines.push(
        `  ${svc.name}: ${metrics.map((m) => m.archetype).join(", ")}`,
      );
    }

    const systemContent = [
      "You are the environment simulator for an on-call training scenario.",
      "Assess the cumulative effect of the trainee's recent actions and call",
      "select_metric_reaction with: the outcome category, the pattern that best",
      "models how metrics will visibly change, the speed, and optionally a scope",
      "(list of metric_ids to affect — defaults to all active incident metrics).",
      "Hints are provided per outcome but are non-binding.",
      "",
      "Available services and metrics:",
      ...serviceLines,
    ].join("\n");

    // ── User message: live session state ─────────────────────────────────────

    // Action window: all active actions taken since the last reaction.
    // The most recent action is labelled PRIMARY — this drives the reaction menu.
    // Earlier actions in the window provide context (the LLM should reason about
    // the cumulative effect, not just the most recent one in isolation).
    const lastAction = newActions[newActions.length - 1];
    let actionSection: string;
    if (newActions.length === 1) {
      actionSection = `## Trainee Action\nt=${lastAction.simTime} ${lastAction.action} ${JSON.stringify(lastAction.params)}`;
    } else {
      const lines = newActions.map((a, i) => {
        const tag = i === newActions.length - 1 ? " [PRIMARY]" : "";
        return `  t=${a.simTime} ${a.action} ${JSON.stringify(a.params)}${tag}`;
      });
      actionSection = `## Trainee Actions (${newActions.length} since last reaction)\n${lines.join("\n")}`;
    }

    // Current metric values for every tracked metric
    const metricLines: string[] = [];
    for (const svc of [
      focalService,
      ...scenario.opsDashboard.correlatedServices,
    ]) {
      const metrics =
        "metrics" in svc
          ? (svc as typeof focalService).metrics
          : ((svc as (typeof scenario.opsDashboard.correlatedServices)[0])
              .overrides ?? focalService.metrics);
      for (const m of metrics) {
        const current = metricStore.getCurrentValue(
          svc.name,
          m.archetype,
          context.simTime,
        );
        const rp = metricStore.getResolvedParams(svc.name, m.archetype);
        const label = m.label ?? m.archetype;
        const unit = m.unit ?? "";
        const currentStr =
          current !== null ? `${current.toFixed(2)}${unit}` : "no data";
        const baselineStr = rp ? `baseline=${rp.baselineValue}${unit}` : "";
        metricLines.push(
          `  ${svc.name}/${m.archetype} (${label}): current=${currentStr} ${baselineStr}`.trimEnd(),
        );
      }
    }

    // Active alarms
    const alarms = context.simState.alarms;
    const alarmLines =
      alarms.length > 0
        ? alarms.map(
            (a) =>
              `  ${a.id} ${a.service} ${a.condition} status=${a.status} severity=${a.severity}`,
          )
        : ["  (none)"];

    // Host group counts from scenario (environmental state)
    const hostLines =
      scenario.hostGroups.length > 0
        ? scenario.hostGroups.map(
            (h) => `  ${h.label} (${h.service}): ${h.instanceCount} instances`,
          )
        : ["  (not configured)"];

    // Active throttles with llm_hint from scenario config
    const activeThrottles = context.simState.throttles;
    let activeThrottleSection: string | null = null;
    if (activeThrottles.length > 0) {
      const lines = activeThrottles.map((t) => {
        const ra = scenario.remediationActions.find(
          (r) => r.id === t.remediationActionId,
        );
        const targetConfig = ra?.throttleTargets?.find(
          (tt) => tt.id === t.targetId,
        );
        const hint = targetConfig?.llmHint ? ` — ${targetConfig.llmHint}` : "";
        const customerClause = t.customerId
          ? ` (customer: ${t.customerId})`
          : "";
        return `  [${t.scope.toUpperCase()}] ${t.label}${customerClause}: ${t.limitRate} ${t.unit}${hint}`;
      });
      activeThrottleSection = `## Active Throttles\n${lines.join("\n")}`;
    }

    // Per-metric reaction guide — one entry per active incident metric
    // showing current state and non-binding hints for each outcome
    const metricReactionLines = template.activeMetrics.map((m) => {
      const hint = template.hints[0]; // hints are action-derived, same for all metrics
      return (
        `  ${m.metricId} (current=${m.currentValue.toFixed(2)}, ` +
        `baseline=${m.resolvedValue.toFixed(2)}, ` +
        `peak=${m.peakValue.toFixed(2)})\n` +
        `    full_recovery → ${m.resolvedValue.toFixed(2)} | ` +
        `partial_recovery → ${((m.currentValue + m.resolvedValue) / 2).toFixed(2)} | ` +
        `worsening → >${m.peakValue.toFixed(2)} | no_effect → unchanged\n` +
        `    Suggested if fixing: pattern=${hint.suggestedPattern} speed=${hint.suggestedSpeed}`
      );
    });
    const reactionsSection =
      `## Per-Metric Reactions\n` +
      `Declare a reaction for each metric that changes. ` +
      `Omit metrics that are unaffected (implicit no_effect).\n` +
      `Hints are non-binding.\n\n` +
      metricReactionLines.join("\n\n") +
      `\n\nOutcomes: full_recovery | partial_recovery | worsening | no_effect\n` +
      `Patterns: smooth_decay | cliff | stepped | blip_then_decay | queue_burndown | oscillating | sawtooth_rebound`;

    const userContent = [
      `## Scenario\n${scenario.title}`,
      `## Sim Time\nt=${context.simTime}`,
      actionSection,
      `## Current Metric Values\n${metricLines.join("\n")}`,
      `## Active Alarms\n${alarmLines.join("\n")}`,
      `## Host Groups\n${hostLines.join("\n")}`,
      ...(activeThrottleSection ? [activeThrottleSection] : []),
      reactionsSection,
    ].join("\n\n");

    return [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ];
  }
}
