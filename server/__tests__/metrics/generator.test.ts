import { describe, it, expect, beforeEach } from 'vitest'
import { generateAllMetrics } from '../../src/metrics/generator'
import { getFixtureScenario, clearFixtureCache } from '../../src/testutil/index'

beforeEach(() => clearFixtureCache())

describe('generateAllMetrics with fixture scenario', () => {
  it('returns series for focal service metrics', () => {
    const scenario = getFixtureScenario()
    const result   = generateAllMetrics(scenario, 'session-1')
    expect(result['fixture-service']).toBeDefined()
    expect(result['fixture-service']['error_rate']).toBeDefined()
    expect(result['fixture-service']['error_rate'].length).toBeGreaterThan(0)
  })

  it('series length = (pre_incident_seconds + duration_seconds) / resolution_seconds + 1', () => {
    const scenario  = getFixtureScenario()
    const result    = generateAllMetrics(scenario, 'session-1')
    const { preIncidentSeconds } = scenario.opsDashboard
    const durationSeconds = scenario.timeline.durationMinutes * 60
    const resolutionSeconds = 15
    const expectedLength = Math.floor((preIncidentSeconds + durationSeconds) / resolutionSeconds) + 1
    const series    = result['fixture-service']['error_rate']
    expect(series.length).toBe(expectedLength)
  })

  it('all t values within expected range', () => {
    const scenario   = getFixtureScenario()
    const result     = generateAllMetrics(scenario, 'session-1')
    const { preIncidentSeconds } = scenario.opsDashboard
    const durationSeconds = scenario.timeline.durationMinutes * 60
    const series = result['fixture-service']['error_rate']
    series.forEach(({ t }) => {
      expect(t).toBeGreaterThanOrEqual(-preIncidentSeconds)
      expect(t).toBeLessThanOrEqual(durationSeconds)
    })
  })

  it('same sessionId → identical series (PRNG determinism)', () => {
    const scenario = getFixtureScenario()
    const a = generateAllMetrics(scenario, 'session-same')
    const b = generateAllMetrics(scenario, 'session-same')
    const seriesA = a['fixture-service']['error_rate']
    const seriesB = b['fixture-service']['error_rate']
    expect(seriesA).toEqual(seriesB)
  })

  it('different sessionId → different series', () => {
    const scenario = getFixtureScenario()
    const a = generateAllMetrics(scenario, 'session-A')
    const b = generateAllMetrics(scenario, 'session-B')
    const seriesA = a['fixture-service']['error_rate'].map(p => p.v)
    const seriesB = b['fixture-service']['error_rate'].map(p => p.v)
    const allSame = seriesA.every((v, i) => v === seriesB[i])
    expect(allSame).toBe(false)
  })

  it('all v values are non-negative (clamping works)', () => {
    const scenario = getFixtureScenario()
    const result = generateAllMetrics(scenario, 'session-clamp')
    for (const service of Object.values(result)) {
      for (const series of Object.values(service)) {
        series.forEach(({ v }) => expect(v).toBeGreaterThanOrEqual(0))
      }
    }
  })

  it('returns series for all correlated services', () => {
    const scenario = getFixtureScenario()
    // Build a scenario with a correlated service
    const withCorrelated = {
      ...scenario,
      opsDashboard: {
        ...scenario.opsDashboard,
        correlatedServices: [{
          name:        'downstream-service',
          correlation: 'exonerated' as const,
          health:      'healthy' as const,
        }],
      },
    }
    const result = generateAllMetrics(withCorrelated, 'session-1')
    expect(result['downstream-service']).toBeDefined()
    expect(Object.keys(result['downstream-service']).length).toBeGreaterThan(0)
  })

  it('series_override bypasses generation layers', () => {
    const scenario = getFixtureScenario()
    // Add a series_override to the fixture metric
    const modified = {
      ...scenario,
      opsDashboard: {
        ...scenario.opsDashboard,
        focalService: {
          ...scenario.opsDashboard.focalService,
          metrics: [{
            archetype: 'error_rate',
            seriesOverride: [{ t: 0, v: 99 }, { t: 15, v: 98 }],
          }],
        },
      },
    }
    const result = generateAllMetrics(modified as typeof scenario, 'session-override')
    const series = result['fixture-service']['error_rate']
    expect(series).toHaveLength(2)
    expect(series[0]).toEqual({ t: 0, v: 99 })
    expect(series[1]).toEqual({ t: 15, v: 98 })
  })
})
