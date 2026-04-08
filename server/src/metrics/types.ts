// Internal types for the metrics module.
// These are NOT exported to shared/ — they are server-only implementation details.

import type { NoiseLevel, TrafficProfile } from '../scenario/types'

export type NoiseType   = 'gaussian' | 'random_walk' | 'sporadic_spikes' | 'sawtooth_gc' | 'none'
export type OverlayType = 'spike_and_sustain' | 'sudden_drop' | 'saturation'
                        | 'gradual_degradation' | 'none'

export interface ResolvedMetricParams {
  // Identity
  metricId:   string
  service:    string
  archetype:  string
  label:      string
  unit:       string

  // Generation window
  fromSecond:        number   // -pre_incident_seconds
  toSecond:          number   // scenario_duration_seconds
  resolutionSeconds: number

  // Baseline
  baselineValue: number

  // Rhythm
  rhythmProfile:  TrafficProfile
  inheritsRhythm: boolean

  // Noise
  noiseType:            NoiseType
  noiseLevelMultiplier: number   // resolved noise level × health multiplier

  // Incident overlay — all fields always present after resolution
  overlay:                     OverlayType
  onsetSecond:                 number
  peakValue:                   number
  dropFactor:                  number
  ceiling:                     number
  saturationDurationSeconds:   number
  rampDurationSeconds:         number

  // Series override — if not null, skip all generation layers
  seriesOverride: Array<{ t: number; v: number }> | null

  // PRNG seed — derived from hash(scenarioId + sessionId + metricId)
  seed: number
}

// Noise level multiplier mapping
export const NOISE_LEVEL_MULTIPLIERS: Record<NoiseLevel, number> = {
  low:     0.5,
  medium:  1.0,
  high:    2.0,
  extreme: 4.0,
}

// Health multiplier
export const HEALTH_MULTIPLIERS: Record<string, number> = {
  healthy:  1.0,
  degraded: 1.5,
  flaky:    2.5,
}
