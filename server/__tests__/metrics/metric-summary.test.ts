import { describe, it, expect, beforeEach } from "vitest";
import {
  computeMetricSummary,
  renderMetricSummary,
} from "../../src/metrics/metric-summary";
import { createMetricStore } from "../../src/metrics/metric-store";
import type { MetricStore } from "../../src/metrics/metric-store";
import type { LoadedScenario } from "../../src/scenario/types";
import type { ResolvedMetricParams } from "../../src/metrics/types";
import type { TimeSeriesPoint } from "@shared/types/events";
import {
  getFixtureScenario,
  clearFixtureCache,
} from "../../src/testutil/index";

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseParams(
  overrides: Partial<ResolvedMetricParams> = {},
): ResolvedMetricParams {
  return {
    metricId: "error_rate",
    service: "payment-service",
    archetype: "error_rate",
    label: "Error Rate",
    unit: "percent",
    fromSecond: -300,
    toSecond: 900,
    resolutionSeconds: 1,
    baselineValue: 0.5,
    resolvedValue: 0.5,
    rhythmProfile: "always_on_api",
    inheritsRhythm: false,
    noiseType: "sporadic_spikes",
    noiseLevelMultiplier: 1.0,
    overlay: "spike_and_sustain",
    onsetSecond: 0,
    peakValue: 95,
    dropFactor: 0.1,
    ceiling: 100,
    saturationDurationSeconds: 300,
    rampDurationSeconds: 30,
    seriesOverride: null,
    seed: 42,
    ...overrides,
  };
}

/**
 * Builds a MetricStore from a hand-crafted series.
 * `pts` is the full series for service/metricId.
 */
function storeFromSeries(
  service: string,
  metricId: string,
  pts: TimeSeriesPoint[],
  params: Partial<ResolvedMetricParams> = {},
): MetricStore {
  const rp = baseParams({ metricId, service, ...params });
  return createMetricStore(
    { [service]: { [metricId]: pts } },
    { [service]: { [metricId]: rp } },
  );
}

/** Generates a flat baseline series from fromT to toT at 5s resolution. */
function flatSeries(
  fromT: number,
  toT: number,
  value: number,
): TimeSeriesPoint[] {
  const pts: TimeSeriesPoint[] = [];
  for (let t = fromT; t <= toT; t += 5) pts.push({ t, v: value });
  return pts;
}

/** Generates a series that is flat at `pre` before onset, then ramps linearly to `peak`. */
function rampSeries(
  fromT: number,
  onset: number,
  toT: number,
  pre: number,
  peak: number,
): TimeSeriesPoint[] {
  const pts: TimeSeriesPoint[] = [];
  for (let t = fromT; t <= toT; t += 5) {
    if (t < onset) pts.push({ t, v: pre });
    else {
      const frac = Math.min((t - onset) / (toT - onset), 1);
      pts.push({ t, v: pre + (peak - pre) * frac });
    }
  }
  return pts;
}

/** Generates a series that spikes to `peak` then decays back to `resolved`. */
function spikeAndDecaySeries(
  fromT: number,
  onset: number,
  peakAt: number,
  toT: number,
  pre: number,
  peak: number,
  resolved: number,
): TimeSeriesPoint[] {
  const pts: TimeSeriesPoint[] = [];
  for (let t = fromT; t <= toT; t += 5) {
    if (t < onset) {
      pts.push({ t, v: pre });
    } else if (t <= peakAt) {
      const frac = (t - onset) / (peakAt - onset);
      pts.push({ t, v: pre + (peak - pre) * frac });
    } else {
      const frac = (t - peakAt) / (toT - peakAt);
      pts.push({ t, v: peak - (peak - resolved) * frac });
    }
  }
  return pts;
}

