/**
 * Tests for per-minute metric ticking and history downsampling.
 *
 * Requirements:
 * 1. One data point per in-game minute, always.
 *    Real-time tick interval = 60s / speed:
 *      1x → 60s real, 2x → 30s real, 5x → 12s real, 10x → 6s real
 * 2. resolutionSeconds = 60 — all series use 1-minute resolution.
 * 3. generatePoint emits only when the sim clock crosses a new 60s boundary.
 *    Multiple boundaries per tick (possible at high speed with variable timing)
 *    all get emitted in one call.
 * 4. setSpeed recreates the tick interval so cadence adjusts immediately.
 * 5. Pre-incident history is downsampled for rendering:
 *    - t ∈ [-6h, 0]: 1-minute resolution (kept as-is)
 *    - t < -6h: downsampled to 5-minute resolution
 *    - t > 0: always full resolution
 */

import { describe, it, expect } from "vitest";
import { createMetricStore } from "../../src/metrics/metric-store";
import {
  downsampleSeries,
  prepareChartSeries,
} from "../../src/metrics/downsample";
import type { TimeSeriesPoint } from "@shared/types/events";
import type { ResolvedMetricParams } from "../../src/metrics/types";

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
    fromSecond: -7200, // 2 hours pre-incident history
    toSecond: 3600,
    resolutionSeconds: 60, // 1 minute
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
    dropFactor: 1.0,
    ceiling: 10.0,
    saturationDurationSeconds: 60,
    rampDurationSeconds: 30,
    seriesOverride: null,
    seed: 42,
    ...overrides,
  };
}

function makeHistorical(resolutionSeconds = 60): TimeSeriesPoint[] {
  // Pre-incident data: t = -7200 to 0, one point per resolutionSeconds
  const pts: TimeSeriesPoint[] = [];
  for (let t = -7200; t <= 0; t += resolutionSeconds) {
    pts.push({ t, v: 1.0 });
  }
  return pts;
}

// ── resolutionSeconds = 60 ────────────────────────────────────────────────────

describe("per-minute resolution — generatePoint emits on 60-second boundaries", () => {
  it("at simTime=30 (no minute boundary crossed) — no new point", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical() } },
      { svc: { error_rate: makeRp() } },
    );
    // Initial last point is at t=0. simTime=30 hasn't crossed t=60.
    const pts = store.generatePoint("svc", "error_rate", 30);
    expect(pts).toHaveLength(0);
  });

  it("at simTime=60 — exactly one new point at t=60", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical() } },
      { svc: { error_rate: makeRp() } },
    );
    const pts = store.generatePoint("svc", "error_rate", 60);
    expect(pts).toHaveLength(1);
    expect(pts[0].t).toBe(60);
  });

  it("at simTime=61 — one new point at t=60 (last full minute boundary)", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical() } },
      { svc: { error_rate: makeRp() } },
    );
    const pts = store.generatePoint("svc", "error_rate", 61);
    expect(pts).toHaveLength(1);
    expect(pts[0].t).toBe(60);
  });

  it("at simTime=150 — two new points at t=60 and t=120", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical() } },
      { svc: { error_rate: makeRp() } },
    );
    const pts = store.generatePoint("svc", "error_rate", 150);
    expect(pts).toHaveLength(2);
    expect(pts[0].t).toBe(60);
    expect(pts[1].t).toBe(120);
  });

  it("sequential calls do not re-emit already-generated points", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical() } },
      { svc: { error_rate: makeRp() } },
    );
    const first = store.generatePoint("svc", "error_rate", 60);
    expect(first).toHaveLength(1);
    expect(first[0].t).toBe(60);

    // Second call at same simTime — no new boundaries
    const second = store.generatePoint("svc", "error_rate", 60);
    expect(second).toHaveLength(0);

    // Advance to t=120
    const third = store.generatePoint("svc", "error_rate", 120);
    expect(third).toHaveLength(1);
    expect(third[0].t).toBe(120);
  });

  it("at 10x speed: simTime jumps 150s per tick — all 2 minute boundaries emitted", () => {
    // Simulates one tick at 10x: clock goes from 0 → 150
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical() } },
      { svc: { error_rate: makeRp() } },
    );
    const pts = store.generatePoint("svc", "error_rate", 150);
    // t=60 and t=120 both within [0, 150]
    expect(pts).toHaveLength(2);
    const times = pts.map((p) => p.t);
    expect(times).toContain(60);
    expect(times).toContain(120);
  });

  it("at 2x speed: simTime advances 30s per tick — point at t=60 only when tick crosses it", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical() } },
      { svc: { error_rate: makeRp() } },
    );
    // tick 1: simTime = 30 → no boundary
    expect(store.generatePoint("svc", "error_rate", 30)).toHaveLength(0);
    // tick 2: simTime = 60 → boundary at 60
    const pts = store.generatePoint("svc", "error_rate", 60);
    expect(pts).toHaveLength(1);
    expect(pts[0].t).toBe(60);
  });

  it("getAllSeries includes all generated points in order", () => {
    const store = createMetricStore(
      { svc: { error_rate: makeHistorical() } },
      { svc: { error_rate: makeRp() } },
    );
    store.generatePoint("svc", "error_rate", 60);
    store.generatePoint("svc", "error_rate", 120);
    store.generatePoint("svc", "error_rate", 180);
    const all = store.getAllSeries();
    const times = all["svc"]["error_rate"].map((p) => p.t);
    expect(times).toContain(60);
    expect(times).toContain(120);
    expect(times).toContain(180);
    // Points must be sorted
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
  });
});

