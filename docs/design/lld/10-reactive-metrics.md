# LLD 10 — Reactive Metrics

**Phase:** 10
**Depends on:** All of Phases 1–6 (implemented). Phases 7–9 unaffected.
**HLD sections:** §7.2, §8.3, §8.6, §16
**Touches these completed phase files:**

- `server/src/metrics/` — new modules added alongside existing ones (no existing files modified)
- `server/src/session/session.ts` — session factory updated to create `MetricStore` and pass it to `StakeholderEngine`
- `server/src/engine/stakeholder-engine.ts` — accepts `MetricStore`, executes `apply_metric_response`
- `server/src/engine/game-loop.ts` — streams `metric_update` SSE events as sim time advances past reactive overlay points
- `shared/types/events.ts` — `metric_update` event already defined; `ReactiveOverlayType` and `ReactiveSpeedTier` added as exported types

---

## Purpose

Make metric graphs respond to trainee actions in real time. When the LLM calls `apply_metric_response` after a trainee action, the server splices a reactive overlay into the pre-generated metric series from the current sim time forward, then streams the new points to the client as sim time advances. The client sees the graph change without a reload.

The LLM supplies semantic parameters only — direction, pattern, speed tier, magnitude. The server owns all math. Authors supply one optional field per metric (`resolved_value`) when "recovered" is not "back to baseline".

---

## Scope

### New files

```
server/src/metrics/
  metric-store.ts                   # live session metric state — splice and stream
  patterns/
    reactive-overlay.ts             # compute reactive overlay series for all 8 patterns
```

### Modified files (completed phases)

```
shared/types/events.ts              # export ReactiveOverlayType, ReactiveSpeedTier;
                                    # remove '// Phase 2' annotation from metric_update SimEvent
server/src/scenario/schema.ts       # add resolved_value: z.number().min(0).optional() to MetricConfigSchema
server/src/scenario/types.ts        # add resolvedValue?: number to MetricConfig interface
server/src/metrics/resolver.ts      # resolve resolved_value (defaults to baseline_value)
server/src/session/session.ts       # session factory: create MetricStore, pass to StakeholderEngine
server/src/engine/stakeholder-engine.ts  # accept MetricStore, execute apply_metric_response
server/src/engine/game-loop.ts      # stream metric_update events from MetricStore on each tick
```

### Test files

```
server/__tests__/metrics/metric-store.test.ts
server/__tests__/metrics/patterns/reactive-overlay.test.ts
server/__tests__/engine/stakeholder-engine-reactive.test.ts  # new reactive-specific cases
```

---

## 1. Types (`shared/types/events.ts` additions)

These types are added to the canonical shared types file and imported by both server and client.

```typescript
// The 8 reactive overlay patterns — runtime-applied via apply_metric_response
export type ReactiveOverlayType =
  | "smooth_decay" // exponential curve toward target
  | "stepped" // 4 discrete drops at equal intervals
  | "queue_burndown" // plateau at current value, then sharp cliff once backlog clears
  | "oscillating" // bounces — damping toward resolved or sustained indefinitely
  | "blip_then_decay" // brief spike above current, then smooth decay
  | "cascade_clear" // metrics recover in sequence: infra → quality → business
  | "sawtooth_rebound" // decays to target, re-degrades, repeats — fix buys time only
  | "cliff"; // near-instant jump — circuit breaker, hard failover

// Speed tier → sim-second mapping
// '1m'=60  '5m'=300  '15m'=900  '30m'=1800  '60m'=3600
export type ReactiveSpeedTier = "1m" | "5m" | "15m" | "30m" | "60m";
```

---

## 2. Scenario Config Addition (`resolved_value`)

`resolved_value` is an optional field on any metric config entry. When present, it defines what the metric looks like after the incident is fully resolved — the target for `direction=recovery` + `magnitude=full`.

**Default:** `baseline_value` (no change to existing scenarios — zero migration cost).

**Only set when recovery ≠ return-to-baseline.** Examples:

- Traffic spike scenario: `request_rate.resolved_value = 520` — service was legitimately scaled up
- Capacity expansion: `connection_pool_used.resolved_value = 12` — pool was enlarged as part of fix

```yaml
# scenario.yaml — ops_dashboard section, no other section changes needed
metrics:
  - archetype: error_rate
    critical_threshold: 5
    incident_peak: 14.2
    # resolved_value omitted → defaults to baseline_value (~0.8%)

  - archetype: request_rate
    resolved_value: 520 # scaled up — recovery is NOT back to original 350 rps
```

Validation at scenario load time: `resolved_value` must be a non-negative number within the archetype's valid range. Two files require changes:

- `server/src/scenario/schema.ts` — add `resolved_value: z.number().min(0).optional()` to `MetricConfigSchema`
- `server/src/scenario/types.ts` — add `resolvedValue?: number` to the `MetricConfig` interface

Both are listed in the modified files scope above.

---

## 3. Resolver Update (`server/src/metrics/resolver.ts`)

One addition to `resolveMetricParams`: populate `resolvedValue` on `ResolvedMetricParams`.

```typescript
// In resolveMetricParams — after resolving baselineValue:
resolvedValue: metricConfig.resolved_value ?? resolvedBaselineValue;
```

