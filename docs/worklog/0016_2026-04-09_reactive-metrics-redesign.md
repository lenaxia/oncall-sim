# 0016 — Reactive Metrics Redesign: On-Demand Generation + Metric Reaction Engine

**Date:** 2026-04-09
**Status:** Complete

---

## What Was Done

Two major pieces of work, both motivated by the same root problem: metric graphs were not
reflecting trainee actions.

---

### 1. Metric Reaction Engine — Decoupled from Stakeholder Engine

The original `apply_metric_response` tool lived inside the stakeholder engine, which is
persona-gated with cooldowns. This meant metric reactions were silently dropped when all
personas were in cooldown. Worse, the stakeholder engine fired on every dirty tick
(scripted events, alarms, etc.) — not just trainee actions.

**Fix:**

- Extracted `apply_metric_response` into a new `MetricReactionEngine`
  (`server/src/engine/metric-reaction-engine.ts`) — no persona gating, no cooldowns,
  no eligibility checks.
- Added `triggeredByAction: boolean` to `StakeholderContext`. Set `true` only in
  `handleAction`, `handleChatMessage`, `handleEmailReply`. The metric reaction engine
  no-ops unless `triggeredByAction=true`.
- `onMetricReact` hook added to `GameLoopDependencies`. Fires concurrently with
  `onDirtyTick` via `Promise.all`.
- `apply_metric_response` removed from `getStakeholderTools()`. New
  `getMetricReactionTools()` returns it only for the metric reaction engine.
- `getSimTime()` injected into `createMetricReactionEngine` so overlay is applied at
  the actual sim time when the LLM responds, not the stale `context.simTime` captured
  when the action fired.

---

### 2. On-Demand Metric Generation

The original design pre-generated the full metric series (`t = fromSecond` to
`t = toSecond`) at session start. The reactive overlay spliced a shaped series into
`state.series` from the action simTime forward. This caused two problems:

1. **Sustained behavior was impossible.** Overlay patterns are finite (`speedSeconds`
   long). After they expired, the chart had no more points and froze.
2. **Wrong simTime.** The overlay was applied at `context.simTime` (captured when the
   action fired). By the time the async LLM call returned, that window had already
   been streamed.

**New design:**

- **`t <= 0`** — pre-generated at session start (historical / pre-incident data). Sent
  in `session_snapshot`. Fixed forever.
- **`t > 0`** — generated on-demand one point per tick. Each tick calls
  `MetricStore.generatePoint(service, metricId, simTime)`, which computes the value
  at the resolution grid point `>= simTime` using the current behavioral state.
- **`ActiveOverlay`** replaces `ResolvedReactiveParams` + splice. The LLM response sets
  an `ActiveOverlay` on the metric (pattern, startValue, targetValue, speedSeconds,
  `sustained`). The overlay persists until overwritten by another action. `sustained=true`
  (default) means the metric holds `targetValue` indefinitely after the transition
  completes. `sustained=false` means it reverts to the scripted incident config after
  `speedSeconds`.
- **Noise state is cached** — `NoiseState` (PRNG position, `random_walk` accumulator,
  `sawtooth_gc` accumulated/lastGcT) is updated on each generated point. No replay from
  history needed — only the previous step's state is required.
- **Catch-up on fast-forward** — `generatePoint` loops from `lastGeneratedT +
resolutionSeconds` up to `simTime`, returning all due points. Under normal operation
  this is exactly one point per tick.

**`apply_metric_response` tool changes:**

- Added optional `sustained` boolean (default `true`). Only set `false` for transient
  one-off effects.
- `cascade_clear` pattern still expanded to per-metric `smooth_decay` overlays with
  staggered `startSimTime`.

**Client side:**

- `session_snapshot` now contains only `t <= 0` points.
- `metric_update` SSE events flow every tick for every metric from `t > 0` onward.
- `SessionContext` reducer `case 'metric_update'` splices incoming points into
  `state.metrics` (this was already implemented but unreachable — now fully exercised).

---

## Files Changed

### New

- `server/src/engine/metric-reaction-engine.ts`
- `server/__tests__/engine/metric-reaction-engine.test.ts`

### Deleted

- `server/__tests__/engine/stakeholder-engine-reactive.test.ts` — superseded by
  `metric-reaction-engine.test.ts`

### Modified

- `server/src/metrics/metric-store.ts` — full rewrite: `ActiveOverlay`, `NoiseState`,
  `generatePoint`, `applyActiveOverlay`; `applyReactiveOverlay` and `getPointsInWindow`
  removed
- `server/src/metrics/generator.ts` — only generate `t <= 0` points
- `server/src/engine/game-loop.ts` — `triggeredByAction` flag; `onMetricReact` hook;
  tick Step 4b uses `generatePoint` instead of `getPointsInWindow`
- `server/src/engine/stakeholder-engine.ts` — `apply_metric_response` case removed;
  `_buildMetricResponseContext` removed
- `server/src/session/session.ts` — `createMetricReactionEngine` wired with `getSimTime`
- `server/src/llm/tool-definitions.ts` — `getMetricReactionTools()`; `sustained` field
  on `apply_metric_response`; `apply_metric_response` excluded from `getStakeholderTools`
- `client/src/context/SessionContext.tsx` — `metric_update` reducer case now splices
  points into `state.metrics`
- All affected test files updated

---

## Test Results

```
Server: 773 / 773  (34 test files)
```

---

## Known Issues

None.

## What Comes Next

- LLM error toast notification (server SSE `{ type: "error" }` → client `showToast`)
- Validate sustained overlay behavior across a full session with multiple actions
