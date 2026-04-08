# LLD 02 — Metric Generator

**Phase:** 2
**Depends on:** Phase 1 (shared types, scenario config types, testutil)
**HLD sections:** §8.3, §8.4

---

## Purpose

Generate realistic time-series metric data from declarative scenario config. Pure server-side module — no LLM, no SSE, no session state. Takes resolved metric parameters and returns `TimeSeriesPoint[]` arrays. Fully tested in isolation.

All types imported from Phase 1:
- `TimeSeriesPoint` — from `shared/types/events.ts`
- `LoadedScenario`, `MetricConfig`, `FocalServiceConfig`, `CorrelatedServiceConfig`, `ServiceScale`, `OpsDashboardConfig`, `NoiseLevel`, `HealthLevel`, `TrafficProfile`, `CorrelationType` — from `server/src/scenario/types.ts`

---

## Scope

```
server/src/metrics/
  generator.ts          # orchestrator
  resolver.ts           # parameter resolution chain
  incident-types.ts     # incident type registry
  archetypes.ts         # archetype defaults
  correlation.ts        # upstream_impact and exonerated derivation
  patterns/
    baseline.ts
    rhythm.ts
    noise.ts
    incident-overlay.ts
```

---

## 1. Data Model

### Resolved metric parameters

After resolution, every metric has a fully concrete parameter set before any generation occurs. `LoadedScenario`, `NoiseLevel`, `HealthLevel`, and `TrafficProfile` are imported from Phase 1 `scenario/types.ts`.

```typescript
// Internal to the metrics module — not exported to shared/
interface ResolvedMetricParams {
  // Identity
  metricId:   string
  service:    string
  archetype:  string
  label:      string
  unit:       string

  // Generation window
  fromSecond:        number   // -pre_incident_seconds
  toSecond:          number   // scenario_duration_seconds
  resolutionSeconds: number

  // Baseline
  baselineValue: number

  // Rhythm
  rhythmProfile:  TrafficProfile
  inheritsRhythm: boolean

  // Noise
  noiseType:            NoiseType
  noiseLevelMultiplier: number   // resolved noise level × health multiplier

  // Incident overlay — all fields always present after resolution
  // overlay: 'none' means no incident effect
  overlay:                     OverlayType
  onsetSecond:                 number   // always relative to t=0
  peakValue:                   number
  dropFactor:                  number
  ceiling:                     number
  saturationDurationSeconds:   number
  rampDurationSeconds:         number

  // Series override — if present, skip all generation layers and use directly
  seriesOverride: Array<{ t: number; v: number }> | null

  // PRNG seed — derived from hash(scenarioId + sessionId + metricId)
  seed: number
}

// Noise level multiplier mapping (applied on top of archetype defaults)
// low=0.5, medium=1.0, high=2.0, extreme=4.0
// Health multiplier: healthy=1.0, degraded=1.5, flaky=2.5
// Final multiplier = noiseLevel multiplier × health multiplier

type NoiseType    = 'gaussian' | 'random_walk' | 'sporadic_spikes' | 'sawtooth_gc' | 'none'
type OverlayType  = 'spike_and_sustain' | 'sudden_drop' | 'saturation'
                  | 'gradual_degradation' | 'none'
                  // spike_and_recover is Phase 2
```

---

## 2. Module Interfaces

### `generator.ts`

```typescript
// Entry point. Called once per session at scenario start.
// Returns all metric series for all services, keyed for the SessionSnapshot.
export function generateAllMetrics(
  scenario: LoadedScenario,
  sessionId: string
): Record<string, Record<string, TimeSeriesPoint[]>>
// Returns: { 'payment-service': { 'error_rate': [...], ... }, ... }
```

### `resolver.ts`

```typescript
// Resolves full parameters for a single metric config entry.
// Precedence: author config → incident type registry → archetype defaults → scale derivation.
export function resolveMetricParams(
  metricConfig: MetricConfig,
  serviceConfig: FocalServiceConfig | CorrelatedServiceConfig,
  scenarioConfig: LoadedScenario,
  sessionId: string
): ResolvedMetricParams

// Validates that an incident_type exists in the registry.
// Returns true if found, logs a warning and returns false if not.
export function validateIncidentType(incidentType: string): boolean
```

