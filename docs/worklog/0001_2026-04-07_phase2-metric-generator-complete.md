# 0001 — Phase 2: Metric Generator

**Date:** 2026-04-07
**Phase:** 2 — Metric Generator
**Status:** Complete

---

## What Was Done

Implemented the full deterministic metric time-series generator. This module is pure server-side with no LLM, no SSE, and no session state — it takes resolved metric parameters and returns `TimeSeriesPoint[]` arrays. Called once per session at creation time.

### `server/src/metrics/types.ts`

Internal module types:

- `ResolvedMetricParams` — fully concrete parameter set after resolution; every generation function operates on this
- `NoiseType` — `'gaussian' | 'random_walk' | 'sporadic_spikes' | 'sawtooth_gc' | 'none'`
- `OverlayType` — `'spike_and_sustain' | 'sudden_drop' | 'saturation' | 'gradual_degradation' | 'none'`

### `server/src/metrics/archetypes.ts`

Registry of all metric archetypes matching HLD §8.4:

- 24+ archetypes registered: `error_rate`, `fault_rate`, `availability`, `request_rate`, `p99_latency_ms`, `p50_latency_ms`, `cpu_utilization`, `memory_heap`, `memory_jvm`, `gc_pause_ms`, `connection_pool_used`, `queue_depth`, `cache_hit_rate`, `disk_io_util`, `network_rx_bytes`, `network_tx_bytes`, `db_query_time_ms`, `thread_count`, `open_file_descriptors`, `cert_expiry`, `lambda_duration_ms`, `lambda_cold_starts`, `sqs_message_age`, `dynamo_consumed_rcu`
- Each archetype specifies: label, unit, noise type, whether it inherits rhythm, default noise level, scale field for baseline derivation, derive-baseline function, min/max value constraints
- `getArchetypeDefaults(archetype)` — throws for unknown archetypes (validation catches this first)
- `getValidArchetypes()` — returns all valid archetype names; used by cross-reference validation in Phase 3

### `server/src/metrics/incident-types.ts`

Registry of five incident types and their per-archetype response profiles:

- `bad_deploy_latency` — spike_and_sustain on latency and error_rate, gradual on cpu
- `memory_leak` — gradual_degradation on memory_jvm, memory_heap; GC pause escalation
- `dependency_outage` — spike_and_sustain on error_rate/fault_rate (high peak factor 20×), sudden_drop on availability
- `traffic_spike` — spike_and_sustain on request_rate, saturation on cpu and connection pools
- `connection_pool_exhaustion` — saturation on connection_pool_used, spike_and_sustain on latency
- `getIncidentResponse(incidentType, archetype)` — returns profile or null
- `validateIncidentType(incidentType)` — returns boolean; used by loader to warn on unknown types

### `server/src/metrics/resolver.ts`

Parameter resolution chain (precedence: author config → incident type registry → archetype defaults → scale derivation):

- Resolves full `ResolvedMetricParams` for a single metric config entry
- PRNG seed derived via djb2 hash of `scenarioId:sessionId:metricId`
- Noise multiplier = noise level multiplier (low=0.5, medium=1.0, high=2.0, extreme=4.0) × health multiplier (healthy=1.0, degraded=1.5, flaky=2.5)
- Baseline derived from `scale.typicalRps`, `scale.instanceCount`, or `scale.maxConnections` when `baselineValue` omitted, based on archetype's `scaleField`
- `seriesOverride` presence sets a flag to skip all generation layers

### `server/src/metrics/patterns/baseline.ts`

Flat baseline array — repeats `baselineValue` for each time axis point.

### `server/src/metrics/patterns/rhythm.ts`

Traffic pattern deltas for six profiles:

- `business_hours_web` — sinusoidal daily pattern, peak ~19:00 UTC, trough ~03:00 UTC, 55% weekend factor
- `business_hours_b2b` — similar but steeper B2B curve
- `always_on_api` — flat ripple (minimal variation)
- `batch_nightly` — flat outside batch window (02:00–04:00 UTC), large spike during window
- `batch_weekly` — flat most of week, spike on Sunday night
- `none` — all zeros

### `server/src/metrics/patterns/noise.ts`

Five noise types, all using seeded PRNG (never `Math.random()`):

- `gaussian` — independent samples with configurable std dev factor
- `random_walk` — mean-reverting walk with configurable step std dev and reversion strength
- `sporadic_spikes` — gaussian baseline with random positive spikes at configurable probability
- `sawtooth_gc` — monotonic growth between GC events, periodic drops at `gcPeriodSeconds`
- `none` — all zeros

`createSeededPRNG(seed)` — djb2-based deterministic PRNG.
`NOISE_TYPE_DEFAULTS` — exported parameter reference for tests.

### `server/src/metrics/patterns/incident-overlay.ts`

Four overlay types applied on top of baseline+rhythm+noise:

- `spike_and_sustain` — ramps to peak over `rampDurationSeconds`, sustains; noise preserved through incident window
- `sudden_drop` — multiplies values at/after onset by `(1 - dropFactor)`
- `saturation` — climbs from baseline to ceiling over `saturationDurationSeconds`
- `gradual_degradation` — linear ramp from onset to end of scenario; supports negative onset seconds (pre-incident degradation)
- `clampSeries(series, min, max)` — enforces bounds (percentage metrics clamped to [0, 100])

### `server/src/metrics/correlation.ts`

Derives correlated service metrics from the focal service's generated series:

- `upstream_impact` — propagates incident delta (error_rate, fault_rate, availability, p99_latency_ms, p50_latency_ms, request_rate) with `impactFactor` scaling and `lagSeconds` time shift; infrastructure archetypes generate baseline+noise only
- `exonerated` / `independent` — generate baseline+noise only; no incident overlay
- Override metrics generated independently and replace derived metrics
- `extractIncidentDelta(focalSeries, params)` — extracts the incident overlay component from a focal series

### `server/src/metrics/generator.ts`

Orchestrator — entry point called once per session:

- Builds time axis: `range(-preIncidentSeconds, durationSeconds, resolutionSeconds)`
- For each focal service metric: resolve → (seriesOverride bypass OR baseline → rhythm → noise → incident overlay) → clamp → zip to `TimeSeriesPoint[]`
- For each correlated service: derive via `correlation.ts` with override substitution
- Returns `Record<service, Record<metricId, TimeSeriesPoint[]>>` matching `SessionSnapshot.metrics` exactly

### `server/src/metrics/series.ts`

Utility for building and manipulating time series arrays; shared by generator and correlation.

---

## Test Results

| File | Tests |
|---|---|
| `archetypes.test.ts` | 16 |
| `incident-types.test.ts` | 10 |
| `resolver.test.ts` | 17 |
| `generator.test.ts` | 8 |
| `patterns/baseline.test.ts` | 4 |
| `patterns/rhythm.test.ts` | 8 |
| `patterns/noise.test.ts` | 17 |
| `patterns/incident-overlay.test.ts` | 15 |
| `correlation.test.ts` | 9 |
| **Total** | **104** |

- **Pass rate:** 104/104
- **Known failures:** None
- **Typecheck:** Clean
- **Lint:** Clean

---

## Known Issues

`spike_and_recover` overlay type is deferred to Phase 2 as noted in the LLD. All other overlay types are implemented. The `OverlayType` union includes `spike_and_recover` as a placeholder; the generator treats it as `'none'` until Phase 2 implements it.

---

## What Comes Next

Phase 3 — Scenario Loader and Validation: implement `loader.ts` and `validator.ts`; wire in `generateAllMetrics` call from session factory (Phase 6).
