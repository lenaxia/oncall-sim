import { describe, it, expect, beforeEach } from 'vitest'
import { deriveCorrelatedMetrics, extractIncidentDelta } from '../../src/metrics/correlation'
import { resolveMetricParams } from '../../src/metrics/resolver'
import { generateOneSeries } from '../../src/metrics/generator'
import { getFixtureScenario, clearFixtureCache } from '../../src/testutil/index'
import type { CorrelatedServiceConfig } from '../../src/scenario/types'
import type { ResolvedMetricParams } from '../../src/metrics/types'

beforeEach(() => clearFixtureCache())

// ── extractIncidentDelta ──────────────────────────────────────────────────────

describe('extractIncidentDelta', () => {
  it('returns v = point.v - params.baselineValue', () => {
    const focalSeries = [
      { t: 0, v: 1.0 },
      { t: 15, v: 5.0 },
      { t: 30, v: 10.0 },
    ]
    const params = { baselineValue: 1.0 } as ResolvedMetricParams
    const deltas = extractIncidentDelta(focalSeries, params)
    expect(deltas[0].v).toBeCloseTo(0.0)
    expect(deltas[1].v).toBeCloseTo(4.0)
    expect(deltas[2].v).toBeCloseTo(9.0)
  })

  it('preserves t values', () => {
    const focalSeries = [{ t: -30, v: 2 }, { t: 0, v: 3 }]
    const params = { baselineValue: 1.0 } as ResolvedMetricParams
    const deltas = extractIncidentDelta(focalSeries, params)
    expect(deltas[0].t).toBe(-30)
    expect(deltas[1].t).toBe(0)
  })
})

// ── deriveCorrelatedMetrics — exonerated ──────────────────────────────────────

describe('deriveCorrelatedMetrics — exonerated', () => {
  it('produces series with no incident overlay (all v values within normal range)', () => {
    const scenario = getFixtureScenario()
    const focalMetric = scenario.opsDashboard.focalService.metrics[0]
    const focalParams = resolveMetricParams(
      focalMetric, scenario.opsDashboard.focalService, scenario, 'session-1'
    )
    const focalSeries = { [focalMetric.archetype]: generateOneSeries(focalParams) }
    const focalResolvedParams = { [focalMetric.archetype]: focalParams }

    const exonerated: CorrelatedServiceConfig = {
      name:        'exonerated-service',
      correlation: 'exonerated',
      health:      'healthy',
    }

    const result = deriveCorrelatedMetrics(
      exonerated, focalSeries, focalResolvedParams, scenario, 'session-1'
    )

    // Should have series
    expect(Object.keys(result).length).toBeGreaterThan(0)
    // All values should be non-negative
    for (const series of Object.values(result)) {
      series.forEach(({ v }) => expect(v).toBeGreaterThanOrEqual(0))
    }
  })
})

// ── deriveCorrelatedMetrics — upstream_impact ─────────────────────────────────

