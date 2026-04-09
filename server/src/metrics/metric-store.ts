// metric-store.ts — live session metric state.
// One instance per session. Wraps pre-generated series and handles reactive overlay splicing.

import type { TimeSeriesPoint } from "@shared/types/events";
import type { ResolvedMetricParams, ResolvedReactiveParams } from "./types";
import { createSeededPRNG } from "./patterns/noise";
import { computeReactiveOverlay } from "./patterns/reactive-overlay";

// ── Internal state ────────────────────────────────────────────────────────────

interface MetricState {
  series: TimeSeriesPoint[];
  resolvedParams: ResolvedMetricParams;
  prngOffset: number; // how many PRNG steps consumed — advances on splice
  reactiveWindowEnd?: number; // last t of active reactive overlay; undefined if none applied
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface MetricStore {
  getAllSeries(): Record<string, Record<string, TimeSeriesPoint[]>>;
  getCurrentValue(
    service: string,
    metricId: string,
    simTime: number,
  ): number | null;
  applyReactiveOverlay(params: ResolvedReactiveParams, simTime: number): void;
  getPointsInWindow(
    service: string,
    metricId: string,
    fromSimTime: number,
    toSimTime: number,
  ): TimeSeriesPoint[];
  getResolvedParams(
    service: string,
    metricId: string,
  ): ResolvedMetricParams | null;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createMetricStore(
  series: Record<string, Record<string, TimeSeriesPoint[]>>,
  resolvedParams: Record<string, Record<string, ResolvedMetricParams>>,
): MetricStore {
  // Build internal state map: service → metricId → MetricState
  const _state = new Map<string, Map<string, MetricState>>();

  for (const [service, metrics] of Object.entries(series)) {
    const serviceMap = new Map<string, MetricState>();
    for (const [metricId, pts] of Object.entries(metrics)) {
      const rp = resolvedParams[service]?.[metricId];
      if (!rp) continue;
      serviceMap.set(metricId, {
        series: [...pts], // shallow copy to own the array
        resolvedParams: rp,
        prngOffset: pts.length,
      });
    }
    _state.set(service, serviceMap);
  }

  function _getState(service: string, metricId: string): MetricState | null {
    return _state.get(service)?.get(metricId) ?? null;
  }

  return {
    getAllSeries(): Record<string, Record<string, TimeSeriesPoint[]>> {
      const result: Record<string, Record<string, TimeSeriesPoint[]>> = {};
      for (const [service, serviceMap] of _state) {
        result[service] = {};
        for (const [metricId, state] of serviceMap) {
          // Deep copy: series contains plain {t,v} objects
          result[service][metricId] = state.series.map((p) => ({
            t: p.t,
            v: p.v,
          }));
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
      // Find last point with t <= simTime
      let best: TimeSeriesPoint | null = null;
      for (const pt of state.series) {
        if (pt.t <= simTime) best = pt;
        else break;
      }
      return best?.v ?? null;
    },

    applyReactiveOverlay(
      params: ResolvedReactiveParams,
      simTime: number,
    ): void {
      const state = _getState(params.service, params.metricId);
      if (!state) return;

      // Find splice index: first stored point with t >= simTime
      let spliceIdx = state.series.findIndex((p) => p.t >= simTime);
      if (spliceIdx === -1) {
        // All points are before simTime — append after last
        spliceIdx = state.series.length;
      }

      // Position PRNG at the splice point (advance past already-consumed points)
      const prng = createSeededPRNG(state.resolvedParams.seed);
      for (let i = 0; i < spliceIdx; i++) prng.next();

      // Compute the reactive overlay series
      const startSimTime =
        spliceIdx < state.series.length ? state.series[spliceIdx].t : simTime;

      const newPoints = computeReactiveOverlay(
        params,
        startSimTime,
        state.resolvedParams.resolutionSeconds,
        prng,
      );

      // Splice: replace all points from spliceIdx onward
      state.series.splice(
        spliceIdx,
        state.series.length - spliceIdx,
        ...newPoints,
      );
      state.prngOffset = spliceIdx + newPoints.length;

      // Track reactive window end
      if (newPoints.length > 0) {
        state.reactiveWindowEnd = newPoints[newPoints.length - 1].t;
      }
    },

    getPointsInWindow(
      service: string,
      metricId: string,
      fromSimTime: number,
      toSimTime: number,
    ): TimeSeriesPoint[] {
      const state = _getState(service, metricId);
      if (!state) return [];

      // Fast path: no active reactive overlay
      if (state.reactiveWindowEnd === undefined) return [];
      if (fromSimTime >= state.reactiveWindowEnd) return [];

      // Return points with t > fromSimTime (exclusive) and t <= toSimTime (inclusive)
      return state.series.filter((p) => p.t > fromSimTime && p.t <= toSimTime);
    },

    getResolvedParams(
      service: string,
      metricId: string,
    ): ResolvedMetricParams | null {
      return _getState(service, metricId)?.resolvedParams ?? null;
    },
  };
}
