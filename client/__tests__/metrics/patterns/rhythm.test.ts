import { describe, it, expect } from 'vitest'
import { generateRhythm, TRAFFIC_PROFILES } from '../../../src/metrics/patterns/rhythm'
import type { TrafficProfile } from '../../../src/scenario/types'

const SECONDS_PER_HOUR = 3600
const SECONDS_PER_DAY  = 86400

// Build tAxis for a full week at 15-min resolution
function buildWeekAxis(): number[] {
  const points: number[] = []
  for (let t = 0; t < 7 * SECONDS_PER_DAY; t += 900) points.push(t)
  return points
}

describe('generateRhythm — none', () => {
  it('returns all zeros', () => {
    const tAxis = [0, 900, 1800, 3600]
    generateRhythm('none', 100, tAxis).forEach(v => expect(v).toBe(0))
  })
})

describe('generateRhythm — business_hours_web', () => {
  const baseline = 100
  const tAxis    = buildWeekAxis()
  const rhythm   = generateRhythm('business_hours_web', baseline, tAxis)

  it('has positive deltas near peak hour UTC (19:00)', () => {
    const maxDelta = Math.max(...rhythm)
    expect(maxDelta).toBeGreaterThan(0)
    // Verify the maximum occurs near 19:00 UTC
    const maxIdx = rhythm.indexOf(maxDelta)
    const secOfDay = ((tAxis[maxIdx] % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY
    const hourOfDay = secOfDay / 3600
    // Peak should be within ±3 hours of 19:00
    expect(Math.abs(hourOfDay - 19)).toBeLessThan(3)
  })

  it('has negative deltas near trough hour (03:00 UTC)', () => {
    // Find delta at 03:00 UTC on a weekday
    const troughT = 3 * SECONDS_PER_HOUR  // Monday 03:00
    const troughIdx = tAxis.findIndex(t => Math.abs(t - troughT) < 900)
    expect(troughIdx).toBeGreaterThanOrEqual(0)
    expect(rhythm[troughIdx]).toBeLessThan(0)
  })

  it('weekend values ≈ 55% of weekday peak (business_hours_web weekendFactor=0.55)', () => {
    const p = TRAFFIC_PROFILES['business_hours_web']
    // Monday 19:00 vs Sunday 19:00 — same time of day, different day
    const mondayPeakT = 19 * SECONDS_PER_HOUR
    const sundayPeakT = 6 * SECONDS_PER_DAY + 19 * SECONDS_PER_HOUR
    const mondayIdx = tAxis.findIndex(t => Math.abs(t - mondayPeakT) < 900)
    const sundayIdx = tAxis.findIndex(t => Math.abs(t - sundayPeakT) < 900)
    if (mondayIdx >= 0 && sundayIdx >= 0) {
      const mondayVal = baseline + rhythm[mondayIdx]   // actual value
      const sundayVal = baseline + rhythm[sundayIdx]
      const ratio = sundayVal / mondayVal
      // ratio should be approximately weekendFactor (0.55) ± 0.15
      expect(ratio).toBeGreaterThan(p.weekendFactor - 0.15)
      expect(ratio).toBeLessThan(p.weekendFactor + 0.15)
    }
  })

  it('all rhythms stay within reasonable bounds', () => {
    const p = TRAFFIC_PROFILES['business_hours_web']
    // Max possible: baseline × (peakFactor - 1)
    // Min possible: baseline × (troughFactor × weekendFactor - 1)
    const maxExpected = baseline * (p.dailyPeakFactor - 1.0) * 1.05
    const minExpected = baseline * (p.dailyTroughFactor * p.weekendFactor - 1.0) * 1.1
    rhythm.forEach(v => {
      expect(v).toBeLessThanOrEqual(maxExpected)
      expect(v).toBeGreaterThanOrEqual(minExpected)
    })
  })
})

describe('generateRhythm — batch_nightly', () => {
  const baseline = 10
  const tAxis    = buildWeekAxis()
  const rhythm   = generateRhythm('batch_nightly', baseline, tAxis)
  const p        = TRAFFIC_PROFILES['batch_nightly']

  it('has high deltas during batch window', () => {
    const bwStart = (p.batchWindowHourUTC ?? 3) * SECONDS_PER_HOUR
    const bwEnd   = bwStart + (p.batchDurationHours ?? 4) * SECONDS_PER_HOUR
    // Find a point in the middle of the batch window
    const midBatch = (bwStart + bwEnd) / 2
    const idx = tAxis.findIndex(t => Math.abs(t - midBatch) < 900)
    if (idx >= 0) {
      expect(rhythm[idx]).toBeGreaterThan(0)
    }
  })

  it('has near-zero deltas well outside batch window', () => {
    // Noon UTC is outside the 03:00–07:00 batch window
    const noonT = 12 * SECONDS_PER_HOUR
    const idx   = tAxis.findIndex(t => Math.abs(t - noonT) < 900)
    if (idx >= 0) {
      // During the day (outside batch) delta should be very small (troughFactor - 1) × baseline
      const expected = baseline * (p.dailyTroughFactor - 1.0)
      expect(Math.abs(rhythm[idx] - expected)).toBeLessThan(baseline * 0.1)
    }
  })
})

describe('TRAFFIC_PROFILES', () => {
  it('has entries for all six profiles', () => {
    const profiles: TrafficProfile[] = [
      'business_hours_web', 'business_hours_b2b', 'always_on_api',
      'batch_nightly', 'batch_weekly', 'none',
    ]
    profiles.forEach(p => expect(TRAFFIC_PROFILES[p]).toBeDefined())
  })
})
