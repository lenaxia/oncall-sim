// reactive-overlay.ts — runtime reactive overlay computation for all 8 patterns.
// Pure functions — no session state. Called by MetricStore.applyReactiveOverlay.

import type { TimeSeriesPoint, ReactiveSpeedTier } from "@shared/types/events";
import type { ResolvedReactiveParams } from "../types";
import { generateNoise } from "./noise";
import { createSeededPRNG } from "./noise";
import { getArchetypeDefaults } from "../archetypes";
import { logger } from "../../logger";

const log = logger.child({ component: "reactive-overlay" });

// ── Speed tier mapping ────────────────────────────────────────────────────────

export const REACTIVE_SPEED_SECONDS: Record<ReactiveSpeedTier, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "60m": 3600,
};

// ── Target value resolution ───────────────────────────────────────────────────

/**
 * Resolves the concrete target value from direction, magnitude, and metric bounds.
 * resolvedValue and incidentPeak come from ResolvedMetricParams.
 * currentValue comes from MetricStore.getCurrentValue at the time of application.
 */
export function resolveReactiveTarget(
  direction: "recovery" | "worsening",
  magnitude: "full" | "partial",
  currentValue: number,
  resolvedValue: number,
  incidentPeak: number,
): number {
  if (direction === "recovery") {
    return magnitude === "full"
      ? resolvedValue
      : currentValue + (resolvedValue - currentValue) / 2;
  }
  // worsening
  if (currentValue >= incidentPeak) {
    // Already at or past peak — worsen further by 20%
    return currentValue * 1.2;
  }
  return magnitude === "full"
    ? incidentPeak
    : currentValue + (incidentPeak - currentValue) / 2;
}

// ── Core overlay computation ──────────────────────────────────────────────────

/**
 * Computes the reactive overlay series starting from startSimTime.
 * Returns TimeSeriesPoint[] at resolutionSeconds intervals.
 * Total window length depends on pattern:
 *   Most patterns:     startSimTime to startSimTime + speedSeconds
 *   queue_burndown:    startSimTime to startSimTime + speedSeconds + 120s
 *   sawtooth_rebound:  startSimTime to startSimTime + 2 × speedSeconds
 * Returns [] and logs a warning for cascade_clear — the stakeholder engine
 * expands cascade_clear into individual smooth_decay calls before reaching here.
 */
export function computeReactiveOverlay(
  params: ResolvedReactiveParams,
  startSimTime: number,
  resolutionSeconds: number,
  prng: ReturnType<typeof createSeededPRNG>,
): TimeSeriesPoint[] {
  const { pattern, speedSeconds, currentValue, targetValue } = params;

  if (pattern === "cascade_clear") {
    log.warn(
      { pattern },
      "computeReactiveOverlay called with cascade_clear — must be expanded by stakeholder engine",
    );
    return [];
  }

  // Determine total window length
  const totalSeconds =
    pattern === "queue_burndown"
      ? speedSeconds + 120
      : pattern === "sawtooth_rebound"
        ? speedSeconds * 2
        : speedSeconds;

  // Build t-axis
  const tAxis: number[] = [];
  for (
    let t = startSimTime;
    t <= startSimTime + totalSeconds;
    t += resolutionSeconds
  ) {
    tAxis.push(t);
  }
  if (tAxis.length === 0) return [];

  // Compute deterministic shape values (before noise)
  const shape = computeShape(pattern, params, tAxis, startSimTime);

  // Add noise using the archetype's noise profile
  const archDef = getArchetypeDefaults(params.metricId);
  const noiseDeltas = generateNoise(
    archDef.noiseType,
    Math.abs(currentValue - targetValue) * 0.3 + 0.5, // noise baseline: fraction of delta
    1.0,
    tAxis,
    prng,
  );

  // Clamp to archetype bounds
  const minVal = archDef.minValue;
  const maxVal =
    archDef.maxValue === Infinity ? Number.MAX_SAFE_INTEGER : archDef.maxValue;

  return tAxis.map((t, i) => ({
    t,
    v: Math.min(maxVal, Math.max(minVal, shape[i] + noiseDeltas[i])),
  }));
}