No other changes to the resolver. `resolvedValue` flows through to `MetricStore` via `ResolvedMetricParams`.

---

## 4. `ResolvedReactiveParams` (internal to metrics module)

Fully concrete parameter set for a single reactive overlay application. Built by the stakeholder engine when executing `apply_metric_response`, passed to `MetricStore.applyReactiveOverlay`.

```typescript
// server/src/metrics/metric-store.ts — exported for stakeholder engine use
export interface ResolvedReactiveParams {
  service: string;
  metricId: string;
  direction: "recovery" | "worsening";
  pattern: ReactiveOverlayType;
  speedSeconds: number; // resolved from ReactiveSpeedTier via REACTIVE_SPEED_SECONDS
  magnitude: "full" | "partial";
  currentValue: number; // live value at time of application
  targetValue: number; // resolved from magnitude + direction (see §4.1)
  // Only present when pattern='oscillating'
  oscillationMode?: "damping" | "sustained";
  cycleSeconds?: number; // clamped to [30, 300] before this struct is built
}
```

### 4.1 Target value resolution

```
direction=recovery,  magnitude=full    → resolvedValue
direction=recovery,  magnitude=partial → midpoint(currentValue, resolvedValue)
direction=worsening, magnitude=full    → incidentPeak
direction=worsening, magnitude=partial → midpoint(currentValue, incidentPeak)
```

`midpoint(a, b) = a + (b - a) / 2`

For `direction=worsening` when `currentValue >= incidentPeak` (metric is already at or past peak): target = `currentValue * 1.2`, capped at archetype max. This handles the case where a second wrong action makes a bad situation worse.

---

## 5. `MetricStore` (`server/src/metrics/metric-store.ts`)

Owns live session metric state. One instance per session. Wraps the pre-generated `TimeSeriesPoint[]` arrays produced by `generateAllMetrics` and handles reactive overlay splicing.

**`metricId` convention:** The key used throughout `MetricStore` (and in all `metric_update` SSE events) is the archetype string from the metric config (e.g. `'error_rate'`, `'p99_latency_ms'`). For correlated service `overrides` that use the same archetype as the focal service, the same key is used scoped under the service name — `metricStore.getCurrentValue('checkout-service', 'error_rate', t)` is distinct from `metricStore.getCurrentValue('payment-service', 'error_rate', t)`. This matches the `Record<service, Record<metricId, TimeSeriesPoint[]>>` shape produced by `generateAllMetrics` and documented in LLD 02.

```typescript
import { TimeSeriesPoint } from "@shared/types/events";
import { ResolvedMetricParams } from "./resolver";

export interface MetricStore {
  // Returns all series — used for session_snapshot and SSE reconnect.
  // Returns a deep copy — safe to mutate the returned object.
  getAllSeries(): Record<string, Record<string, TimeSeriesPoint[]>>;

  // Returns the last point at or before simTime for a given metric.
  // Returns null if the service or metric does not exist.
  getCurrentValue(
    service: string,
    metricId: string,
    simTime: number,
  ): number | null;

  // Splices a reactive overlay into the series from simTime onward.
  // All pre-generated points with t >= simTime are replaced by the computed overlay.
  // Noise is preserved — overlay points continue the same seeded PRNG sequence.
  // The game loop streams the new points via getPointsInWindow on subsequent ticks.
  applyReactiveOverlay(params: ResolvedReactiveParams, simTime: number): void;

  // Returns all points with t > fromSimTime and t <= toSimTime for a metric.
  // Lower bound is exclusive to prevent re-emitting the boundary point on consecutive ticks.
  // Returns an empty array immediately if the metric has no active reactive overlay window
  // (avoids iterating pre-generated series on every tick for unaffected metrics).
  // Used by the game loop on each tick to find newly-visible points to stream.
  getPointsInWindow(
    service: string,
    metricId: string,
    fromSimTime: number,
    toSimTime: number,
  ): TimeSeriesPoint[];

  // Returns the ResolvedMetricParams for a metric.
  // Used by the stakeholder engine to look up resolvedValue and incidentPeak
  // when building ResolvedReactiveParams.
  getResolvedParams(
    service: string,
    metricId: string,
  ): ResolvedMetricParams | null;
}

export function createMetricStore(
  series: Record<string, Record<string, TimeSeriesPoint[]>>,
  resolvedParams: Record<string, Record<string, ResolvedMetricParams>>,
): MetricStore;
```

### 5.1 Splice semantics

`applyReactiveOverlay` replaces all points with `t >= simTime` in the stored series with the computed reactive overlay. This means:

- A second `apply_metric_response` on the same metric starts from whatever the metric's actual current value is at that moment — not from the original incident peak. If recovery was 80% complete when the trainee made a second (wrong) action, worsening starts from the 80%-recovered value.
- The PRNG continues from the index of the splice point, not from zero — noise is seamless across the splice boundary.
- The splice point is the first stored `t` value that is `>= simTime`. Points at exactly `simTime` are replaced.

### 5.2 PRNG continuation across splice

