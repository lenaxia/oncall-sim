import { describe, it, expect } from 'vitest'
import { resolveMetricParams, deriveMetricSeedExported } from '../../src/metrics/resolver'
import { getFixtureScenario, clearFixtureCache } from '../../src/testutil/index'
import type { MetricConfig } from '../../src/scenario/types'

describe('resolveMetricParams — baseline derivation', () => {
  it('uses author baseline_value when provided', () => {
    const scenario = getFixtureScenario()
    const metricConfig: MetricConfig = { archetype: 'error_rate', baselineValue: 5.0 }
    const params = resolveMetricParams(
      metricConfig, scenario.opsDashboard.focalService, scenario, 'session-1'
    )
    expect(params.baselineValue).toBe(5.0)
  })

  it('derives baseline from scale when baseline_value omitted', () => {
    const scenario = getFixtureScenario()
    const metricConfig: MetricConfig = { archetype: 'request_rate' }
    const params = resolveMetricParams(
      metricConfig, scenario.opsDashboard.focalService, scenario, 'session-1'
    )
    // fixture scale.typical_rps = 100
    expect(params.baselineValue).toBe(100)
  })
})

describe('resolveMetricParams — noise', () => {
  it('noise level × health multiplier computes correctly (healthy × low)', () => {
    const scenario = getFixtureScenario()
    const metricConfig: MetricConfig = { archetype: 'error_rate', baselineValue: 1.0 }
    const params = resolveMetricParams(
      metricConfig, scenario.opsDashboard.focalService, scenario, 'session-1'
    )
    // fixture health = 'healthy' (1.0x), error_rate default = 'low' (0.5x)
    expect(params.noiseLevelMultiplier).toBeCloseTo(0.5)
  })

  it('author-supplied noise level overrides archetype default', () => {
    const scenario = getFixtureScenario()
    const metricConfig: MetricConfig = { archetype: 'error_rate', baselineValue: 1.0, noise: 'extreme' }
    const params = resolveMetricParams(
      metricConfig, scenario.opsDashboard.focalService, scenario, 'session-1'
    )
    // extreme (4.0) × healthy (1.0) = 4.0
    expect(params.noiseLevelMultiplier).toBeCloseTo(4.0)
  })

  it('noise level × health multiplier: medium × degraded = 1.5', () => {
    const scenario = getFixtureScenario()
    const degradedService = { ...scenario.opsDashboard.focalService, health: 'degraded' as const }
    const metricConfig: MetricConfig = { archetype: 'request_rate', baselineValue: 100, noise: 'medium' }
    const params = resolveMetricParams(metricConfig, degradedService, scenario, 'session-1')
    // medium (1.0) × degraded (1.5) = 1.5
    expect(params.noiseLevelMultiplier).toBeCloseTo(1.5)
  })

  it('noise level × health multiplier: low × flaky = 1.25', () => {
    const scenario = getFixtureScenario()
    const flakyService = { ...scenario.opsDashboard.focalService, health: 'flaky' as const }
    const metricConfig: MetricConfig = { archetype: 'error_rate', baselineValue: 1.0, noise: 'low' }
    const params = resolveMetricParams(metricConfig, flakyService, scenario, 'session-1')
    // low (0.5) × flaky (2.5) = 1.25
    expect(params.noiseLevelMultiplier).toBeCloseTo(1.25)
  })

  it('noise level × health multiplier: high × flaky = 5.0', () => {
    const scenario = getFixtureScenario()
    const flakyService = { ...scenario.opsDashboard.focalService, health: 'flaky' as const }
    const metricConfig: MetricConfig = { archetype: 'cpu_utilization', baselineValue: 20, noise: 'high' }
    const params = resolveMetricParams(metricConfig, flakyService, scenario, 'session-1')
    // high (2.0) × flaky (2.5) = 5.0
    expect(params.noiseLevelMultiplier).toBeCloseTo(5.0)
  })
})

