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
import { buildReactionMenu } from "../metrics/reaction-menu";
import type { ReactionMenu } from "../metrics/types";

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
  // Re-evaluate tools per-invocation — the static schema doesn't change,
  // but checking enablement on each react() is cleaner than caching at construction.

  return {
    async react(context: StakeholderContext): Promise<void> {
      const tools = getMetricReactionTools(scenario);
      if (tools.length === 0) return;
      if (!context.triggeredByAction) return;

      // Skip if the triggering action was purely observational
      const lastAction = context.auditLog[context.auditLog.length - 1];
      if (lastAction && PASSIVE_ACTIONS.has(lastAction.action)) return;

      try {
        await _react(context, tools);
      } catch (err) {
        log.error({ err }, "Unexpected error in metric reaction");
      }
    },
  };

  async function _react(
    context: StakeholderContext,
    tools: ReturnType<typeof getMetricReactionTools>,
  ): Promise<void> {
    const lastAction = context.auditLog[context.auditLog.length - 1];
    if (!lastAction) return;

    const menu = buildReactionMenu(
      lastAction,
      scenario,
      metricStore,
      getSimTime(),
    );

    // Skip LLM call if no non-no_effect reactions have overlays (no active incidents)
    const hasEffect = menu.reactions.some(
      (r) => r.id !== "no_effect" && r.overlays.length > 0,
    );
    if (!hasEffect) return;

    const messages = _buildPrompt(context, menu);

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
      const reactionId = toolCall.params["reaction_id"];
      // reaction_id is a required string field per tool schema; guard against
      // malformed LLM responses that omit or mis-type it.
      if (typeof reactionId !== "string") continue;
      _applySelectedReaction(reactionId, menu);
      break; // only the first valid call is honoured
    }
  }

  function _applySelectedReaction(
    reactionId: string,
    menu: ReactionMenu,
  ): void {
    const reaction = menu.reactions.find((r) => r.id === reactionId);
    if (!reaction) {
      log.warn({ reactionId }, "Unknown reaction_id — no overlay applied");
      return;
    }
    for (const spec of reaction.overlays) {
      metricStore.applyActiveOverlay(spec.service, spec.metricId, spec.overlay);
      log.info({ service: spec.service, metricId: spec.metricId, reactionId });
    }
  }

  function _applyMetricResponse(params: Record<string, unknown>): void {
    const entries = params["affected_metrics"];
    if (!Array.isArray(entries)) return;

    // Use current sim time when the LLM response arrives — not the stale
    // context.simTime captured when the action was taken.
    const applyAtSimTime = getSimTime();

    for (const rawEntry of entries as Record<string, unknown>[]) {
      const service = rawEntry["service"] as string | undefined;
      const metricId = rawEntry["metric_id"] as string | undefined;
      if (!service || !metricId) continue;

      // Validate service
      const focalService = scenario.opsDashboard.focalService;
      const isKnownService =
        service === focalService.name ||
        scenario.opsDashboard.correlatedServices.some(
          (cs) => cs.name === service,
        );
      if (!isKnownService) {
        log.warn(
          { service },
          "apply_metric_response: unknown service, skipping",
        );
        continue;
      }

      // Validate metricId
      const knownMetrics: string[] =
        service === focalService.name
          ? focalService.metrics.map((m) => m.archetype)
          : (() => {
              const cs = scenario.opsDashboard.correlatedServices.find(
                (c) => c.name === service,
              );
              return (
                cs?.overrides?.map((m) => m.archetype) ??
                focalService.metrics.map((m) => m.archetype)
              );
            })();
      if (!knownMetrics.includes(metricId)) {
        log.warn(
          { service, metricId },
          "apply_metric_response: unknown metric_id, skipping",
        );
        continue;
      }

      const direction =
        (rawEntry["direction"] as "recovery" | "worsening") ?? "recovery";
      const speed = (rawEntry["speed"] as ReactiveSpeedTier) ?? "5m";
      const magnitude = (rawEntry["magnitude"] as "full" | "partial") ?? "full";
      const speedSeconds = REACTIVE_SPEED_SECONDS[speed];
      const sustained = rawEntry["sustained"] !== false; // default true

      // cascade_clear: expand to individual smooth_decay overlays with stagger
      const rawPattern = (rawEntry["pattern"] as string) ?? "smooth_decay";
      if (rawPattern === "cascade_clear") {
        const INFRA = new Set([
          "cpu_utilization",
          "memory_used",
          "memory_rss",
          "connection_pool_used",
          "thread_count",
          "heap_used",
        ]);
        const QUALITY = new Set([
          "error_rate",
          "fault_rate",
          "availability",
          "p99_latency_ms",
          "p50_latency_ms",
        ]);
        const group = INFRA.has(metricId) ? 0 : QUALITY.has(metricId) ? 1 : 2;
        const staggeredStart = applyAtSimTime + (group * speedSeconds) / 3;

        const rp = metricStore.getResolvedParams(service, metricId);
        const currentValue = metricStore.getCurrentValue(
          service,
          metricId,
          applyAtSimTime,
        );
        if (!rp || currentValue === null) continue;

        const targetValue = resolveReactiveTarget(
          direction,
          magnitude,
          currentValue,
          rp.resolvedValue,
          rp.peakValue,
        );
        const overlay: ActiveOverlay = {
          startSimTime: staggeredStart,
          startValue: currentValue,
          targetValue,
          pattern: "smooth_decay",
          speedSeconds,
          sustained,
        };
        metricStore.applyActiveOverlay(service, metricId, overlay);
        log.info(
          {
            service,
            metricId,
            pattern: "smooth_decay (cascade_clear)",
            direction,
            speed,
            sustained,
            simTime: staggeredStart,
          },
          "apply_metric_response executed",
        );
        continue;
      }

      const pattern = rawPattern as ActiveOverlayPattern;
      const rp = metricStore.getResolvedParams(service, metricId);
      const currentValue = metricStore.getCurrentValue(
        service,
        metricId,
        applyAtSimTime,
      );
      if (!rp || currentValue === null) {
        log.warn(
          { service, metricId },
          "apply_metric_response: no resolved params or current value, skipping",
        );
        continue;
      }

      const targetValue = resolveReactiveTarget(
        direction,
        magnitude,
        currentValue,
        rp.resolvedValue,
        rp.peakValue,
      );

      const overlay: ActiveOverlay = {
        startSimTime: applyAtSimTime,
        startValue: currentValue,
        targetValue,
        pattern,
        speedSeconds,
        sustained,
        ...(pattern === "oscillating"
          ? {
              oscillationMode:
                (rawEntry["oscillation_mode"] as
                  | "damping"
                  | "sustained"
                  | undefined) ?? "damping",
              cycleSeconds: (() => {
                const raw = rawEntry["cycle_seconds"] as number | undefined;
                return raw != null ? Math.min(300, Math.max(30, raw)) : 60;
              })(),
            }
          : {}),
      };

      metricStore.applyActiveOverlay(service, metricId, overlay);
      log.info(
        {
          service,
          metricId,
          pattern,
          direction,
          speed,
          magnitude,
          sustained,
          simTime: applyAtSimTime,
        },
        "apply_metric_response executed",
      );
    }
  }

  function _buildPrompt(
    context: StakeholderContext,
    menu: ReactionMenu,
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
      "Your only job is to select the pre-computed metric reaction that best reflects the outcome",
      "of the most recent trainee action. Always call select_metric_reaction with exactly one reaction_id.",
      "",
      "Available services and metrics:",
      ...serviceLines,
    ].join("\n");

    // ── User message: live session state ─────────────────────────────────────

    // Last trainee action (most important signal)
    const lastAction = context.auditLog[context.auditLog.length - 1];
    const actionSection = lastAction
      ? `## Trainee Action\nt=${lastAction.simTime} ${lastAction.action} ${JSON.stringify(lastAction.params)}`
      : "## Trainee Action\n(none)";

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

    // Available reactions from the pre-computed menu
    const reactionLines = menu.reactions.map(
      (r) => `[${r.id}] ${r.label}\n  Use when: ${r.description}`,
    );
    const reactionsSection = `## Available Reactions\nSelect exactly one reaction_id.\n\n${reactionLines.join("\n\n")}`;

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
