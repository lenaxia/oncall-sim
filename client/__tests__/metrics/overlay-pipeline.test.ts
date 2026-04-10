/**
 * Tests for Step 4: multi-incident overlay pipeline.
 *
 * Tests the new overlayApplications[] field on ResolvedMetricParams,
 * the updated applyIncidentOverlay() signature, and the updateResolvedValue()
 * / clearScriptedOverlays() methods on MetricStore.
 */

import { describe, it, expect } from "vitest";
import { applyIncidentOverlay } from "../../src/metrics/patterns/incident-overlay";
import type { OverlayApplication } from "../../src/metrics/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeApp(
  overrides: Partial<OverlayApplication> = {},
): OverlayApplication {
  return {
    overlay: "spike_and_sustain",
    onsetSecond: 0,
    peakValue: 10.0,
    dropFactor: 10.0,
    ceiling: 10.0,
    rampDurationSeconds: 0,
    saturationDurationSeconds: 60,
    ...overrides,
  };
}

// ── applyIncidentOverlay — new signature ──────────────────────────────────────

describe("applyIncidentOverlay — new signature (baselineValue + OverlayApplication)", () => {
  it("returns unchanged series when overlay is 'none'", () => {
    const series = [1, 2, 3];
    const tAxis = [-60, -30, 0];
    const app = makeApp({ overlay: "none" });
    const result = applyIncidentOverlay(series, 1.0, app, tAxis);
    expect(result).toEqual([1, 2, 3]);
  });

  it("skips points before onsetSecond", () => {
    const series = [1, 1, 1, 1, 1]; // baseline = 1
    const tAxis = [-30, -15, 0, 15, 30];
    const app = makeApp({
      overlay: "spike_and_sustain",
      onsetSecond: 10,
      peakValue: 5,
      rampDurationSeconds: 0,
    });
    const result = applyIncidentOverlay(series, 1.0, app, tAxis);
    // t=-30,-15,0 are before onset → unchanged
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(1);
    expect(result[2]).toBe(1);
    // t=15,30 are after onset → spike applied
    expect(result[3]).toBeGreaterThan(1);
    expect(result[4]).toBeGreaterThan(1);
  });

  it("skips points at or after endSecond", () => {
    const series = [1, 1, 1, 1, 1];
    const tAxis = [0, 15, 30, 45, 60];
    const app = makeApp({
      overlay: "spike_and_sustain",
      onsetSecond: 0,
      endSecond: 30,
      peakValue: 5,
      rampDurationSeconds: 0,
    });
    const result = applyIncidentOverlay(series, 1.0, app, tAxis);
    // t=0,15 → spike applied
    expect(result[0]).toBeGreaterThan(1);
    expect(result[1]).toBeGreaterThan(1);
    // t=30,45,60 at or after endSecond → unchanged
    expect(result[2]).toBe(1);
    expect(result[3]).toBe(1);
    expect(result[4]).toBe(1);
  });

  it("spike_and_sustain: reaches peakValue after ramp", () => {
    const series = [1, 1, 1];
    const tAxis = [0, 15, 30];
    // rampDuration=0 → immediate full spike
    const app = makeApp({
      overlay: "spike_and_sustain",
      onsetSecond: 0,
      peakValue: 10,
      rampDurationSeconds: 0,
    });
    const result = applyIncidentOverlay(series, 1.0, app, tAxis);
    // all three points should get the full delta (peakValue - baseline = 9)
    expect(result[0]).toBeCloseTo(1 + (10 - 1), 5);
    expect(result[1]).toBeCloseTo(1 + (10 - 1), 5);
  });

  it("saturation: fills toward ceiling proportionally", () => {
    const series = [1, 1];
    const tAxis = [0, 60];
    const app = makeApp({
      overlay: "saturation",
      onsetSecond: 0,
      ceiling: 10,
      saturationDurationSeconds: 60,
    });
    const result = applyIncidentOverlay(series, 1.0, app, tAxis);
    // at t=0 elapsed=0 → minimal saturation
    // at t=60 elapsed=60 → full saturation (ceiling=10)
    expect(result[0]).toBeLessThan(result[1]);
    expect(result[1]).toBeCloseTo(10, 0);
  });

  it("sudden_drop: multiplies by dropFactor", () => {
    const series = [10, 10];
    const tAxis = [0, 30];
    const app = makeApp({
      overlay: "sudden_drop",
      onsetSecond: 0,
      dropFactor: 0.1,
    });
    const result = applyIncidentOverlay(series, 10.0, app, tAxis);
    expect(result[0]).toBeCloseTo(1.0, 5); // 10 × 0.1
    expect(result[1]).toBeCloseTo(1.0, 5);
  });

  it("returns independent copy — does not mutate input series", () => {
    const series = [1, 2, 3];
    const tAxis = [0, 15, 30];
    const app = makeApp({
      overlay: "spike_and_sustain",
      onsetSecond: 0,
      peakValue: 5,
      rampDurationSeconds: 0,
    });
    const original = [...series];
    applyIncidentOverlay(series, 1.0, app, tAxis);
    expect(series).toEqual(original);
  });
});