### `incident-types.ts`

```typescript
// Registry lookup: returns the response profile for a given
// (incident_type, archetype) pair, or null if not registered.
export function getIncidentResponse(
  incidentType: string,
  archetype: string
): IncidentResponseProfile | null

interface IncidentResponseProfile {
  overlay:           OverlayType
  defaultPeakFactor: number    // multiplier on baseline
  defaultOnsetOffset: number   // seconds relative to t=0
}

// Full registry — the source of truth for all built-in incident types.
// Exported for use in tests and for documentation.
export const INCIDENT_TYPE_REGISTRY: Record<string, Record<string, IncidentResponseProfile>>
```

### `archetypes.ts`

```typescript
// Returns archetype defaults for a given archetype name.
// Throws if archetype is not registered — validation should catch this first.
export function getArchetypeDefaults(archetype: string): ArchetypeDefaults

interface ArchetypeDefaults {
  label:             string
  unit:              string
  noiseType:         NoiseType
  inheritsRhythm:    boolean
  defaultNoiseLevel: NoiseLevel   // from scenario/types.ts
  // Which scale field drives baseline derivation, or null if author must supply baseline_value
  scaleField: 'typical_rps' | 'instance_count' | 'max_connections' | null
  // Derives baseline from scale value. null means no scale derivation — author must provide baseline_value.
  deriveBaseline: ((scaleValue: number) => number) | null
}

// Returns all valid archetype names. Used by schema cross-reference validation in Phase 1.
export function getValidArchetypes(): string[]
```

### `correlation.ts`

```typescript
// Derives correlated service metrics from the focal service's generated series.
// Only propagates traffic and quality archetypes (error_rate, fault_rate,
// availability, p99_latency_ms, p50_latency_ms, request_rate).
export function deriveCorrelatedMetrics(
  correlationConfig: CorrelatedServiceConfig,
  focalSeries: Record<string, TimeSeriesPoint[]>,
  focalResolvedParams: Record<string, ResolvedMetricParams>,
  scenarioConfig: LoadedScenario,
  sessionId: string
): Record<string, TimeSeriesPoint[]>

// Extracts only the incident overlay delta from a focal service series.
// Used by upstream_impact derivation.
export function extractIncidentDelta(
  focalSeries: TimeSeriesPoint[],
  params: ResolvedMetricParams
): TimeSeriesPoint[]
```

---

## 3. Pattern Module Interfaces

Each pattern module operates on a time axis array (`number[]` of sim seconds) and returns a delta array of the same length.

### `patterns/baseline.ts`

```typescript
// Returns a flat array of baselineValue repeated for each time point.
export function generateBaseline(
  baselineValue: number,
  tAxis: number[]
): number[]
```

### `patterns/rhythm.ts`

```typescript
// Returns rhythm deltas for each time point.
// Returns all zeros if profile is 'none' or archetype does not inherit rhythm.
export function generateRhythm(
  profile: TrafficProfile,
  baselineValue: number,
  tAxis: number[]
): number[]

// Profile parameter definitions (used internally and exported for tests)
export const TRAFFIC_PROFILES: Record<TrafficProfile, TrafficProfileParams>

interface TrafficProfileParams {
  pattern: 'sinusoidal_weekly' | 'sinusoidal_daily' | 'sawtooth_daily'
           | 'sawtooth_weekly' | 'flat_ripple' | 'flat'
  dailyPeakFactor:   number
  dailyTroughFactor: number
  peakHourUTC:       number
  weekendFactor:     number
  batchWindowHourUTC?: number
  batchDurationHours?: number
}
```

### `patterns/noise.ts`

