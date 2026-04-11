// correlation.ts — derives correlated service metrics from the focal service's generated series.

import type {
  CorrelatedServiceConfig,
  LoadedScenario,
} from "../scenario/types";
import type { TimeSeriesPoint } from "@shared/types/events";
import type { ResolvedMetricParams } from "./types";
import { resolveMetricParams } from "./resolver";
import { generateOneSeries } from "./series";

const PROPAGATED_ARCHETYPES = new Set([
  "error_rate",
  "fault_rate",
  "availability",
  "p99_latency_ms",
  "p50_latency_ms",
  "request_rate",
]);

export function extractIncidentDelta(
  focalSeries: TimeSeriesPoint[],
  params: ResolvedMetricParams,
): TimeSeriesPoint[] {
  return focalSeries.map(({ t, v }) => ({ t, v: v - params.baselineValue }));
}

export interface CorrelatedMetricsResult {
  series: Record<string, TimeSeriesPoint[]>;
  resolvedParams: Record<string, ResolvedMetricParams>;
}

export function deriveCorrelatedMetrics(
  correlationConfig: CorrelatedServiceConfig,
  focalSeries: Record<string, TimeSeriesPoint[]>,
  focalResolvedParams: Record<string, ResolvedMetricParams>,
  scenarioConfig: LoadedScenario,
  sessionId: string,
): CorrelatedMetricsResult {
  const series: Record<string, TimeSeriesPoint[]> = {};
  const resolvedParams: Record<string, ResolvedMetricParams> = {};

  const { opsDashboard } = scenarioConfig;
  const focalMetrics = opsDashboard.focalService.metrics;

  for (const focalMetricConfig of focalMetrics) {
    const archetype = focalMetricConfig.archetype;

    const correlatedMetricConfig = {
      ...focalMetricConfig,
      incidentPeak: undefined,
      onsetSecond: undefined,
      incidentResponse: undefined,
      seriesOverride: undefined,
    };

    const params = resolveMetricParams(
      correlatedMetricConfig,
      correlationConfig,
      scenarioConfig,
      sessionId,
    );
    let seriesForMetric = generateOneSeries(params);

    if (
      correlationConfig.correlation === "upstream_impact" &&
      PROPAGATED_ARCHETYPES.has(archetype)
    ) {
      const focalParam = focalResolvedParams[archetype];
      const focal = focalSeries[archetype];

      if (focalParam && focal) {
        const lagSeconds = correlationConfig.lagSeconds ?? 0;
        const impactFactor = correlationConfig.impactFactor ?? 1.0;
        const focalDeltas = extractIncidentDelta(focal, focalParam);

        seriesForMetric = seriesForMetric.map((pt) => {
          const targetT = pt.t - lagSeconds;
          const deltaPoint = focalDeltas.reduce(
            (closest, d) =>
              Math.abs(d.t - targetT) < Math.abs(closest.t - targetT)
                ? d
                : closest,
            focalDeltas[0],
          );
          const delta = deltaPoint ? deltaPoint.v * impactFactor : 0;
          return { t: pt.t, v: pt.v + delta };
        });
      }
    }

    series[archetype] = seriesForMetric;
    resolvedParams[archetype] = params;
  }

  if (correlationConfig.overrides) {
    for (const overrideMetricConfig of correlationConfig.overrides) {
      const overrideParams = resolveMetricParams(
        overrideMetricConfig,
        correlationConfig,
        scenarioConfig,
        sessionId,
      );
      series[overrideMetricConfig.archetype] =
        generateOneSeries(overrideParams);
      resolvedParams[overrideMetricConfig.archetype] = overrideParams;
    }
  }

  return { series, resolvedParams };
}