// ── overlayApplications[] in generateOneSeries ────────────────────────────────

describe("generateOneSeries — overlayApplications[]", () => {
  it("zero overlayApplications → pure baseline + rhythm + noise", async () => {
    const { generateOneSeries } = await import("../../src/metrics/series");
    const { buildLoadedScenario } = await import("../../src/testutil/index");
    const scenario = buildLoadedScenario();
    const { resolvedParams } = (
      await import("../../src/metrics/generator")
    ).generateAllMetrics(scenario, "test");
    const rp = resolvedParams["fixture-service"]["error_rate"];
    if (!rp) return;

    // Ensure no overlay
    const rpNoOverlay = { ...rp, overlayApplications: [] };
    const series = generateOneSeries(rpNoOverlay);
    // All pre-incident points should be near baseline
    const preIncident = series.filter((p) => p.t <= 0);
    expect(preIncident.length).toBeGreaterThan(0);
    const mean = preIncident.reduce((s, p) => s + p.v, 0) / preIncident.length;
    // Should be within 5× of baseline (noise can be significant)
    expect(mean).toBeLessThan(rp.baselineValue * 5 + 1);
  });

  it("single spike_and_sustain overlay raises values after onset", async () => {
    const { generateOneSeries } = await import("../../src/metrics/series");
    const { buildLoadedScenario } = await import("../../src/testutil/index");
    const scenario = buildLoadedScenario();
    const { resolvedParams } = (
      await import("../../src/metrics/generator")
    ).generateAllMetrics(scenario, "test");
    const rp = resolvedParams["fixture-service"]["error_rate"];
    if (!rp) return;

    const app: OverlayApplication = {
      overlay: "spike_and_sustain",
      onsetSecond: 0,
      peakValue: rp.baselineValue * 10,
      dropFactor: 10,
      ceiling: rp.baselineValue * 10,
      rampDurationSeconds: 0,
      saturationDurationSeconds: 60,
    };
    const rpWithOverlay = { ...rp, overlayApplications: [app] };
    const series = generateOneSeries(rpWithOverlay);

    const pre = series.filter((p) => p.t < 0);
    const post = series.filter((p) => p.t > 0);
    if (pre.length > 0 && post.length > 0) {
      const preMean = pre.reduce((s, p) => s + p.v, 0) / pre.length;
      const postMean = post.reduce((s, p) => s + p.v, 0) / post.length;
      expect(postMean).toBeGreaterThan(preMean);
    }
  });

  it("two overlayApplications compound in order", async () => {
    const { generateOneSeries } = await import("../../src/metrics/series");
    const { buildLoadedScenario } = await import("../../src/testutil/index");
    const scenario = buildLoadedScenario();
    const { resolvedParams } = (
      await import("../../src/metrics/generator")
    ).generateAllMetrics(scenario, "test");
    const rp = resolvedParams["fixture-service"]["error_rate"];
    if (!rp) return;

    const baseline = rp.baselineValue;
    const app1: OverlayApplication = {
      overlay: "spike_and_sustain",
      onsetSecond: 0,
      peakValue: baseline * 5,
      dropFactor: 5,
      ceiling: baseline * 5,
      rampDurationSeconds: 0,
      saturationDurationSeconds: 60,
    };
    const app2: OverlayApplication = {
      overlay: "spike_and_sustain",
      onsetSecond: 60,
      peakValue: baseline * 10,
      dropFactor: 10,
      ceiling: baseline * 10,
      rampDurationSeconds: 0,
      saturationDurationSeconds: 60,
    };
    const rpWith2 = { ...rp, overlayApplications: [app1, app2] };
    const rpWith1 = { ...rp, overlayApplications: [app1] };

    const seriesWith2 = generateOneSeries(rpWith2);
    const seriesWith1 = generateOneSeries(rpWith1);

    // Points after app2's onset should be higher with 2 overlays
    const after2Onset_with2 = seriesWith2.filter((p) => p.t >= 60);
    const after2Onset_with1 = seriesWith1.filter((p) => p.t >= 60);
    if (after2Onset_with2.length > 0 && after2Onset_with1.length > 0) {
      const mean2 =
        after2Onset_with2.reduce((s, p) => s + p.v, 0) /
        after2Onset_with2.length;
      const mean1 =
        after2Onset_with1.reduce((s, p) => s + p.v, 0) /
        after2Onset_with1.length;
      expect(mean2).toBeGreaterThan(mean1);
    }
  });
});

