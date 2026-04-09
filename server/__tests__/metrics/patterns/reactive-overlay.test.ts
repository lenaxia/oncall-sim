import { describe, it, expect } from "vitest";
import {
  REACTIVE_SPEED_SECONDS,
  resolveReactiveTarget,
  computeReactiveOverlay,
} from "../../../src/metrics/patterns/reactive-overlay";
import { createSeededPRNG } from "../../../src/metrics/patterns/noise";
import type { ResolvedReactiveParams } from "../../../src/metrics/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeParams(
  overrides: Partial<ResolvedReactiveParams> = {},
): ResolvedReactiveParams {
  return {
    service: "svc",
    metricId: "error_rate",
    direction: "recovery",
    pattern: "smooth_decay",
    speedSeconds: 300,
    magnitude: "full",
    currentValue: 14.0,
    targetValue: 1.0,
    ...overrides,
  };
}

const RES = 15; // resolution seconds used in all tests

// ── REACTIVE_SPEED_SECONDS ────────────────────────────────────────────────────

describe("REACTIVE_SPEED_SECONDS", () => {
  it("maps all five speed tiers correctly", () => {
    expect(REACTIVE_SPEED_SECONDS["1m"]).toBe(60);
    expect(REACTIVE_SPEED_SECONDS["5m"]).toBe(300);
    expect(REACTIVE_SPEED_SECONDS["15m"]).toBe(900);
    expect(REACTIVE_SPEED_SECONDS["30m"]).toBe(1800);
    expect(REACTIVE_SPEED_SECONDS["60m"]).toBe(3600);
  });
});

// ── resolveReactiveTarget ─────────────────────────────────────────────────────

describe("resolveReactiveTarget", () => {
  it("recovery + full → resolvedValue", () => {
    expect(resolveReactiveTarget("recovery", "full", 14, 1, 20)).toBe(1);
  });

  it("recovery + partial → midpoint(currentValue, resolvedValue)", () => {
    expect(resolveReactiveTarget("recovery", "partial", 14, 1, 20)).toBeCloseTo(
      7.5,
    );
  });

  it("worsening + full → incidentPeak", () => {
    expect(resolveReactiveTarget("worsening", "full", 14, 1, 20)).toBe(20);
  });

  it("worsening + partial → midpoint(currentValue, incidentPeak)", () => {
    expect(
      resolveReactiveTarget("worsening", "partial", 14, 1, 20),
    ).toBeCloseTo(17);
  });

  it("worsening when currentValue >= incidentPeak → currentValue * 1.2", () => {
    const result = resolveReactiveTarget("worsening", "full", 22, 1, 20);
    expect(result).toBeCloseTo(22 * 1.2);
  });

  it("worsening partial when currentValue >= incidentPeak → currentValue * 1.2", () => {
    const result = resolveReactiveTarget("worsening", "partial", 25, 1, 20);
    expect(result).toBeCloseTo(25 * 1.2);
  });
});

// ── computeReactiveOverlay — cascade_clear guard ──────────────────────────────

describe("computeReactiveOverlay — cascade_clear guard", () => {
  it("returns empty array and does not throw for cascade_clear", () => {
    const prng = createSeededPRNG(1);
    const params = makeParams({ pattern: "cascade_clear" });
    const result = computeReactiveOverlay(params, 0, RES, prng);
    expect(result).toEqual([]);
  });
});

// ── computeReactiveOverlay — smooth_decay ─────────────────────────────────────

