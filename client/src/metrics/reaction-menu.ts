// reaction-menu.ts — builds the hint template for the metric reaction LLM call.
//
// The LLM selects an outcome (full/partial/worsening/no_effect) and specifies
// pattern, speed, and optionally scope. Hints are provided for each outcome
// but are non-binding — the LLM may override them based on the action context.
//
// The actual overlay computation happens in metric-reaction-engine.ts at
// apply-time, using the LLM's chosen parameters and the current metric state.

import type { AuditEntry } from "@shared/types/events";
import type { LoadedScenario } from "../scenario/types";
import type { MetricStore, ActiveOverlayPattern } from "./metric-store";
import type { ActionType } from "@shared/types/events";
import { REACTIVE_SPEED_SECONDS } from "./patterns/reactive-overlay";
import type { ReactiveSpeedTier } from "@shared/types/events";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReactionOutcome =
  | "full_recovery"
  | "partial_recovery"
  | "worsening"
  | "no_effect";

/** A single metric available for overlay application. */
export interface ReactionMetricContext {
  service: string;
  metricId: string;
  currentValue: number;
  resolvedValue: number;
  peakValue: number;
}

/** Non-binding hints for each outcome, derived from the action window and metric state. */
export interface OutcomeHint {
  outcome: ReactionOutcome;
  label: string;
  description: string;
  suggestedPattern: ActiveOverlayPattern;
  suggestedSpeed: ReactiveSpeedTier;
}

/**
 * The reaction template: everything the LLM needs to make an informed choice.
 * Replaces the old pre-computed ReactionMenu with overlay specs.
 */
export interface ReactionTemplate {
  /** All actions taken since the last completed reaction. */
  actions: AuditEntry[];
  /** Active incident metrics the LLM can affect. Empty = skip LLM call. */
  activeMetrics: ReactionMetricContext[];
  /** Non-binding hints for each outcome. */
  hints: [
    OutcomeHint & { outcome: "full_recovery" },
    OutcomeHint & { outcome: "partial_recovery" },
    OutcomeHint & { outcome: "worsening" },
    OutcomeHint & { outcome: "no_effect" },
  ];
  /** The actionType of the most recent action — used for context only. */
  primaryActionType: ActionType;
}

// ── buildReactionTemplate ─────────────────────────────────────────────────────

/**
 * Builds the hint template for the given action window.
 * Called once per LLM invocation. All actions in the window are considered;
 * the most recent drives the primaryActionType.
 *
 * Returns a template with empty activeMetrics when no incidents are active
 * (caller skips the LLM call in that case).
 */
export function buildReactionTemplate(
  actions: AuditEntry[],
  scenario: LoadedScenario,
  metricStore: MetricStore,
  simTime: number,
): ReactionTemplate {
  const lastAction = actions[actions.length - 1];

  // Collect active incident metrics
  const allMetrics = metricStore.listMetrics();
  const activeMetrics: ReactionMetricContext[] = [];

  for (const { service, metricId } of allMetrics) {
    const rp = metricStore.getResolvedParams(service, metricId);
    if (!rp || rp.overlayApplications.length === 0) continue;

    const activeApps = rp.overlayApplications.filter(
      (a) =>
        a.onsetSecond <= simTime &&
        (a.endSecond == null || simTime < a.endSecond),
    );
    if (activeApps.length === 0) continue;

    const currentValue =
      metricStore.getCurrentValue(service, metricId, simTime) ??
      rp.baselineValue;
    const maxPeak = Math.max(...activeApps.map((a) => a.peakValue));

    activeMetrics.push({
      service,
      metricId,
      currentValue,
      resolvedValue: rp.resolvedValue,
      peakValue: maxPeak,
    });
  }

  const hints = buildHints(actions, activeMetrics);

  return {
    actions,
    activeMetrics,
    hints,
    primaryActionType: lastAction.action,
  };
}

// ── Hint derivation ───────────────────────────────────────────────────────────

/**
 * Derives non-binding hints for each outcome based on the action window.
 * These are suggestions — the LLM should choose what fits the situation.
 */
function buildHints(
  actions: AuditEntry[],
  activeMetrics: ReactionMetricContext[],
): ReactionTemplate["hints"] {
  const { suggestedPattern, suggestedSpeed } = deriveDefaultHint(actions);
  const worsePattern: ActiveOverlayPattern = "blip_then_decay";

  const metricNames =
    activeMetrics.map((m) => m.metricId).join(", ") ||
    "active incident metrics";

  const full: OutcomeHint & { outcome: "full_recovery" } = {
    outcome: "full_recovery",
    label: "Full recovery — actions collectively resolve the root cause",
    description:
      "All incident metrics return to baseline. Select when the actions " +
      "directly address the root cause and no further degradation is expected.",
    suggestedPattern,
    suggestedSpeed,
  };

  const partial: OutcomeHint & { outcome: "partial_recovery" } = {
    outcome: "partial_recovery",
    label: "Partial recovery — actions help but root cause not fully addressed",
    description:
      "Metrics improve toward halfway between current and baseline. " +
      "Select when the actions reduce impact but the underlying issue persists.",
    suggestedPattern: "smooth_decay", // partial improvement is always gradual
    suggestedSpeed: "15m",
  };

  const worse: OutcomeHint & { outcome: "worsening" } = {
    outcome: "worsening",
    label: "Worsening — actions made things worse or introduced a new problem",
    description:
      `Metrics spike further on ${metricNames}. ` +
      "Select when the actions are counterproductive, target the wrong component, " +
      "or introduce a side effect that degrades the service further.",
    suggestedPattern: worsePattern,
    suggestedSpeed: "5m",
  };

  const noEffect: OutcomeHint & { outcome: "no_effect" } = {
    outcome: "no_effect",
    label: "No meaningful change — actions had no impact on the incident",
    description:
      "Metrics continue their current trajectory unchanged. " +
      "Select when the actions are unrelated to the root cause.",
    suggestedPattern,
    suggestedSpeed,
  };

  return [full, partial, worse, noEffect];
}

/**
 * Derives the most appropriate pattern and speed hint from the action window.
 * Based on the types of actions taken — e.g. rollback → cliff (immediate),
 * scale → smooth_decay (gradual), feature flag → cliff (immediate).
 */
function deriveDefaultHint(actions: AuditEntry[]): {
  suggestedPattern: ActiveOverlayPattern;
  suggestedSpeed: ReactiveSpeedTier;
} {
  // Use the most recent action as the primary signal
  const actionTypes = new Set(actions.map((a) => a.action));

  // Immediate fixes — rollback, feature flag toggle → cliff
  if (
    actionTypes.has("trigger_rollback") ||
    actionTypes.has("toggle_feature_flag") ||
    actionTypes.has("emergency_deploy")
  ) {
    return { suggestedPattern: "cliff", suggestedSpeed: "1m" };
  }

  // Scaling or infra changes — gradual improvement
  if (
    actionTypes.has("scale_cluster") ||
    actionTypes.has("scale_capacity") ||
    actionTypes.has("restart_service")
  ) {
    return { suggestedPattern: "smooth_decay", suggestedSpeed: "5m" };
  }

  // Traffic shaping — stepped improvement
  if (actionTypes.has("throttle_traffic")) {
    return { suggestedPattern: "stepped", suggestedSpeed: "5m" };
  }

  // Default
  return { suggestedPattern: "smooth_decay", suggestedSpeed: "5m" };
}

// Re-export REACTIVE_SPEED_SECONDS for consumers that need to translate speed tier → seconds
export { REACTIVE_SPEED_SECONDS };
