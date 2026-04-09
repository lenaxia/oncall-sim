// generator.ts — orchestrator for full metric series generation.
// Called once per session at scenario start.

import type { LoadedScenario } from "../scenario/types";
import type { TimeSeriesPoint } from "@shared/types/events";
import type { ResolvedMetricParams } from "./types";
import { resolveMetricParams } from "./resolver";
import { generateOneSeries } from "./series";
import { deriveCorrelatedMetrics } from "./correlation";

// Re-export for tests that import directly from generator
export { generateOneSeries } from "./series";

export interface GeneratedMetrics {
  series: Record<string, Record<string, TimeSeriesPoint[]>>;
  resolvedParams: Record<string, Record<string, ResolvedMetricParams>>;
}

/**
 * Entry point. Called once per session at scenario start.
 * Returns both the generated series and the resolved params for all services.
 * The series are keyed by service name → metricId (archetype).
 * The resolvedParams are used by MetricStore to look up resolvedValue and incidentPeak.
 */
export function generateAllMetrics(
  scenario: LoadedScenario,
  sessionId: string,
): GeneratedMetrics {
  const series: Record<string, Record<string, TimeSeriesPoint[]>> = {};
  const resolvedParams: Record<
    string,
    Record<string, ResolvedMetricParams>
  > = {};
  const { opsDashboard } = scenario;

  // ── Focal service ──────────────────────────────────────────────────────────
  const focalName = opsDashboard.focalService.name;
  series[focalName] = {};
  resolvedParams[focalName] = {};

  for (const metricConfig of opsDashboard.focalService.metrics) {
    const params = resolveMetricParams(
      metricConfig,
      opsDashboard.focalService,
      scenario,
      sessionId,
    );
    series[focalName][metricConfig.archetype] = generateOneSeries(params);
    resolvedParams[focalName][metricConfig.archetype] = params;
  }

  // ── Correlated services ────────────────────────────────────────────────────
  for (const correlatedService of opsDashboard.correlatedServices) {
    const result = deriveCorrelatedMetrics(
      correlatedService,
      series[focalName],
      resolvedParams[focalName],
      scenario,
      sessionId,
    );
    series[correlatedService.name] = result.series;
    resolvedParams[correlatedService.name] = result.resolvedParams;
  }

  return { series, resolvedParams };
}
