// metric-store.ts — live session metric state.
// One instance per session.
//
// Design:
//   - t <= 0: pre-generated historical series, fixed, sent in session_snapshot.
//   - t >  0: generated on-demand one point per tick, cached after generation.
//
// Metric behavior at t > 0 is driven by the active overlay (set by LLM in response
// to trainee actions). If no overlay is active, the scripted incident config
// (ResolvedMetricParams) drives generation. The overlay persists until overwritten
// unless sustained=false, in which case it expires after speedSeconds.

import type { TimeSeriesPoint } from "@shared/types/events";
import type { ResolvedMetricParams } from "./types";
import {
  createSeededPRNG,
  type SeededPRNG,
  NOISE_TYPE_DEFAULTS,
} from "./patterns/noise";
import { generateBaseline } from "./patterns/baseline";
import { generateRhythm } from "./patterns/rhythm";
import { applyIncidentOverlay, clampSeries } from "./patterns/incident-overlay";
import { getArchetypeDefaults } from "./archetypes";

// ── Internal state ────────────────────────────────────────────────────────────

// Running state for stateful noise generators.
// Reconstructed by replaying from t=0 up to the last generated point —
// but since we generate one point at a time in order, we just cache it.
interface NoiseState {
  prng: SeededPRNG;
  // random_walk
  walkAccumulator: number;
  // sawtooth_gc
  gcAccumulated: number;
  gcLastT: number;
}

// Active behavioral overlay — set by LLM, persists until overwritten.
export interface ActiveOverlay {
  startSimTime: number;
  startValue: number; // metric value when overlay was applied
  targetValue: number;
  pattern: ActiveOverlayPattern;
  speedSeconds: number;
  sustained: boolean; // if false, reverts to scripted config after speedSeconds
  // oscillating only
  oscillationMode?: "damping" | "sustained";
  cycleSeconds?: number;
}

export type ActiveOverlayPattern =
  | "smooth_decay"
  | "stepped"
  | "cliff"
  | "blip_then_decay"
  | "queue_burndown"
  | "oscillating"
  | "sawtooth_rebound";

