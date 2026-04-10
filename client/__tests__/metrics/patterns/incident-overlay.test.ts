import { describe, it, expect } from "vitest";
import {
  applyIncidentOverlay,
  clampSeries,
} from "../../../src/metrics/patterns/incident-overlay";
import type { OverlayApplication } from "../../../src/metrics/types";

function makeApp(
  overrides: Partial<OverlayApplication> = {},
): OverlayApplication {
  return {
    overlay: "spike_and_sustain",
    onsetSecond: 0,
    peakValue: 10.0,
    dropFactor: 10.0,
    ceiling: 10.0,
    rampDurationSeconds: 30,
    saturationDurationSeconds: 60,
    ...overrides,
  };
}

function makeSeries(tAxis: number[], value = 1.0) {
  return tAxis.map(() => value);
}

describe("applyIncidentOverlay — none", () => {
  it("returns series unchanged", () => {
    const tAxis = [-30, -15, 0, 15, 30];
    const series = makeSeries(tAxis, 1.0);
    const app = makeApp({ overlay: "none" });
    const result = applyIncidentOverlay(series, 1.0, app, tAxis);
    expect(result).toEqual(series);
  });
});

describe("applyIncidentOverlay — spike_and_sustain", () => {
  const tAxis = [-30, -15, 0, 15, 30, 45, 60];
  const series = makeSeries(tAxis, 1.0);
  const app = makeApp({
    overlay: "spike_and_sustain",
    onsetSecond: 0,
    peakValue: 10.0,
    rampDurationSeconds: 30,
  });
  const result = applyIncidentOverlay(series, 1.0, app, tAxis);

  it("values before onsetSecond are unchanged", () => {
    const preOnset = tAxis.filter((t) => t < 0);
    preOnset.forEach((t) => {
      const idx = tAxis.indexOf(t);
      expect(result[idx]).toBeCloseTo(series[idx], 5);
    });
  });

  it("values strictly after onset are elevated toward peakValue", () => {
    const postOnsetStrict = tAxis.filter((t) => t > 0);
    postOnsetStrict.forEach((t) => {
      const idx = tAxis.indexOf(t);
      expect(result[idx]).toBeGreaterThan(series[idx]);
    });
  });

  it("reaches peak after ramp duration", () => {
    const atRampEnd = tAxis.indexOf(30); // t=30 = onset + rampDuration
    expect(result[atRampEnd]).toBeCloseTo(1.0 + (10.0 - 1.0) * 1.0, 1);
  });

  it("noise is preserved through incident window (values not all identical post-onset)", () => {
    const noisySeries = tAxis.map((_, i) => 1.0 + (i % 3) * 0.1);
    const noisyResult = applyIncidentOverlay(noisySeries, 1.0, app, tAxis);
    const postOnset = tAxis
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t > 0)
      .map(({ i }) => i);
    const postValues = postOnset.map((i) => noisyResult[i]);
    const allSame = postValues.every((v) => v === postValues[0]);
    expect(allSame).toBe(false);
  });

  it("does not mutate input series", () => {
    const original = [...series];
    applyIncidentOverlay(series, 1.0, app, tAxis);
    expect(series).toEqual(original);
  });
});

describe("applyIncidentOverlay — endSecond", () => {
  it("points at or after endSecond are returned unchanged", () => {
    const tAxis = [0, 15, 30, 45, 60];
    const series = makeSeries(tAxis, 1.0);
    const app = makeApp({
      overlay: "spike_and_sustain",
      onsetSecond: 0,
      endSecond: 30,
      peakValue: 10.0,
      rampDurationSeconds: 0,
    });
    const result = applyIncidentOverlay(series, 1.0, app, tAxis);
    // t=0, t=15 → elevated
    expect(result[0]).toBeGreaterThan(1.0);
    expect(result[1]).toBeGreaterThan(1.0);
    // t=30, t=45, t=60 → unchanged
    expect(result[2]).toBe(1.0);
    expect(result[3]).toBe(1.0);
    expect(result[4]).toBe(1.0);
  });
});

describe("applyIncidentOverlay — sudden_drop", () => {
  const tAxis = [-30, -15, 0, 15, 30];
  const series = makeSeries(tAxis, 100.0);
  const app = makeApp({
    overlay: "sudden_drop",
    onsetSecond: 0,
    dropFactor: 0.5,
  });
  const result = applyIncidentOverlay(series, 100.0, app, tAxis);

  it("values before onsetSecond unchanged", () => {
    expect(result[0]).toBeCloseTo(100.0, 5);
    expect(result[1]).toBeCloseTo(100.0, 5);
  });

  it("values at and after onsetSecond reduced by dropFactor", () => {
    [2, 3, 4].forEach((idx) => {
      expect(result[idx]).toBeCloseTo(100.0 * 0.5, 1);
    });
  });
});

describe("applyIncidentOverlay — saturation", () => {
  const tAxis = [0, 15, 30, 45, 60, 75, 90];
  const series = makeSeries(tAxis, 5.0);
  const app = makeApp({
    overlay: "saturation",
    onsetSecond: 0,
    ceiling: 18.0,
    saturationDurationSeconds: 60,
  });
  const result = applyIncidentOverlay(series, 5.0, app, tAxis);

  it("values climb toward ceiling over saturation_duration_seconds", () => {
    expect(result[0]).toBeCloseTo(5.0, 0);
    expect(result[4]).toBeGreaterThan(result[0]);
    expect(result[4]).toBeLessThanOrEqual(18.0 + 0.01);
  });

  it("does not exceed ceiling after saturation", () => {
    result.forEach((v) => expect(v).toBeLessThanOrEqual(18.0 + 0.1));
  });
});

describe("applyIncidentOverlay — gradual_degradation", () => {
  const tAxis = [-60, -30, 0, 60, 120, 180, 240, 300];
  const series = makeSeries(tAxis, 50.0);
  const app = makeApp({
    overlay: "gradual_degradation",
    onsetSecond: 0,
    peakValue: 350.0,
  });
  const result = applyIncidentOverlay(series, 50.0, app, tAxis);

  it("values before onsetSecond unchanged", () => {
    expect(result[0]).toBeCloseTo(50.0, 5);
    expect(result[1]).toBeCloseTo(50.0, 5);
  });

  it("values climb linearly from onsetSecond toward end of scenario", () => {
    const postIdx = tAxis
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t >= 0)
      .map(({ i }) => i);
    for (let k = 1; k < postIdx.length; k++) {
      expect(result[postIdx[k]]).toBeGreaterThanOrEqual(result[postIdx[k - 1]]);
    }
  });

  it("onset at negative second starts climb before t=0", () => {
    const appNeg = makeApp({
      overlay: "gradual_degradation",
      onsetSecond: -60,
      peakValue: 350.0,
    });
    const resultNeg = applyIncidentOverlay(series, 50.0, appNeg, tAxis);
    const idx = tAxis.indexOf(-30);
    expect(resultNeg[idx]).toBeGreaterThan(50.0);
  });
});

describe("clampSeries", () => {
  it("no values below minValue", () => {
    const series = [-5, 0, 5, 10, 15];
    const clamped = clampSeries(series, 0, 100);
    clamped.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
  });

  it("no values above maxValue", () => {
    const series = [90, 95, 100, 105, 110];
    const clamped = clampSeries(series, 0, 100);
    clamped.forEach((v) => expect(v).toBeLessThanOrEqual(100));
  });

  it("values within range are unchanged", () => {
    const series = [20, 50, 75];
    const clamped = clampSeries(series, 0, 100);
    expect(clamped).toEqual(series);
  });
});
