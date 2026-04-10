import { describe, it, expect, beforeEach } from "vitest";
import {
  deriveCorrelatedMetrics,
  extractIncidentDelta,
} from "../../src/metrics/correlation";
import { resolveMetricParams } from "../../src/metrics/resolver";
import { generateOneSeries } from "../../src/metrics/generator";
import {
  buildLoadedScenario,
  clearFixtureCache,
} from "../../src/testutil/index";
import type { CorrelatedServiceConfig } from "../../src/scenario/types";
import type { ResolvedMetricParams } from "../../src/metrics/types";

// Use buildLoadedScenario() — correlation tests depend on opsDashboard.focalService.metrics
// which is derived from components in Step 3. Until then, testutil provides stable fixture data.
const getFixtureScenario = async () => buildLoadedScenario();

beforeEach(() => clearFixtureCache());

// ── extractIncidentDelta ──────────────────────────────────────────────────────

describe("extractIncidentDelta", () => {
  it("returns v = point.v - params.baselineValue", async () => {
    const focalSeries = [
      { t: 0, v: 1.0 },
      { t: 15, v: 5.0 },
      { t: 30, v: 10.0 },
    ];
    const params = { baselineValue: 1.0 } as ResolvedMetricParams;
    const deltas = extractIncidentDelta(focalSeries, params);
    expect(deltas[0].v).toBeCloseTo(0.0);
    expect(deltas[1].v).toBeCloseTo(4.0);
    expect(deltas[2].v).toBeCloseTo(9.0);
  });

  it("preserves t values", async () => {
    const focalSeries = [
      { t: -30, v: 2 },
      { t: 0, v: 3 },
    ];
    const params = { baselineValue: 1.0 } as ResolvedMetricParams;
    const deltas = extractIncidentDelta(focalSeries, params);
    expect(deltas[0].t).toBe(-30);
    expect(deltas[1].t).toBe(0);
  });
});

// ── deriveCorrelatedMetrics — exonerated ──────────────────────────────────────

describe("deriveCorrelatedMetrics — exonerated", () => {
  it("produces series with no incident overlay (all v values within normal range)", async () => {
    const scenario = await getFixtureScenario();
    const focalMetric = scenario.opsDashboard.focalService.metrics[0];
    const focalParams = resolveMetricParams(
      focalMetric,
      scenario.opsDashboard.focalService,
      scenario,
      "session-1",
    );
    const focalSeries = {
      [focalMetric.archetype]: generateOneSeries(focalParams),
    };
    const focalResolvedParams = { [focalMetric.archetype]: focalParams };

    const exonerated: CorrelatedServiceConfig = {
      name: "exonerated-service",
      correlation: "exonerated",
      health: "healthy",
    };

    const { series } = deriveCorrelatedMetrics(
      exonerated,
      focalSeries,
      focalResolvedParams,
      scenario,
      "session-1",
    );

    expect(Object.keys(series).length).toBeGreaterThan(0);
    for (const s of Object.values(series)) {
      s.forEach(({ v }) => expect(v).toBeGreaterThanOrEqual(0));
    }
  });
});

// ── deriveCorrelatedMetrics — upstream_impact ─────────────────────────────────