The seeded PRNG for each metric is stateful — it produces noise values in sequence as points are generated. To continue noise seamlessly after a splice, `MetricStore` tracks how many points have already been consumed from each metric's PRNG (equal to the number of pre-generated points up to the splice point) and passes a PRNG positioned at that offset to `computeReactiveOverlay`.

```typescript
// Internal state per metric
interface MetricState {
  series: TimeSeriesPoint[];
  resolvedParams: ResolvedMetricParams;
  prngOffset: number; // how many points have been consumed — advances on splice
  reactiveWindowEnd?: number; // sim-time of last reactive overlay point, if any.
  // getPointsInWindow returns empty immediately if
  // fromSimTime >= reactiveWindowEnd (outside active window).
  // Set by applyReactiveOverlay. Never cleared — if a second
  // overlay is applied, reactiveWindowEnd is updated to the
  // new window's end time.
}
```

---

## 6. `patterns/reactive-overlay.ts`

Pure function module. No session state. Takes fully resolved parameters and a positioned PRNG, returns `TimeSeriesPoint[]`.

**Adding a new pattern** requires changes in exactly these places — no others:

1. `ReactiveOverlayType` union in `shared/types/events.ts`
2. New case in `computeReactiveOverlay` switch in this file
3. JSON Schema `enum` array in `apply_metric_response` tool definition (`llm/tool-definitions.ts`)
4. Prompt context block description in `stakeholder-engine.ts`
5. Test cases in `patterns/reactive-overlay.test.ts`

```typescript
import { TimeSeriesPoint } from "@shared/types/events";
import { SeededPRNG } from "./noise";
import { ResolvedReactiveParams } from "../metric-store";
import { ReactiveSpeedTier } from "@shared/types/events";

// Speed tier to sim-seconds mapping. Exported for tests and prompt builder.
export const REACTIVE_SPEED_SECONDS: Record<ReactiveSpeedTier, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "60m": 3600,
};

// Resolves the concrete target value from direction, magnitude, and metric bounds.
// resolvedValue and incidentPeak come from ResolvedMetricParams (via metricStore.getResolvedParams).
// currentValue comes from metricStore.getCurrentValue at the time of application.
// Called by the stakeholder engine in §7.3 step f before building ResolvedReactiveParams.
export function resolveReactiveTarget(
  direction: "recovery" | "worsening",
  magnitude: "full" | "partial",
  currentValue: number,
  resolvedValue: number,
  incidentPeak: number,
): number;

// Computes the full reactive overlay series starting from startSimTime.
// Returns TimeSeriesPoint[] at resolutionSeconds intervals.
// Total window length depends on pattern:
//   Most patterns:     startSimTime to startSimTime + speedSeconds
//   queue_burndown:    startSimTime to startSimTime + speedSeconds + 120s
//   sawtooth_rebound:  startSimTime to startSimTime + 2 × speedSeconds
// Noise is applied using the provided PRNG — caller positions it at the correct offset.
// Returns [] and logs a warning if called with pattern='cascade_clear' — the stakeholder
// engine expands cascade_clear into individual smooth_decay calls before reaching this function.
export function computeReactiveOverlay(
  params: ResolvedReactiveParams,
  startSimTime: number,
  resolutionSeconds: number,
  prng: SeededPRNG,
): TimeSeriesPoint[];
```

### 6.1 Per-pattern formulas

All formulas operate on `t` = elapsed seconds since `startSimTime` (i.e. `t=0` at the splice point). Noise is added after the deterministic shape using the archetype's `noiseType` and `noiseLevelMultiplier` from `ResolvedMetricParams`. Values are clamped to `[0, archetypeMax]` after noise.

Let:

- `C` = `currentValue`
- `T` = `targetValue`
- `S` = `speedSeconds`
- `λ` = `ln(20) / S` (ensures 95% convergence by `t = S` — i.e. within 5% of target at end of speed window)