interface MetricState {
  historicalSeries: TimeSeriesPoint[]; // t <= 0, fixed
  resolvedParams: ResolvedMetricParams;
  noiseState: NoiseState;
  lastGeneratedT: number; // last t for which we generated and cached a point
  generatedPoints: TimeSeriesPoint[]; // t > 0 points in order, appended per tick
  activeOverlay: ActiveOverlay | null;
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface MetricStore {
  // Returns historical (t<=0) + all generated (t>0) points. Used for
  // session_snapshot and metric-summary computations.
  getAllSeries(): Record<string, Record<string, TimeSeriesPoint[]>>;

  // Returns the value at the most recent point <= simTime.
  // For t<=0 uses historicalSeries, for t>0 uses generatedPoints cache.
  getCurrentValue(
    service: string,
    metricId: string,
    simTime: number,
  ): number | null;

  // Generates all due points for simTime > 0, returns them in order.
  // Under normal operation returns exactly one point per tick.
  // On fast-forward or reconnect returns all missed points.
  generatePoint(
    service: string,
    metricId: string,
    simTime: number,
  ): TimeSeriesPoint[];

  // Sets the active behavioral overlay for a metric.
  // startValue should be getCurrentValue at the moment of application.
  applyActiveOverlay(
    service: string,
    metricId: string,
    overlay: ActiveOverlay,
  ): void;

  getResolvedParams(
    service: string,
    metricId: string,
  ): ResolvedMetricParams | null;

  listMetrics(): Array<{ service: string; metricId: string }>;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createMetricStore(
  // historical series: t <= 0 only
  historicalSeries: Record<string, Record<string, TimeSeriesPoint[]>>,
  resolvedParams: Record<string, Record<string, ResolvedMetricParams>>,
): MetricStore {
  const _state = new Map<string, Map<string, MetricState>>();

  for (const [service, metrics] of Object.entries(historicalSeries)) {
    const serviceMap = new Map<string, MetricState>();
    for (const [metricId, pts] of Object.entries(metrics)) {
      const rp = resolvedParams[service]?.[metricId];
      if (!rp) continue;

      // Advance PRNG past all historical points so on-demand generation
      // continues from the correct PRNG position
      const prng = createSeededPRNG(rp.seed);
      _advancePrngForNoise(rp.noiseType, pts.length, prng);

      serviceMap.set(metricId, {
        historicalSeries: [...pts],
        resolvedParams: rp,
        noiseState: {
          prng,
          walkAccumulator: _computeInitialWalkAccumulator(pts),
          gcAccumulated: 0,
          gcLastT: 0,
        },
        lastGeneratedT: 0, // t=0 is last historical point
        generatedPoints: [],
        activeOverlay: null,
      });
    }
    _state.set(service, serviceMap);
  }

  function _getState(service: string, metricId: string): MetricState | null {
    return _state.get(service)?.get(metricId) ?? null;
  }

  // ── Noise state helpers ───────────────────────────────────────────────────

  // Advance PRNG by n steps without capturing values — used to sync after
  // replaying historical generation.
  function _advancePrngForNoise(
    noiseType: ResolvedMetricParams["noiseType"],
    nPoints: number,
    prng: SeededPRNG,
  ): void {
    if (noiseType === "none") return;
    if (noiseType === "gaussian") {
      // Box-Muller uses 2 draws per sample
      for (let i = 0; i < nPoints; i++) {
        prng.next();
        prng.next();
      }
      return;
    }
    if (noiseType === "random_walk") {
      for (let i = 0; i < nPoints; i++) {
        prng.next();
        prng.next();
      }
      return;
    }
    if (noiseType === "sporadic_spikes") {
      // base gaussian (2 draws) + spike check (1) + conditional spike gaussian (2)
      // Approximate: 3 draws per point minimum. Use actual replay for accuracy.
      for (let i = 0; i < nPoints; i++) {
        prng.next();
        prng.next();
        prng.next();
      }
      return;
    }
    if (noiseType === "sawtooth_gc") {
      // 2 draws per point (gaussian jitter)
      for (let i = 0; i < nPoints; i++) {
        prng.next();
        prng.next();
      }
      return;
    }
  }

  // Walk accumulator at t=0 — replay random_walk noise over historical series
  // to get the correct walk value entering the live sim.
  function _computeInitialWalkAccumulator(
    historicalPts: TimeSeriesPoint[],
  ): number {
    // For the purposes of continuity, the walk accumulator starts at 0 and
    // we replay just the step count. The actual walk value isn't observable
    // in the historical series because it's mixed with baseline+rhythm+overlay,
    // but we need the correct prng position — which _advancePrngForNoise handles.
    // Walk accumulator starts at 0; mean-reversion pulls it back so any starting
    // error damps out quickly. Acceptable approximation.
    void historicalPts;
    return 0;
  }

  // Generate a single noise delta for one new point, advancing noise state.
  function _generateNoiseDelta(state: MetricState, t: number): number {
    const { noiseType, baselineValue, noiseLevelMultiplier } =
      state.resolvedParams;
    const ns = state.noiseState;
    const prng = ns.prng;

    const gaussianSample = (mean: number, sd: number): number => {
      const u1 = Math.max(prng.next(), 1e-10);
      const u2 = prng.next();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return mean + z * sd;
    };

    switch (noiseType) {
      case "none":
        return 0;

      case "gaussian": {
        const p = NOISE_TYPE_DEFAULTS.gaussian;
        const sd =
          baselineValue * (p.stdDevFactor ?? 0.04) * noiseLevelMultiplier;
        return gaussianSample(0, sd);
      }

      case "random_walk": {
        const p = NOISE_TYPE_DEFAULTS.random_walk;
        const stepSd =
          baselineValue * (p.walkStdDev ?? 0.015) * noiseLevelMultiplier;
        const reversion = p.reversionStrength ?? 0.05;
        ns.walkAccumulator += gaussianSample(0, stepSd);
        ns.walkAccumulator -= ns.walkAccumulator * reversion;
        return ns.walkAccumulator;
      }

      case "sporadic_spikes": {
        const p = NOISE_TYPE_DEFAULTS.sporadic_spikes;
        const baseSd =
          baselineValue * (p.baseSdFactor ?? 0.02) * noiseLevelMultiplier;
        const spikeProb = p.spikeProbability ?? 0.05;
        const spikeMag =
          baselineValue *
          (p.spikeMagnitudeFactor ?? 0.5) *
          noiseLevelMultiplier;
        const base = gaussianSample(0, baseSd);
        const isSpike = prng.next() < spikeProb;
        return isSpike
          ? base + Math.abs(gaussianSample(spikeMag, spikeMag * 0.3))
          : base;
      }

      case "sawtooth_gc": {
        const p = NOISE_TYPE_DEFAULTS.sawtooth_gc;
        const gcPeriod = p.gcPeriodSeconds ?? 120;
        const gcDrop = p.gcDropFactor ?? 0.6;
        const growthRate =
          (p.interGcGrowthRate ?? 0.003) * noiseLevelMultiplier;
        const dt = state.lastGeneratedT > 0 ? t - state.lastGeneratedT : 0;
        const elapsed = t - ns.gcLastT;
        if (elapsed >= gcPeriod) {
          ns.gcAccumulated *= 1 - gcDrop;
          ns.gcLastT = t;
        }
        ns.gcAccumulated += baselineValue * growthRate * dt;
        return ns.gcAccumulated + gaussianSample(0, baselineValue * 0.01);
      }

      default:
        return 0;
    }
  }

  // ── Scripted value computation (no overlay) ───────────────────────────────

  function _computeScriptedValue(state: MetricState, t: number): number {
    const rp = state.resolvedParams;

    // baseline + rhythm (both stateless / pure functions of t)
    const base = generateBaseline(rp.baselineValue, [t])[0];
    const rhythm = rp.inheritsRhythm
      ? generateRhythm(rp.rhythmProfile, rp.baselineValue, [t])[0]
      : 0;
    const combined = [base + rhythm];

    // incident overlay (stateless, pure function of t and params)
    const withOverlay = applyIncidentOverlay(combined, rp, [t]);
    const archDef = getArchetypeDefaults(rp.archetype);
    return clampSeries(withOverlay, archDef.minValue, archDef.maxValue)[0];
  }

  // ── Overlay shape computation (replaces scripted value when overlay active) ─

  function _computeOverlayValue(overlay: ActiveOverlay, t: number): number {
    const { startSimTime, startValue, targetValue, pattern, speedSeconds } =
      overlay;
    const elapsed = t - startSimTime;

    // After speedSeconds: if not sustained, caller reverts to scripted.
    // Here we clamp elapsed to speedSeconds so shape functions don't extrapolate.
    const e = Math.min(elapsed, speedSeconds);
    const lambda = Math.log(20) / speedSeconds;
    const C = startValue;
    const T = targetValue;

    switch (pattern) {
      case "smooth_decay":
        return T + (C - T) * Math.exp(-lambda * e);

      case "stepped": {
        const stepSize = (C - T) / 4;
        const step = Math.min(4, Math.floor(e / (speedSeconds / 4)));
        return C - stepSize * step;
      }

      case "cliff":
        return e >= 5 ? T : C;

      case "blip_then_decay": {
        const blipPeak = Math.max(C * 1.3, C + 1);
        const blipDuration = speedSeconds * 0.1;
        if (e <= blipDuration) return blipPeak;
        const lambdaBlip = Math.log(20) / (speedSeconds * 0.9);
        return T + (blipPeak - T) * Math.exp(-lambdaBlip * (e - blipDuration));
      }

      case "queue_burndown": {
        if (e <= speedSeconds) return C;
        const lambdaCliff = Math.log(2) / 15;
        return T + (C - T) * Math.exp(-lambdaCliff * (e - speedSeconds));
      }

      case "oscillating": {
        const mode = overlay.oscillationMode ?? "damping";
        const cycle = overlay.cycleSeconds ?? 60;
        if (mode === "damping") {
          return (
            T +
            (C - T) *
              Math.cos((2 * Math.PI * e) / cycle) *
              Math.exp(-e / speedSeconds)
          );
        }
        const M = (C + T) / 2;
        const A = (C - T) / 2;
        return M + A * Math.cos((2 * Math.PI * e) / cycle);
      }

      case "sawtooth_rebound": {
        const halfPeriod = speedSeconds / 2;
        const lambdaDecay = Math.log(20) / speedSeconds;
        const vMid = T + (C - T) * Math.exp(-lambdaDecay * halfPeriod);
        const cyclePos = e % speedSeconds;
        if (cyclePos <= halfPeriod) {
          return T + (C - T) * Math.exp(-lambdaDecay * cyclePos);
        }
        return vMid + (C - vMid) * ((cyclePos - halfPeriod) / halfPeriod);
      }

      default:
        return C;
    }
  }

  // ── Core single-point generator ───────────────────────────────────────────

  function _generatePointAt(state: MetricState, t: number): TimeSeriesPoint {
    const overlay = state.activeOverlay;
    const elapsed = overlay ? t - overlay.startSimTime : 0;
    const overlayExpired = overlay
      ? !overlay.sustained && elapsed > overlay.speedSeconds
      : false;

    let shapeValue: number;
    if (overlay && !overlayExpired) {
      shapeValue = _computeOverlayValue(overlay, t);
    } else {
      // No active overlay, or non-sustained overlay has expired
      if (overlayExpired) state.activeOverlay = null;
      shapeValue = _computeScriptedValue(state, t);
    }

    const noise = _generateNoiseDelta(state, t);
    const archDef = getArchetypeDefaults(state.resolvedParams.archetype);
    const v = Math.min(
      archDef.maxValue === Infinity
        ? Number.MAX_SAFE_INTEGER
        : archDef.maxValue,
      Math.max(archDef.minValue, shapeValue + noise),
    );

    return { t, v };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    getAllSeries(): Record<string, Record<string, TimeSeriesPoint[]>> {
      const result: Record<string, Record<string, TimeSeriesPoint[]>> = {};
      for (const [service, serviceMap] of _state) {
        result[service] = {};
        for (const [metricId, state] of serviceMap) {
          // historical + all generated points so far
          result[service][metricId] = [
            ...state.historicalSeries.map((p) => ({ t: p.t, v: p.v })),
            ...state.generatedPoints.map((p) => ({ t: p.t, v: p.v })),
          ];
        }
      }
      return result;
    },

    getCurrentValue(
      service: string,
      metricId: string,
      simTime: number,
    ): number | null {
      const state = _getState(service, metricId);
      if (!state) return null;

      const allPoints =
        simTime <= 0
          ? state.historicalSeries
          : [...state.historicalSeries, ...state.generatedPoints];

      let best: TimeSeriesPoint | null = null;
      for (const pt of allPoints) {
        if (pt.t <= simTime) best = pt;
        else break;
      }
      return best?.v ?? null;
    },

    generatePoint(
      service: string,
      metricId: string,
      simTime: number,
    ): TimeSeriesPoint[] {
      if (simTime <= 0) return [];
      const state = _getState(service, metricId);
      if (!state) return [];

      const rp = state.resolvedParams;
      let expectedNext = state.lastGeneratedT + rp.resolutionSeconds;

      const points: TimeSeriesPoint[] = [];
      while (simTime >= expectedNext) {
        const point = _generatePointAt(state, expectedNext);
        state.generatedPoints.push(point);
        state.lastGeneratedT = expectedNext;
        points.push(point);
        expectedNext += rp.resolutionSeconds;
      }
      return points;
    },

    applyActiveOverlay(
      service: string,
      metricId: string,
      overlay: ActiveOverlay,
    ): void {
      const state = _getState(service, metricId);
      if (!state) return;
      state.activeOverlay = overlay;
    },

    getResolvedParams(
      service: string,
      metricId: string,
    ): ResolvedMetricParams | null {
      return _getState(service, metricId)?.resolvedParams ?? null;
    },

    listMetrics(): Array<{ service: string; metricId: string }> {
      const result: Array<{ service: string; metricId: string }> = [];
      for (const [service, serviceMap] of _state) {
        for (const metricId of serviceMap.keys()) {
          result.push({ service, metricId });
        }
      }
      return result;
    },
  };
}
