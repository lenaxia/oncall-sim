// series.ts — generates a single TimeSeriesPoint[] from resolved params.
// Extracted here to break the correlation ↔ generator circular dependency.

import type { TimeSeriesPoint } from '@shared/types/events'
import type { ResolvedMetricParams } from './types'
import { generateBaseline } from './patterns/baseline'
import { generateRhythm } from './patterns/rhythm'
import { generateNoise, createSeededPRNG } from './patterns/noise'
import { applyIncidentOverlay, clampSeries } from './patterns/incident-overlay'
import { getArchetypeDefaults } from './archetypes'

function buildTimeAxis(fromSecond: number, toSecond: number, resolutionSeconds: number): number[] {
  const tAxis: number[] = []
  for (let t = fromSecond; t <= toSecond; t += resolutionSeconds) {
    tAxis.push(t)
  }
  return tAxis
}

/**
 * Generates a single TimeSeriesPoint[] from resolved params.
 * Called by generator.ts and correlation.ts.
 */
export function generateOneSeries(params: ResolvedMetricParams): TimeSeriesPoint[] {
  const { fromSecond, toSecond, resolutionSeconds } = params
  const tAxis = buildTimeAxis(fromSecond, toSecond, resolutionSeconds)

  // Series override bypass
  if (params.seriesOverride) {
    return params.seriesOverride.map(({ t, v }) => ({ t, v }))
  }

  // Layer 1: baseline
  const baseline = generateBaseline(params.baselineValue, tAxis)

  // Layer 2: rhythm (zeros if archetype doesn't inherit rhythm)
  const rhythm = params.inheritsRhythm
    ? generateRhythm(params.rhythmProfile, params.baselineValue, tAxis)
    : tAxis.map(() => 0)

  // Layer 3: noise
  const prng  = createSeededPRNG(params.seed)
  const noise = generateNoise(
    params.noiseType,
    params.baselineValue,
    params.noiseLevelMultiplier,
    tAxis,
    prng
  )

  // Combine layers
  const combined = tAxis.map((_, i) => baseline[i] + rhythm[i] + noise[i])

  // Layer 4: incident overlay
  const archDef     = getArchetypeDefaults(params.archetype)
  const withOverlay = applyIncidentOverlay(combined, params, tAxis)

  // Clamp
  const clamped = clampSeries(withOverlay, archDef.minValue, archDef.maxValue)

  return tAxis.map((t, i) => ({ t, v: clamped[i] }))
}

export { buildTimeAxis }
