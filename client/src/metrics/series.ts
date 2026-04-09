// series.ts — generates a single TimeSeriesPoint[] from resolved params.

import type { TimeSeriesPoint } from "@shared/types/events";
import type { ResolvedMetricParams } from "./types";
import { generateBaseline } from "./patterns/baseline";
import { generateRhythm } from "./patterns/rhythm";
import { generateNoise, createSeededPRNG } from "./patterns/noise";
import { applyIncidentOverlay, clampSeries } from "./patterns/incident-overlay";
import { getArchetypeDefaults } from "./archetypes";

function buildTimeAxis(
  fromSecond: number,
  toSecond: number,
  resolutionSeconds: number,
): number[] {
  const tAxis: number[] = [];
  for (let t = fromSecond; t <= toSecond; t += resolutionSeconds) {
    tAxis.push(t);
  }
  return tAxis;
}

export function generateOneSeries(
  params: ResolvedMetricParams,
): TimeSeriesPoint[] {
  const { fromSecond, toSecond, resolutionSeconds } = params;
  const tAxis = buildTimeAxis(fromSecond, toSecond, resolutionSeconds);

  if (params.seriesOverride) {
    return params.seriesOverride.map(({ t, v }) => ({ t, v }));
  }

  const baseline = generateBaseline(params.baselineValue, tAxis);

  const rhythm = params.inheritsRhythm
    ? generateRhythm(params.rhythmProfile, params.baselineValue, tAxis)
    : tAxis.map(() => 0);

  const prng = createSeededPRNG(params.seed);
  const noise = generateNoise(
    params.noiseType,
    params.baselineValue,
    params.noiseLevelMultiplier,
    tAxis,
    prng,
  );

  const combined = tAxis.map((_, i) => baseline[i] + rhythm[i] + noise[i]);

  const archDef = getArchetypeDefaults(params.archetype);
  const withOverlay = applyIncidentOverlay(combined, params, tAxis);
  const clamped = clampSeries(withOverlay, archDef.minValue, archDef.maxValue);

  return tAxis.map((t, i) => ({ t, v: clamped[i] }));
}

export { buildTimeAxis };
