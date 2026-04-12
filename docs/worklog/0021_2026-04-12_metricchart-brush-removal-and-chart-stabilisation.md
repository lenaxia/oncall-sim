# 0021 — 2026-04-12 — MetricChart Brush Removal and Chart Rendering Stabilisation

## Session Overview

Continuation of the previous session (0020). Focused on stabilising the ops
dashboard chart rendering, which had been broken by a cascade of attempted
fixes. Also includes several engine correctness fixes discovered during
debugging.

---

## What Was Done

### 1. Metric Reaction Engine — additional context fixes

Following on from 0020, several more issues were fixed in the metric reaction
call:

- **`activeMetricMap` key format**: was keyed with `:` (colon) but LLM returns
  `service/metricId` with `/` (slash). All metric reactions were silently
  skipped. Fixed by keying with slash and adding plain `metricId` fallback.
- **Passive actions triggering metric reaction**: `open_tab`, `view_metric` etc.
  were calling `triggerMetricReact()` unnecessarily. Now gated by
  `PASSIVE_ACTIONS` export from `metric-reaction-engine.ts`.
- **`_lastProcessedAuditLength` cursor rollback on error**: cursor now rolls
  back to `previousLength` when LLM call errors/times out, so actions are
  retried rather than silently dropped.
- **Per-Metric Reactions prompt format**: now uses `service/metricId` as
  canonical id so LLM and engine use the same format.

### 2. Sim clock `preIncidentSeconds` offset

`createSimClock` now accepts `initialSimTime` parameter. `SessionContext`
passes `scenario.timeline.preIncidentSeconds` so the clock starts at the
correct offset (e.g. `t=28800` for cache-stampede). Previously the clock
always started at `t=0`, meaning incident overlays (`onset_second=90`) weren't
active when the trainee first acted.

Fast-forward loop added in `createSession`: generates all metric points from
`t=0` to `t=preIncidentSeconds` synchronously at session start so the 4-hour
chart window has data immediately.

### 3. MetricChart — Brush removed

**Root cause of all chart rendering failures:** Recharts `Brush` component
computes traveller positions as `(index/total) * containerWidth`. When
`ResponsiveContainer` reports `width=-1` on first paint (before ResizeObserver
fires), all positions are NaN. The browser's SVG renderer throws on every NaN
attribute — with 11 metrics × multiple attributes × multiple renders this
produced 528+ SVG errors per paint cycle, corrupting chart output even though
the underlying data was correct.

Multiple attempts to work around this (containerReady state, ResizeObserver
deferral, render-prop pattern, two-LineChart conditional) each introduced new
bugs. Final fix: **remove Brush entirely**. The chart now shows a fixed 4-hour
sliding window that auto-advances with the sim clock. No state management, no
NaN risk, no re-render cascade.

**What was removed**: `useState`, `useEffect`, `Brush` import, all brush state
(`brushStart`, `brushEnd`, `userBrushStart`, `userBrushEnd`, `userScrolledRef`,
`containerRef`, `containerReady`).

**What remains**: `prepareChartSeries` memoized per-metric (from v1.0.16),
`lowerBound` binary search, 4h window computed directly in `useMemo`.

### 4. `prepareChartSeries` moved inside `MetricChart`

Previously called inline in `OpsDashboardTab` on every render, creating a new
array reference every `metrics_tick`. This caused `MetricChart.memo` to see a
changed `series` prop and remount the entire Recharts SVG tree for all charts
simultaneously. Now memoized per-chart as `useMemo(() => prepareChartSeries(series), [series])`.

### 5. Debug panel label fix

`_makeLabel` now prefers `[PRIMARY]` tag (appended to last action in
multi-action windows) over header-based match. Handles decimal sim times like
`t=120.00999999999999` correctly.

### 6. MetricChart tests (19 new tests)

`client/__tests__/components/MetricChart.test.tsx` covering:

- Header rendering (label, current value, ALARM badge threshold logic)
- containerReady deferral (no crash before/after ResizeObserver fires)
- onFirstHover callback
- `prepareChartSeries`: empty input, fast-path reference stability,
  downsampling of >6h history, live point preservation, sort order
- `downsampleSeries`: empty input, multiple-of-resolution filtering,
  negative timestamp handling

### 7. Releases v1.0.13 through v1.0.20

| Version | Description                                                         |
| ------- | ------------------------------------------------------------------- |
| v1.0.13 | service/metricId format fix + fast-forward metric history           |
| v1.0.14 | metric_id map key, passive action gate, NaN chart guard             |
| v1.0.15 | MetricChart brush state rewrite (stale init, tab-away, conditional) |
| v1.0.16 | prepareChartSeries memoized inside MetricChart                      |
| v1.0.17 | Brush deferred via ResizeObserver (later reverted)                  |
| v1.0.18 | Revert to known-good e2dd25f brush logic                            |
| v1.0.19 | Brush sync on large simTime jump (stale useState fix)               |
| v1.0.20 | Remove Brush entirely — definitive fix                              |

---

## Known Issues / Not Done

### Brush (pan/zoom) removed

The Brush minimap that allowed the trainee to pan back into historical data
is gone. Charts now show a fixed 4-hour sliding window only. The full
historical series (8h for cache-stampede) is computed but not accessible.

Adding the Brush back is backlog work. The correct approach is to test it in
isolation against Recharts' actual measurement lifecycle before integrating,
rather than fixing it reactively.

### `console.warn` suppression for Recharts `-1` warning

`main.tsx` suppresses the transient `width(-1)/height(-1)` warning from
`ResponsiveContainer` on first paint. This is still present and necessary
since `minWidth={1}` doesn't fully prevent the warning.

---

## Test Status

- 1236 tests passing (72 files)
- TypeScript clean (excluding pre-existing `ScenarioContext.test.ts` error)

---

## What Comes Next

1. Investigate adding Brush back as deliberate backlog work with proper
   isolation testing
2. Consider whether 4h window is the right default or whether it should be
   configurable per scenario
3. Verify cache-stampede scenario plays through correctly end-to-end with the
   metric reaction engine improvements