describe('resolveMetricParams — incident overlay', () => {
  it('author incident_peak overrides registry default factor', () => {
    const scenario = getFixtureScenario()
    // fixture has archetype: error_rate, incident_peak: 12.0, onset_second: 0
    const focalMetric = scenario.opsDashboard.focalService.metrics[0]
    expect(focalMetric.archetype).toBe('error_rate')
    const params = resolveMetricParams(
      focalMetric, scenario.opsDashboard.focalService, scenario, 'session-1'
    )
    expect(params.peakValue).toBe(12.0)
  })

  it('author onset_second overrides registry default', () => {
    const scenario = getFixtureScenario()
    const focalMetric = scenario.opsDashboard.focalService.metrics[0]
    const params = resolveMetricParams(
      focalMetric, scenario.opsDashboard.focalService, scenario, 'session-1'
    )
    expect(params.onsetSecond).toBe(0)  // fixture sets onset_second: 0
  })

  it('Tier 1 metric gets overlay from incident type registry', () => {
    const scenario = getFixtureScenario()
    // bad_deploy_latency + p99_latency_ms → spike_and_sustain
    const metricConfig: MetricConfig = { archetype: 'p99_latency_ms', baselineValue: 200 }
    const params = resolveMetricParams(
      metricConfig, scenario.opsDashboard.focalService, scenario, 'session-1'
    )
    // fixture incident_type is bad_deploy_latency
    expect(params.overlay).toBe('spike_and_sustain')
  })

  it('unrecognized incident_type: overlay is none for Tier 1 metrics', () => {
    const scenario = getFixtureScenario()
    const focalWithBadType = {
      ...scenario.opsDashboard.focalService,
      incidentType: 'made_up_incident_xyz',
    }
    const metricConfig: MetricConfig = { archetype: 'cpu_utilization', baselineValue: 20 }
    const params = resolveMetricParams(metricConfig, focalWithBadType, scenario, 'session-1')
    expect(params.overlay).toBe('none')
  })

  it('series_override presence: seriesOverride is set in params', () => {
    const scenario = getFixtureScenario()
    const override = [{ t: 0, v: 5 }, { t: 15, v: 6 }]
    const metricConfig: MetricConfig = {
      archetype: 'cert_expiry', seriesOverride: override,
    }
    const params = resolveMetricParams(
      metricConfig, scenario.opsDashboard.focalService, scenario, 'session-1'
    )
    expect(params.seriesOverride).toEqual(override)
  })
})

describe('resolveMetricParams — generation window', () => {
  it('fromSecond is -pre_incident_seconds', () => {
    clearFixtureCache()
    const scenario = getFixtureScenario()
    const params = resolveMetricParams(
      { archetype: 'error_rate', baselineValue: 1 },
      scenario.opsDashboard.focalService,
      scenario,
      'session-1'
    )
    expect(params.fromSecond).toBe(-scenario.opsDashboard.preIncidentSeconds)
  })

  it('toSecond is durationMinutes × 60', () => {
    const scenario = getFixtureScenario()
    const params = resolveMetricParams(
      { archetype: 'error_rate', baselineValue: 1 },
      scenario.opsDashboard.focalService,
      scenario,
      'session-1'
    )
    expect(params.toSecond).toBe(scenario.timeline.durationMinutes * 60)
  })
})

describe('deriveMetricSeed', () => {
  it('same inputs → same seed', () => {
    const a = deriveMetricSeedExported('_fixture', 'session-1', 'fixture-service:error_rate')
    const b = deriveMetricSeedExported('_fixture', 'session-1', 'fixture-service:error_rate')
    expect(a).toBe(b)
  })

  it('different sessionId → different seed', () => {
    const a = deriveMetricSeedExported('_fixture', 'session-1', 'fixture-service:error_rate')
    const b = deriveMetricSeedExported('_fixture', 'session-2', 'fixture-service:error_rate')
    expect(a).not.toBe(b)
  })

  it('different metricId → different seed', () => {
    const a = deriveMetricSeedExported('_fixture', 'session-1', 'fixture-service:error_rate')
    const b = deriveMetricSeedExported('_fixture', 'session-1', 'fixture-service:cpu_utilization')
    expect(a).not.toBe(b)
  })
})