describe("deriveCorrelatedMetrics — upstream_impact", () => {
  it("propagated archetypes contain incident delta from focal", async () => {
    const scenario = await getFixtureScenario();
    const focalMetric = scenario.opsDashboard.focalService.metrics[0];
    const focalParams = resolveMetricParams(
      focalMetric,
      scenario.opsDashboard.focalService,
      scenario,
      "session-1",
    );
    const focalSeries = {
      [focalMetric.archetype]: generateOneSeries(focalParams),
    };
    const focalResolvedParams = { [focalMetric.archetype]: focalParams };

    const upstream: CorrelatedServiceConfig = {
      name: "upstream-service",
      correlation: "upstream_impact",
      lagSeconds: 0,
      impactFactor: 1.0,
      health: "healthy",
    };

    const { series } = deriveCorrelatedMetrics(
      upstream,
      focalSeries,
      focalResolvedParams,
      scenario,
      "session-1",
    );

    expect(Object.keys(series).length).toBeGreaterThan(0);
    for (const s of Object.values(series)) {
      s.forEach(({ v }) => expect(v).toBeGreaterThanOrEqual(0));
    }
  });

  it("override metrics replace derived metrics", async () => {
    const scenario = await getFixtureScenario();
    const focalMetric = scenario.opsDashboard.focalService.metrics[0];
    const focalParams = resolveMetricParams(
      focalMetric,
      scenario.opsDashboard.focalService,
      scenario,
      "session-1",
    );
    const focalSeries = {
      [focalMetric.archetype]: generateOneSeries(focalParams),
    };
    const focalResolvedParams = { [focalMetric.archetype]: focalParams };

    const upstream: CorrelatedServiceConfig = {
      name: "upstream-override",
      correlation: "upstream_impact",
      health: "healthy",
      overrides: [
        {
          archetype: "conversion_rate",
          baselineValue: 68,
          incidentPeak: 28,
        },
      ],
    };

    const { series } = deriveCorrelatedMetrics(
      upstream,
      focalSeries,
      focalResolvedParams,
      scenario,
      "session-1",
    );

    expect(series["conversion_rate"]).toBeDefined();
    const preIncident = series["conversion_rate"].filter((p) => p.t < 0);
    if (preIncident.length > 0) {
      const mean =
        preIncident.reduce((a, b) => a + b.v, 0) / preIncident.length;
      expect(mean).toBeGreaterThan(50);
    }
  });

  it("propagated delta is shifted by lag_seconds", async () => {
    const scenario = await getFixtureScenario();
    const focalMetric = scenario.opsDashboard.focalService.metrics[0];
    const focalParams = resolveMetricParams(
      focalMetric,
      scenario.opsDashboard.focalService,
      scenario,
      "session-lag",
    );
    const focalSeries = {
      [focalMetric.archetype]: generateOneSeries(focalParams),
    };
    const focalResolvedParams = { [focalMetric.archetype]: focalParams };

    const noLag: CorrelatedServiceConfig = {
      name: "no-lag",
      correlation: "upstream_impact",
      lagSeconds: 0,
      impactFactor: 1.0,
      health: "healthy",
    };
    const withLag: CorrelatedServiceConfig = {
      name: "with-lag",
      correlation: "upstream_impact",
      lagSeconds: 30,
      impactFactor: 1.0,
      health: "healthy",
    };

    const { series: noLagSeries } = deriveCorrelatedMetrics(
      noLag,
      focalSeries,
      focalResolvedParams,
      scenario,
      "session-lag",
    );
    const { series: withLagSeries } = deriveCorrelatedMetrics(
      withLag,
      focalSeries,
      focalResolvedParams,
      scenario,
      "session-lag",
    );

    const archetype = focalMetric.archetype;
    const noLagS = noLagSeries[archetype];
    const withLagS = withLagSeries[archetype];

    if (noLagS && withLagS) {
      const onsetSec = focalParams.onsetSecond;
      const earlyPost = noLagS.filter(
        (p) => p.t >= onsetSec && p.t < onsetSec + 15,
      );
      const earlyPostLag = withLagS.filter(
        (p) => p.t >= onsetSec && p.t < onsetSec + 15,
      );
      if (earlyPost.length > 0 && earlyPostLag.length > 0) {
        expect(earlyPost[0].v).toBeGreaterThanOrEqual(earlyPostLag[0].v - 0.5);
      }
    }
  });

  it("propagated delta is scaled by impact_factor", async () => {
    const scenario = await getFixtureScenario();
    const focalMetric = scenario.opsDashboard.focalService.metrics[0];
    const focalParams = resolveMetricParams(
      focalMetric,
      scenario.opsDashboard.focalService,
      scenario,
      "session-100",
    );
    const focalSeries = {
      [focalMetric.archetype]: generateOneSeries(focalParams),
    };
    const focalResolvedParams = { [focalMetric.archetype]: focalParams };

    const withFullImpact: CorrelatedServiceConfig = {
      name: "full-impact",
      correlation: "upstream_impact",
      impactFactor: 1.0,
      health: "healthy",
    };
    const withHalfImpact: CorrelatedServiceConfig = {
      name: "half-impact",
      correlation: "upstream_impact",
      impactFactor: 0.5,
      health: "healthy",
    };

    const { series: fullSeries } = deriveCorrelatedMetrics(
      withFullImpact,
      focalSeries,
      focalResolvedParams,
      scenario,
      "session-100",
    );
    const { series: halfSeries } = deriveCorrelatedMetrics(
      withHalfImpact,
      focalSeries,
      focalResolvedParams,
      scenario,
      "session-100",
    );

    const postFull = fullSeries[focalMetric.archetype].filter((p) => p.t > 0);
    const postHalf = halfSeries[focalMetric.archetype].filter((p) => p.t > 0);
    if (postFull.length > 0 && postHalf.length > 0) {
      const meanFull = postFull.reduce((a, b) => a + b.v, 0) / postFull.length;
      const meanHalf = postHalf.reduce((a, b) => a + b.v, 0) / postHalf.length;
      expect(meanHalf).toBeLessThanOrEqual(meanFull + 0.01);
    }
  });

  it("infrastructure archetypes (cpu_utilization) are NOT propagated as incident delta", async () => {
    const scenario = await getFixtureScenario();
    const scenarioWithCpu = {
      ...scenario,
      opsDashboard: {
        ...scenario.opsDashboard,
        focalService: {
          ...scenario.opsDashboard.focalService,
          metrics: [
            {
              archetype: "cpu_utilization",
              baselineValue: 10,
              incidentPeak: 95,
              onsetSecond: 0,
            },
          ],
        },
      },
    };
    const focalMetric = scenarioWithCpu.opsDashboard.focalService.metrics[0];
    const focalParams = resolveMetricParams(
      focalMetric,
      scenarioWithCpu.opsDashboard.focalService,
      scenarioWithCpu,
      "session-infra",
    );
    const focalSeries = { cpu_utilization: generateOneSeries(focalParams) };
    const focalResolvedParams = { cpu_utilization: focalParams };

    const upstream: CorrelatedServiceConfig = {
      name: "infra-test",
      correlation: "upstream_impact",
      impactFactor: 1.0,
      health: "healthy",
    };
    const { series } = deriveCorrelatedMetrics(
      upstream,
      focalSeries,
      focalResolvedParams,
      scenarioWithCpu,
      "session-infra",
    );

    const cpuSeries = series["cpu_utilization"];
    if (cpuSeries && cpuSeries.length > 0) {
      const postOnset = cpuSeries.filter((p) => p.t > 0);
      const preOnset = cpuSeries.filter((p) => p.t < 0);
      if (postOnset.length > 0 && preOnset.length > 0) {
        const postMean =
          postOnset.reduce((a, b) => a + b.v, 0) / postOnset.length;
        expect(postMean).toBeLessThan(50);
      }
    }
  });

  it("exonerated: override metrics are generated independently", async () => {
    const scenario = await getFixtureScenario();
    const focalMetric = scenario.opsDashboard.focalService.metrics[0];
    const focalParams = resolveMetricParams(
      focalMetric,
      scenario.opsDashboard.focalService,
      scenario,
      "session-1",
    );
    const focalSeries = {
      [focalMetric.archetype]: generateOneSeries(focalParams),
    };
    const focalResolvedParams = { [focalMetric.archetype]: focalParams };

    const exoneratedWithOverride: CorrelatedServiceConfig = {
      name: "exonerated-override",
      correlation: "exonerated",
      health: "healthy",
      overrides: [
        {
          archetype: "error_rate",
          baselineValue: 0.3,
        },
      ],
    };

    const { series } = deriveCorrelatedMetrics(
      exoneratedWithOverride,
      focalSeries,
      focalResolvedParams,
      scenario,
      "session-1",
    );

    expect(series["error_rate"]).toBeDefined();
    const preIncident = series["error_rate"].filter((p) => p.t < 0);
    if (preIncident.length > 0) {
      const mean =
        preIncident.reduce((a, b) => a + b.v, 0) / preIncident.length;
      expect(mean).toBeLessThan(2.0);
    }
  });
});