// ── resolver produces resolutionSeconds = 60 ─────────────────────────────────

describe("resolver — resolutionSeconds is always 60", () => {
  it("resolved params have resolutionSeconds = 60 regardless of scenario config", async () => {
    const { buildLoadedScenario } = await import("../../src/testutil/index");
    const { generateAllMetrics } = await import("../../src/metrics/generator");
    const scenario = buildLoadedScenario();
    const { resolvedParams } = generateAllMetrics(scenario, "s");
    for (const svcParams of Object.values(resolvedParams)) {
      for (const rp of Object.values(svcParams)) {
        expect(rp.resolutionSeconds).toBe(60);
      }
    }
  });

  it("historical series has 1-minute resolution (one point per 60s)", async () => {
    const { buildLoadedScenario } = await import("../../src/testutil/index");
    const { generateAllMetrics } = await import("../../src/metrics/generator");
    const scenario = buildLoadedScenario();
    const { series } = generateAllMetrics(scenario, "s");
    const focalSeries = series["fixture-service"];
    for (const pts of Object.values(focalSeries)) {
      if (pts.length < 2) continue;
      // All adjacent points should be 60s apart
      for (let i = 1; i < pts.length; i++) {
        expect(pts[i].t - pts[i - 1].t).toBe(60);
      }
    }
  });
});

// ── downsampleSeries ──────────────────────────────────────────────────────────

describe("downsampleSeries", () => {
  function makeSeries(
    fromSec: number,
    toSec: number,
    step: number,
  ): TimeSeriesPoint[] {
    const pts: TimeSeriesPoint[] = [];
    for (let t = fromSec; t <= toSec; t += step) {
      pts.push({ t, v: Math.random() });
    }
    return pts;
  }

  it("returns empty for empty input", () => {
    expect(downsampleSeries([], 300)).toEqual([]);
  });

  it("returns all points unchanged when all are within target resolution", () => {
    // 5-minute resolution input, 5-minute target — no reduction
    const pts = makeSeries(-3600, 0, 300);
    const result = downsampleSeries(pts, 300);
    expect(result).toHaveLength(pts.length);
  });

  it("reduces 1-minute series to 5-minute resolution by keeping every 5th point", () => {
    // 60s resolution over 1 hour = 61 points
    const pts = makeSeries(-3600, 0, 60);
    const result = downsampleSeries(pts, 300);
    // Should have ~13 points (every 5 minutes)
    expect(result.length).toBeLessThan(pts.length);
    expect(result.length).toBeGreaterThan(0);
    // All result timestamps should be multiples of 300
    for (const p of result) {
      expect(Math.abs(p.t % 300)).toBe(0);
    }
  });

  it("preserves t=0 when it is a multiple of target resolution", () => {
    const pts = makeSeries(-3600, 0, 60);
    const result = downsampleSeries(pts, 300);
    const hasZero = result.some((p) => p.t === 0);
    expect(hasZero).toBe(true);
  });

  it("result points are in ascending time order", () => {
    const pts = makeSeries(-7200, 0, 60);
    const result = downsampleSeries(pts, 300);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].t).toBeGreaterThan(result[i - 1].t);
    }
  });
});

// ── prepareChartSeries ────────────────────────────────────────────────────────

describe("prepareChartSeries — downsamples history beyond 6h", () => {
  it("keeps recent 6h at 1-minute resolution, downsamples older to 5-minute", () => {
    // Build a 24h series at 1-minute resolution: t = -86400 to 0
    const pts: TimeSeriesPoint[] = [];
    for (let t = -86400; t <= 0; t += 60) {
      pts.push({ t, v: 1.0 });
    }

    const result = prepareChartSeries(pts);

    // Points from t >= -21600 (6h ago) should all be kept (1min resolution)
    const recentPts = result.filter((p) => p.t >= -21600);
    const recentInput = pts.filter((p) => p.t >= -21600);
    expect(recentPts.length).toBe(recentInput.length);

    // Points from t < -21600 should be reduced (5min resolution)
    const oldPts = result.filter((p) => p.t < -21600);
    const oldInput = pts.filter((p) => p.t < -21600);
    expect(oldPts.length).toBeLessThan(oldInput.length);

    // Old points should all be at 5-minute boundaries
    for (const p of oldPts) {
      expect(Math.abs(p.t % 300)).toBe(0);
    }
  });

  it("series shorter than 6h is returned unchanged", () => {
    const pts: TimeSeriesPoint[] = [];
    for (let t = -3600; t <= 0; t += 60) {
      pts.push({ t, v: 1.0 });
    }
    const result = prepareChartSeries(pts);
    expect(result.length).toBe(pts.length);
  });

  it("live points (t > 0) are always kept at full resolution", () => {
    const pts: TimeSeriesPoint[] = [];
    for (let t = -86400; t <= 300; t += 60) {
      pts.push({ t, v: 1.0 });
    }
    const result = prepareChartSeries(pts);
    const livePts = result.filter((p) => p.t > 0);
    const liveInput = pts.filter((p) => p.t > 0);
    expect(livePts.length).toBe(liveInput.length);
  });

  it("result is in ascending time order", () => {
    const pts: TimeSeriesPoint[] = [];
    for (let t = -86400; t <= 0; t += 60) pts.push({ t, v: 1.0 });
    const result = prepareChartSeries(pts);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].t).toBeGreaterThan(result[i - 1].t);
    }
  });

  it("empty input returns empty output", () => {
    expect(prepareChartSeries([])).toEqual([]);
  });
});
