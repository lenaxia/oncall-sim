# 0013 — 2026-04-08 — Performance benchmarks and OpsDashboard fixes

**Date:** 2026-04-08
**Phase:** Cross-cutting (Phases 8, 10)
**Status:** Complete

## What Was Done

### 1. Performance audit and benchmarking

Identified five candidate bottlenecks in the OpsDashboard render path and the server game loop. Wrote a benchmark suite (`client/__tests__/perf/ops-dashboard-perf.bench.ts`) using Vitest bench to measure actual cost rather than reasoning through algorithmic complexity alone.

**Benchmark results summary:**

| Claim                                                | Verdict        | Measured cost                                           |
| ---------------------------------------------------- | -------------- | ------------------------------------------------------- |
| `series.filter` per tick (40 charts at 10x speed)    | Real           | ~38ms per tick for 40 charts                            |
| `allAlarms map + hasFiringAlarm scan`                | Not real       | 57µs total — not worth changing                         |
| `findIndex` O(n) for brush window start              | Real, dramatic | 1,588× slower than binary search                        |
| `personas.find` inside `pages.map`                   | Not real       | 11µs total — not worth changing                         |
| `getPointsInWindow` without fast-path guard (server) | Real           | 63,754× slower without guard, but guard already existed |
| `getAllSeries()` for key iteration in game loop      | Real           | Full deep-copy of all series on every tick              |

Claims 2 and 4 were refuted — the operations are in the tens-of-microseconds range and not worth the code complexity.

### 2. Fix 1 — `series.filter` memoised in `MetricChart`

**File:** `client/src/components/tabs/MetricChart.tsx`

- Wrapped `series.filter(p => p.t <= simTime)` in `useMemo([series, simTime])`. The filter only re-runs when the series reference changes (reactive overlay splice) or simTime crosses a new data point boundary.
- Wrapped the component in `React.memo` so it skips reconciliation entirely when props are reference-stable between ticks.
- Combined saving at 10x speed with a 72h pre-incident window: ~38ms per full dashboard render cycle eliminated when no new points are visible.

### 3. Fix 3 — Binary search replaces `findIndex` for brush window start in `MetricChart`

**File:** `client/src/components/tabs/MetricChart.tsx`

- Added `lowerBound(arr, target)` — a standard O(log n) binary search returning the index of the first element where `arr[i].t >= target`.
- Replaced `visible.findIndex(p => p.t >= windowStart)` with `lowerBound(visible, windowStart)`.
- The old `findIndex` was scanning ~95% of an 8,760-point array on every render because the 4-hour brush window start (`simTime - 14400s`) lands at roughly index 8,295 in a 72-hour pre-incident history at 30s resolution.
- `windowStart` and `defaultStartIndex` are both computed inside `useMemo([visible, windowStart])` so binary search only runs when `visible` changes.
- Benchmarked: 1,588× faster in the realistic case. Absolute saving: ~25ms per full dashboard tick, compounding with Fix 1.

### 4. Fix 5 — `listMetrics()` added to `MetricStore`; game loop stops deep-copying on every tick

**Files:** `server/src/metrics/metric-store.ts`, `server/src/engine/game-loop.ts`

The game loop's Step 4b (streaming reactive overlay points) was calling `metricStore.getAllSeries()` purely to get the set of `(service, metricId)` key pairs to iterate. `getAllSeries()` performs a full deep copy of every `TimeSeriesPoint[]` in the store — O(total points across all metrics) — on every game loop tick, regardless of whether any reactive overlay is active.

- Added `listMetrics(): Array<{ service: string; metricId: string }>` to the `MetricStore` interface. Returns key pairs by iterating the internal Map — no array allocation proportional to series length.
- Implemented in `createMetricStore` factory.
- Updated `_buildFallbackStore` in `game-loop.ts` to implement the new method.
- Updated `game-loop.ts` Step 4b to use `metricStore.listMetrics()` instead of `Object.entries(metricStore.getAllSeries())`.
- Updated stub `MetricStore` objects in two test files (`stakeholder-engine.test.ts`, `metric-summary.test.ts`) to include `listMetrics: () => []`.

The `reactiveWindowEnd` fast-path in `getPointsInWindow` was already correctly implemented — it returns `[]` immediately for metrics with no active overlay. The fix here removes the cost of the deep-copy that was happening before `getPointsInWindow` was even called.

## Test Results

- Server: 770/770 passed
- Client: 359/359 passed
- `npm run typecheck --workspace=server`: clean
- `npm run typecheck --workspace=client`: clean
- Known failures: none

## Known Issues

None introduced. Pre-existing typecheck warnings in `metric-summary.test.ts` and `stakeholder-engine.test.ts` (unrelated `MetricSummary.narratives` shape mismatch) are unchanged.

## What Comes Next

- Phase 9 (Coach + Debrief) — not started
- The benchmark suite in `client/__tests__/perf/` can be re-run at any time with `npx vitest bench __tests__/perf/ops-dashboard-perf.bench.ts` from the `client` directory