// Minimal LoadedScenario for summary tests (only opsDashboard needed)
function makeScenario(
  overrides: {
    focalMetrics?: Array<{
      archetype: string;
      label?: string;
      unit?: string;
      warningThreshold?: number;
      criticalThreshold?: number;
    }>;
    correlatedServices?: LoadedScenario["opsDashboard"]["correlatedServices"];
  } = {},
): LoadedScenario {
  const base = getFixtureScenario();
  return {
    ...base,
    opsDashboard: {
      ...base.opsDashboard,
      focalService: {
        ...base.opsDashboard.focalService,
        name: "payment-service",
        metrics: (
          overrides.focalMetrics ?? [
            {
              archetype: "error_rate",
              label: "Error Rate",
              unit: "percent",
              warningThreshold: 1,
              criticalThreshold: 10,
            },
          ]
        ).map((m) => ({
          archetype: m.archetype,
          label: m.label,
          unit: m.unit,
          warningThreshold: m.warningThreshold,
          criticalThreshold: m.criticalThreshold,
        })) as LoadedScenario["opsDashboard"]["focalService"]["metrics"],
      },
      correlatedServices: overrides.correlatedServices ?? [],
    },
  };
}

// ── classifyBand (tested indirectly via status field) ─────────────────────────

describe("MetricNarrative — status band classification", () => {
  it("returns healthy when value is below warning threshold", () => {
    const store = storeFromSeries(
      "payment-service",
      "error_rate",
      flatSeries(-60, 60, 0.3),
    );
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 60);
    expect(summary.narratives[0].status).toBe("healthy");
  });

  it("returns warning when value is between warning and critical", () => {
    const store = storeFromSeries(
      "payment-service",
      "error_rate",
      flatSeries(-60, 60, 5),
    );
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 60);
    expect(summary.narratives[0].status).toBe("warning");
  });

  it("returns critical when value is at or above critical threshold", () => {
    const store = storeFromSeries(
      "payment-service",
      "error_rate",
      flatSeries(-60, 60, 90),
    );
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 60);
    expect(summary.narratives[0].status).toBe("critical");
  });

  it("returns unknown when store has no data", () => {
    const store = storeFromSeries("payment-service", "error_rate", []);
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 60);
    expect(summary.narratives[0].status).toBe("unknown");
  });
});

// ── slope derivation ──────────────────────────────────────────────────────────

describe("MetricNarrative — slope derivation", () => {
  it("returns stable for a flat series", () => {
    const store = storeFromSeries(
      "payment-service",
      "error_rate",
      flatSeries(-120, 120, 50),
    );
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 60);
    expect(summary.narratives[0].slope).toBe("stable");
  });

  it("returns rising sharply for a steeply rising series", () => {
    const store = storeFromSeries(
      "payment-service",
      "error_rate",
      rampSeries(-60, 0, 60, 0, 80), // 0→80 over 60s with baseline 0.5
    );
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 60);
    expect(summary.narratives[0].slope).toBe("rising sharply");
  });

  it("returns recovering for a steeply falling series", () => {
    const store = storeFromSeries(
      "payment-service",
      "error_rate",
      spikeAndDecaySeries(-60, -60, -30, 60, 0, 80, 0),
    );
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 60);
    expect(["recovering", "falling"]).toContain(summary.narratives[0].slope);
  });

  it("returns unknown when fewer than 3 points in the window", () => {
    // Only 2 points in the last 60s window
    const store = storeFromSeries("payment-service", "error_rate", [
      { t: 0, v: 50 },
      { t: 30, v: 55 },
    ]);
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 60);
    expect(summary.narratives[0].slope).toBe("unknown");
  });
});

// ── pre-incident value ────────────────────────────────────────────────────────

describe("MetricNarrative — pre-incident value", () => {
  it("captures the value just before onsetSecond", () => {
    const series = rampSeries(-60, 0, 120, 0.3, 90);
    const store = storeFromSeries("payment-service", "error_rate", series, {
      onsetSecond: 0,
    });
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 60);
    // Pre-incident should be close to 0.3 (the pre-onset value)
    expect(summary.narratives[0].preIncident).not.toBeNull();
    expect(summary.narratives[0].preIncident!).toBeLessThan(1);
  });

  it("preIncident is null when there is no data before onsetSecond", () => {
    // Series starts exactly at onset
    const store = storeFromSeries(
      "payment-service",
      "error_rate",
      flatSeries(0, 120, 90),
      { onsetSecond: 0 },
    );
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 60);
    // getCurrentValue at t=-1 should return null (no points before t=0)
    expect(summary.narratives[0].preIncident).toBeNull();
  });
});

// ── timeInBand ────────────────────────────────────────────────────────────────