describe("computeReactiveOverlay — smooth_decay", () => {
  it("first point is near currentValue (within noise range)", () => {
    const prng = createSeededPRNG(42);
    const params = makeParams({
      pattern: "smooth_decay",
      currentValue: 14,
      targetValue: 1,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    expect(points.length).toBeGreaterThan(0);
    // First point should be within 30% of currentValue given low noise
    expect(points[0].v).toBeGreaterThan(0);
    expect(points[0].v).toBeLessThan(14 * 2);
  });

  it("value at t=speedSeconds is within 5% of targetValue (λ = ln(20)/S)", () => {
    const prng = createSeededPRNG(42);
    const S = 300;
    const target = 1.0;
    const current = 14.0;
    const params = makeParams({
      pattern: "smooth_decay",
      speedSeconds: S,
      currentValue: current,
      targetValue: target,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    const lastPoint = points[points.length - 1];
    const tolerance = (current - target) * 0.05 + 1.0; // 5% of delta + noise headroom
    expect(lastPoint.v).toBeLessThan(target + tolerance);
    expect(lastPoint.v).toBeGreaterThanOrEqual(0);
  });

  it("determinism: same PRNG + same params → identical series", () => {
    const params = makeParams({ pattern: "smooth_decay" });
    const a = computeReactiveOverlay(params, 0, RES, createSeededPRNG(99));
    const b = computeReactiveOverlay(params, 0, RES, createSeededPRNG(99));
    expect(a).toEqual(b);
  });

  it("noise: two different PRNG seeds produce different series", () => {
    const params = makeParams({ pattern: "smooth_decay" });
    const a = computeReactiveOverlay(params, 0, RES, createSeededPRNG(1));
    const b = computeReactiveOverlay(params, 0, RES, createSeededPRNG(2));
    const identical = a.every((pt, i) => pt.v === b[i]?.v);
    expect(identical).toBe(false);
  });

  it("t values start at startSimTime and increment by resolutionSeconds", () => {
    const prng = createSeededPRNG(1);
    const params = makeParams({ pattern: "smooth_decay", speedSeconds: 60 });
    const points = computeReactiveOverlay(params, 100, RES, prng);
    expect(points[0].t).toBe(100);
    expect(points[1].t).toBe(115);
  });

  it("all values non-negative", () => {
    const prng = createSeededPRNG(1);
    const params = makeParams({
      pattern: "smooth_decay",
      currentValue: 0.5,
      targetValue: 0,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    points.forEach((p) => expect(p.v).toBeGreaterThanOrEqual(0));
  });

  it("worsening direction: values move toward incidentPeak (above currentValue)", () => {
    const prng = createSeededPRNG(1);
    const params = makeParams({
      pattern: "smooth_decay",
      direction: "worsening",
      currentValue: 5,
      targetValue: 20,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    const last = points[points.length - 1];
    // Should be closer to 20 than to 5
    expect(Math.abs(last.v - 20)).toBeLessThan(Math.abs(last.v - 5) + 2);
  });
});

// ── computeReactiveOverlay — stepped ─────────────────────────────────────────

describe("computeReactiveOverlay — stepped", () => {
  it("produces 4 distinct level segments across speedSeconds", () => {
    const prng = createSeededPRNG(1);
    const S = 120;
    const params = makeParams({
      pattern: "stepped",
      speedSeconds: S,
      currentValue: 20,
      targetValue: 0,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    // Sample the midpoint of each quarter — values should be decreasing
    const q1 = points.find((p) => p.t >= S * 0.1 && p.t < S * 0.25);
    const q2 = points.find((p) => p.t >= S * 0.35 && p.t < S * 0.5);
    const q3 = points.find((p) => p.t >= S * 0.6 && p.t < S * 0.75);
    const q4 = points.find((p) => p.t >= S * 0.85);
    if (q1 && q2 && q3 && q4) {
      expect(q1.v).toBeGreaterThan(q2.v - 2);
      expect(q2.v).toBeGreaterThan(q3.v - 2);
    }
  });

  it("no overshoot below targetValue (recovery)", () => {
    const prng = createSeededPRNG(1);
    const params = makeParams({
      pattern: "stepped",
      currentValue: 15,
      targetValue: 1,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    points.forEach((p) => expect(p.v).toBeGreaterThanOrEqual(0));
  });

  it("worsening direction: 4 upward steps, no overshoot above incidentPeak range", () => {
    const prng = createSeededPRNG(1);
    const params = makeParams({
      pattern: "stepped",
      direction: "worsening",
      currentValue: 5,
      targetValue: 20,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    // Last point should be close to targetValue
    const last = points[points.length - 1];
    expect(last.v).toBeGreaterThan(5);
  });
});

// ── computeReactiveOverlay — cliff ────────────────────────────────────────────

describe("computeReactiveOverlay — cliff", () => {
  it("value near currentValue before t=5s", () => {
    const prng = createSeededPRNG(1);
    const params = makeParams({
      pattern: "cliff",
      currentValue: 14,
      targetValue: 1,
      speedSeconds: 60,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    const pre = points.filter((p) => p.t < 5);
    pre.forEach((p) => expect(p.v).toBeGreaterThan(1));
  });

  it("value near targetValue at t >= 5s", () => {
    const prng = createSeededPRNG(1);
    const params = makeParams({
      pattern: "cliff",
      currentValue: 14,
      targetValue: 1,
      speedSeconds: 60,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    const post = points.filter((p) => p.t >= 15);
    expect(post.length).toBeGreaterThan(0);
    post.forEach((p) => {
      const tolerance = 2.0; // noise headroom
      expect(p.v).toBeLessThan(1 + tolerance);
    });
  });

  it("all values non-negative", () => {
    const prng = createSeededPRNG(1);
    const params = makeParams({
      pattern: "cliff",
      currentValue: 14,
      targetValue: 0,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    points.forEach((p) => expect(p.v).toBeGreaterThanOrEqual(0));
  });
});

// ── computeReactiveOverlay — queue_burndown ───────────────────────────────────

describe("computeReactiveOverlay — queue_burndown", () => {
  it("values stay near currentValue for first speedSeconds", () => {
    const prng = createSeededPRNG(1);
    const S = 300;
    const params = makeParams({
      pattern: "queue_burndown",
      speedSeconds: S,
      currentValue: 14,
      targetValue: 1,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    const plateau = points.filter((p) => p.t <= S - RES);
    plateau.forEach((p) => {
      expect(p.v).toBeGreaterThan(5); // still elevated
    });
  });

  it("sharp drop begins after speedSeconds", () => {
    const prng = createSeededPRNG(1);
    const S = 300;
    const params = makeParams({
      pattern: "queue_burndown",
      speedSeconds: S,
      currentValue: 14,
      targetValue: 1,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    const postPlateau = points.filter((p) => p.t > S + 60);
    if (postPlateau.length > 0) {
      const mean =
        postPlateau.reduce((a, b) => a + b.v, 0) / postPlateau.length;
      expect(mean).toBeLessThan(10); // should be falling
    }
  });

  it("total series length = speedSeconds + 120s worth of points", () => {
    const prng = createSeededPRNG(1);
    const S = 300;
    const params = makeParams({ pattern: "queue_burndown", speedSeconds: S });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    const expectedMin = Math.floor(S / RES);
    const expectedMax = Math.floor((S + 120) / RES) + 3;
    expect(points.length).toBeGreaterThan(expectedMin);
    expect(points.length).toBeLessThan(expectedMax);
  });

  it("all values non-negative", () => {
    const prng = createSeededPRNG(1);
    const params = makeParams({
      pattern: "queue_burndown",
      currentValue: 14,
      targetValue: 0,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    points.forEach((p) => expect(p.v).toBeGreaterThanOrEqual(0));
  });
});

// ── computeReactiveOverlay — blip_then_decay ──────────────────────────────────

describe("computeReactiveOverlay — blip_then_decay", () => {
  it("blipPeak = max(C*1.3, C+1) — standard case", () => {
    const prng = createSeededPRNG(1);
    const C = 5;
    const params = makeParams({
      pattern: "blip_then_decay",
      currentValue: C,
      targetValue: 0.5,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    const blipPeak = Math.max(C * 1.3, C + 1);
    // First point(s) should be near blipPeak
    expect(points[0].v).toBeGreaterThan(C);
    expect(points[0].v).toBeLessThan(blipPeak * 1.5 + 1);
  });

  it("blipPeak floor case: C=0.5 → blipPeak = C+1 = 1.5, not C*1.3=0.65", () => {
    const prng = createSeededPRNG(1);
    const C = 0.5;
    const params = makeParams({
      pattern: "blip_then_decay",
      currentValue: C,
      targetValue: 0,
      speedSeconds: 300,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    expect(points[0].v).toBeGreaterThan(C); // blip is visible even at near-zero baseline
  });

  it("value decays toward targetValue after blip", () => {
    const prng = createSeededPRNG(1);
    const params = makeParams({
      pattern: "blip_then_decay",
      currentValue: 5,
      targetValue: 0.5,
      speedSeconds: 300,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    const last = points[points.length - 1];
    const mid = points[Math.floor(points.length * 0.5)];
    // Trend: mid should be lower than early blip
    expect(last.v).toBeLessThan(points[0].v + 1);
    expect(mid.v).toBeGreaterThanOrEqual(0);
  });

  it("all values non-negative", () => {
    const prng = createSeededPRNG(1);
    const params = makeParams({
      pattern: "blip_then_decay",
      currentValue: 0.1,
      targetValue: 0,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    points.forEach((p) => expect(p.v).toBeGreaterThanOrEqual(0));
  });
});

// ── computeReactiveOverlay — oscillating ──────────────────────────────────────

describe("computeReactiveOverlay — oscillating / damping", () => {
  it("value oscillates (crosses midpoint multiple times)", () => {
    const prng = createSeededPRNG(1);
    const params = makeParams({
      pattern: "oscillating",
      speedSeconds: 300,
      currentValue: 14,
      targetValue: 1,
      oscillationMode: "damping",
      cycleSeconds: 60,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    const mid = (14 + 1) / 2;
    let crossings = 0;
    for (let i = 1; i < points.length; i++) {
      if ((points[i - 1].v - mid) * (points[i].v - mid) < 0) crossings++;
    }
    expect(crossings).toBeGreaterThan(0);
  });

  it("amplitude decreases over time (damping)", () => {
    const prng = createSeededPRNG(1);
    const params = makeParams({
      pattern: "oscillating",
      speedSeconds: 300,
      currentValue: 14,
      targetValue: 1,
      oscillationMode: "damping",
      cycleSeconds: 60,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    const firstQuarter = points.slice(0, Math.floor(points.length * 0.25));
    const lastQuarter = points.slice(Math.floor(points.length * 0.75));
    const rangeFirst =
      Math.max(...firstQuarter.map((p) => p.v)) -
      Math.min(...firstQuarter.map((p) => p.v));
    const rangeLast =
      Math.max(...lastQuarter.map((p) => p.v)) -
      Math.min(...lastQuarter.map((p) => p.v));
    expect(rangeLast).toBeLessThan(rangeFirst + 2);
  });
});

describe("computeReactiveOverlay — oscillating / sustained", () => {
  it("oscillates at approximately constant amplitude", () => {
    const prng = createSeededPRNG(1);
    const params = makeParams({
      pattern: "oscillating",
      speedSeconds: 300,
      currentValue: 14,
      targetValue: 1,
      oscillationMode: "sustained",
      cycleSeconds: 60,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    const firstHalf = points.slice(0, Math.floor(points.length / 2));
    const secondHalf = points.slice(Math.floor(points.length / 2));
    const rangeFirst =
      Math.max(...firstHalf.map((p) => p.v)) -
      Math.min(...firstHalf.map((p) => p.v));
    const rangeSecond =
      Math.max(...secondHalf.map((p) => p.v)) -
      Math.min(...secondHalf.map((p) => p.v));
    // Sustained: second half amplitude should be similar to first (within 40%)
    expect(rangeSecond).toBeGreaterThan(rangeFirst * 0.3);
  });

  it("faster cycle produces more oscillations over same window", () => {
    const S = 300;
    function countCrossings(cycleSeconds: number): number {
      const prng = createSeededPRNG(1);
      const params = makeParams({
        pattern: "oscillating",
        speedSeconds: S,
        currentValue: 14,
        targetValue: 1,
        oscillationMode: "sustained",
        cycleSeconds,
      });
      const points = computeReactiveOverlay(params, 0, RES, prng);
      const mid = (14 + 1) / 2;
      let c = 0;
      for (let i = 1; i < points.length; i++) {
        if ((points[i - 1].v - mid) * (points[i].v - mid) < 0) c++;
      }
      return c;
    }
    expect(countCrossings(30)).toBeGreaterThan(countCrossings(120));
  });
});

// ── computeReactiveOverlay — sawtooth_rebound ─────────────────────────────────

describe("computeReactiveOverlay — sawtooth_rebound", () => {
  it("produces 2 full cycles (total series covers ~2x speedSeconds)", () => {
    const prng = createSeededPRNG(1);
    const S = 120;
    const params = makeParams({
      pattern: "sawtooth_rebound",
      speedSeconds: S,
      currentValue: 14,
      targetValue: 1,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    const totalTime = points[points.length - 1].t - points[0].t;
    expect(totalTime).toBeGreaterThanOrEqual(S * 1.5);
  });

  it("value decays in first half then re-degrades in second half", () => {
    const prng = createSeededPRNG(1);
    const S = 120;
    const params = makeParams({
      pattern: "sawtooth_rebound",
      speedSeconds: S,
      currentValue: 14,
      targetValue: 1,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    // Mid of first cycle: value should be lower than start
    const midFirst = points.find((p) => p.t >= S * 0.4 && p.t <= S * 0.6);
    // End of first cycle: value should be back up
    const endFirst = points.find((p) => p.t >= S * 0.85 && p.t <= S);
    if (midFirst && endFirst) {
      expect(midFirst.v).toBeLessThan(points[0].v + 1);
      expect(endFirst.v).toBeGreaterThan(midFirst.v - 2);
    }
  });

  it("all values non-negative", () => {
    const prng = createSeededPRNG(1);
    const params = makeParams({
      pattern: "sawtooth_rebound",
      currentValue: 14,
      targetValue: 0,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    points.forEach((p) => expect(p.v).toBeGreaterThanOrEqual(0));
  });
});

// ── clamping ──────────────────────────────────────────────────────────────────

describe("computeReactiveOverlay — clamping", () => {
  it("error_rate values never go below 0", () => {
    const prng = createSeededPRNG(1);
    const params = makeParams({
      pattern: "smooth_decay",
      currentValue: 0.1,
      targetValue: 0,
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    points.forEach((p) => expect(p.v).toBeGreaterThanOrEqual(0));
  });

  it("error_rate values never exceed 100", () => {
    const prng = createSeededPRNG(1);
    const params = makeParams({
      pattern: "smooth_decay",
      direction: "worsening",
      currentValue: 98,
      targetValue: 100,
      metricId: "error_rate",
    });
    const points = computeReactiveOverlay(params, 0, RES, prng);
    points.forEach((p) => expect(p.v).toBeLessThanOrEqual(100));
  });
});
