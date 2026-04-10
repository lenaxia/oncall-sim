// reaction-menu.ts — builds the 4-candidate reaction menu for a trainee action.
//
// The LLM sees the menu via the ## Available Reactions prompt section and
// selects one reaction_id via the select_metric_reaction tool.
//
// All four reactions are always present. Their overlays vary by action type
// and incident context.

import type { AuditEntry } from "@shared/types/events";
import type { LoadedScenario } from "../scenario/types";
import type { MetricStore, ActiveOverlay } from "./metric-store";
import type { ReactionMenu, MetricReaction, MetricOverlaySpec } from "./types";

// ── Action type helpers ───────────────────────────────────────────────────────

// Communication-only actions — no metric effect expected. The engine filters
// these with PASSIVE_ACTIONS; buildReactionMenu is not called for them.
// Listed here for documentation only.
const _COMMUNICATION_ACTIONS = new Set([
  "post_chat_message",
  "reply_email",
  "direct_message_persona",
  "ack_page",
  "page_user",
  "update_ticket",
  "add_ticket_comment",
]);

// ── buildReactionMenu ─────────────────────────────────────────────────────────

/**
 * Builds a fixed-4-reaction menu for the given trainee action.
 * Called by the metric reaction engine before each LLM call.
 *
 * When all three non-no_effect reactions have empty overlays (no active
 * incidents or communication-only action), the engine will skip the LLM call.
 */
export function buildReactionMenu(
  action: AuditEntry,
  scenario: LoadedScenario,
  metricStore: MetricStore,
  simTime: number,
): ReactionMenu {
  const metrics = metricStore.listMetrics();
  const currentValues: Record<string, Record<string, number>> = {};
  for (const { service, metricId } of metrics) {
    if (!currentValues[service]) currentValues[service] = {};
    const v = metricStore.getCurrentValue(service, metricId, simTime);
    if (v != null) currentValues[service][metricId] = v;
  }

  // Collect all metrics that have active incident overlays (non-empty overlayApplications)
  const incidentMetrics: Array<{
    service: string;
    metricId: string;
    resolvedValue: number;
    currentValue: number;
    peakValue: number;
    isCapacity: boolean; // saturation-type metric
  }> = [];

  for (const { service, metricId } of metrics) {
    const rp = metricStore.getResolvedParams(service, metricId);
    if (!rp || rp.overlayApplications.length === 0) continue;

    // Only consider overlays that are currently active (onset reached)
    const activeApps = rp.overlayApplications.filter(
      (a) =>
        a.onsetSecond <= simTime &&
        (a.endSecond == null || simTime < a.endSecond),
    );
    if (activeApps.length === 0) continue;

    const maxPeak = Math.max(...activeApps.map((a) => a.peakValue));
    const isSaturation = activeApps.some((a) => a.overlay === "saturation");
    const currentValue = currentValues[service]?.[metricId] ?? rp.baselineValue;

    incidentMetrics.push({
      service,
      metricId,
      resolvedValue: rp.resolvedValue,
      currentValue,
      peakValue: maxPeak,
      isCapacity: isSaturation,
    });
  }

  const fullRecovery = buildFullRecovery(incidentMetrics, simTime);
  const partialRecovery = buildPartialRecovery(incidentMetrics, simTime);
  const worsening = buildWorsening(incidentMetrics, simTime);
  const noEffect = buildNoEffect();

  return {
    actionType: action.action,
    reactions: [fullRecovery, partialRecovery, worsening, noEffect],
  };
}

// ── Reaction builders ─────────────────────────────────────────────────────────

type IncidentMetric = {
  service: string;
  metricId: string;
  resolvedValue: number;
  currentValue: number;
  peakValue: number;
  isCapacity: boolean;
};

function buildFullRecovery(
  incidentMetrics: IncidentMetric[],
  simTime: number,
): MetricReaction & { id: "full_recovery" } {
  const overlays: MetricOverlaySpec[] = incidentMetrics.map((m) =>
    makeOverlaySpec(m.service, m.metricId, {
      startSimTime: simTime,
      startValue: m.currentValue,
      targetValue: m.resolvedValue,
      pattern: "smooth_decay",
      speedSeconds: 300,
      sustained: true,
    }),
  );

  return {
    id: "full_recovery",
    label: "Full recovery — action fully resolves the incident",
    description:
      "Select when the action directly addresses the root cause and metrics will return to normal.",
    overlays,
  };
}

function buildPartialRecovery(
  incidentMetrics: IncidentMetric[],
  simTime: number,
): MetricReaction & { id: "partial_recovery" } {
  const overlays: MetricOverlaySpec[] = incidentMetrics.map((m) => {
    const midpoint = (m.currentValue + m.resolvedValue) / 2;
    return makeOverlaySpec(m.service, m.metricId, {
      startSimTime: simTime,
      startValue: m.currentValue,
      targetValue: midpoint,
      pattern: "smooth_decay",
      speedSeconds: 300,
      sustained: true,
    });
  });

  return {
    id: "partial_recovery",
    label: "Partial recovery — action helps but does not fully resolve",
    description:
      "Select when the action improves the situation but the root cause is not fully addressed.",
    overlays,
  };
}

function buildWorsening(
  incidentMetrics: IncidentMetric[],
  simTime: number,
): MetricReaction & { id: "worsening" } {
  // Worsening: metrics spike further toward peakValue × 1.2 (above current peak)
  const overlays: MetricOverlaySpec[] = incidentMetrics.map((m) => {
    const worseTarget = Math.min(
      m.peakValue * 1.2,
      m.peakValue + m.currentValue * 0.5,
    );
    return makeOverlaySpec(m.service, m.metricId, {
      startSimTime: simTime,
      startValue: m.currentValue,
      targetValue: Math.max(worseTarget, m.currentValue * 1.1),
      pattern: "blip_then_decay",
      speedSeconds: 600,
      sustained: true,
    });
  });

  return {
    id: "worsening",
    label: "Situation worsens — action made things worse",
    description:
      "Select when this action is counterproductive or introduces a new problem.",
    overlays,
  };
}

function buildNoEffect(): MetricReaction & { id: "no_effect" } {
  return {
    id: "no_effect",
    label: "No meaningful metric change",
    description:
      "Select when this action had no impact on the incident trajectory.",
    overlays: [],
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOverlaySpec(
  service: string,
  metricId: string,
  overlay: ActiveOverlay,
): MetricOverlaySpec {
  return { service, metricId, overlay };
}