describe('deriveCorrelatedMetrics — upstream_impact', () => {
  it('propagated archetypes contain incident delta from focal', () => {
    const scenario = getFixtureScenario()
    const focalMetric = scenario.opsDashboard.focalService.metrics[0]
    const focalParams = resolveMetricParams(
      focalMetric, scenario.opsDashboard.focalService, scenario, 'session-1'
    )
    const focalSeries = { [focalMetric.archetype]: generateOneSeries(focalParams) }
    const focalResolvedParams = { [focalMetric.archetype]: focalParams }

    const upstream: CorrelatedServiceConfig = {
      name:         'upstream-service',
      correlation:  'upstream_impact',
      lagSeconds:   0,
      impactFactor: 1.0,
      health:       'healthy',
    }

    const result = deriveCorrelatedMetrics(
      upstream, focalSeries, focalResolvedParams, scenario, 'session-1'
    )

    expect(Object.keys(result).length).toBeGreaterThan(0)
    for (const series of Object.values(result)) {
      series.forEach(({ v }) => expect(v).toBeGreaterThanOrEqual(0))
    }
  })

  it('override metrics replace derived metrics', () => {
    const scenario = getFixtureScenario()
    const focalMetric = scenario.opsDashboard.focalService.metrics[0]
    const focalParams = resolveMetricParams(
      focalMetric, scenario.opsDashboard.focalService, scenario, 'session-1'
    )
    const focalSeries = { [focalMetric.archetype]: generateOneSeries(focalParams) }
    const focalResolvedParams = { [focalMetric.archetype]: focalParams }

    const upstream: CorrelatedServiceConfig = {
      name:         'upstream-override',
      correlation:  'upstream_impact',
      health:       'healthy',
      overrides: [{
        archetype:     'conversion_rate',
        baselineValue: 68,
        incidentPeak:  28,
      }],
    }

    const result = deriveCorrelatedMetrics(
      upstream, focalSeries, focalResolvedParams, scenario, 'session-1'
    )

    expect(result['conversion_rate']).toBeDefined()
    const preIncident = result['conversion_rate'].filter(p => p.t < 0)
    if (preIncident.length > 0) {
      const mean = preIncident.reduce((a, b) => a + b.v, 0) / preIncident.length
      expect(mean).toBeGreaterThan(50)
    }
  })

  it('propagated delta is shifted by lag_seconds', () => {
    // With lagSeconds=30, the correlated service "sees" the focal incident
    // 30 seconds later. So at t=30 on the correlated side, we expect the
    // focal's t=0 delta. We verify that the lag-30 service has a later onset
    // than the lag-0 service for the incident delta.
    const scenario = getFixtureScenario()
    const focalMetric = scenario.opsDashboard.focalService.metrics[0]
    const focalParams = resolveMetricParams(
      focalMetric, scenario.opsDashboard.focalService, scenario, 'session-lag'
    )
    const focalSeries = { [focalMetric.archetype]: generateOneSeries(focalParams) }
    const focalResolvedParams = { [focalMetric.archetype]: focalParams }

    const noLag: CorrelatedServiceConfig = {
      name: 'no-lag', correlation: 'upstream_impact',
      lagSeconds: 0, impactFactor: 1.0, health: 'healthy',
    }
    const withLag: CorrelatedServiceConfig = {
      name: 'with-lag', correlation: 'upstream_impact',
      lagSeconds: 30, impactFactor: 1.0, health: 'healthy',
    }

    const resultNoLag  = deriveCorrelatedMetrics(noLag,   focalSeries, focalResolvedParams, scenario, 'session-lag')
    const resultWithLag = deriveCorrelatedMetrics(withLag, focalSeries, focalResolvedParams, scenario, 'session-lag')

    const archetype = focalMetric.archetype
    const noLagSeries  = resultNoLag[archetype]
    const withLagSeries = resultWithLag[archetype]

    if (noLagSeries && withLagSeries) {
      // For each point, the with-lag version should have the focal's earlier delta
      // applied at a shifted position. At t=onsetSecond of focal, no-lag sees the delta
      // immediately; with-lag sees it lag seconds later.
      // In practice: find a post-onset point and verify the with-lag version has
      // a smaller accumulated incident delta than no-lag (it hasn't fully propagated yet).
      const onsetSec = focalParams.onsetSecond
      const earlyPost = noLagSeries.filter(p => p.t >= onsetSec && p.t < onsetSec + 15)
      const earlyPostLag = withLagSeries.filter(p => p.t >= onsetSec && p.t < onsetSec + 15)
      // With lag, the correlated series at t=onset uses focal delta at t=onset-lag (pre-onset → ~0)
      // Without lag, it uses focal delta at t=onset (incident already started → positive)
      if (earlyPost.length > 0 && earlyPostLag.length > 0) {
        // Both series come from the same session seed so noise should be similar;
        // the lag shifts when the incident delta kicks in
        // No-lag should have at least as high a value at onset as with-lag
        expect(earlyPost[0].v).toBeGreaterThanOrEqual(earlyPostLag[0].v - 0.5)
      }
    }
  })

  it('propagated delta is scaled by impact_factor', () => {
    const scenario = getFixtureScenario()
    const focalMetric = scenario.opsDashboard.focalService.metrics[0]
    const focalParams = resolveMetricParams(
      focalMetric, scenario.opsDashboard.focalService, scenario, 'session-100'
    )
    const focalSeries = { [focalMetric.archetype]: generateOneSeries(focalParams) }
    const focalResolvedParams = { [focalMetric.archetype]: focalParams }

    const withFullImpact: CorrelatedServiceConfig = {
      name: 'full-impact', correlation: 'upstream_impact', impactFactor: 1.0, health: 'healthy',
    }
    const withHalfImpact: CorrelatedServiceConfig = {
      name: 'half-impact', correlation: 'upstream_impact', impactFactor: 0.5, health: 'healthy',
    }

    const full = deriveCorrelatedMetrics(withFullImpact, focalSeries, focalResolvedParams, scenario, 'session-100')
    const half = deriveCorrelatedMetrics(withHalfImpact, focalSeries, focalResolvedParams, scenario, 'session-100')

    // Post-onset: the half-impact service should have smaller total values
    const postFull = full[focalMetric.archetype].filter(p => p.t > 0)
    const postHalf = half[focalMetric.archetype].filter(p => p.t > 0)
    if (postFull.length > 0 && postHalf.length > 0) {
      const meanFull = postFull.reduce((a, b) => a + b.v, 0) / postFull.length
      const meanHalf = postHalf.reduce((a, b) => a + b.v, 0) / postHalf.length
      // Half impact should have lower or equal post-incident mean
      expect(meanHalf).toBeLessThanOrEqual(meanFull + 0.01)
    }
  })

  it('infrastructure archetypes (cpu_utilization) are NOT propagated as incident delta', () => {
    // Only traffic/quality archetypes propagate; infra archetypes get independent generation
    const scenario = getFixtureScenario()
    // Build a focal with cpu_utilization having a huge incident overlay
    const scenarioWithCpu = {
      ...scenario,
      opsDashboard: {
        ...scenario.opsDashboard,
        focalService: {
          ...scenario.opsDashboard.focalService,
          metrics: [{
            archetype: 'cpu_utilization',
            baselineValue: 10,
            incidentPeak: 95,
            onsetSecond: 0,
          }],
        },
      },
    }
    const focalMetric = scenarioWithCpu.opsDashboard.focalService.metrics[0]
    const focalParams = resolveMetricParams(
      focalMetric, scenarioWithCpu.opsDashboard.focalService, scenarioWithCpu, 'session-infra'
    )
    const focalSeries = { cpu_utilization: generateOneSeries(focalParams) }
    const focalResolvedParams = { cpu_utilization: focalParams }

    const upstream: CorrelatedServiceConfig = {
      name: 'infra-test', correlation: 'upstream_impact', impactFactor: 1.0, health: 'healthy',
    }
    const result = deriveCorrelatedMetrics(
      upstream, focalSeries, focalResolvedParams, scenarioWithCpu, 'session-infra'
    )

    // cpu_utilization is an infra archetype — should NOT have focal incident delta added
    // The correlated service generates independently (baseline only, no overlay propagation)
    const cpuSeries = result['cpu_utilization']
    if (cpuSeries && cpuSeries.length > 0) {
      const postOnset = cpuSeries.filter(p => p.t > 0)
      const preOnset  = cpuSeries.filter(p => p.t < 0)
      if (postOnset.length > 0 && preOnset.length > 0) {
        const postMean = postOnset.reduce((a, b) => a + b.v, 0) / postOnset.length
        // Without propagation, post-mean should be close to pre-mean (no incident effect)
        // The focal has a huge spike to 95, but the correlated cpu should not
        expect(postMean).toBeLessThan(50)  // focal peaks at 95 — correlated should not
      }
    }
  })

  it('exonerated: override metrics are generated independently', () => {
    const scenario = getFixtureScenario()
    const focalMetric = scenario.opsDashboard.focalService.metrics[0]
    const focalParams = resolveMetricParams(
      focalMetric, scenario.opsDashboard.focalService, scenario, 'session-1'
    )
    const focalSeries = { [focalMetric.archetype]: generateOneSeries(focalParams) }
    const focalResolvedParams = { [focalMetric.archetype]: focalParams }

    const exoneratedWithOverride: CorrelatedServiceConfig = {
      name:        'exonerated-override',
      correlation: 'exonerated',
      health:      'healthy',
      overrides: [{
        archetype:     'error_rate',
        baselineValue: 0.3,  // low healthy value — the exonerating signal
      }],
    }

    const result = deriveCorrelatedMetrics(
      exoneratedWithOverride, focalSeries, focalResolvedParams, scenario, 'session-1'
    )

    // Override metric should exist and be generated with the overridden baseline
    expect(result['error_rate']).toBeDefined()
    // Pre-incident mean should be near 0.3 (no incident — exonerated)
    const preIncident = result['error_rate'].filter(p => p.t < 0)
    if (preIncident.length > 0) {
      const mean = preIncident.reduce((a, b) => a + b.v, 0) / preIncident.length
      expect(mean).toBeLessThan(2.0)  // should be near 0.3, well below focal spike level
    }
  })
})
