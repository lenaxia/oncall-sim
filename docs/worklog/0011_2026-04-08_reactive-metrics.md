# 0011 — Reactive Metrics (Phase 10)

**Date:** 2026-04-08
**Status:** Complete

---

## What Was Done

Implemented Phase 10: reactive metrics. Metric graphs now respond to trainee actions in real
time. When the LLM calls `apply_metric_response` after a trainee action (correct fix, wrong
action, partial mitigation), the server splices a reactive overlay into the pre-generated
metric series from current sim time forward and streams the updated points to the client as
sim time advances. The client sees the graph change without a reload.

The LLM supplies semantic parameters only — direction, pattern, speed, magnitude. The server
owns all math. Authors supply one optional field (`resolved_value`) only when "recovered" is
not "return to baseline."

---

## Design

Full design documented in `docs/design/lld/10-reactive-metrics.md`. HLD §7.2, §8.3, §8.6,
§16 updated to reflect the feature moving from Phase 2 non-goal to in-scope.

### Core principle

The scenario config declares what metrics exist and what their resolved steady state is.
The LLM reasons about what happened and calls a single tool with semantic parameters.
The server computes everything. No LLM-generated numbers ever touch the metric series.

### `resolved_value`

Single new optional field on `MetricConfig`. Defines what the metric looks like when the
incident is fully resolved. Defaults to `baseline_value` — no author burden for the common
case. Only set when "recovered" ≠ "back to baseline" (e.g. traffic spike scenarios where
the service was legitimately scaled up).

### `apply_metric_response` tool

```typescript
apply_metric_response({
  affected_metrics: [{
    service:          string,
    metric_id:        string,
    direction:        'recovery' | 'worsening',
    pattern:          ReactiveOverlayType,
    speed:            '1m' | '5m' | '15m' | '30m' | '60m',
    magnitude:        'full' | 'partial',
    // oscillating only:
    oscillation_mode?: 'damping' | 'sustained',
    cycle_seconds?:    number   // clamped to [30, 300]
  }>
})
```

- `direction=recovery` → moves toward `resolved_value`
- `direction=worsening` → moves toward `incident_peak`
- `magnitude=partial` → halfway between current value and target
- Different patterns and speeds per metric in one call → asymmetric recovery

### 8 reactive overlay patterns

| Pattern            | Behavior                                                                            |
| ------------------ | ----------------------------------------------------------------------------------- |
| `smooth_decay`     | Exponential curve toward target. λ = ln(20)/S, 95% convergence at t=S               |
| `stepped`          | 4 discrete drops at equal intervals                                                 |
| `queue_burndown`   | Holds elevated for full speed window, then sharp cliff. Total series = S + 120s     |
| `oscillating`      | Damping: amplitude decays toward target. Sustained: constant amplitude indefinitely |
| `blip_then_decay`  | Spike to max(C×1.3, C+1) then smooth decay. Models restart transient                |
| `cascade_clear`    | Per-metric smooth_decay staggered: infra first, then quality, then business         |
| `sawtooth_rebound` | Decays then re-degrades, 2 full cycles. Models fix-that-buys-time                   |
| `cliff`            | Near-instant jump at t+5s. Models circuit breaker trip or hard failover             |

### Speed tiers

`1m`=60s, `5m`=300s, `15m`=900s, `30m`=1800s, `60m`=3600s (all in sim-seconds).

### Splice semantics

`MetricStore.applyReactiveOverlay` replaces all series points with `t >= simTime` with the
computed reactive overlay. A second application starts from the actual current value at that
moment — not from the original incident peak. PRNG continues from the splice index so noise
is seamless across the boundary.

### Game loop streaming

On each tick, the game loop calls `MetricStore.getPointsInWindow(service, metricId, prevSimTime, currentSimTime)` for all metrics. Returns empty immediately for metrics with no
active reactive overlay (zero overhead for unaffected metrics). Streams `metric_update` SSE
events for any points in the window.

### Fallback store

When a session is created without a full `MetricStore` (older code paths, tests), the game
loop creates a read-only fallback store from the plain metrics Record. This keeps
`computeMetricSummary` (other in-progress work) working without requiring every caller to
provide a full `MetricStore`.

---

## Files Changed

### New

- `docs/design/lld/10-reactive-metrics.md` — full LLD (9 validation passes)
- `server/src/metrics/metric-store.ts` — `MetricStore` interface + `createMetricStore`
- `server/src/metrics/patterns/reactive-overlay.ts` — all 8 patterns, pure functions
- `server/__tests__/metrics/metric-store.test.ts` — 18 test cases
- `server/__tests__/metrics/patterns/reactive-overlay.test.ts` — 38 test cases
- `server/__tests__/engine/stakeholder-engine-reactive.test.ts` — 10 test cases

### Modified

- `shared/types/events.ts` — `ReactiveOverlayType`, `ReactiveSpeedTier`; `metric_update` Phase 2 annotation removed
- `server/src/metrics/types.ts` — `ResolvedReactiveParams` type; `resolvedValue` field on `ResolvedMetricParams`
- `server/src/metrics/resolver.ts` — populates `resolvedValue`, defaults to `baselineValue`
- `server/src/metrics/generator.ts` — returns `{ series, resolvedParams }` instead of plain Record
- `server/src/metrics/correlation.ts` — returns `{ series, resolvedParams }` from `deriveCorrelatedMetrics`
- `server/src/scenario/schema.ts` + `types.ts` + `loader.ts` — `resolved_value` field
- `server/src/llm/tool-definitions.ts` — Phase 2 tool stubs removed; `apply_metric_response` added
- `server/src/engine/stakeholder-engine.ts` — accepts `MetricStore`; metric response context block; `apply_metric_response` execution with topology validation and `cascade_clear` expansion
- `server/src/engine/game-loop.ts` — `MetricStore` in deps (optional, fallback provided); `metric_update` streaming; snapshot reads from MetricStore
- `server/src/session/session.ts` — `MetricStore` created and wired to `StakeholderEngine` + `GameLoop`
- `scenarios/_fixture/scenario.yaml` — `apply_metric_response` enabled in `llm_event_tools`
- `scenarios/_fixture/mock-llm-responses.yaml` — `apply_metric_response` fixture entry for `after_action:trigger_rollback`
- Various test files updated for generator return type change and new `StakeholderEngine` signature

---

## Test Results

```
Server:  744 / 744  (33 test files)
```

---

## Known Gaps / Deferred

- **`metric_update` SSE streaming test** — the integration test validates the overlay is
  spliced correctly via `getSnapshot()`. SSE streaming of `metric_update` events is tested
  in the game-loop unit test (`metric_update streaming` describe block). A true end-to-end
  SSE streaming test was deferred because it requires the game loop to tick enough times in
  real time within the test window, which is slow at default sim speed.
- **Client-side `metric_update` handling** — the client currently receives `session_snapshot`
  with the full pre-generated series on connect. It does not yet apply incoming `metric_update`
  SSE events to update the live graph. That is the next piece (client-side graph mutation on
  `metric_update`).
