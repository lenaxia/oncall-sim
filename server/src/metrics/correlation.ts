// correlation.ts — derives correlated service metrics from the focal service's generated series.

import type { CorrelatedServiceConfig, LoadedScenario } from '../scenario/types'
import type { TimeSeriesPoint } from '@shared/types/events'
import type { ResolvedMetricParams } from './types'
import { resolveMetricParams } from './resolver'
import { generateOneSeries } from './series'

// Traffic and quality archetypes that propagate upstream impact
const PROPAGATED_ARCHETYPES = new Set([
  'error_rate', 'fault_rate', 'availability',
  'p99_latency_ms', 'p50_latency_ms', 'request_rate',
])

/**
 * Extracts the incident overlay delta from a focal service series.
 * Delta = generated_value - baseline_value at each point.
 * Used by upstream_impact derivation.
 */
export function extractIncidentDelta(
  focalSeries: TimeSeriesPoint[],
  params: ResolvedMetricParams
): TimeSeriesPoint[] {
  return focalSeries.map(({ t, v }) => ({
    t,
    v: v - params.baselineValue,
  }))
}

/**
 * Derives correlated service metrics from the focal service's generated series.
 * Returns a Record<metricId, TimeSeriesPoint[]> for this correlated service.
 */
export function deriveCorrelatedMetrics(
  correlationConfig: CorrelatedServiceConfig,
  focalSeries: Record<string, TimeSeriesPoint[]>,
  focalResolvedParams: Record<string, ResolvedMetricParams>,
  scenarioConfig: LoadedScenario,
  sessionId: string
): Record<string, TimeSeriesPoint[]> {
  const result: Record<string, TimeSeriesPoint[]> = {}

  const { opsDashboard } = scenarioConfig
  const focalMetrics = opsDashboard.focalService.metrics

  // Generate independent baseline+rhythm+noise for this service's own archetypes
  for (const focalMetricConfig of focalMetrics) {
    const archetype = focalMetricConfig.archetype

    // Build a metric config for the correlated service based on the focal config
    // but with no incident response (for exonerated/independent) or with derived overlay
    const correlatedMetricConfig = {
      ...focalMetricConfig,
      // Remove any incident-specific author values for the base generation
      incidentPeak:     undefined,
      onsetSecond:      undefined,
      incidentResponse: undefined,
      seriesOverride:   undefined,
    }

    const params = resolveMetricParams(
      correlatedMetricConfig,
      correlationConfig,
      scenarioConfig,
      sessionId
    )

    let series = generateOneSeries(params)

    // upstream_impact: add scaled + shifted focal incident delta for propagated archetypes
    if (correlationConfig.correlation === 'upstream_impact'
        && PROPAGATED_ARCHETYPES.has(archetype)) {
      const focalParam = focalResolvedParams[archetype]
      const focal      = focalSeries[archetype]

      if (focalParam && focal) {
        const lagSeconds    = correlationConfig.lagSeconds    ?? 0
        const impactFactor  = correlationConfig.impactFactor  ?? 1.0
        const focalDeltas   = extractIncidentDelta(focal, focalParam)

        // Apply shifted + scaled delta
        series = series.map((pt) => {
          const targetT  = pt.t - lagSeconds
          // Find nearest delta point (linear search, series are short)
          const deltaPoint = focalDeltas.reduce((closest, d) => {
            return Math.abs(d.t - targetT) < Math.abs(closest.t - targetT) ? d : closest
          }, focalDeltas[0])
          const delta = deltaPoint ? deltaPoint.v * impactFactor : 0
          return { t: pt.t, v: pt.v + delta }
        })
      }
    }

    result[archetype] = series
  }

  // Apply overrides last — each override metric config generated independently
  if (correlationConfig.overrides) {
    for (const overrideMetricConfig of correlationConfig.overrides) {
      const overrideParams = resolveMetricParams(
        overrideMetricConfig,
        correlationConfig,
        scenarioConfig,
        sessionId
      )
      result[overrideMetricConfig.archetype] = generateOneSeries(overrideParams)
    }
  }

  return result
}
