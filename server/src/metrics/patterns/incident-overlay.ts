// incident-overlay.ts — applies incident shape on top of existing series.
// Transforms values in-place for t >= onsetSecond, preserving baseline noise.

import type { ResolvedMetricParams } from '../types'

/**
 * Applies the incident overlay to an existing series (baseline + rhythm + noise).
 * Returns a new array — does not mutate the input.
 * Does NOT clamp — call clampSeries after.
 */
export function applyIncidentOverlay(
  series: number[],
  params: ResolvedMetricParams,
  tAxis: number[]
): number[] {
  if (params.overlay === 'none') return [...series]

  const result = [...series]
  const {
    overlay, onsetSecond, peakValue, dropFactor,
    ceiling, saturationDurationSeconds, rampDurationSeconds,
    baselineValue,
  } = params

  for (let i = 0; i < tAxis.length; i++) {
    const t = tAxis[i]
    if (t < onsetSecond) continue

    const elapsed = t - onsetSecond
    const current = result[i]

    switch (overlay) {
      case 'spike_and_sustain': {
        // Ramp from baseline toward peakValue over rampDurationSeconds, then hold
        const rampFraction = rampDurationSeconds > 0
          ? Math.min(elapsed / rampDurationSeconds, 1.0)
          : 1.0
        // Target adds (peakValue - baselineValue) × rampFraction to whatever exists
        const incidentDelta = (peakValue - baselineValue) * rampFraction
        result[i] = current + incidentDelta
        break
      }

      case 'sudden_drop': {
        // At onset, multiply by dropFactor (dropFactor < 1 means reduction)
        // Drop is applied as a delta: multiply the whole current value
        result[i] = current * dropFactor
        break
      }

      case 'saturation': {
        // Climbs toward ceiling over saturationDurationSeconds
        const satFraction = saturationDurationSeconds > 0
          ? Math.min(elapsed / saturationDurationSeconds, 1.0)
          : 1.0
        const targetValue = baselineValue + (ceiling - baselineValue) * satFraction
        // Replace value entirely — saturation is absolute not additive
        // but preserve noise by adding current noise component
        const noiseComponent = current - baselineValue
        result[i] = targetValue + noiseComponent * (1 - satFraction)
        break
      }

      case 'gradual_degradation': {
        // Linear climb from onsetSecond to end of scenario
        const scenarioDuration = tAxis[tAxis.length - 1] - onsetSecond
        const fraction = scenarioDuration > 0
          ? Math.min(elapsed / scenarioDuration, 1.0)
          : 1.0
        const incidentDelta = (peakValue - baselineValue) * fraction
        result[i] = current + incidentDelta
        break
      }
    }
  }

  return result
}

/**
 * Clamps all values to [minValue, maxValue].
 * Called after overlay application.
 */
export function clampSeries(
  series: number[],
  minValue: number,
  maxValue: number
): number[] {
  return series.map((v) => Math.max(minValue, Math.min(maxValue, v)))
}
