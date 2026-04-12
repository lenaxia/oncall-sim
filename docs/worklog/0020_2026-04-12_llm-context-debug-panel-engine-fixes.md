# 0020 — 2026-04-12 — LLM Context, Debug Panel, Engine Fixes, Sim Clock

## Session Overview

Long debugging and improvement session covering LLM context quality, the metric
reaction engine pipeline, a new LLM debug panel, and a cluster of runtime bugs
that prevented the metric reaction engine from functioning correctly end-to-end.

---

## What Was Done

### 1. LLM Context Quality (metric-reaction-engine)

Rebuilt `_buildPrompt` in `metric-reaction-engine.ts` with full scenario context:

- **System prompt**: scenario description, root cause, incident mechanism
  (per-component descriptions from topology), service correlations
  (upstream/downstream with correlation type), remediation action IDs in
  brackets so action params (`remediationActionId`) can be cross-referenced,
  correct-fix flag and side effects per action.
- **User message**: full prior audit log (not just action window), reaction
  history log showing cause→effect per past LLM decision (action → value at
  decision time → outcome/pattern/speed → current value), pipeline state with
  current/previous versions, feature flag current state, metric thresholds
  (warn/crit) alongside current values.
- `ReactionHistoryEntry` / `ReactionDecision` types added; `_reactionHistory[]`
  accumulates per-call decisions and is rendered in subsequent prompts.

### 2. LLM Debug Panel (`VITE_DEBUG` → `DEBUG` runtime env var)

- `llm-debug-store.ts`: singleton ring buffer (max 200 entries) recording every
  LLM request/response. `classifyRole()` reclassifies metrics-engine calls as
  `"metrics"` (detected by presence of `select_metric_reaction` tool).
  `formatEntryForClipboard()` formats a single request/response pair for
  pasting into an LLM CLI.
- `DebugPanelShell.tsx`: full-screen overlay with filter tabs (All / Stakeholder
  / Metrics / Coach / Debrief), entry list, and detail pane. Copy button on
  selected entry writes `formatEntryForClipboard()` output to clipboard.
- `llm-client.ts`: debug interceptor wraps the real client when
  `window.__CONFIG__.debug === true`.
- `server.js`: replaced `serve` with Express. Reads `DEBUG` env var at container
  start, injects `window.__CONFIG__ = {debug: ...}` into index.html before
  `</head>`. No build-time baking, no extra endpoint, no proxy needed.
- `index.html`: dev mode always sets `window.__CONFIG__ = {debug: true}`.
- **34 tests** for `llm-debug-store` covering all paths.

### 3. Chart Fix (Recharts 0×0 warnings)

- `MetricChart.tsx`: added `min-w-0` to chart wrapper div and `minWidth={1}` to
  `ResponsiveContainer`. Suppressed residual `console.warn` for the transient
  0×0 warning in `main.tsx`.

### 4. Stakeholder ↔ Metric Engine Decoupling

- `triggerDirtyTick()` no longer includes `onMetricReact` in its `Promise.all`.
  Stakeholder tick owns `_inFlight` exclusively.
- `triggerMetricReact()`: new independent function called directly from
  `handleAction()` for non-passive actions only (gated by `PASSIVE_ACTIONS`).
  Builds context with `triggeredByAction: true` explicitly.
- LLM timeout raised from 30s to 90s.

Previously: metric reaction waited behind stakeholder tick (0–30s) before
starting its own call (0–30s) = up to 60s wall-clock delay.
After: metric reaction fires immediately on action, parallel to stakeholder.

### 5. `_lastProcessedAuditLength` cursor rollback on error

Previously the cursor advanced before the LLM call. On timeout/error the
actions were silently dropped. Now `previousLength` is saved; cursor rolls back
on failure so the action window is retried.

### 6. Sim Clock Offset (`preIncidentSeconds`)

- `createSimClock` now accepts `initialSimTime` parameter.
- `SessionContext.tsx` passes `scenario.timeline.preIncidentSeconds` so the
  clock starts at the correct offset (e.g. `t=28800` for cache-stampede).
- Previously the clock always started at `t=0`, so incident overlays
  (`onset_second=90`) weren't active when the trainee first acted, causing
  `activeMetrics` to be empty and all metric reaction LLM calls to be skipped.
- Fast-forward loop added in `createSession`: generates all metric points from
  `t=0` to `t=preIncidentSeconds` synchronously at session start so the chart
  window `[simTime-4h, simTime]` has data immediately.

### 7. `service/metricId` Format Fix

- `activeMetricMap` was keyed with `:` (colon) but the LLM naturally returns
  `service/metricId` with `/` (slash). Map now keyed with `/`.
- Per-Metric Reactions section in prompt now shows `service/metricId` as
  canonical id so the LLM knows what format to use.
- Tool definition updated to specify full `service/metricId` format.

### 8. Debug Label Extraction Fix

- `_makeLabel` now prefers the `[PRIMARY]` tag (appended to last action in
  multi-action windows) over the header-based match. Handles decimal sim times
  like `t=120.00999999999999` correctly.

### 9. Docker / Helm Releases

- v1.0.1 through v1.0.14 released.
- `client/Dockerfile`: replaced `serve` with `node server.js`.
- `talos-ops-prod` helm release updated through v1.0.14.

---

## Known Issues / Not Done

### Ops Dashboard Rendering (BROKEN — session ended before fixing)

Three visual regressions introduced by the sim-clock and fast-forward changes:

1. **"No metrics for a long period of time"** — `chartSimTime` throttle
   initialised to `state.simTime` but chart window `[simTime-4h, simTime]`
   may not have visible data if fast-forward points haven't propagated to
   React state yet.

2. **"Metrics disappear when tabbing away"** — browser throttles `setInterval`
   when tab is hidden; on return, the gap in `metrics_tick` events causes the
   chart to show a flat/missing segment.

3. **"Brush bar not rendered correctly"** — `brushStart`/`brushEnd` state can
   get out of sync with the now-large `visible` array (480+ points for
   cache-stampede). Guard added (`windowed.length < 2`) but caused a different
   regression (duplicate `LineChart` conditional structure).

**A rewrite of `MetricChart.tsx` was started but NOT validated/tested.**
The file was written with a cleaner `userScrolledRef` approach but has not
been type-checked or tested. **Do not deploy without validating first.**

---

## Test Status

- All 1217 tests passing at end of session (before `MetricChart` rewrite).
- TypeScript clean (excluding pre-existing `ScenarioContext.test.ts` error).

---

## What Comes Next

1. Validate and finish the `MetricChart.tsx` rewrite:
   - Write tests for the brush auto-advance logic
   - Verify chart renders correctly with 480+ points
   - Verify tab-away/restore doesn't cause gaps
   - Verify brush handles the `userScrolledRef` correctly
2. Investigate whether `OpsDashboardTab` throttle (`CHART_SIMTIME_THROTTLE_MS`)
   needs adjustment given the new clock starting at `t=28800`.
3. Consider whether the fast-forward loop should emit a `metrics_tick` bulk
   event so React state is populated without waiting for the first real tick.
4. Release v1.0.15 once ops dashboard is verified.