describe("MetricNarrative — timeInBand", () => {
  it("is 0 for a metric that just crossed into critical", () => {
    // Rises from healthy to just-over-critical at t=60
    const series: TimeSeriesPoint[] = [
      ...flatSeries(-60, 55, 5), // warning band
      { t: 60, v: 11 }, // crosses critical at t=60
    ];
    const store = storeFromSeries("payment-service", "error_rate", series);
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 60);
    // Was in warning up to t=55, crossed critical at t=60 — timeInBand ≈ 5s
    expect(summary.narratives[0].timeInBand).toBeLessThanOrEqual(10);
  });

  it("is large for a metric that has been critical for a long time", () => {
    const store = storeFromSeries(
      "payment-service",
      "error_rate",
      flatSeries(-300, 300, 90),
    );
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 300);
    expect(summary.narratives[0].timeInBand).toBeGreaterThan(200);
  });
});

// ── sentence templates ────────────────────────────────────────────────────────

describe("MetricNarrative — sentence content", () => {
  it("healthy+stable sentence does not mention rising or critical", () => {
    const store = storeFromSeries(
      "payment-service",
      "error_rate",
      flatSeries(-120, 120, 0.3),
    );
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 60);
    const s = summary.narratives[0].sentence.toLowerCase();
    expect(s).not.toContain("critical");
    expect(s).not.toContain("rising");
    expect(s).toContain("normal");
  });

  it('critical+rising sentence contains "critical" and direction language', () => {
    const store = storeFromSeries(
      "payment-service",
      "error_rate",
      rampSeries(-60, 0, 120, 0.3, 90),
    );
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 60);
    const s = summary.narratives[0].sentence.toLowerCase();
    expect(s).toMatch(/critical|rising|climbing/);
  });

  it('critical+stable sentence for saturated archetype mentions "saturated"', () => {
    const store = storeFromSeries(
      "payment-service",
      "connection_pool_used",
      flatSeries(-300, 300, 18),
      {
        metricId: "connection_pool_used",
        archetype: "connection_pool_used",
        baselineValue: 7,
      },
    );
    const scenario = makeScenario({
      focalMetrics: [
        {
          archetype: "connection_pool_used",
          label: "Connection Pool Used",
          unit: "count",
          criticalThreshold: 16,
        },
      ],
    });
    const summary = computeMetricSummary(scenario, store, 300);
    expect(summary.narratives[0].sentence.toLowerCase()).toContain("saturated");
  });

  it('recovering sentence says "recovered" or "improving"', () => {
    const store = storeFromSeries(
      "payment-service",
      "error_rate",
      spikeAndDecaySeries(-60, -60, -30, 120, 0.3, 80, 0.3),
    );
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 120);
    const s = summary.narratives[0].sentence.toLowerCase();
    expect(s).toMatch(/recover|normal|back|improv/);
  });

  it("sentence includes pre-incident value when available", () => {
    const store = storeFromSeries(
      "payment-service",
      "error_rate",
      rampSeries(-60, 0, 120, 0.3, 90),
      { onsetSecond: 0 },
    );
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 60);
    // Pre-incident value (~0.3%) should appear in sentence
    expect(summary.narratives[0].sentence).toMatch(/0\.3|before/);
  });
});

// ── renderMetricSummary ───────────────────────────────────────────────────────