// ── MetricStore.updateResolvedValue ───────────────────────────────────────────

describe("MetricStore — updateResolvedValue", () => {
  it("updateResolvedValue updates the resolvedValue in resolvedParams", async () => {
    const { createMetricStore } =
      await import("../../src/metrics/metric-store");
    const { buildLoadedScenario } = await import("../../src/testutil/index");
    const scenario = buildLoadedScenario();
    const { series, resolvedParams } = (
      await import("../../src/metrics/generator")
    ).generateAllMetrics(scenario, "test");
    const store = createMetricStore(series, resolvedParams);

    const before = store.getResolvedParams("fixture-service", "error_rate");
    expect(before).toBeDefined();

    store.updateResolvedValue("fixture-service", "error_rate", 999);
    const after = store.getResolvedParams("fixture-service", "error_rate");
    expect(after!.resolvedValue).toBe(999);
  });

  it("updateResolvedValue on unknown metric is a no-op", async () => {
    const { createMetricStore } =
      await import("../../src/metrics/metric-store");
    const { buildLoadedScenario } = await import("../../src/testutil/index");
    const scenario = buildLoadedScenario();
    const { series, resolvedParams } = (
      await import("../../src/metrics/generator")
    ).generateAllMetrics(scenario, "test");
    const store = createMetricStore(series, resolvedParams);
    // Should not throw
    expect(() =>
      store.updateResolvedValue("unknown-svc", "error_rate", 99),
    ).not.toThrow();
  });
});

// ── MetricStore.clearScriptedOverlays ─────────────────────────────────────────

describe("MetricStore — clearScriptedOverlays", () => {
  it("removes saturation overlays from overlayApplications", async () => {
    const { createMetricStore } =
      await import("../../src/metrics/metric-store");
    const { buildLoadedScenario } = await import("../../src/testutil/index");
    const scenario = buildLoadedScenario();
    const { series, resolvedParams } = (
      await import("../../src/metrics/generator")
    ).generateAllMetrics(scenario, "test");

    // Inject a saturation overlay into resolvedParams
    const rpBefore = resolvedParams["fixture-service"]["error_rate"];
    if (!rpBefore) return;
    const satApp: OverlayApplication = {
      overlay: "saturation",
      onsetSecond: 0,
      peakValue: 10,
      dropFactor: 1,
      ceiling: 10,
      rampDurationSeconds: 30,
      saturationDurationSeconds: 60,
    };
    resolvedParams["fixture-service"]["error_rate"] = {
      ...rpBefore,
      overlayApplications: [satApp],
    };

    const store = createMetricStore(series, resolvedParams);
    const rpWithSat = store.getResolvedParams("fixture-service", "error_rate");
    expect(
      rpWithSat!.overlayApplications.some((a) => a.overlay === "saturation"),
    ).toBe(true);

    store.clearScriptedOverlays("fixture-service", "error_rate");

    const rpAfter = store.getResolvedParams("fixture-service", "error_rate");
    expect(
      rpAfter!.overlayApplications.every((a) => a.overlay !== "saturation"),
    ).toBe(true);
  });

  it("clearScriptedOverlays on unknown metric is a no-op", async () => {
    const { createMetricStore } =
      await import("../../src/metrics/metric-store");
    const { buildLoadedScenario } = await import("../../src/testutil/index");
    const scenario = buildLoadedScenario();
    const { series, resolvedParams } = (
      await import("../../src/metrics/generator")
    ).generateAllMetrics(scenario, "test");
    const store = createMetricStore(series, resolvedParams);
    expect(() =>
      store.clearScriptedOverlays("unknown-svc", "error_rate"),
    ).not.toThrow();
  });
});