```typescript
// Returns noise deltas for each time point.
// Uses the provided seeded PRNG — never uses Math.random().
export function generateNoise(
  noiseType: NoiseType,
  baselineValue: number,
  noiseLevelMultiplier: number,
  tAxis: number[],
  prng: SeededPRNG
): number[]

// Seeded PRNG — deterministic given the same seed.
export interface SeededPRNG {
  next(): number   // returns value in [0, 1)
}

export function createSeededPRNG(seed: number): SeededPRNG

// Statistical parameters for each noise type at noiseLevelMultiplier=1.0.
// Exported so tests can verify generated series stay within expected bounds.
interface NoiseTypeParams {
  stdDevFactor?:       number   // gaussian: std dev as fraction of baselineValue
  walkStdDev?:         number   // random_walk: per-step std dev
  reversionStrength?:  number   // random_walk: pull-back toward baseline per step
  baseSdFactor?:       number   // sporadic_spikes: gaussian base std dev factor
  spikeProbability?:   number   // sporadic_spikes: probability of spike per point
  spikeMagnitudeFactor?: number // sporadic_spikes: spike height as fraction of baseline
  gcPeriodSeconds?:    number   // sawtooth_gc: GC interval in sim seconds
  gcDropFactor?:       number   // sawtooth_gc: fraction of heap dropped at GC
  interGcGrowthRate?:  number   // sawtooth_gc: MB/s growth between GC events
}

export const NOISE_TYPE_DEFAULTS: Record<NoiseType, NoiseTypeParams>
```

### `patterns/incident-overlay.ts`

```typescript
// Applies the incident overlay to an existing series (baseline + rhythm + noise).
// Transforms values in-place for t >= onsetSecond.
// Does NOT replace values — adds the incident delta on top of existing noise.
export function applyIncidentOverlay(
  series: number[],
  params: ResolvedMetricParams,
  tAxis: number[]
): number[]

// Clamps all values to [0, maxValue]. maxValue defaults to Infinity.
// Called after overlay application.
export function clampSeries(
  series: number[],
  minValue: number,
  maxValue: number
): number[]
```

---

## 4. Generation Algorithm

```
generateAllMetrics(scenario, sessionId):
  1. Build time axis:
     tAxis = range(-pre_incident_seconds, duration_seconds, resolutionSeconds)

  2. For each metric on focal_service:
     a. resolve params → ResolvedMetricParams (resolver.ts)
     b. if params.seriesOverride is not null:
          use seriesOverride directly → skip to step (g)
     c. generate baseline layer (baseline.ts)
     d. add rhythm deltas (rhythm.ts) — zeros if inheritsRhythm=false or profile='none'
     e. add noise deltas (noise.ts) using seeded PRNG from params.seed
     f. apply incident overlay (incident-overlay.ts) — no-op if overlay='none'
     g. clamp to [0, Infinity] (error rates clamped to [0, 100] by archetype max)
     h. zip with tAxis → TimeSeriesPoint[] { t, v }

  3. For each correlated_service:
     a. for upstream_impact:
          - generate independent baseline+rhythm+noise for this service's scale/health
          - extract incident delta from focal series (correlation.ts)
          - add scaled+shifted focal incident delta for propagated archetypes only
            (error_rate, fault_rate, availability, p99_latency_ms, p50_latency_ms, request_rate)
          - infrastructure archetypes generate baseline+noise only (no incident effect)
     b. for exonerated / independent:
          - generate baseline+rhythm+noise only; overlay is always 'none'
     c. apply overrides last — each override metric config is generated independently
        (Tier 2/3) and replaces the derived series for that metricId
     d. clamp all

  4. Return nested Record<service, Record<metricId, TimeSeriesPoint[]>>
     Shape matches SessionSnapshot.metrics exactly (defined in Phase 1)
```

---

## 5. PRNG Seeding

```typescript
// Seed derivation — called once per metric
function deriveMetricSeed(scenarioId: string, sessionId: string, metricId: string): number {
  const str = `${scenarioId}:${sessionId}:${metricId}`
  // djb2 hash
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i)
    hash |= 0  // force 32-bit integer
  }
  return Math.abs(hash)
}
```

Each metric gets its own PRNG instance. Metrics on the same service have independent noise — no correlated jitter across metrics.

---

