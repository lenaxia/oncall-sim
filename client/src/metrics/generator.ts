// generator.ts — orchestrator for metric series generation.
// Called once per session at scenario start.
// Only generates t <= 0 (historical/pre-incident data).
// t > 0 is generated on-demand per tick by MetricStore.

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
 * Returns historical series (t <= 0) and resolved params for all services.
 * t > 0 points are generated on-demand per tick by MetricStore.generatePoint().
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
    // Generate full series then filter to t <= 0 only.
    // The full generation ensures PRNG is advanced correctly to the t=0 boundary.
    const fullSeries = generateOneSeries(params);
    series[focalName][metricConfig.archetype] = fullSeries.filter(
      (p) => p.t <= 0,
    );
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
    // Filter correlated series to t <= 0 as well
    const filteredSeries: Record<string, TimeSeriesPoint[]> = {};
    for (const [metricId, pts] of Object.entries(result.series)) {
      filteredSeries[metricId] = pts.filter((p) => p.t <= 0);
    }
    series[correlatedService.name] = filteredSeries;
    resolvedParams[correlatedService.name] = result.resolvedParams;
  }

  return { series, resolvedParams };
}
