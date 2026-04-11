// reactive-overlay.ts — runtime reactive overlay computation for all 8 patterns.

import type { TimeSeriesPoint, ReactiveSpeedTier } from "@shared/types/events";
import type { ResolvedReactiveParams } from "../types";
import { generateNoise, createSeededPRNG } from "./noise";
import { getArchetypeDefaults } from "../archetypes";
import { logger } from "../../logger";

const log = logger.child({ component: "reactive-overlay" });

export const REACTIVE_SPEED_SECONDS: Record<ReactiveSpeedTier, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "60m": 3600,
};

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
  if (currentValue >= incidentPeak) {
    return currentValue * 1.2;
  }
  return magnitude === "full"
    ? incidentPeak
    : currentValue + (incidentPeak - currentValue) / 2;
}

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

  const totalSeconds =
    pattern === "queue_burndown"
      ? speedSeconds + 120
      : pattern === "sawtooth_rebound"
        ? speedSeconds * 2
        : speedSeconds;

  const tAxis: number[] = [];
  for (
    let t = startSimTime;
    t <= startSimTime + totalSeconds;
    t += resolutionSeconds
  ) {
    tAxis.push(t);
  }
  if (tAxis.length === 0) return [];

  const shape = computeShape(pattern, params, tAxis, startSimTime);

  const archDef = getArchetypeDefaults(params.metricId);
  const noiseDeltas = generateNoise(
    archDef.noiseType,
    Math.abs(currentValue - targetValue) * 0.3 + 0.5,
    1.0,
    tAxis,
    prng,
  );

  const minVal = archDef.minValue;
  const maxVal =
    archDef.maxValue === Infinity ? Number.MAX_SAFE_INTEGER : archDef.maxValue;

  return tAxis.map((t, i) => ({
    t,
    v: Math.min(maxVal, Math.max(minVal, shape[i] + noiseDeltas[i])),
  }));
}

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
      const lambdaCliff = Math.log(2) / 15;
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
        const M = (C + T) / 2;
        const A = (C - T) / 2;
        return tAxis.map((t) => {
          const elapsed = t - startSimTime;
          return M + A * Math.cos((2 * Math.PI * elapsed) / cycle);
        });
      }
    }

    case "sawtooth_rebound": {
      const halfPeriod = S / 2;
      const vMid = T + (C - T) * Math.exp(-lambda * halfPeriod);
      return tAxis.map((t) => {
        const elapsed = t - startSimTime;
        const cyclePos = elapsed % S;
        if (cyclePos <= halfPeriod) {
          return T + (C - T) * Math.exp(-lambda * cyclePos);
        } else {
          const rampFraction = (cyclePos - halfPeriod) / halfPeriod;
          return vMid + (C - vMid) * rampFraction;
        }
      });
    }

    case "cascade_clear":
      return tAxis.map(() => C);

    default: {
      const _exhaustive: never = pattern;
      log.warn({ pattern: _exhaustive }, "Unknown reactive overlay pattern");
      return tAxis.map(() => C);
    }
  }
}