## 6. Test Strategy

All tests use `buildFlatSeries` and `createSeededPRNG` from `testutil`. No tests make LLM calls or load real scenarios (except the fixture integration test).

### `generator.test.ts`

```
generateAllMetrics with fixture scenario:
  - returns series for focal service metrics
  - returns series for all correlated services
  - series length = (pre_incident_seconds + duration_seconds) / resolution_seconds
  - all t values within expected range
  - same sessionId → identical series (PRNG determinism)
  - different sessionId → different series
```

### `resolver.test.ts`

```
resolveMetricParams:
  - author incident_peak overrides registry default factor
  - author onset_second overrides registry default
  - archetype baseline derived from scale when baseline_value omitted
  - noise level × health multiplier computes correctly for all combinations
  - unrecognized incident_type: logs warning, returns overlay: 'none' for Tier 1 metrics
  - series_override presence: resolved params marked to skip generation
```

### `incident-types.test.ts`

```
getIncidentResponse:
  - returns profile for all registered (incident_type, archetype) pairs
  - returns null for unregistered pairs
  - all five incident types have entries for their key archetypes
```

### `patterns/baseline.test.ts`

```
generateBaseline:
  - all values equal baselineValue
  - length matches tAxis length
```

### `patterns/rhythm.test.ts`

```
generateRhythm:
  - 'none' profile returns all zeros
  - business_hours_web: peak near hour 19 UTC, trough near hour 3
  - business_hours_web: weekend values ≈ 55% of weekday peak
  - batch_nightly: flat outside batch window, spike during window
  - all rhythms stay within expected factor bounds
```

### `patterns/noise.test.ts`

```
gaussian noise:
  - mean within ±10% of 0 over 1000 samples (statistical test)
  - std dev within ±20% of expected std dev over 1000 samples
  - same seed → identical sequence
  - different seed → different sequence

random_walk:
  - values stay within 3× std dev of baseline over 500 samples
  - shows autocorrelation (adjacent values correlated)

sporadic_spikes:
  - spike frequency within ±50% of expected probability over 1000 samples
  - baseline portion has gaussian distribution
  - spikes are strictly positive

sawtooth_gc:
  - GC drops occur at expected interval (± 1 resolution period)
  - values monotonically increase between GC events
  - values drop at GC events by approximately gc_drop_factor
```

### `patterns/incident-overlay.test.ts`

```
spike_and_sustain:
  - values before onsetSecond unchanged
  - values at and after onsetSecond elevated toward peakValue
  - noise preserved through incident window (values not identical pre/post onset)

sudden_drop:
  - values before onsetSecond unchanged
  - values at onsetSecond reduced by dropFactor
  - values remain reduced after onsetSecond

saturation:
  - values climb from baseline to ceiling over saturation_duration_seconds
  - values do not exceed ceiling after saturation

gradual_degradation:
  - values climb linearly from onsetSecond to end of scenario
  - onset at negative second starts climb before t=0

clampSeries:
  - no values below minValue
  - no values above maxValue
```

### `correlation.test.ts`

```
deriveCorrelatedMetrics (upstream_impact):
  - propagated archetypes (error_rate, etc.) contain incident delta from focal
  - propagated delta scaled by impact_factor
  - propagated delta shifted by lag_seconds
  - infrastructure archetypes (cpu_utilization, etc.) NOT propagated
  - override metrics present: override replaces derived metric entirely

deriveCorrelatedMetrics (exonerated):
  - no incident overlay on any metric
  - baseline + noise present and within normal bounds
  - override metrics generated independently
```

---

## 7. Definition of Done

- [ ] All module interfaces implemented with no `any`
- [ ] All five incident types registered in `incident-types.ts`
- [ ] All archetypes in HLD §8.4 registered in `archetypes.ts`
- [ ] `series_override` bypass implemented in generator
- [ ] PRNG seeding deterministic — verified by test
- [ ] All test cases listed in §6 pass
- [ ] Uses `testutil` helpers — no duplicated test setup
- [ ] `generateAllMetrics` called with fixture scenario produces valid output