| Pattern                   | Shape formula (before noise)                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smooth_decay`            | `v(t) = T + (C − T) × e^(−λt)`                                                                                                                                                                                                                                                                                                                                                               |
| `stepped`                 | 4 drops of `(C − T) / 4` at `t = S/4, S/2, 3S/4, S`. Flat between drops                                                                                                                                                                                                                                                                                                                      |
| `queue_burndown`          | `v(t) = C` for `t ∈ [0, S]`; then `v(t) = T + (C − T) × e^(−λ_cliff × (t − S))` where `λ_cliff = ln(2) / 15`. Total series window = `S + 120s` to allow the post-plateau decay to complete visibly. The 120s post-plateau extension uses the same `resolutionSeconds` interval.                                                                                                              |
| `oscillating / damping`   | `v(t) = T + (C − T) × cos(2πt / cycleSeconds) × e^(−t / S)`                                                                                                                                                                                                                                                                                                                                  |
| `oscillating / sustained` | `v(t) = M + A × cos(2πt / cycleSeconds)` where `M = (C + T) / 2`, `A = (C − T) / 2`                                                                                                                                                                                                                                                                                                          |
| `blip_then_decay`         | `v(t) = blipPeak` for `t ∈ [0, S × 0.1]`; then `smooth_decay` from `blipPeak` toward `T` with `λ`. `blipPeak = max(C × 1.3, C + 1)` — the `+1` floor ensures a visible blip even when `C` is near zero (e.g. error rate at 0%).                                                                                                                                                              |
| `cascade_clear`           | Caller passes per-metric `startSimTime` staggered by `S / metricCount`. Each metric uses `smooth_decay` independently. `cascade_clear` is resolved by the stakeholder engine into per-metric `smooth_decay` calls with offset start times — not a single formula                                                                                                                             |
| `sawtooth_rebound`        | Half 1 `t ∈ [0, S/2]`: `smooth_decay` from `C` toward `T`. Let `V_mid = T + (C − T) × e^(−λ × S/2)` (actual value at midpoint — not exactly T). Half 2 `t ∈ [S/2, S]`: linear ramp from `V_mid` back toward `incidentPeak`. Repeats for 2 full cycles (total window = `2S`). Two cycles are always computed — enough to make the oscillating nature visible without unbounded series growth. |
| `cliff`                   | `v(t) = C` for `t ∈ [0, 5]`; `v(t) = T` for `t > 5`                                                                                                                                                                                                                                                                                                                                          |

### 6.2 `cascade_clear` resolution

`cascade_clear` is not a single math formula — it's a sequencing strategy. When the stakeholder engine sees `pattern='cascade_clear'` in an `apply_metric_response` call, it expands it into multiple `smooth_decay` entries (one per affected metric) with staggered `startSimTime` offsets before passing them to `MetricStore.applyReactiveOverlay`. The ordering is:

1. Infrastructure archetypes: `cpu_utilization`, `memory_*`, `connection_pool_used`, `thread_count`
2. Quality archetypes: `error_rate`, `fault_rate`, `availability`, `p99_latency_ms`, `p50_latency_ms`
3. Business archetypes: `conversion_rate`, `active_users`, `request_rate`

Each group is delayed by `speedSeconds / 3` seconds from the previous group — `groupCount` is always 3 regardless of how many groups are actually present in a given call, so the stagger is predictable. Within a group, metrics recover simultaneously.

---

## 7. Stakeholder Engine Changes (`engine/stakeholder-engine.ts`)

### 7.1 Constructor signature

```typescript
export function createStakeholderEngine(
  llmClient: LLMClient,
  scenario: LoadedScenario,
  metricStore: MetricStore,
): StakeholderEngine;
```

### 7.2 Prompt context block

The stakeholder engine injects a metric response context block into every prompt. This block is built dynamically from the scenario topology so the LLM always has the current list of valid service/metric pairs.

```
Available metric response tool: apply_metric_response
Use after any trainee action that changes the incident trajectory.

Services and metrics in this scenario:
  payment-service: error_rate, p99_latency_ms, connection_pool_used, request_rate, cpu_utilization
  checkout-service: conversion_rate, error_rate, p99_latency_ms
  fraud-detection: error_rate, p99_latency_ms

Patterns:
  smooth_decay      — clean exponential curve, use for straightforward fixes
  stepped           — discrete drops, use for rolling restarts or gradual rollouts
  queue_burndown    — stays elevated then drops sharply, use when backlogs must drain first
  oscillating       — bounces before stabilizing or sustaining, use when fix is insufficient
                      or traffic retries keep hammering a recovering service
  blip_then_decay   — brief spike then recovery, use for restarts or failovers
  cascade_clear     — metrics recover in sequence (infra first, then quality, then business)
  sawtooth_rebound  — recovers then re-degrades, use when fix buys time but not root cause
  cliff             — near-instant flip, use for circuit breaker trips or hard failovers

Speed: 1m | 5m | 15m | 30m | 60m
Direction: recovery (toward resolved state) | worsening (toward incident peak)
Magnitude: full (complete) | partial (halfway to resolved state)

Rules:
- Only call apply_metric_response when a trainee action has actually changed the situation.
- Check the audit log — do not re-apply a response to a metric that already has an active
  reactive overlay in progress from the same action.
