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

// ── Reaction history ──────────────────────────────────────────────────────────

// One entry per completed LLM call. Captured after tool call resolution so the
// LLM can see the full cause→effect chain on subsequent calls:
// "at t=180 I saw trigger_rollback, connection_pool_used was at 98%, I chose
//  full_recovery/cliff/1m → now at t=240 it's at 42% and recovering."
interface ReactionDecision {
  metricId: string;
  service: string;
  outcome: ReactionOutcome;
  pattern: ActiveOverlayPattern;
  speed: ReactiveSpeedTier;
  valueAtDecision: number; // metric value when the decision was made
}

interface ReactionHistoryEntry {
  simTime: number; // sim time when the LLM call was made
  actions: string[]; // action types in the window (e.g. ["trigger_rollback"])
  decisions: ReactionDecision[];
}

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

  // Ordered log of past LLM decisions — used to show the LLM the cause→effect
  // chain so it can reason about whether prior reactions are still in progress.
  const _reactionHistory: ReactionHistoryEntry[] = [];

  return {
    async react(context: StakeholderContext): Promise<void> {
      const tools = getMetricReactionTools(scenario);
      console.log(
        `[metric-react] react() entry at ${Date.now()}ms — triggeredByAction=`,
        context.triggeredByAction,
        "tools=",
        tools.length,
        "auditLog.length=",
        context.auditLog.length,
        "_isInFlight=",
        _isInFlight,
      );
      if (tools.length === 0) {
        log.info(
          "metric-reaction: skipped — no tools (select_metric_reaction not enabled for scenario)",
        );
        return;
      }
      if (!context.triggeredByAction) {
        console.log("[metric-react] skipped — triggeredByAction=false");
        return;
      }

      const newActions = context.auditLog.slice(_lastProcessedAuditLength);
      const hasActiveAction = newActions.some(
        (a) => !PASSIVE_ACTIONS.has(a.action),
      );
      console.log(
        "[metric-react] newActions=",
        newActions.map((a) => a.action),
        "hasActiveAction=",
        hasActiveAction,
        "_isInFlight=",
        _isInFlight,
        "_lastProcessedAuditLength=",
        _lastProcessedAuditLength,
      );

      if (_isInFlight) {
        console.log(
          `[metric-react] _isInFlight=true at ${Date.now()}ms — saving as pendingContext`,
        );
        _pendingContext = context;
        return;
      }

      try {
        console.log(
          `[metric-react] setting _isInFlight=true at ${Date.now()}ms`,
        );
        _isInFlight = true;
        await _react(context, tools);
      } catch (err) {
        log.error({ err }, "Unexpected error in metric reaction");
      } finally {
        console.log(
          `[metric-react] setting _isInFlight=false at ${Date.now()}ms, pendingContext=${_pendingContext !== null}`,
        );
        _isInFlight = false;
        if (_pendingContext !== null) {
          const pending = _pendingContext;
          _pendingContext = null;
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

    // Record how far into the audit log we've processed — done AFTER the LLM
    // call resolves (or after activeMetrics check) to avoid silently swallowing
    // actions if the call is skipped or fails.
    const snapshotLength = context.auditLog.length;

    const template = buildReactionTemplate(
      newActions,
      scenario,
      metricStore,
      getSimTime(),
    );

    // Skip LLM call when no incident metrics are active.
    // Do NOT advance the cursor in this case — keep the actions for the next call.
    if (template.activeMetrics.length === 0) {
      console.log(
        "[metric-react] _react() skipped — activeMetrics is empty, simTime=",
        getSimTime(),
      );
      log.debug(
        { actions: newActions.map((a) => a.action) },
        "metric-reaction: no active incident metrics — skipping LLM call",
      );
      return;
    }

    console.log(
      "[metric-react] _react() FIRING LLM call — activeMetrics=",
      template.activeMetrics.map((m) => m.metricId),
      "actions=",
      newActions.map((a) => a.action),
    );

    // Advance cursor now that we know we're making the call.
    // Tracked so we can roll back if the call fails.
    const previousLength = _lastProcessedAuditLength;
    _lastProcessedAuditLength = snapshotLength;

    const messages = _buildPrompt(context, template, newActions);

    log.info(
      {
        actions: newActions.map((a) => a.action),
        activeMetrics: template.activeMetrics.map((m) => m.metricId),
      },
      "metric-reaction: firing LLM call",
    );

    let response;
    try {
      response = await getLLMClient().call({
        role: "stakeholder",
        messages,
        tools,
        sessionId: context.sessionId,
      });
    } catch (err) {
      // Cursor was already advanced — on failure, roll it back so the actions
      // are included in the next call window rather than silently dropped.
      _lastProcessedAuditLength = previousLength;
      if (err instanceof LLMError) {
        log.error(
          { code: err.code, err: err.message },
          "LLM error — rolling back cursor for retry",
        );
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

      // Accumulate decisions for the history entry
      const decisions: ReactionDecision[] = [];

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

        decisions.push({
          metricId,
          service: metricEntry.service,
          outcome: outcome as ReactionOutcome,
          pattern,
          speed: speedTier,
          valueAtDecision: metricEntry.currentValue,
        });
      }

      // Record this reaction in history so future calls see the causal chain
      if (decisions.length > 0) {
        _reactionHistory.push({
          simTime: getSimTime(),
          actions: newActions.map((a) => a.action),
          decisions,
        });
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

    // ── System prompt ────────────────────────────────────────────────────────
    // Tells the LLM what it is, what the incident is, what actually causes it,
    // and which remediation actions are correct fixes vs. red herrings.
    // This is the ground truth the LLM needs to judge whether actions help.

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

    // Remediation catalogue: id, action type, service, correct/not, side effects.
    // The id is critical — action params include remediationActionId so the LLM
    // can cross-reference the action window to the catalogue entry.
    const remediationLines = scenario.remediationActions.map((ra) => {
      const parts = [
        `  [${ra.id}] ${ra.type} on ${ra.service}`,
        ra.isCorrectFix ? "(CORRECT FIX)" : "(not a fix)",
      ];
      if (ra.sideEffect) parts.push(`— side effect: ${ra.sideEffect}`);
      if (ra.targetVersion) parts.push(`— target version: ${ra.targetVersion}`);
      if (ra.flagId)
        parts.push(
          `— flag: ${ra.flagId} → ${ra.flagEnabled ? "enabled" : "disabled"}`,
        );
      return parts.join(" ");
    });

    // Incident mechanism: per-component incident descriptions from the topology.
    // This is the causal narrative — what is actually broken and how.
    // Gives the LLM the system-state context it needs to judge whether an action
    // addresses the mechanism, not just whether it matches a "correct fix" label.
    const incidentLines: string[] = [];
    for (const component of scenario.topology.focalService.components) {
      const incidents = scenario.topology.focalService.incidents.filter(
        (inc) => inc.affectedComponent === component.id,
      );
      for (const inc of incidents) {
        incidentLines.push(`  ${component.label}: ${inc.description}`);
      }
    }

    // Service correlation map: tells the LLM which downstream/upstream services
    // are causally linked to the incident vs. exonerated, so it can reason about
    // whether actions targeting correlated services affect incident metrics.
    const correlationLines: string[] = [];
    for (const svc of scenario.topology.downstream) {
      if (svc.correlation) {
        correlationLines.push(
          `  ${svc.name} (downstream): ${svc.correlation}${svc.description ? ` — ${svc.description}` : ""}`,
        );
      }
    }
    for (const svc of scenario.topology.upstream) {
      correlationLines.push(
        `  ${svc.name} (upstream)${svc.description ? ` — ${svc.description}` : ""}`,
      );
    }

    const systemContent = [
      "You are the environment simulator for an on-call training scenario.",
      "Assess the cumulative effect of the trainee's actions and call",
      "select_metric_reaction with: the outcome category, the pattern that best",
      "models how metrics will visibly change, the speed, and optionally a scope",
      "(list of metric_ids to affect — defaults to all active incident metrics).",
      "Hints are provided per outcome but are non-binding.",
      "",
      "## Incident",
      `${scenario.title}: ${scenario.description}`,
      "",
      "## Root Cause",
      scenario.evaluation.rootCause,
      ...(incidentLines.length > 0
        ? ["", "## Incident Mechanism", ...incidentLines]
        : []),
      ...(correlationLines.length > 0
        ? ["", "## Service Correlations", ...correlationLines]
        : []),
      "",
      "## Available Services and Metrics",
      ...serviceLines,
      "",
      "## Remediation Actions",
      "Match action params (remediationActionId) to [id] to identify which action was taken.",
      ...remediationLines,
    ].join("\n");

    // ── User message: live session state ─────────────────────────────────────

    // Full prior audit log (all actions before this window, passive included for
    // context). The LLM needs this to reason about cumulative state — e.g. if the
    // correct fix was applied in a prior window, it should not re-trigger full
    // recovery for an unrelated new action while metrics are already recovering.
    const priorActions = context.auditLog.slice(
      0,
      context.auditLog.length - newActions.length,
    );
    let priorAuditSection: string | null = null;
    if (priorActions.length > 0) {
      const lines = priorActions.map(
        (a) => `  [t=${a.simTime}] ${a.action} ${JSON.stringify(a.params)}`,
      );
      priorAuditSection = `## Prior Actions (full history)\n${lines.join("\n")}`;
    }

    // Reaction history: one entry per past LLM decision, showing what actions
    // triggered it, what values were seen at decision time, and what outcome was
    // chosen — then the current metric value so the LLM can see whether that
    // reaction is complete, still in progress, or was superseded.
    let reactionHistorySection: string | null = null;
    if (_reactionHistory.length > 0) {
      const lines: string[] = [];
      for (const entry of _reactionHistory) {
        lines.push(
          `  [t=${entry.simTime}] actions: ${entry.actions.join(", ")}`,
        );
        for (const d of entry.decisions) {
          const nowValue = metricStore.getCurrentValue(
            d.service,
            d.metricId,
            context.simTime,
          );
          const nowStr = nowValue !== null ? nowValue.toFixed(2) : "no data";
          lines.push(
            `    ${d.metricId}: was ${d.valueAtDecision.toFixed(2)} → decided ${d.outcome}/${d.pattern}/${d.speed} → now ${nowStr}`,
          );
        }
      }
      reactionHistorySection = `## Past Reactions (cause → effect)\n${lines.join("\n")}`;
    }

    // Current action window: new active actions since the last reaction.
    // The most recent is labelled PRIMARY — it drives the reaction menu hints.
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

    // Current metric values for every tracked metric, with thresholds so the LLM
    // can reason about whether a partial recovery would still breach an alarm boundary.
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
        const thresholdParts: string[] = [];
        if (m.warningThreshold != null)
          thresholdParts.push(`warn=${m.warningThreshold}${unit}`);
        if (m.criticalThreshold != null)
          thresholdParts.push(`crit=${m.criticalThreshold}${unit}`);
        const thresholdStr =
          thresholdParts.length > 0
            ? ` thresholds=${thresholdParts.join("/")}`
            : "";
        metricLines.push(
          `  ${svc.name}/${m.archetype} (${label}): current=${currentStr} ${baselineStr}${thresholdStr}`.trimEnd(),
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

    // Pipeline state — needed to interpret rollback/deploy actions correctly.
    // Shows current deployed version and previous version per stage.
    const pipelines = context.simState.pipelines;
    let pipelineSection: string | null = null;
    if (pipelines.length > 0) {
      const lines: string[] = [];
      for (const p of pipelines) {
        lines.push(`  ${p.name} (${p.service}):`);
        for (const s of p.stages) {
          lines.push(
            `    ${s.name}: current=${s.currentVersion} previous=${s.previousVersion ?? "none"} status=${s.status}`,
          );
        }
      }
      pipelineSection = `## Pipeline State\n${lines.join("\n")}`;
    }

    // Feature flag state — current effective state derived from defaults plus
    // any toggle_feature_flag actions already applied in the audit log.
    const flagStateMap = new Map(
      scenario.featureFlags.map((f) => [f.id, f.defaultOn]),
    );
    for (const entry of context.auditLog) {
      if (entry.action === "toggle_feature_flag") {
        const flagId = entry.params["flagId"] as string | undefined;
        const enabled = entry.params["enabled"] as boolean | undefined;
        if (flagId && enabled !== undefined) flagStateMap.set(flagId, enabled);
      }
    }
    let featureFlagSection: string | null = null;
    if (scenario.featureFlags.length > 0) {
      const lines = scenario.featureFlags.map((f) => {
        const current = flagStateMap.get(f.id) ?? f.defaultOn;
        return `  ${f.id} (${f.label}): ${current ? "enabled" : "disabled"}${f.description ? ` — ${f.description}` : ""}`;
      });
      featureFlagSection = `## Feature Flags\n${lines.join("\n")}`;
    }

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
      `## Sim Time\nt=${context.simTime}`,
      ...(priorAuditSection ? [priorAuditSection] : []),
      ...(reactionHistorySection ? [reactionHistorySection] : []),
      actionSection,
      `## Current Metric Values\n${metricLines.join("\n")}`,
      `## Active Alarms\n${alarmLines.join("\n")}`,
      ...(pipelineSection ? [pipelineSection] : []),
      ...(featureFlagSection ? [featureFlagSection] : []),
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
