import { describe, it, expect } from "vitest";
import { createMetricStore } from "../../src/metrics/metric-store";
import type { ActiveOverlay } from "../../src/metrics/metric-store";
import type { ResolvedMetricParams } from "../../src/metrics/types";
import type { TimeSeriesPoint } from "@shared/types/events";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRp(
  overrides: Partial<ResolvedMetricParams> = {},
): ResolvedMetricParams {
  return {
    metricId: "error_rate",
    service: "svc",
    archetype: "error_rate",
    label: "Error Rate",
    unit: "percent",
    fromSecond: -60,
    toSecond: 300,
    resolutionSeconds: 60,
    baselineValue: 1.0,
    resolvedValue: 1.0,
    rhythmProfile: "none",
    inheritsRhythm: false,
    noiseType: "none",
    noiseLevelMultiplier: 1.0,
    overlayApplications: [],
    overlay: "none",
    onsetSecond: 0,
    peakValue: 10.0,
    dropFactor: 0.5,
    ceiling: 10.0,
    saturationDurationSeconds: 60,
    rampDurationSeconds: 30,
    seriesOverride: null,
    seed: 42,
    ...overrides,
  };
}

function makeHistorical(v = 1): TimeSeriesPoint[] {
  return [
    { t: -60, v },
    { t: 0, v },
  ];
}

function makeOverlay(overrides: Partial<ActiveOverlay> = {}): ActiveOverlay {
  return {
    startSimTime: 60,
    startValue: 10,
    targetValue: 1,
    pattern: "smooth_decay",
    speedSeconds: 300,
    sustained: true,
    ...overrides,
  };
}

// Convenience: generate the single next point and return it
function nextPoint(
  store: ReturnType<typeof createMetricStore>,
  service: string,
  metricId: string,
  simTime: number,
): TimeSeriesPoint {
  const pts = store.generatePoint(service, metricId, simTime);
  if (pts.length === 0)
    throw new Error(`generatePoint returned empty at t=${simTime}`);
  return pts[pts.length - 1];
}

// ── getAllSeries ──────────────────────────────────────────────────────────────

describe("MetricStore — getAllSeries", () => {
  it("returns historical series before any points are generated", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical() } },
      { svc: { error_rate: makeRp() } },
    );
    expect(store.getAllSeries()["svc"]["error_rate"].map((p) => p.t)).toEqual([
      -60, 0,
    ]);
  });

  it("includes generated points after generatePoint is called", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical() } },
      { svc: { error_rate: makeRp() } },
    );
    store.generatePoint("svc", "error_rate", 60);
    expect(store.getAllSeries()["svc"]["error_rate"].map((p) => p.t)).toEqual([
      -60, 0, 60,
    ]);
  });

  it("returns a deep copy — mutating returned object does not affect store", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical(5) } },
      { svc: { error_rate: makeRp() } },
    );
    const copy = store.getAllSeries();
    copy["svc"]["error_rate"][0].v = 999;
    expect(store.getAllSeries()["svc"]["error_rate"][0].v).toBe(5);
  });
});

// ── getCurrentValue ───────────────────────────────────────────────────────────

describe("MetricStore — getCurrentValue", () => {
  it("returns historical value for t <= 0", () => {
    const store = createMetricStore(
      {
        svc: {
          error_rate: [
            { t: -60, v: 3 },
            { t: 0, v: 5 },
          ],
        },
      },
      { svc: { error_rate: makeRp() } },
    );
    expect(store.getCurrentValue("svc", "error_rate", 0)).toBe(5);
    expect(store.getCurrentValue("svc", "error_rate", -60)).toBe(3);
  });

  it("returns generated point value for t > 0 after generation", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical() } },
      { svc: { error_rate: makeRp() } },
    );
    const pt = nextPoint(store, "svc", "error_rate", 60);
    expect(store.getCurrentValue("svc", "error_rate", 60)).toBe(pt.v);
  });

  it("returns null for unknown service", () => {
    expect(
      createMetricStore({}, {}).getCurrentValue("no-svc", "error_rate", 0),
    ).toBeNull();
  });

  it("returns null for unknown metricId", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical() } },
      { svc: { error_rate: makeRp() } },
    );
    expect(store.getCurrentValue("svc", "no_metric", 0)).toBeNull();
  });
});

// ── generatePoint ─────────────────────────────────────────────────────────────