- Use direction=worsening when the action made the situation worse.
- Use magnitude=partial when the fix is incomplete or doesn't address root cause.
- Specify different patterns and speeds per metric in one call for asymmetric recovery.
- For oscillating: set oscillation_mode=sustained if root cause is not addressed.
- For cascade_clear: list all metrics across all affected services; ordering is automatic.
```

### 7.3 `apply_metric_response` execution

When the LLM returns `apply_metric_response` in its tool call response:

```
execute apply_metric_response(rawParams):

  1. Validate rawParams.affected_metrics is an array — reject entire call if not
  2. For each entry in affected_metrics:
     a. Resolve the service's metric list from LoadedScenario.opsDashboard:
        — if entry.service === scenario.opsDashboard.focalService.name:
            metricList = scenario.opsDashboard.focalService.metrics
        — else find in scenario.opsDashboard.correlatedServices where name === entry.service:
            metricList = correlatedService.overrides ?? []
        — if service not found in either: log "apply_metric_response: unknown service
          '<service>'", skip entry
     b. Validate metric_id exists in metricList (match on archetype used as metricId, or
        explicit label if present — same convention used by the metric generator):
        — if not found: log "apply_metric_response: unknown metric_id '<metricId>' on
          '<service>'", skip entry
     c. If pattern='oscillating':
        — validate oscillation_mode is 'damping' or 'sustained' — default to 'damping' if absent
        — clamp cycle_seconds to [30, 300] — default to 60 if absent
     d. Look up currentValue: metricStore.getCurrentValue(service, metricId, context.simTime)
        — if null: log and skip (metric may not have any points yet)
     e. Look up resolvedParams: metricStore.getResolvedParams(service, metricId)
        — if null: log and skip
     f. Resolve targetValue using resolveReactiveTarget(direction, magnitude,
        currentValue, resolvedParams.resolvedValue, resolvedParams.peakValue)
        — resolveReactiveTarget is imported from 'metrics/patterns/reactive-overlay'
     g. If pattern='cascade_clear': expand to per-metric smooth_decay entries with
        staggered startSimTime offsets (see §6.2). Each expanded entry is processed as a
        separate smooth_decay application: build its own ResolvedReactiveParams with
        pattern='smooth_decay' and call metricStore.applyReactiveOverlay with
        simTime = context.simTime + (groupIndex * speedSeconds / 3).
        The original cascade_clear entry is fully consumed by this expansion — no further
        processing of the original entry occurs.
     h. Build ResolvedReactiveParams
     i. Call metricStore.applyReactiveOverlay(resolvedReactiveParams, context.simTime)
        — void return; game loop streams metric_update events via getPointsInWindow on each tick
     j. Log to the server logger (structured):
        logger.info({ service, metricId, pattern, direction, speed, magnitude, simTime },
          'apply_metric_response executed')
        This is a system event, not a trainee action — it does not go in the trainee audit log
        and does not require a new GameLoop interface method.

  3. Return no SimEvents — metric_update events are streamed by the game loop
     as sim time advances past the new points (see §8)
```

---

## 8. Game Loop Changes (`engine/game-loop.ts`)

### 8.1 `MetricStore` in `GameLoopDependencies`

```typescript
export interface GameLoopDependencies {
  scenario: LoadedScenario;
  sessionId: string;
  clock: SimClock;
  scheduler: EventScheduler;
  auditLog: AuditLog;
  store: ConversationStore;
  evaluator: Evaluator;
  metricStore: MetricStore; // replaces the plain `metrics` Record — game loop owns streaming
  onDirtyTick?: (context: StakeholderContext) => Promise<SimEvent[]>;
  onCoachTick?: (context: StakeholderContext) => Promise<CoachMessage | null>;
}
```

The `metrics` field (plain `Record<string, Record<string, TimeSeriesPoint[]>>`) is removed from `GameLoopDependencies` and replaced by `metricStore`. The snapshot method reads from `metricStore.getAllSeries()`.

### 8.2 Streaming `metric_update` events

On each tick, after advancing sim time, the game loop queries the metric store for any new points that have become visible since the last tick:

```
tick():
  1. previousSimTime = clock.getSimTime()
  2. clock.tick(realElapsedMs)
  3. currentSimTime = clock.getSimTime()
  4. ... (scripted events, dirty check — unchanged)
  5. Stream newly-visible metric points:
     for each service in metricStore.getAllSeries():
       for each metricId in that service:
         newPoints = metricStore.getPointsInWindow(
           service, metricId,
           previousSimTime,     // exclusive: getPointsInWindow returns t > previousSimTime
           currentSimTime       // inclusive upper bound
         )
         for each point in newPoints:
           emit { type: 'metric_update', service, metricId, point } via onEvent