describe("renderMetricSummary", () => {
  beforeEach(() => clearFixtureCache());

  it("returns empty string when no narratives", () => {
    const summary = { simTime: 0, narratives: [] };
    const scenario = makeScenario();
    expect(renderMetricSummary(summary, scenario)).toBe("");
  });

  it("output contains the grounding instruction", () => {
    const store = storeFromSeries(
      "payment-service",
      "error_rate",
      flatSeries(-60, 60, 90),
    );
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 60);
    const text = renderMetricSummary(summary, scenario);
    expect(text).toContain("do not contradict");
  });

  it("focal service is labelled as (focal service)", () => {
    const store = storeFromSeries(
      "payment-service",
      "error_rate",
      flatSeries(-60, 60, 90),
    );
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 60);
    const text = renderMetricSummary(summary, scenario);
    expect(text).toContain("focal service");
  });

  it("exonerated service gets a single short line", () => {
    const store = createMetricStore(
      {
        "payment-service": { error_rate: flatSeries(-60, 60, 0.3) },
        "auth-service": { error_rate: flatSeries(-60, 60, 0.1) },
      },
      {
        "payment-service": { error_rate: baseParams() },
        "auth-service": { error_rate: baseParams({ service: "auth-service" }) },
      },
    );
    const scenario = makeScenario({
      correlatedServices: [
        {
          name: "auth-service",
          correlation: "exonerated",
          health: "healthy",
          lagSeconds: 0,
          impactFactor: 0,
          overrides: [
            {
              archetype: "error_rate",
              label: "Error Rate",
              unit: "percent",
              warningThreshold: 1,
              criticalThreshold: 10,
            },
          ],
        },
      ],
    });
    const summary = computeMetricSummary(scenario, store, 60);
    const text = renderMetricSummary(summary, scenario);
    expect(text).toContain("not involved");
    expect(text).toContain("auth-service");
  });

  it("independent service shows value+status but no sentence prose", () => {
    const store = createMetricStore(
      {
        "payment-service": { error_rate: flatSeries(-60, 60, 90) },
        "order-service": { error_rate: flatSeries(-60, 60, 2) },
      },
      {
        "payment-service": { error_rate: baseParams() },
        "order-service": {
          error_rate: baseParams({
            service: "order-service",
            baselineValue: 0.5,
          }),
        },
      },
    );
    const scenario = makeScenario({
      correlatedServices: [
        {
          name: "order-service",
          correlation: "independent",
          health: "healthy",
          lagSeconds: 0,
          impactFactor: 0,
          overrides: [
            {
              archetype: "error_rate",
              label: "Error Rate",
              unit: "percent",
              warningThreshold: 1,
              criticalThreshold: 10,
            },
          ],
        },
      ],
    });
    const summary = computeMetricSummary(scenario, store, 60);
    const text = renderMetricSummary(summary, scenario);
    // Independent service should show value+band notation, not full prose
    expect(text).toContain("["); // status band in brackets
  });

  it("full output contains metric sentence for focal service", () => {
    const store = storeFromSeries(
      "payment-service",
      "error_rate",
      rampSeries(-60, 0, 60, 0.3, 90),
    );
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 60);
    const text = renderMetricSummary(summary, scenario);
    expect(text).toContain("Error Rate");
    // Should contain something about the current state
    expect(text.toLowerCase()).toMatch(/critical|rising|climbing|elevated/);
  });

  it("output contains the LLM grounding rules", () => {
    const store = storeFromSeries(
      "payment-service",
      "error_rate",
      flatSeries(-60, 60, 90),
    );
    const scenario = makeScenario();
    const summary = computeMetricSummary(scenario, store, 60);
    const text = renderMetricSummary(summary, scenario);
    expect(text).toContain("Do not describe a metric as improving");
    expect(text).toContain("Do not describe a metric as worsening");
  });
});

// ── computeMetricSummary integration ─────────────────────────────────────────

describe("computeMetricSummary — integration with fixture scenario", () => {
  beforeEach(() => clearFixtureCache());

  it("loads without error and returns a narrative per focal metric", () => {
    const scenario = getFixtureScenario();
    const focalMetricCount = scenario.opsDashboard.focalService.metrics.length;
    // Null store — no data, but computation should not throw
    const nullStore: MetricStore = {
      getAllSeries: () => ({}),
      getCurrentValue: () => null,
      generatePoint: () => [],
      applyActiveOverlay: () => {},
      getResolvedParams: () => null,
      listMetrics: () => [],
    };
    const summary = computeMetricSummary(scenario, nullStore, 0);
    expect(summary.narratives.length).toBe(focalMetricCount);
  });

  it("simTime is preserved in the summary", () => {
    const scenario = getFixtureScenario();
    const nullStore: MetricStore = {
      getAllSeries: () => ({}),
      getCurrentValue: () => null,
      generatePoint: () => [],
      applyActiveOverlay: () => {},
      getResolvedParams: () => null,
      listMetrics: () => [],
    };
    const summary = computeMetricSummary(scenario, nullStore, 300);
    expect(summary.simTime).toBe(300);
  });
});
