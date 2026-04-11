// downsample.ts — series downsampling utilities for chart rendering.
//
// Full-resolution series (1 point/minute) is used internally for MetricStore
// alarm checking and scripted value computation. For chart rendering, older
// history is downsampled to reduce Recharts node count.

import type { TimeSeriesPoint } from "@shared/types/events";

// Recent history kept at full resolution for chart rendering
const FULL_RESOLUTION_CUTOFF_SECONDS = 6 * 3600; // 21600s = 6 hours
// Older history downsampled to this resolution
const DOWNSAMPLE_RESOLUTION_SECONDS = 300; // 5 minutes

/**
 * Downsamples a sorted TimeSeriesPoint[] by keeping only points whose t
 * is a multiple of targetResolutionSeconds.
 *
 * Note: uses Math.abs(t % res) to handle negative timestamps correctly
 * (JavaScript % preserves sign: -21600 % 300 === -0, not 0).
 */
export function downsampleSeries(
  pts: TimeSeriesPoint[],
  targetResolutionSeconds: number,
): TimeSeriesPoint[] {
  if (pts.length === 0) return [];
  return pts.filter(
    (p) => Math.abs(Math.round(p.t) % targetResolutionSeconds) === 0,
  );
}

/**
 * Prepares a series for chart rendering by downsampling old history:
 * - t >= -6h: kept at full 1-minute resolution
 * - t < -6h: downsampled to 5-minute resolution
 * - t > 0 (live): always full resolution
 *
 * Returns the original array unchanged when all points are within 6h.
 */
export function prepareChartSeries(pts: TimeSeriesPoint[]): TimeSeriesPoint[] {
  if (pts.length === 0) return [];

  const cutoff = -FULL_RESOLUTION_CUTOFF_SECONDS; // -21600

  // Fast path: all points are within the 6h window
  if (pts[0].t >= cutoff) return pts;

  const oldPts = pts.filter((p) => p.t < cutoff);
  const recentPts = pts.filter((p) => p.t >= cutoff);

  const downsampled = downsampleSeries(oldPts, DOWNSAMPLE_RESOLUTION_SECONDS);

  return [...downsampled, ...recentPts];
}