```

**Only points in the reactive-overlay window are streamed this way.** Pre-generated points are already in the `session_snapshot` — the client has them. The game loop must not re-emit pre-generated points. This is enforced by the `reactiveWindowEnd` field tracked per metric in `MetricStore` — `getPointsInWindow` returns an empty array immediately for metrics that have no active reactive overlay window (i.e. `reactiveWindowEnd` is undefined or `fromSimTime >= reactiveWindowEnd`).

### 8.3 `getSnapshot` update

```typescript
// Updated to read from MetricStore instead of the plain metrics Record
getSnapshot(): SessionSnapshot {
  return {
    ...
    metrics: metricStore.getAllSeries(),   // includes spliced reactive points
    ...
  }
}
```

This ensures reconnecting clients receive the full updated series including any reactive overlay points that have already been applied.

---

## 9. Session Factory Changes (`session/session.ts`)

```typescript
export async function createSession(
  scenarioId: string,
  scenario: LoadedScenario,
  llmClient: LLMClient,
): Promise<Session> {
  const sessionId = generateSessionId();

  // Generate metrics and resolved params
  const { series, resolvedParams } = generateAllMetrics(scenario, sessionId);
  //                                 ^ generateAllMetrics updated to return both
  //                                   (previously returned series only)

  // Create MetricStore
  const metricStore = createMetricStore(series, resolvedParams);

  // Build engine components (unchanged)
  const clock = createSimClock(scenario.timeline.defaultSpeed);
  const scheduler = createEventScheduler(scenario);
  const auditLog = createAuditLog();
  const store = createConversationStore();
  const evaluator = createEvaluator();

  populateInitialState(store, scenario);

  // StakeholderEngine now receives MetricStore
  const stakeholderEngine = createStakeholderEngine(
    llmClient,
    scenario,
    metricStore,
  );

  // GameLoop receives MetricStore instead of plain metrics Record
  const gameLoop = createGameLoop({
    scenario,
    sessionId,
    clock,
    scheduler,
    auditLog,
    store,
    evaluator,
    metricStore, // was: metrics
    onDirtyTick: (ctx) => stakeholderEngine.tick(ctx),
  });

  return {
    id: sessionId,
    scenarioId,
    scenario,
    gameLoop,
    debrief: null,
    createdAt: Date.now(),
    lastSseAt: Date.now(),
    status: "active",
  };
}
```

### `generateAllMetrics` return type change

`generateAllMetrics` currently returns `Record<string, Record<string, TimeSeriesPoint[]>>`. It is updated to also return the resolved params so the session factory can pass both to `createMetricStore`:

```typescript
// server/src/metrics/generator.ts — updated return type
export function generateAllMetrics(
  scenario: LoadedScenario,
  sessionId: string,
): {
  series: Record<string, Record<string, TimeSeriesPoint[]>>;
  resolvedParams: Record<string, Record<string, ResolvedMetricParams>>;
};
```

This is a breaking change to the `generator.ts` public interface. All callers (only the session factory) must be updated. Tests that call `generateAllMetrics` directly must destructure the new return shape.

---

## 10. Tool Definition (`llm/tool-definitions.ts`)

Add `apply_metric_response` to `EVENT_TOOLS`:

```typescript
{
  name: 'apply_metric_response',
  description: `Mutate live metric trajectories in response to a trainee action.
    Use this when the trainee has done something that changes the incident trajectory —
    either improving or worsening the situation. Specify each affected metric individually
    to model realistic asymmetric recovery. The server handles all math; you specify
    semantic parameters only.`,
  parameters: {
    type: 'object',
    required: ['affected_metrics'],
    properties: {
      affected_metrics: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['service', 'metric_id', 'direction', 'pattern', 'speed', 'magnitude'],
          properties: {
            service:          { type: 'string' },
            metric_id:        { type: 'string' },
            direction:        { type: 'string', enum: ['recovery', 'worsening'] },
            pattern:          { type: 'string', enum: [
              'smooth_decay', 'stepped', 'queue_burndown', 'oscillating',
              'blip_then_decay', 'cascade_clear', 'sawtooth_rebound', 'cliff'
            ]},
            speed:            { type: 'string', enum: ['1m', '5m', '15m', '30m', '60m'] },
            magnitude:        { type: 'string', enum: ['full', 'partial'] },
            oscillation_mode: { type: 'string', enum: ['damping', 'sustained'] },
            cycle_seconds:    { type: 'number', minimum: 30, maximum: 300 }
          }
        }
      }
    }
  }
}
```

`apply_metric_response` is always included in `getStakeholderTools` when `apply_metric_response` is enabled in `scenario.engine.llm_event_tools`. No `max_calls` constraint — the LLM may call it once per dirty tick (the per-entry validation handles bad references).

---

## 11. Validation (`llm/tool-definitions.ts` — `validateToolCall`)

`validateToolCall` checks structural validity only — that the required fields are present and the array is non-empty. It does **not** validate service/metric references; that would require access to the scenario topology, which the execution step in the stakeholder engine already has. Per-entry service/metric validation and skipping happens in §7.3, not here.

```typescript
// apply_metric_response structural validation in validateToolCall
case 'apply_metric_response':
  if (!Array.isArray(params.affected_metrics) || params.affected_metrics.length === 0) {
    return { valid: false, reason: 'affected_metrics must be a non-empty array' }
  }
  for (const entry of params.affected_metrics) {
    if (!entry.service || !entry.metric_id || !entry.direction ||
        !entry.pattern || !entry.speed || !entry.magnitude) {
      return { valid: false, reason: 'each affected_metrics entry requires service, metric_id, direction, pattern, speed, magnitude' }
    }
  }
  return { valid: true }
```

If structural validation passes, the call reaches §7.3 execution. There, each entry is individually validated against the scenario topology — unknown service or metric_id causes that entry to be logged and skipped; the remaining entries are still executed. The overall call is never rejected wholesale due to a bad reference on one entry.

---

## 12. Mock Mode

The `apply_metric_response` tool call fits the existing `after_action` mock trigger format with no changes to `MockProvider`.

The `_fixture` scenario mock entry must use the fixture's actual service and metric names (one focal service, one `error_rate` metric — per LLD 01 §4):

```yaml
# scenarios/_fixture/mock-llm-responses.yaml — add to existing stakeholder_responses

- trigger: after_action:trigger_rollback:fixture-service
  tool_calls:
    - tool: apply_metric_response
      params:
        affected_metrics:
          - service: fixture-service
            metric_id: error_rate
            direction: recovery
            pattern: smooth_decay
            speed: 5m
            magnitude: full
```

The following is an illustrative example using the `api-error-rate-spike` launch scenario topology, showing multi-metric asymmetric recovery:

```yaml
# scenarios/api-error-rate-spike/mock-llm-responses.yaml

