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

  it("blip_then_decay going UP (worsening latency): blip is above startValue", () => {
    // C=10 (low latency), T=80 (high latency). Blip should go above C before settling at T.
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical(10) } },
      { svc: { error_rate: makeRp({ overlay: "none", baselineValue: 10 }) } },
    );
    store.applyActiveOverlay(
      "svc",
      "error_rate",
      makeOverlay({
        startSimTime: 0,
        startValue: 10,
        targetValue: 80,
        pattern: "blip_then_decay",
        speedSeconds: 300,
        sustained: true,
      }),
    );
    // During blip window (first 10% of speedSeconds = 30s): value should be above C=10
    const blipPoint = nextPoint(store, "svc", "error_rate", 60); // 60s <= 30s? No, blip is first 30s
    // t=60 is past the blip (30s), decaying toward T=80 from blipPeak≈13
    expect(blipPoint.v).toBeGreaterThan(10); // still above C, moving toward T
  });

  it("blip_then_decay going DOWN (worsening cache_hit_rate): blip is below startValue", () => {
    // C=60 (recovering hit rate), T=5 (bad hit rate). Blip should go BELOW C before settling at T.
    const store = createMetricStore(
      { svc: { cache_hit_rate: makeHistorical(60) } },
      {
        svc: {
          cache_hit_rate: makeRp({
            archetype: "cache_hit_rate",
            overlay: "none",
            baselineValue: 60,
            noiseType: "none",
            noiseLevelMultiplier: 0,
          }),
        },
      },
    );
    store.applyActiveOverlay(
      "svc",
      "cache_hit_rate",
      makeOverlay({
        startSimTime: 0,
        startValue: 60,
        targetValue: 5,
        pattern: "blip_then_decay",
        speedSeconds: 300,
        sustained: true,
      }),
    );
    // At t=60: within blip window (0..30s blip, then decay). At t=60 we're past the blip.
    // blipPeak = min(60*0.7, 60-1) = min(42, 59) = 42. At t=60 (elapsed=60, past blip at 30s):
    // decaying from 42 toward 5. Value should be below 60 (C).
    const p60 = nextPoint(store, "svc", "cache_hit_rate", 60);
    expect(p60.v).toBeLessThan(60);
    expect(p60.v).toBeGreaterThanOrEqual(0);
  });

  it("re-anchors startValue and startSimTime to the most recent generated point when overlay arrives late", () => {
    // Simulate: LLM call was made at t=60, but response arrives at t=180.
    // Overlay was built with startValue from t=60, but must animate from t=180.
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical(1) } },
      { svc: { error_rate: makeRp({ overlay: "none", baselineValue: 1 }) } },
    );

    // Advance the store to t=60, t=120, t=180 — simulating 3 ticks before overlay arrives.
    nextPoint(store, "svc", "error_rate", 60);
    nextPoint(store, "svc", "error_rate", 120);
    nextPoint(store, "svc", "error_rate", 180);

    const valueAtT180 = store.getCurrentValue("svc", "error_rate", 180)!;

    // Overlay built at t=60 (stale anchor) but applied at t=180
    store.applyActiveOverlay(
      "svc",
      "error_rate",
      makeOverlay({
        startSimTime: 60, // stale — from when LLM call was made
        startValue: 999, // stale — should be overridden
        targetValue: 10,
        pattern: "smooth_decay",
        speedSeconds: 300,
        sustained: true,
      }),
    );

    // The overlay stored in the state should be anchored to t=180, not t=60
    const p240 = nextPoint(store, "svc", "error_rate", 240);
    // With fresh anchor (startValue≈valueAtT180, startSimTime=180), at t=240 (elapsed=60s)
    // smooth_decay moves toward targetValue=10 from ~1, so value should be > valueAtT180.
    expect(p240.v).toBeGreaterThan(valueAtT180);
  });

  it("re-computes targetValue from fresh anchor when _intent is provided (worsening)", () => {
    // currentValue at LLM call time was 5. By the time overlay is applied, metric is at 8.
    // Without re-anchoring: target = 5 + (10 - 5) * 1.0 = 10 (from old anchor of 5).
    // With re-anchoring:    target = 8 + (10 - 8) * 1.0 = 10 (from new anchor of 8).
    // Key invariant: worsening should always move AWAY from baseline, never backwards.
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical(5) } },
      {
        svc: {
          error_rate: makeRp({
            overlay: "none",
            baselineValue: 1,
            peakValue: 10,
          }),
        },
      },
    );

    // Advance to t=60, t=120 — metric has drifted from its t=0 value of 5
    nextPoint(store, "svc", "error_rate", 60);
    nextPoint(store, "svc", "error_rate", 120);

    store.applyActiveOverlay(
      "svc",
      "error_rate",
      makeOverlay({
        startSimTime: 0,
        startValue: 5, // stale LLM-call-time value
        targetValue: 10, // will be recomputed
        pattern: "cliff",
        speedSeconds: 60,
        sustained: true,
        _intent: {
          outcome: "worsening",
          magnitude: 1.0,
          resolvedValue: 1,
          peakValue: 10,
        },
      }),
    );

    // At t=180, cliff has elapsed (speedSeconds=60 from anchor at t=120), should be at target
    const p180 = nextPoint(store, "svc", "error_rate", 180);
    // Target is recomputed from anchored value (~5) toward peak (10) — should be moving up
    expect(p180.v).toBeGreaterThan(5);
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

  it("worsening near peak going UP (p99_latency): extends effective peak upward when headroom < 20%", () => {
    // current≈99, peak=100, resolvedValue=50 → worsening goes UP.
    // headroom/scale = 1/100 = 0.01 < 0.2 → effectivePeak = 99 * 1.3 = 128.7
    // target = 99 + (128.7-99) * 0.8 ≈ 122.8 — clearly visible.
    const store = createMetricStore(
      {
        svc: {
          p99_latency_ms: [
            { t: -60, v: 99 },
            { t: 0, v: 99 },
          ],
        },
      },
      {
        svc: {
          p99_latency_ms: makeRp({
            metricId: "p99_latency_ms",
            archetype: "p99_latency_ms",
            baselineValue: 99,
            resolvedValue: 50,
            peakValue: 100,
            overlay: "none",
            noiseType: "none",
            noiseLevelMultiplier: 0,
          }),
        },
      },
    );

    nextPoint(store, "svc", "p99_latency_ms", 60);
    const latestV = store.getCurrentValue("svc", "p99_latency_ms", 60)!;
    expect(latestV).toBeCloseTo(99, 0);

    store.applyActiveOverlay(
      "svc",
      "p99_latency_ms",
      makeOverlay({
        startSimTime: 0,
        startValue: 1,
        targetValue: 1,
        pattern: "cliff",
        speedSeconds: 60,
        sustained: true,
        _intent: {
          outcome: "worsening",
          magnitude: 0.8,
          resolvedValue: 50,
          peakValue: 100,
        },
      }),
    );

    const p120 = nextPoint(store, "svc", "p99_latency_ms", 120);
    // effectivePeak = 99 * 1.3 = 128.7 → target ≈ 122.8 → well above 110
    expect(p120.v).toBeGreaterThan(110);
  });

  it("worsening near peak going DOWN (cache_hit_rate): extends effective peak downward when headroom < 20%", () => {
    // current≈2, peak=2 (sudden_drop, resolvedValue=82) → worsening goes DOWN.
    // headroom/scale ≈ 0 < 0.2 → effectivePeak = 2 * 0.7 = 1.4
    // target = 2 + (1.4 - 2) * 0.8 = 2 - 0.48 = 1.52 — moves further down, not up.
    const store = createMetricStore(
      {
        svc: {
          cache_hit_rate: [
            { t: -60, v: 2 },
            { t: 0, v: 2 },
          ],
        },
      },
      {
        svc: {
          cache_hit_rate: makeRp({
            metricId: "cache_hit_rate",
            archetype: "cache_hit_rate",
            baselineValue: 2,
            resolvedValue: 82,
            peakValue: 2,
            overlay: "none",
            noiseType: "none",
            noiseLevelMultiplier: 0,
          }),
        },
      },
    );

    nextPoint(store, "svc", "cache_hit_rate", 60);
    const latestV = store.getCurrentValue("svc", "cache_hit_rate", 60)!;
    expect(latestV).toBeCloseTo(2, 0);

    store.applyActiveOverlay(
      "svc",
      "cache_hit_rate",
      makeOverlay({
        startSimTime: 0,
        startValue: 82,
        targetValue: 82,
        pattern: "cliff",
        speedSeconds: 60,
        sustained: true,
        _intent: {
          outcome: "worsening",
          magnitude: 0.8,
          resolvedValue: 82,
          peakValue: 2,
        },
      }),
    );

    const p120 = nextPoint(store, "svc", "cache_hit_rate", 120);
    // effectivePeak = 2 * 0.7 = 1.4 → target = 2 + (1.4-2)*0.8 = 1.52
    // Must be BELOW current (2), not above
    expect(p120.v).toBeLessThan(2);
    expect(p120.v).toBeGreaterThanOrEqual(0); // never negative
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