describe("MetricStore — generatePoint", () => {
  it("returns empty array for t <= 0", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical() } },
      { svc: { error_rate: makeRp() } },
    );
    expect(store.generatePoint("svc", "error_rate", 0)).toEqual([]);
    expect(store.generatePoint("svc", "error_rate", -60)).toEqual([]);
  });

  it("returns a point at the expected next tick", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical() } },
      { svc: { error_rate: makeRp() } },
    );
    const pts = store.generatePoint("svc", "error_rate", 60);
    expect(pts.length).toBe(1);
    expect(pts[0].t).toBe(60);
    expect(typeof pts[0].v).toBe("number");
  });

  it("returns empty array if simTime has not yet reached next tick", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical() } },
      { svc: { error_rate: makeRp() } }, // resolutionSeconds=60
    );
    // First tick at t=60, so t=30 is not yet due
    expect(store.generatePoint("svc", "error_rate", 30)).toEqual([]);
  });

  it("generates sequential points correctly", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical() } },
      { svc: { error_rate: makeRp() } },
    );
    const p1 = nextPoint(store, "svc", "error_rate", 60);
    const p2 = nextPoint(store, "svc", "error_rate", 120);
    const p3 = nextPoint(store, "svc", "error_rate", 180);
    expect(p1.t).toBe(60);
    expect(p2.t).toBe(120);
    expect(p3.t).toBe(180);
  });

  it("catches up multiple missed ticks when simTime skips ahead", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical() } },
      { svc: { error_rate: makeRp() } }, // resolutionSeconds=60
    );
    // Jump to t=180 — should get t=60, t=120, t=180
    const pts = store.generatePoint("svc", "error_rate", 180);
    expect(pts.map((p) => p.t)).toEqual([60, 120, 180]);
  });

  it("without overlay, generates scripted incident values via overlayApplications", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical(1) } },
      {
        svc: {
          error_rate: makeRp({
            overlayApplications: [
              {
                overlay: "spike_and_sustain",
                onsetSecond: 0,
                peakValue: 10,
                dropFactor: 10,
                ceiling: 10,
                rampDurationSeconds: 0,
                saturationDurationSeconds: 60,
              },
            ],
            baselineValue: 1,
          }),
        },
      },
    );
    const p1 = nextPoint(store, "svc", "error_rate", 60);
    expect(p1.v).toBeGreaterThan(1);
  });

  it("with active overlay, generates overlay-shaped values", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical(10) } },
      { svc: { error_rate: makeRp({ overlay: "none" }) } },
    );
    store.applyActiveOverlay(
      "svc",
      "error_rate",
      makeOverlay({
        startSimTime: 0,
        startValue: 10,
        targetValue: 1,
        pattern: "smooth_decay",
        speedSeconds: 300,
        sustained: true,
      }),
    );
    const p1 = nextPoint(store, "svc", "error_rate", 60);
    nextPoint(store, "svc", "error_rate", 120);
    nextPoint(store, "svc", "error_rate", 180);
    nextPoint(store, "svc", "error_rate", 240);
    const p5 = nextPoint(store, "svc", "error_rate", 300);
    expect(p1.v).toBeLessThan(10);
    expect(p5.v).toBeLessThan(p1.v);
  });
});

// ── applyActiveOverlay ────────────────────────────────────────────────────────

describe("MetricStore — applyActiveOverlay", () => {
  it("overlay takes effect on next generated point", () => {
    const store1 = createMetricStore(
      { svc: { error_rate: makeHistorical(1) } },
      { svc: { error_rate: makeRp({ overlay: "none" }) } },
    );
    const withoutOverlay = nextPoint(store1, "svc", "error_rate", 60);

    const store2 = createMetricStore(
      { svc: { error_rate: makeHistorical(1) } },
      { svc: { error_rate: makeRp({ overlay: "none" }) } },
    );
    store2.applyActiveOverlay(
      "svc",
      "error_rate",
      makeOverlay({
        startSimTime: 0,
        startValue: 1,
        targetValue: 10,
        pattern: "smooth_decay",
        speedSeconds: 300,
        sustained: true,
      }),
    );
    const withOverlay = nextPoint(store2, "svc", "error_rate", 60);

    expect(withOverlay.v).toBeGreaterThan(withoutOverlay.v);
  });

  it("second overlay replaces first", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical(10) } },
      { svc: { error_rate: makeRp({ overlay: "none" }) } },
    );
    store.applyActiveOverlay(
      "svc",
      "error_rate",
      makeOverlay({
        startSimTime: 0,
        startValue: 10,
        targetValue: 1,
        pattern: "smooth_decay",
        speedSeconds: 300,
        sustained: true,
      }),
    );
    nextPoint(store, "svc", "error_rate", 60);
    nextPoint(store, "svc", "error_rate", 120);
    const midVal = store.getCurrentValue("svc", "error_rate", 120)!;
    expect(midVal).toBeLessThan(10);

    store.applyActiveOverlay(
      "svc",
      "error_rate",
      makeOverlay({
        startSimTime: 120,
        startValue: midVal,
        targetValue: 10,
        pattern: "smooth_decay",
        speedSeconds: 300,
        sustained: true,
      }),
    );
    const p3 = nextPoint(store, "svc", "error_rate", 180);
    expect(p3.v).toBeGreaterThan(midVal);
  });

  it("sustained=false: reverts to scripted behavior after speedSeconds", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical(1) } },
      { svc: { error_rate: makeRp({ overlay: "none", baselineValue: 1 }) } },
    );
    store.applyActiveOverlay(
      "svc",
      "error_rate",
      makeOverlay({
        startSimTime: 0,
        startValue: 1,
        targetValue: 10,
        pattern: "cliff",
        speedSeconds: 60,
        sustained: false,
      }),
    );
    const during = nextPoint(store, "svc", "error_rate", 60);
    expect(during.v).toBeCloseTo(10, 0);

    const after = nextPoint(store, "svc", "error_rate", 120);
    expect(after.v).toBeCloseTo(1, 0);
  });

  it("no-op for unknown service", () => {
    const store = createMetricStore({}, {});
    expect(() =>
      store.applyActiveOverlay("no-svc", "error_rate", makeOverlay()),
    ).not.toThrow();
  });
});

// ── getResolvedParams ─────────────────────────────────────────────────────────

describe("MetricStore — getResolvedParams", () => {
  it("returns correct params for known metric", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical() } },
      { svc: { error_rate: makeRp({ baselineValue: 2.5 }) } },
    );
    expect(store.getResolvedParams("svc", "error_rate")?.baselineValue).toBe(
      2.5,
    );
  });

  it("returns null for unknown service", () => {
    expect(
      createMetricStore({}, {}).getResolvedParams("no-svc", "error_rate"),
    ).toBeNull();
  });
});
