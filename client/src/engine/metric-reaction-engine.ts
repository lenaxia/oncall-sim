// metric-reaction-engine.ts — environment-level metric reaction to trainee actions.
// Decoupled from persona communication — no cooldowns, no eligibility gating.
// Called on every dirty tick triggered by a trainee action; the LLM decides
// whether any metric behavioral state should change.

import type { LoadedScenario } from "../scenario/types";
import type { StakeholderContext } from "./game-loop";
import type { LLMClient, LLMMessage } from "../llm/llm-client";
import { LLMError } from "../llm/llm-client";
import {
  getMetricReactionTools,
  validateToolCall,
} from "../llm/tool-definitions";
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

const log = logger.child({ component: "metric-reaction-engine" });

export interface MetricReactionEngine {
  react(context: StakeholderContext): Promise<void>;
}

export function createMetricReactionEngine(
  llmClient: LLMClient,
  scenario: LoadedScenario,
  metricStore: MetricStore,
  getSimTime: () => number,
): MetricReactionEngine {
  const tools = getMetricReactionTools(scenario);

  return {
    async react(context: StakeholderContext): Promise<void> {
      if (tools.length === 0) return;
      if (!context.triggeredByAction) return;

      try {
        await _react(context);
      } catch (err) {
        log.error({ err }, "Unexpected error in metric reaction");
      }
    },
  };

  async function _react(context: StakeholderContext): Promise<void> {
    const messages = _buildPrompt(context);

    let response;
    try {
      response = await llmClient.call({
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

    const callCounts: Record<string, number> = {};
    for (const toolCall of response.toolCalls) {
      const validation = validateToolCall(
        toolCall,
        scenario,
        callCounts,
        tools,
      );
      if (!validation.valid) {
        log.warn(
          { tool: toolCall.tool, reason: validation.reason },
          "Invalid tool call",
        );
        continue;
      }
      callCounts[toolCall.tool] = (callCounts[toolCall.tool] ?? 0) + 1;
      _applyMetricResponse(toolCall.params as Record<string, unknown>);
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

  function _buildPrompt(context: StakeholderContext): LLMMessage[] {
    const focalService = scenario.opsDashboard.focalService;
    const serviceLines: string[] = [
      `  ${focalService.name}: ${focalService.metrics.map((m) => m.archetype).join(", ")}`,
    ];
    for (const cs of scenario.opsDashboard.correlatedServices) {
      const metricIds =
        cs.overrides?.map((m) => m.archetype) ??
        focalService.metrics.map((m) => m.archetype);
      serviceLines.push(`  ${cs.name}: ${metricIds.join(", ")}`);
    }

    const auditLines = context.auditLog
      .slice(-20)
      .map(
        (e) =>
          `  t=${e.simTime} ${e.action}${e.params ? " " + JSON.stringify(e.params) : ""}`,
      )
      .join("\n");

    const systemContent = [
      "You are the environment simulator for an on-call training scenario.",
      "Your only job is to decide whether a recent trainee action warrants a change to metric behavior.",
      "Use apply_metric_response if the action changed the incident trajectory. Otherwise respond with no tool calls.",
      "",
      "Services and metrics in this scenario:",
      ...serviceLines,
      "",
      "Patterns: smooth_decay | stepped | queue_burndown | oscillating | blip_then_decay | cascade_clear | sawtooth_rebound | cliff",
      "Speed: 1m | 5m | 15m | 30m | 60m — how long the transition takes",
      "Direction: recovery (toward resolved state) | worsening (toward incident peak)",
      "Magnitude: full (complete) | partial (halfway to resolved state)",
      "Sustained: true (default) — new behavior persists indefinitely until another action changes it.",
      "           false — behavior reverts to scripted incident progression after the transition completes.",
      "           Use sustained=false only for transient one-off effects (e.g. a brief spike).",
      "",
      "Rules:",
      "- Only call apply_metric_response when a trainee action has actually changed the situation.",
      "- Use direction=worsening when the action made the situation worse.",
      "- Use magnitude=partial when the fix is incomplete or does not address root cause.",
      "- Specify different patterns and speeds per metric in one call for asymmetric recovery.",
      "- For oscillating: set oscillation_mode=sustained if root cause is not addressed.",
      "- Do NOT set sustained=false unless the effect is genuinely transient.",
    ].join("\n");

    const userContent = [
      `## Scenario\n${scenario.title}`,
      `## Sim Time\nt=${context.simTime}`,
      `## Recent Trainee Actions\n${auditLines || "  (none)"}`,
    ].join("\n\n");

    return [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ];
  }
}
