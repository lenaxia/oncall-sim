// generator.ts — orchestrator for full metric series generation.
// Called once per session at scenario start.

import type { LoadedScenario } from '../scenario/types'
import type { TimeSeriesPoint } from '@shared/types/events'
import type { ResolvedMetricParams } from './types'
import { resolveMetricParams } from './resolver'
import { generateOneSeries } from './series'
import { deriveCorrelatedMetrics } from './correlation'

// Re-export for tests that import directly from generator
export { generateOneSeries } from './series'

/**
 * Entry point. Called once per session at scenario start.
 * Returns all metric series for all services, keyed for the SessionSnapshot.
 *
 * Shape: { 'payment-service': { 'error_rate': [...], ... }, ... }
 */
export function generateAllMetrics(
  scenario: LoadedScenario,
  sessionId: string
): Record<string, Record<string, TimeSeriesPoint[]>> {
  const result: Record<string, Record<string, TimeSeriesPoint[]>> = {}
  const { opsDashboard } = scenario

  // ── Focal service ─────────────────────────────────────────────────────────
  const focalName    = opsDashboard.focalService.name
  result[focalName]  = {}
  const focalResolvedParams: Record<string, ResolvedMetricParams> = {}

  for (const metricConfig of opsDashboard.focalService.metrics) {
    const params = resolveMetricParams(
      metricConfig,
      opsDashboard.focalService,
      scenario,
      sessionId
    )
    focalResolvedParams[metricConfig.archetype] = params
    result[focalName][metricConfig.archetype]   = generateOneSeries(params)
  }

  // ── Correlated services ───────────────────────────────────────────────────
  for (const correlatedService of opsDashboard.correlatedServices) {
    result[correlatedService.name] = deriveCorrelatedMetrics(
      correlatedService,
      result[focalName],
      focalResolvedParams,
      scenario,
      sessionId
    )
  }

  return result
}