stakeholder_responses:
  - trigger: after_action:trigger_rollback:payment-service
    tool_calls:
      - tool: apply_metric_response
        params:
          affected_metrics:
            - service: payment-service
              metric_id: error_rate
              direction: recovery
              pattern: smooth_decay
              speed: 5m
              magnitude: full
            - service: payment-service
              metric_id: p99_latency_ms
              direction: recovery
              pattern: queue_burndown
              speed: 15m
              magnitude: full
            - service: checkout-service
              metric_id: conversion_rate
              direction: recovery
              pattern: smooth_decay
              speed: 15m
              magnitude: full
      - tool: send_message
        params:
          persona: checkout-eng
          channel: "#incidents"
          message: "Looks like things are recovering on our side"

  - trigger: after_action:scale_cluster:payment-service
    tool_calls:
      - tool: apply_metric_response
        params:
          affected_metrics:
            - service: payment-service
              metric_id: error_rate
              direction: worsening
              pattern: smooth_decay
              speed: 1m
              magnitude: partial
```

---

## 13. Test Strategy

### `metric-store.test.ts`

```
createMetricStore:
  - getAllSeries() returns copy of full pre-generated series
  - getCurrentValue() returns correct value at simTime
  - getCurrentValue() returns value of most recent point when simTime is between resolution intervals
  - getCurrentValue() for unknown service returns null
  - getCurrentValue() for unknown metricId returns null
  - getPointsInWindow() returns only points with t in [from, to]
  - getPointsInWindow() returns empty array when no points in window
  - getResolvedParams() returns correct ResolvedMetricParams
  - getResolvedParams() for unknown service/metric returns null

applyReactiveOverlay:
  - points before simTime unchanged
  - points at t >= simTime replaced by overlay series
  - splice point is first stored t >= simTime, not necessarily exactly simTime
    (e.g. simTime=95 with resolution=30 splices at t=120, preserving t=90 pre-generated)
  - getAllSeries() reflects spliced values after apply
  - getAllSeries() returns deep copy — mutating returned Record does not affect store state
  - second applyReactiveOverlay starts from actual current value, not incident_peak
  - PRNG continues seamlessly: noise at splice boundary is not discontinuous
  - getPointsInWindow() on reactive window returns only newly-spliced points
    (pre-generated points outside window not returned)
  - getPointsInWindow() at exactly reactiveWindowEnd returns that point (inclusive upper bound)
  - getPointsInWindow() with fromSimTime > reactiveWindowEnd returns empty immediately
  - overlay window length accounts for pattern-specific extension
    (queue_burndown: speedSeconds + 120s, sawtooth_rebound: 2 × speedSeconds, others: speedSeconds)
```

### `patterns/reactive-overlay.test.ts`

```
REACTIVE_SPEED_SECONDS:
  - '1m'=60, '5m'=300, '15m'=900, '30m'=1800, '60m'=3600

resolveReactiveTarget:
  - recovery + full → resolvedValue
  - recovery + partial → midpoint(currentValue, resolvedValue)
  - worsening + full → incidentPeak
  - worsening + partial → midpoint(currentValue, incidentPeak)
  - worsening when currentValue >= incidentPeak → currentValue * 1.2

computeReactiveOverlay — smooth_decay:
  - first point near currentValue (within noise range)
  - value at t=speedSeconds within 5% of targetValue (λ = ln(20)/S guarantees this)
  - noise present: two calls with different PRNGs produce different series
  - same PRNG + same params → identical series (determinism)

computeReactiveOverlay — stepped:
  - exactly 4 step-down events across speedSeconds (recovery direction)
  - each step approximately (currentValue - targetValue) / 4
  - no overshoot below targetValue (recovery)
  - direction=worsening: 4 upward steps toward incidentPeak, no overshoot above incidentPeak

computeReactiveOverlay — queue_burndown:
  - values near currentValue for first speedSeconds of window
  - sharp drop begins after speedSeconds
  - value near targetValue within 60s after plateau ends
  - total series length = speedSeconds + 120s
  - noise present throughout including plateau

computeReactiveOverlay — oscillating / damping:
  - value crosses midpoint multiple times (oscillating)
  - amplitude measurably smaller at t=speedSeconds than at t=0
  - cycle period approximately cycleSeconds

computeReactiveOverlay — oscillating / sustained:
  - value oscillates at approximately constant amplitude
  - mean value near midpoint(currentValue, targetValue)
  - cycle_seconds=30 produces ~2× cycles of cycle_seconds=60 over same window

computeReactiveOverlay — blip_then_decay:
  - blipPeak = max(C × 1.3, C + 1) — verified for both C=5 (30% case) and C=0.5 (floor case)
  - first point(s) at approximately blipPeak (within noise range)
  - blip duration approximately speedSeconds * 0.1
  - value decays toward targetValue after blip

computeReactiveOverlay — sawtooth_rebound:
  - value decays toward targetValue in first half of speedSeconds
  - value re-degrades in second half
  - full series covers 2 × speedSeconds (two complete cycles)
  - pattern repeats exactly once (two cycles total)

computeReactiveOverlay — cliff:
  - value near currentValue at t < 5s
  - value near targetValue at t >= 5s
  - noise only after cliff (no pre-cliff drift)

