// Internal types for the metrics module.

import type { NoiseLevel, TrafficProfile } from "../scenario/types";
import type { ReactiveOverlayType } from "@shared/types/events";

export type NoiseType =
  | "gaussian"
  | "random_walk"
  | "sporadic_spikes"
  | "sawtooth_gc"
  | "none";
export type OverlayType =
  | "spike_and_sustain"
  | "sudden_drop"
  | "saturation"
  | "gradual_degradation"
  | "none";

// ── OverlayApplication ────────────────────────────────────────────────────────
// Replaces the 7 flat overlay fields on ResolvedMetricParams (Step 4).
// Added here in Step 3 so MetricConfig.incidentResponses can reference it.

export interface OverlayApplication {
  overlay: OverlayType;
  onsetSecond: number;
  endSecond?: number; // absent = sustained
  peakValue: number;
  /** Used by sudden_drop only; set to 1.0 for all other overlay types. */
  dropFactor: number;
  ceiling: number;
  rampDurationSeconds: number;
  saturationDurationSeconds: number;
  /** ID of the incident that produced this overlay — used for deduplication. */
  incidentId: string;
}

export interface ResolvedMetricParams {
  metricId: string;
  service: string;
  archetype: string;
  label: string;
  unit: string;
  fromSecond: number;
  toSecond: number;
  resolutionSeconds: number;
  baselineValue: number;
  resolvedValue: number;
  rhythmProfile: TrafficProfile;
  inheritsRhythm: boolean;
  noiseType: NoiseType;
  noiseLevelMultiplier: number;
  // New: multi-incident overlay list (replaces single-overlay flat fields).
  // Empty array = pure baseline + rhythm + noise (no incident).
  overlayApplications: OverlayApplication[];
  /** Critical alarm threshold, if one is configured for this metric. */
  criticalThreshold?: number;
  // Legacy single-overlay fields — kept for backwards compat with the old
  // incident_type registry path (resolver.ts). Removed in Step 4 cleanup.
  overlay: OverlayType;
  onsetSecond: number;
  peakValue: number;
  dropFactor: number;
  ceiling: number;
  saturationDurationSeconds: number;
  rampDurationSeconds: number;
  seriesOverride: Array<{ t: number; v: number }> | null;
  seed: number;
}

// ── Reaction menu types ───────────────────────────────────────────────────────

import type { ActiveOverlay } from "./metric-store";
import type { ActionType } from "@shared/types/events";

/** A single metric overlay to apply when a reaction is selected. */
export interface MetricOverlaySpec {
  service: string;
  metricId: string;
  overlay: ActiveOverlay; // fully pre-computed; applied verbatim to MetricStore
}

export interface MetricReaction {
  id: "full_recovery" | "partial_recovery" | "worsening" | "no_effect";
  label: string; // shown to LLM
  description: string; // when to select this reaction
  overlays: MetricOverlaySpec[];
}

/** Invariant: exactly 4 reactions — one of each id, in the fixed tuple order. */
export interface ReactionMenu {
  actionType: ActionType;
  reactions: [
    MetricReaction & { id: "full_recovery" },
    MetricReaction & { id: "partial_recovery" },
    MetricReaction & { id: "worsening" },
    MetricReaction & { id: "no_effect" },
  ];
}

export interface ResolvedReactiveParams {
  service: string;
  metricId: string;
  direction: "recovery" | "worsening";
  pattern: ReactiveOverlayType;
  speedSeconds: number;
  magnitude: "full" | "partial";
  currentValue: number;
  targetValue: number;
  oscillationMode?: "damping" | "sustained";
  cycleSeconds?: number;
}

export const NOISE_LEVEL_MULTIPLIERS: Record<NoiseLevel, number> = {
  low: 0.5,
  medium: 1.0,
  high: 2.0,
  extreme: 4.0,
};

export const HEALTH_MULTIPLIERS: Record<string, number> = {
  healthy: 1.0,
  degraded: 1.5,
  flaky: 2.5,
};
