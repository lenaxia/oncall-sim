// rhythm.ts — periodic variation layer driven by traffic_profile.
// Returns deltas (positive or negative) relative to baseline.

import type { TrafficProfile } from '../../scenario/types'

// ── Traffic profile parameters ────────────────────────────────────────────────

export interface TrafficProfileParams {
  pattern:            'sinusoidal_weekly' | 'sinusoidal_daily' | 'sawtooth_daily'
                    | 'sawtooth_weekly' | 'flat_ripple' | 'flat'
  dailyPeakFactor:    number   // ratio vs baseline at peak hour
  dailyTroughFactor:  number   // ratio vs baseline at trough hour
  peakHourUTC:        number   // 0-23
  weekendFactor:      number   // ratio vs weekday
  batchWindowHourUTC?: number  // start of batch window (UTC)
  batchDurationHours?: number  // how long the batch window lasts
}

export const TRAFFIC_PROFILES: Record<TrafficProfile, TrafficProfileParams> = {
  business_hours_web: {
    pattern: 'sinusoidal_weekly',
    dailyPeakFactor: 1.35, dailyTroughFactor: 0.45,
    peakHourUTC: 19,        // ~2pm US Eastern
    weekendFactor: 0.55,
  },
  business_hours_b2b: {
    pattern: 'sinusoidal_weekly',
    dailyPeakFactor: 1.30, dailyTroughFactor: 0.20,
    peakHourUTC: 16,        // ~11am US Eastern
    weekendFactor: 0.15,
  },
  always_on_api: {
    pattern: 'flat_ripple',
    dailyPeakFactor: 1.08, dailyTroughFactor: 0.92,
    peakHourUTC: 14,
    weekendFactor: 0.95,
  },
  batch_nightly: {
    pattern: 'sawtooth_daily',
    dailyPeakFactor: 3.5, dailyTroughFactor: 0.05,
    peakHourUTC: 5,         // ~midnight US Eastern
    weekendFactor: 1.0,
    batchWindowHourUTC: 3,
    batchDurationHours: 4,
  },
  batch_weekly: {
    pattern: 'sawtooth_weekly',
    dailyPeakFactor: 4.0, dailyTroughFactor: 0.05,
    peakHourUTC: 5,
    weekendFactor: 0.1,
    batchWindowHourUTC: 3,
    batchDurationHours: 8,
  },
  none: {
    pattern: 'flat',
    dailyPeakFactor: 1.0, dailyTroughFactor: 1.0,
    peakHourUTC: 0,
    weekendFactor: 1.0,
  },
}

// ── Rhythm computation ────────────────────────────────────────────────────────

const SECONDS_PER_DAY  = 86400
const SECONDS_PER_WEEK = 604800

/** Returns the rhythm multiplier (not delta) for a given sim-second t. */
function rhythmMultiplier(t: number, params: TrafficProfileParams): number {
  const { pattern, dailyPeakFactor, dailyTroughFactor, peakHourUTC, weekendFactor,
          batchWindowHourUTC, batchDurationHours } = params

  // Sim time t=0 is arbitrary — we use UTC epoch alignment.
  // We treat t as seconds-since-epoch offset from a known Monday midnight.
  // For rhythm purposes we only care about time-of-day and day-of-week.
  const MON_MIDNIGHT_UTC = 0  // t=0 is Monday 00:00 UTC by convention

  const absT       = t - MON_MIDNIGHT_UTC
  const dayOfWeek  = Math.floor(((absT % SECONDS_PER_WEEK) + SECONDS_PER_WEEK) % SECONDS_PER_WEEK / SECONDS_PER_DAY)
  const secOfDay   = ((absT % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY
  const hourOfDay  = secOfDay / 3600
  const isWeekend  = dayOfWeek >= 5

  if (pattern === 'flat') return 1.0

  const amplitude = (dailyPeakFactor - dailyTroughFactor) / 2
  const midpoint  = (dailyPeakFactor + dailyTroughFactor) / 2

  if (pattern === 'sinusoidal_weekly' || pattern === 'sinusoidal_daily' || pattern === 'flat_ripple') {
    // Sinusoidal with peak at peakHourUTC
    const phaseRad = ((hourOfDay - peakHourUTC) / 24) * 2 * Math.PI
    const daily    = midpoint + amplitude * Math.cos(phaseRad)
    const wkFactor = isWeekend ? weekendFactor : 1.0
    return daily * wkFactor
  }

  if (pattern === 'sawtooth_daily' || pattern === 'sawtooth_weekly') {
    const bwStart    = batchWindowHourUTC ?? 3
    const bwDuration = batchDurationHours ?? 4
    const bwEnd      = bwStart + bwDuration
    const inBatch    = hourOfDay >= bwStart && hourOfDay < bwEnd

    if (inBatch) {
      // Ramp up at start, flat at peak, ramp down at end
      const progress = (hourOfDay - bwStart) / bwDuration
      const rampUp   = Math.min(progress * 3, 1.0)  // reaches peak in first third
      return dailyTroughFactor + rampUp * (dailyPeakFactor - dailyTroughFactor)
    }
    const wkFactor = (pattern === 'sawtooth_weekly' && isWeekend) ? weekendFactor : 1.0
    return dailyTroughFactor * wkFactor
  }

  return 1.0
}

/**
 * Returns rhythm deltas for each time point.
 * Returns all zeros if profile is 'none' or archetype does not inherit rhythm.
 */
export function generateRhythm(
  profile: TrafficProfile,
  baselineValue: number,
  tAxis: number[]
): number[] {
  if (profile === 'none') return tAxis.map(() => 0)
  const params = TRAFFIC_PROFILES[profile]
  return tAxis.map((t) => {
    const multiplier = rhythmMultiplier(t, params)
    return baselineValue * (multiplier - 1.0)
  })
}