computeReactiveOverlay — worsening direction:
  - values move away from resolvedValue toward incidentPeak
  - all patterns work with direction=worsening (tested for smooth_decay and cliff)

clamp behavior:
  - no value below 0 for any pattern
  - error_rate values never exceed 100
```

### `stakeholder-engine-reactive.test.ts`

```
apply_metric_response — happy paths:
  - valid single-metric call → metricStore.applyReactiveOverlay called with correct params
  - valid multi-metric call → applyReactiveOverlay called once per valid entry
  - direction=worsening → targetValue resolves toward incidentPeak
  - magnitude=partial → targetValue is midpoint
  - oscillating with oscillation_mode absent → defaults to 'damping'
  - cycle_seconds=10 → clamped to 30 before ResolvedReactiveParams built
  - cycle_seconds=500 → clamped to 300
  - cascade_clear → expanded to per-metric smooth_decay with staggered startSimTime:
      infra metrics start at context.simTime,
      quality metrics start at context.simTime + speedSeconds/3,
      business metrics start at context.simTime + 2×speedSeconds/3
  - apply_metric_response execution logged to server logger for each valid entry
  - no SimEvents returned from tick (game loop handles metric_update streaming)

apply_metric_response — error paths:
  - unknown service → entry skipped, logged, other entries executed
  - unknown metric_id → entry skipped, logged, other entries executed
  - metricStore.getCurrentValue returns null → entry skipped, logged
  - all entries invalid → empty application, no crash
  - apply_metric_response alongside send_message → both executed independently
```

### Generator test update

The `generateAllMetrics` return type changes from a plain series Record to `{ series, resolvedParams }`. Existing tests in `server/__tests__/metrics/generator.test.ts` (from Phase 2) that call `generateAllMetrics` directly must be updated to destructure the new shape. No new test cases are needed — this is a mechanical update to existing tests.

```
generateAllMetrics (updated return type):
  - returns { series, resolvedParams } — not series directly
  - resolvedParams contains ResolvedMetricParams for all metrics on all services
  - resolvedParams[service][metricId].resolvedValue equals baseline_value when not authored
  - resolvedParams[service][metricId].resolvedValue equals authored resolved_value when present
```

All other existing generator tests remain valid — the series content is unchanged.

### Integration test addition (`routes/sessions.test.ts` update)

The existing Phase 6 integration test suite must be extended with one end-to-end case that verifies the full reactive overlay path:

```
POST /api/sessions/:id/actions (trigger_rollback) with MOCK_LLM=true:
  - mock LLM returns apply_metric_response for after_action:trigger_rollback trigger
  - subsequent GET /api/sessions/:id/events stream contains metric_update events
  - metric_update events have correct service, metricId, and point.v approaching targetValue
  - metric_update events are not emitted for metrics without active reactive overlays
```

This test lives in `server/__tests__/routes/sessions.test.ts` alongside the existing integration tests and uses the fixture scenario and `MOCK_LLM=true`.

---

## 14. Definition of Done

- [ ] `ReactiveOverlayType` and `ReactiveSpeedTier` exported from `shared/types/events.ts`
- [ ] `resolved_value` added to metric config Zod schema — optional, non-negative number
- [ ] `resolveMetricParams` populates `resolvedValue` — defaults to `baselineValue`
- [ ] `generateAllMetrics` returns `{ series, resolvedParams }` — all callers updated
- [ ] `MetricStore` interface implemented with `getAllSeries`, `getCurrentValue`, `applyReactiveOverlay` (void), `getPointsInWindow`, `getResolvedParams`
- [ ] PRNG continuation across splice point is seamless — verified by test
- [ ] All 8 reactive overlay patterns implemented in `computeReactiveOverlay`
- [ ] `cascade_clear` expansion logic in stakeholder engine produces staggered smooth_decay entries
- [ ] `apply_metric_response` added to `EVENT_TOOLS` with correct JSON Schema
- [ ] `validateToolCall` validates service/metric_id per entry — invalid entries skipped, not rejected wholesale
- [ ] `createStakeholderEngine` accepts `MetricStore` parameter
- [ ] Stakeholder engine prompt includes metric response context block with live service/metric list
- [ ] Stakeholder engine executes `apply_metric_response` — validates service/metric against `LoadedScenario.opsDashboard` structure, builds `ResolvedReactiveParams`, calls `metricStore.applyReactiveOverlay`
- [ ] `apply_metric_response` execution logged to server logger (service, metricId, pattern, direction, speed, simTime)
- [ ] `GameLoopDependencies.metrics` replaced by `metricStore` — plain Record removed
- [ ] Game loop streams `metric_update` SSE events for reactive overlay points only (not pre-generated)
- [ ] `gameLoop.getSnapshot().metrics` returns updated series including spliced reactive points
- [ ] Session factory creates `MetricStore` and passes it to `StakeholderEngine` and `GameLoop`
- [ ] `_fixture` scenario `mock-llm-responses.yaml` has `apply_metric_response` entries for `after_action:trigger_rollback` trigger
- [ ] All tests in §13 pass with `MOCK_LLM=true`
- [ ] Integration test in `routes/sessions.test.ts` verifies end-to-end: action → mock `apply_metric_response` → `metric_update` SSE events emitted
- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] No `any` types