// ── Shape functions (deterministic, before noise) ─────────────────────────────

function computeShape(
  pattern: ResolvedReactiveParams["pattern"],
  params: ResolvedReactiveParams,
  tAxis: number[],
  startSimTime: number,
): number[] {
  const {
    speedSeconds,
    currentValue,
    targetValue,
    oscillationMode,
    cycleSeconds,
  } = params;
  const S = speedSeconds;
  const C = currentValue;
  const T = targetValue;

  // λ = ln(20)/S — 95% convergence by t=S
  const lambda = Math.log(20) / S;

  switch (pattern) {
    case "smooth_decay":
      return tAxis.map((t) => {
        const elapsed = t - startSimTime;
        return T + (C - T) * Math.exp(-lambda * elapsed);
      });

    case "stepped": {
      const stepSize = (C - T) / 4;
      return tAxis.map((t) => {
        const elapsed = t - startSimTime;
        const step = Math.min(4, Math.floor(elapsed / (S / 4)));
        return C - stepSize * step;
      });
    }

    case "cliff":
      return tAxis.map((t) => {
        const elapsed = t - startSimTime;
        return elapsed >= 5 ? T : C;
      });

    case "blip_then_decay": {
      const blipPeak = Math.max(C * 1.3, C + 1);
      const blipDuration = S * 0.1;
      const lambdaBlip = Math.log(20) / (S * 0.9);
      return tAxis.map((t) => {
        const elapsed = t - startSimTime;
        if (elapsed <= blipDuration) return blipPeak;
        const decayElapsed = elapsed - blipDuration;
        return T + (blipPeak - T) * Math.exp(-lambdaBlip * decayElapsed);
      });
    }

    case "queue_burndown": {
      const lambdaCliff = Math.log(2) / 15; // half-life of 15s post-plateau
      return tAxis.map((t) => {
        const elapsed = t - startSimTime;
        if (elapsed <= S) return C;
        const postElapsed = elapsed - S;
        return T + (C - T) * Math.exp(-lambdaCliff * postElapsed);
      });
    }

    case "oscillating": {
      const mode = oscillationMode ?? "damping";
      const cycle = cycleSeconds ?? 60;
      if (mode === "damping") {
        return tAxis.map((t) => {
          const elapsed = t - startSimTime;
          return (
            T +
            (C - T) *
              Math.cos((2 * Math.PI * elapsed) / cycle) *
              Math.exp(-elapsed / S)
          );
        });
      } else {
        // sustained
        const M = (C + T) / 2;
        const A = (C - T) / 2;
        return tAxis.map((t) => {
          const elapsed = t - startSimTime;
          return M + A * Math.cos((2 * Math.PI * elapsed) / cycle);
        });
      }
    }

    case "sawtooth_rebound": {
      // Each full cycle = S seconds. Total window = 2S.
      // Half 1 (t in [0, S/2]): smooth_decay C → T
      // Half 2 (t in [S/2, S]): linear ramp from V_mid back toward C (incident level)
      // Repeat for cycle 2.
      const halfPeriod = S / 2;
      const vMid = T + (C - T) * Math.exp(-lambda * halfPeriod);

      return tAxis.map((t) => {
        const elapsed = t - startSimTime;
        const cyclePos = elapsed % S; // position within current S-second cycle
        if (cyclePos <= halfPeriod) {
          // Decay half
          return T + (C - T) * Math.exp(-lambda * cyclePos);
        } else {
          // Ramp-back half: linear from vMid back toward C
          const rampFraction = (cyclePos - halfPeriod) / halfPeriod;
          return vMid + (C - vMid) * rampFraction;
        }
      });
    }

    case "cascade_clear":
      return tAxis.map(() => C); // Should never reach here — guard in computeReactiveOverlay

    default: {
      const _exhaustive: never = pattern;
      log.warn({ pattern: _exhaustive }, "Unknown reactive overlay pattern");
      return tAxis.map(() => C);
    }
  }
}
