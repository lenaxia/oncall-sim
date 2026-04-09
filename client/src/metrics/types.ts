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
