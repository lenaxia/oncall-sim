# LLD 11 — Component Topology, Auto-Generated Metrics, and Reaction Menu

**Phase:** 11
**Depends on:** LLD 01–10 (all implemented)
**HLD sections:** §7, §8, §16 (extensions)

---

## Purpose

This document specifies three tightly related changes that together make scenario
authoring significantly less burdensome while making LLM metric reactions more
reliable:

1. **Component topology** — `topology.focal_service` gains a `components[]` array
   that describes the internal microservice architecture (ECS cluster, Lambda,
   DynamoDB, Kinesis, etc.) using a defined vocabulary. Upstream and downstream
   services gain optional `components[]` for the same purpose.

2. **Auto-generated ops dashboard** — when `ops_dashboard.focal_service.metrics`
   is absent, the system derives the full metric list, baseline values, and
   incident overlay parameters from the component topology and `incidents[]` array.
   Authors declare architecture and intent; the system handles the metric plumbing.

3. **Reaction menu** — the `apply_metric_response` tool is replaced by
   `select_metric_reaction`. The engine pre-computes a small named set of
   physically correct outcomes before each LLM call. The LLM selects the
   appropriate outcome by id. The engine applies the pre-computed overlays.
   This eliminates magic-string metric names, freeform pattern selection, and
   LLM-driven arithmetic.

---

## Scope

### New files

```
client/src/metrics/
  component-metrics.ts         # canonical metric specs per ComponentType
  reaction-menu.ts             # ReactionMenu builder — pre-computes outcome set per action

client/src/scenario/
  component-topology.ts        # graph utilities — entrypoint detection, propagation path
```

### Modified files

```
shared/types/events.ts         # ActiveThrottle already added; ReactionMenu types added
client/src/scenario/types.ts   # TopologyConfig, ServiceNode, ServiceComponent, IncidentConfig
client/src/scenario/schema.ts  # ComponentSchema, IncidentConfigSchema, ServiceNodeSchema
client/src/scenario/loader.ts  # transform topology objects, derive ops_dashboard if absent
client/src/metrics/types.ts    # ResolvedMetricParams: overlay → overlayApplications[]
client/src/metrics/series.ts   # generateOneSeries: apply overlayApplications in sequence
client/src/metrics/metric-store.ts  # _computeScriptedValue: loop overlayApplications;
                               #   updateResolvedValue(); clearScriptedOverlay()
client/src/engine/game-loop.ts # scale_capacity handler; updateResolvedValue on capacity change
client/src/engine/metric-reaction-engine.ts  # select_metric_reaction tool;
                               #   ReactionMenu construction; _applySelectedReaction()
client/src/llm/tool-definitions.ts  # replace apply_metric_response with select_metric_reaction
client/src/context/ScenarioContext.tsx  # expose topology with full component metadata
client/src/components/tabs/RemediationsPanel.tsx  # gate sections on component capabilities
```

### Test files

```
client/__tests__/metrics/component-metrics.test.ts
client/__tests__/metrics/reaction-menu.test.ts
client/__tests__/engine/metric-reaction-engine.test.ts  # extend existing
client/__tests__/scenario/component-topology.test.ts
```

---

## 1. Types

### 1.1 Component vocabulary (`scenario/types.ts`)

```typescript
export type ComponentType =
  | "load_balancer" // ALB/NLB — HTTP entrypoint; throttle point
  | "api_gateway" // API Gateway — HTTP entrypoint; rate-limiting point
  | "ecs_cluster" // ECS tasks (Fargate or EC2-backed) — scalable, restartable
  | "ec2_fleet" // EC2 autoscaling group — scalable, restartable
  | "lambda" // Lambda function — concurrency-limited, not restartable
  | "kinesis_stream" // Kinesis data stream — shard-scalable; no utilization
  | "sqs_queue" // SQS queue — no capacity ceiling; no utilization
  | "dynamodb" // DynamoDB table — WCU/RCU scalable; billing mode switchable
  | "rds" // RDS instance or Aurora cluster — scalable, restartable
  | "elasticache" // Redis/Memcached — node-scalable, restartable
  | "s3" // S3 bucket — no compute; batch/ETL entrypoint only
  | "scheduler"; // EventBridge/cron — batch entrypoint; no scale controls
```

Capacity fields per component type (all optional; absent = not applicable):

```typescript
export interface ServiceComponent {
  id: string; // unique within the service, referenced by inputs[] and incidents
  type: ComponentType;
  label: string; // human-readable display name

  // inputs: ids of components that feed into this one within the same service.
  // A component with inputs:[] is the entrypoint.
  // Exactly one component per service must have inputs:[].
  inputs: string[];

  // ── Capacity fields (type-specific) ──────────────────────────────────────

  // ecs_cluster, ec2_fleet, rds, elasticache:
  instanceCount?: number; // current task/instance count
  utilization?: number; // fraction 0–1; cpu/memory baseline = utilization × 100%

  // lambda:
  reservedConcurrency?: number; // max concurrent executions (hard ceiling)
  lambdaUtilization?: number; // fraction 0–1; baseline concurrent = reserved × utilization

  // kinesis_stream:
  shardCount?: number; // current shard count

  // dynamodb:
  writeCapacity?: number; // provisioned WCU (ignored when billingMode=on_demand)
  readCapacity?: number; // provisioned RCU
  writeUtilization?: number; // fraction 0–1; baseline write_capacity_used = wcu × writeUtil
  readUtilization?: number; // fraction 0–1
  billingMode?: "provisioned" | "on_demand"; // default: provisioned

  // rds:
  maxConnections?: number; // max_connections parameter
  connectionUtilization?: number; // fraction 0–1
}
```

**Utilization applicability:**

| ComponentType              | utilization | lambdaUtilization | writeUtilization | readUtilization | connectionUtilization |
| -------------------------- | ----------- | ----------------- | ---------------- | --------------- | --------------------- |
| ecs_cluster, ec2_fleet     | ✓           | —                 | —                | —               | —                     |
| lambda                     | —           | ✓                 | —                | —               | —                     |
| dynamodb                   | —           | —                 | ✓                | ✓               | —                     |
| rds                        | ✓           | —                 | —                | —               | ✓                     |
| kinesis_stream, sqs_queue  | —           | —                 | —                | —               | — (no ceiling)        |
| load_balancer, api_gateway | —           | —                 | —                | —               | — (pass-through)      |

### 1.2 Incident config (`scenario/types.ts`)

Reuses existing `OverlayType` vocabulary exactly — no new shape primitives.

```typescript
export interface IncidentConfig {
  id: string;
  affectedComponent: string; // component id within this service
  description: string; // included verbatim in LLM prompt context
  onsetOverlay: OverlayType; // spike_and_sustain | gradual_degradation |
  // saturation | sudden_drop
  onsetSecond: number; // same semantics as existing onsetSecond
  magnitude: number; // multiplier on affected component's baseline rate.
  // 1.0 = fills to capacity (for saturation).
  // 3.0 = 3× normal load (for spike_and_sustain).
  rampDurationSeconds?: number; // default 30; only meaningful for spike_and_sustain
  endSecond?: number; // absent/null = sustained until trainee acts.
  // present = auto-recovery begins at endSecond using
  // smooth_decay back to resolvedValue.
}
```

### 1.3 Enriched topology (`scenario/types.ts`)

```typescript
export type ServiceCategory = "api" | "worker" | "pipeline" | "console";

export interface ServiceNode {
  name: string;
  category?: ServiceCategory; // required on focal_service; optional on up/downstream
  description: string;
  owner?: string; // persona id or team name string
  components?: ServiceComponent[];
  incidents?: IncidentConfig[]; // only meaningful on focal_service
}

// Replaces the current flat TopologyConfig
export interface TopologyConfig {
  focalService: ServiceNode; // always a full object after loader transform
  upstream: ServiceNode[];
  downstream: ServiceNode[];
}
```

### 1.4 Multi-incident overlay composition (`metrics/types.ts`)

```typescript
// Replaces the seven individual overlay fields on ResolvedMetricParams
export interface OverlayApplication {
  overlay: OverlayType;
  onsetSecond: number;
  endSecond?: number; // absent = sustained
  peakValue: number;
  dropFactor: number;
  ceiling: number;
  rampDurationSeconds: number;
  saturationDurationSeconds: number;
}

export interface ResolvedMetricParams {
  metricId: string;
  service: string;
  archetype: string;
  label: string;
  unit: string;
  fromSecond: number;
  toSecond: number;
  resolutionSeconds: number;
  baselineValue: number;
  resolvedValue: number; // mutable after session start via updateResolvedValue()
  rhythmProfile: TrafficProfile;
  inheritsRhythm: boolean;
  noiseType: NoiseType;
  noiseLevelMultiplier: number;
  seriesOverride: Array<{ t: number; v: number }> | null;
  seed: number;

  // Multi-incident overlay list — ordered by onsetSecond ascending.
  // Empty array = no incident effect (pure baseline + noise).
  // Single entry = equivalent to the old single-overlay params.
  overlayApplications: OverlayApplication[];
}
```

The legacy single-overlay fields (`overlay`, `onsetSecond`, `peakValue`, etc.) are
**removed** from `ResolvedMetricParams`. All code that reads them must be updated to
read `overlayApplications[0]` or loop over the array. This is the only breaking
change in the metrics module.

### 1.5 Reaction menu types (`shared/types/events.ts`)

```typescript
export interface MetricOverlaySpec {
  service: string;
  metricId: string;
  overlay: ActiveOverlay; // fully pre-computed — pattern, targetValue, speedSeconds, etc.
}

export interface MetricReaction {
  id: string; // stable within a call; e.g. "full_recovery", "worsening_traffic"
  label: string; // shown to LLM — brief description
  description: string; // shown to LLM — when to select this
  overlays: MetricOverlaySpec[];
}

export interface ReactionMenu {
  actionType: string; // the trainee action that triggered this menu
  reactions: MetricReaction[];
  // Always contains at least one recovery candidate and at least one worsening candidate.
}
```

---

## 2. Schema (`scenario/schema.ts`)

### 2.1 ComponentSchema

```typescript
const ComponentSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "load_balancer",
    "api_gateway",
    "ecs_cluster",
    "ec2_fleet",
    "lambda",
    "kinesis_stream",
    "sqs_queue",
    "dynamodb",
    "rds",
    "elasticache",
    "s3",
    "scheduler",
  ]),
  label: z.string().min(1),
  inputs: z.array(z.string()),

  instance_count: z.number().int().positive().optional(),
  utilization: z.number().min(0).max(1).optional(),
  reserved_concurrency: z.number().int().positive().optional(),
  lambda_utilization: z.number().min(0).max(1).optional(),
  shard_count: z.number().int().positive().optional(),
  write_capacity: z.number().int().positive().optional(),
  read_capacity: z.number().int().positive().optional(),
  write_utilization: z.number().min(0).max(1).optional(),
  read_utilization: z.number().min(0).max(1).optional(),
  billing_mode: z.enum(["provisioned", "on_demand"]).optional(),
  max_connections: z.number().int().positive().optional(),
  connection_utilization: z.number().min(0).max(1).optional(),
});
```

### 2.2 IncidentConfigSchema

```typescript
const IncidentConfigSchema = z.object({
  id: z.string().min(1),
  affected_component: z.string().min(1),
  description: z.string().min(1),
  onset_overlay: z.enum([
    "spike_and_sustain",
    "gradual_degradation",
    "saturation",
    "sudden_drop",
  ]),
  onset_second: z.number(),
  magnitude: z.number().positive(),
  ramp_duration_seconds: z.number().positive().optional(),
  end_second: z.number().optional(),
});
```

### 2.3 ServiceNodeSchema

```typescript
const ServiceNodeSchema = z.object({
  name: z.string().min(1),
  category: z.enum(["api", "worker", "pipeline", "console"]).optional(),
  description: z.string().min(1),
  owner: z.string().optional(),
  components: z.array(ComponentSchema).optional().default([]),
  incidents: z.array(IncidentConfigSchema).optional().default([]),
});
```

### 2.4 Topology schema replacement

```typescript
// Replace the existing topology schema:
topology: z.object({
  focal_service: ServiceNodeSchema,
  upstream: z.array(ServiceNodeSchema).optional().default([]),
  downstream: z.array(ServiceNodeSchema).optional().default([]),
});
```

**Backwards compatibility:** The old `topology.focal_service: string` form is
supported by the **loader** (not the schema). The Zod schema requires the object
form. Existing scenarios using the string form must be migrated before loading;
the cross-reference validator emits a clear error message.

### 2.5 `ops_dashboard` becomes optional

```typescript
ops_dashboard_file: z.string().optional(),
ops_dashboard:      OpsDashboardSchema.optional(),   // was required; now optional
// Validation: either ops_dashboard or (components.length > 0 on focal_service)
// must be present. Enforced in validateCrossReferences().
```

---

## 3. Cross-reference validation (`scenario/validator.ts`)

New validation rules added to `validateCrossReferences()`:

1. **Entrypoint rule:** each service with `components.length > 0` must have exactly
   one component with `inputs: []`. If zero or multiple entrypoints, emit an error.

2. **Input reference rule:** every id in `inputs[]` must refer to a component id
   within the same service. Forward references are allowed (ids resolved after full
   parse).

3. **Incident component rule:** every `incidents[i].affected_component` must be a
   component id in `focal_service.components`.

4. **Ops dashboard rule:** if `ops_dashboard` is absent and `focal_service.components`
   is empty, emit: "Either ops_dashboard or topology.focal_service.components must
   be defined."

5. **Utilization applicability rule:** if `utilization` is set on `kinesis_stream`
   or `sqs_queue`, emit a warning (not an error — ignored silently).

---

## 4. Component-to-metric mapping (`metrics/component-metrics.ts`)

Defines the canonical metric archetypes per component type, their baseline
derivation, incident sensitivity, propagation lag, and overlay selection.

```typescript
export interface ComponentMetricSpec {
  archetype: string;

  // Derives baseline value from component capacity fields and service typicalRps.
  // Called once at scenario load. Returns 0 if derivation is not applicable.
  deriveBaseline(component: ServiceComponent, typicalRps: number): number;

  // Returns the peak value for a given incident magnitude applied to this component.
  // baseline × scalingFactor(magnitude) — sub-linear for cpu/memory, linear for rps.
  incidentPeakValue(baseline: number, magnitude: number): number;

  // Seconds of propagation lag from the affected_component to this component.
  // Accumulates along the inputs[] graph: each hop adds this component's lagSeconds.
  lagSeconds: number;

  // Which overlay type represents this metric's behavior under the incident.
  // May differ from the incident's onsetOverlay (e.g. saturation for capacity metrics
  // even when the entrypoint incident is spike_and_sustain).
  overlayType(incidentOverlay: OverlayType): OverlayType;

  // Capacity ceiling for saturation overlays. Null if no hard ceiling.
  ceiling(component: ServiceComponent): number | null;

  // Default resolved value (post-fix baseline). Usually == deriveBaseline result.
  // Override when the fix changes the capacity (e.g. WCU increase changes operating point).
  resolvedValue(component: ServiceComponent, typicalRps: number): number;
}
```

The full `COMPONENT_METRICS` registry maps `ComponentType → ComponentMetricSpec[]`.
Excerpt showing the two most important types for the DDB incident scenario:

```typescript
const COMPONENT_METRICS: Record<ComponentType, ComponentMetricSpec[]> = {
  lambda: [
    {
      archetype: "concurrent_executions",
      deriveBaseline: (c) =>
        (c.reservedConcurrency ?? 200) * (c.lambdaUtilization ?? 0.35),
      incidentPeakValue: (baseline, magnitude) =>
        Math.min(c.reservedConcurrency ?? 200, baseline * magnitude),
      lagSeconds: 45,
      overlayType: () => "saturation",
      ceiling: (c) => c.reservedConcurrency ?? 200,
      resolvedValue: (c) =>
        (c.reservedConcurrency ?? 200) * (c.lambdaUtilization ?? 0.35),
    },
    {
      archetype: "error_rate",
      deriveBaseline: () => 0,
      incidentPeakValue: (_, magnitude) => 15 * magnitude,
      lagSeconds: 60,
      overlayType: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 0,
    },
    {
      archetype: "p99_latency_ms",
      deriveBaseline: () => 300,
      incidentPeakValue: (baseline, magnitude) => baseline * magnitude * 2,
      lagSeconds: 45,
      overlayType: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 300,
    },
  ],

  dynamodb: [
    {
      archetype: "write_capacity_used",
      deriveBaseline: (c) =>
        (c.writeCapacity ?? 100) * (c.writeUtilization ?? 0.6),
      incidentPeakValue: (baseline, magnitude) =>
        Math.min(c.writeCapacity ?? 100, baseline * magnitude),
      lagSeconds: 60,
      overlayType: () => "saturation",
      ceiling: (c) => c.writeCapacity ?? 100,
      resolvedValue: (c) =>
        (c.writeCapacity ?? 100) * (c.writeUtilization ?? 0.6),
    },
    {
      archetype: "write_throttles",
      deriveBaseline: () => 0,
      incidentPeakValue: (_, magnitude) => 40 * magnitude,
      lagSeconds: 65,
      overlayType: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 0,
    },
    // read_capacity_used, read_throttles follow the same pattern
  ],
  // ... load_balancer, ecs_cluster, kinesis_stream, rds, sqs_queue, etc.
};
```

---

## 5. Metric derivation from components (`scenario/loader.ts` + new utility)

### 5.1 `deriveMetricsFromComponents()`

New function called by `transform()` in `loader.ts` when
`ops_dashboard.focal_service.metrics` is absent.

```typescript
export function deriveMetricsFromComponents(
  serviceNode: ServiceNode,
  typicalRps: number,
  preIncidentSeconds: number,
  resolutionSeconds: number,
): {
  metrics: MetricConfig[]; // feeds directly into existing ops_dashboard pipeline
  correlatedOverrides: Record<string, MetricConfig[]>; // per upstream/downstream service
};
```

**Algorithm:**

1. Find the entrypoint component (the one with `inputs: []`).
2. Build the propagation path for each incident in `serviceNode.incidents`:
   - Start at `incident.affectedComponent`
   - Walk the `inputs` graph forward (from inputs toward outputs — reverse of the inputs direction)
   - For each component in the path, find its `ComponentMetricSpec[]`
3. For each metric spec, compute:
   - `baselineValue` = `spec.deriveBaseline(component, typicalRps)`
   - `onsetSecond` = `incident.onsetSecond + spec.lagSeconds` (propagation delay)
   - `peakValue` = `spec.incidentPeakValue(baselineValue, incident.magnitude)`
   - `overlay` = `spec.overlayType(incident.onsetOverlay)`
   - `ceiling` = `spec.ceiling(component)` (for saturation)
   - `rampDurationSeconds` = `incident.rampDurationSeconds ?? 30`
   - `endSecond` = `incident.endSecond`
   - `resolvedValue` = `spec.resolvedValue(component, typicalRps)`
4. Group by metric archetype. If multiple incidents affect the same archetype,
   collect as `overlayApplications[]` sorted by `onsetSecond`.
5. Return `MetricConfig[]` with `incidentResponse` populated. These are
   structurally identical to author-written `MetricConfig` entries — the
   existing resolver handles them without modification.

### 5.2 Propagation graph utility (`scenario/component-topology.ts`)

```typescript
// Returns the component with inputs:[] — the entrypoint.
// Throws if zero or more than one entrypoint.
export function findEntrypoint(
  components: ServiceComponent[],
): ServiceComponent;

// Returns ids in propagation order starting from startId, following
// the reverse-inputs direction (outputs → deeper outputs).
// I.e. for inputs: [alb → ecs → kinesis → lambda → ddb],
// propagationPath("alb") returns ["alb", "ecs", "kinesis", "lambda", "ddb"].
export function propagationPath(
  startId: string,
  components: ServiceComponent[],
): string[];

// Returns the summed lag in seconds from startId to targetId.
export function propagationLag(
  startId: string,
  targetId: string,
  components: ServiceComponent[],
  metricSpecs: Record<ComponentType, ComponentMetricSpec[]>,
): number;
```

---

## 6. Multi-incident overlay application

### 6.1 `generateOneSeries()` (`metrics/series.ts`)

```typescript
export function generateOneSeries(
  params: ResolvedMetricParams,
): TimeSeriesPoint[] {
  const { fromSecond, toSecond, resolutionSeconds } = params;
  const tAxis = buildTimeAxis(fromSecond, toSecond, resolutionSeconds);

  if (params.seriesOverride) {
    return params.seriesOverride.map(({ t, v }) => ({ t, v }));
  }

  const baseline = generateBaseline(params.baselineValue, tAxis);
  const rhythm = params.inheritsRhythm
    ? generateRhythm(params.rhythmProfile, params.baselineValue, tAxis)
    : tAxis.map(() => 0);
  const prng = createSeededPRNG(params.seed);
  const noise = generateNoise(
    params.noiseType,
    params.baselineValue,
    params.noiseLevelMultiplier,
    tAxis,
    prng,
  );

  const combined = tAxis.map((_, i) => baseline[i] + rhythm[i] + noise[i]);

  // Apply each overlay in onset order — later overlays compound on top of earlier ones.
  let result = combined;
  const archDef = getArchetypeDefaults(params.archetype);
  for (const app of params.overlayApplications) {
    result = applyIncidentOverlay(result, { ...params, ...app }, tAxis);
  }

  return tAxis.map((t, i) => ({
    t,
    v: clampSeries([result[i]], archDef.minValue, archDef.maxValue)[0],
  }));
}
```

`applyIncidentOverlay` is unchanged — it already operates on a running array
and only touches points `t >= onsetSecond`. Sequential application is correct
because each call receives the output of the previous call.

### 6.2 `_computeScriptedValue()` (`metrics/metric-store.ts`)

```typescript
function _computeScriptedValue(state: MetricState, t: number): number {
  const rp = state.resolvedParams;
  const base = generateBaseline(rp.baselineValue, [t])[0];
  const rhythm = rp.inheritsRhythm
    ? generateRhythm(rp.rhythmProfile, rp.baselineValue, [t])[0]
    : 0;
  let value = base + rhythm;

  // Apply each overlay in order. Skip ones whose window has closed (endSecond reached).
  for (const app of rp.overlayApplications) {
    if (t < app.onsetSecond) continue;
    if (app.endSecond != null && t >= app.endSecond) continue;
    [value] = applyIncidentOverlay([value], { ...rp, ...app }, [t]);
  }

  const archDef = getArchetypeDefaults(rp.archetype);
  return clampSeries([value], archDef.minValue, archDef.maxValue)[0];
}
```

**`endSecond` auto-recovery:** When `t >= app.endSecond`, the scripted overlay
no longer applies and the metric returns organically to `baseline + rhythm + noise`.
If a shaped recovery is desired instead of an organic return, the scenario author
adds a second incident entry with `onsetSecond: endSecond` and
`onsetOverlay: gradual_degradation` with `magnitude: 0` (returns to baseline).

### 6.3 New `MetricStore` methods

```typescript
// Update resolvedValue after a capacity change action (e.g. increase DDB WCU).
// Called by the game loop's scale_capacity handler before triggering LLM reaction.
updateResolvedValue(service: string, metricId: string, newValue: number): void

// Remove scripted overlays entirely (e.g. DynamoDB switches to on_demand billing).
// After this call, _computeScriptedValue returns baseline + rhythm + noise only.
// The active overlay (LLM-set) remains in effect if present.
clearScriptedOverlays(service: string, metricId: string): void
```

---

## 7. Reaction menu (`metrics/reaction-menu.ts`)

### 7.1 Purpose

Pre-computes a `ReactionMenu` for every trainee action that reaches the
metric-reaction-engine. The LLM selects one reaction by id. The engine applies
its pre-computed overlays. The LLM never specifies metric names, patterns, speeds,
or target values.

### 7.2 Reaction menu structure

Every menu contains:

- **At least one recovery candidate** — metrics trend toward resolved state
- **At least one worsening candidate** — metrics trend toward peak or beyond
- **One no-effect candidate** — named `no_effect` — always present

This guarantees the LLM always has a "things get worse" option, which is
essential for red-herring actions and partially-wrong fixes.

### 7.3 `buildReactionMenu()`

```typescript
export function buildReactionMenu(
  action: AuditEntry,
  scenario: LoadedScenario,
  metricStore: MetricStore,
  simTime: number,
): ReactionMenu;
```

The function dispatches on `action.action` (the `ActionType`). Each action type
has a registered builder that knows which components and metrics are affected.

For **component-derived scenarios** (topology.focal_service.components present),
builders are auto-generated from the component graph. For **legacy authored
scenarios** (ops_dashboard.focal_service.metrics present), builders use
`INCIDENT_TYPE_REGISTRY` + `scenario.remediationActions[].is_correct_fix` to
determine recovery vs worsening.

### 7.4 Reaction candidate construction

```typescript
function buildRecoveryCandidate(
  id: string,
  label: string,
  description: string,
  affectedMetrics: Array<{
    service: string;
    metricId: string;
    pattern: ActiveOverlayPattern;
    speedSeconds: number;
  }>,
  metricStore: MetricStore,
  rp: ResolvedMetricParams,
  simTime: number,
  magnitude: "full" | "partial",
): MetricReaction {
  const overlays: MetricOverlaySpec[] = affectedMetrics.map(
    ({ service, metricId, pattern, speedSeconds }) => {
      const currentValue =
        metricStore.getCurrentValue(service, metricId, simTime) ??
        rp.baselineValue;
      const targetValue = resolveReactiveTarget(
        "recovery",
        magnitude,
        currentValue,
        rp.resolvedValue,
        rp.peakValue,
      );
      return {
        service,
        metricId,
        overlay: {
          startSimTime: simTime,
          startValue: currentValue,
          targetValue,
          pattern,
          speedSeconds,
          sustained: true,
        },
      };
    },
  );
  return { id, label, description, overlays };
}
```

Worsening candidates are built identically with `direction: "worsening"`.

### 7.5 Example menu — `scale_capacity(payments_ddb, writeCapacity: 200)`

Given: incident is DDB write saturation, traffic spike × 3.0 active,
original WCU=100, new WCU=200, demand estimate=180 WCU.

```
ReactionMenu {
  actionType: "scale_capacity",
  reactions: [
    {
      id: "full_recovery_ddb",
      label: "Write throttles clear — 200 WCU covers 3× demand (~180 WCU)",
      description: "Select when the new capacity is sufficient for current traffic.
                    Throttles clear immediately; Lambda errors drain over ~2 minutes.",
      overlays: [
        { service: "payment-service", metricId: "write_capacity_used",
          overlay: { pattern: "smooth_decay", targetValue: 180, speedSeconds: 60, ... } },
        { service: "payment-service", metricId: "write_throttles",
          overlay: { pattern: "cliff", targetValue: 0, speedSeconds: 60, ... } },
        { service: "payment-service", metricId: "error_rate",
          overlay: { pattern: "smooth_decay", targetValue: 0.5, speedSeconds: 120, ... } },
        // concurrent_executions NOT included — traffic spike is still active
      ]
    },
    {
      id: "partial_recovery_ddb",
      label: "Throttles reduce but persist — capacity insufficient for full demand",
      description: "Select when the new capacity is an improvement but does not fully
                    cover current traffic. Appropriate if estimated demand exceeds new WCU.",
      overlays: [
        { service: "payment-service", metricId: "write_capacity_used",
          overlay: { pattern: "smooth_decay", targetValue: 195, speedSeconds: 60, ... } },
        { service: "payment-service", metricId: "write_throttles",
          overlay: { pattern: "smooth_decay", targetValue: 15, speedSeconds: 120, ... } },
        { service: "payment-service", metricId: "error_rate",
          overlay: { pattern: "smooth_decay", targetValue: 6.0, speedSeconds: 120, ... } },
      ]
    },
    {
      id: "worsening_concurrent",
      label: "Lambda concurrency worsens — more writers exhaust DDB faster",
      description: "Select when the action made things worse. E.g. increasing Lambda
                    concurrency without fixing WCU floods DDB with more writes.",
      overlays: [
        { service: "payment-service", metricId: "write_throttles",
          overlay: { pattern: "spike_and_sustain", targetValue: 80, speedSeconds: 60, ... } },
        { service: "payment-service", metricId: "error_rate",
          overlay: { pattern: "spike_and_sustain", targetValue: 22.0, speedSeconds: 60, ... } },
      ]
    },
    {
      id: "no_effect",
      label: "No meaningful metric change",
      description: "Select when the action did not address the active incident.",
      overlays: []
    }
  ]
}
```

### 7.6 Capacity adequacy pre-computation

For `scale_capacity` and `scale_cluster` actions, the system computes and
includes in the prompt:

```
## Capacity Analysis (system-computed)
Component: payments_ddb (DynamoDB)
  Original WCU: 100  |  New WCU: 200
  Traffic magnitude: 3.0× (active incident: ddb_write_saturation)
  Estimated write demand: 60 WCU × 3.0 = 180 WCU
  New headroom: 200 - 180 = 20 WCU  →  SUFFICIENT (throttles should clear)
```

If insufficient: `200 - 210 = -10 WCU  →  INSUFFICIENT (throttles persist)`.

This pre-computation is deterministic — the LLM reads the conclusion and selects
the appropriate reaction. It does not compute; it reasons.

---

## 8. Tool replacement (`llm/tool-definitions.ts`)

### 8.1 New tool: `select_metric_reaction`

```typescript
{
  name: "select_metric_reaction",
  description:
    "Select which pre-computed metric reaction applies to the trainee's action. " +
    "The system has pre-calculated all physically correct outcomes. " +
    "Your job: read the situation and select the reaction that best matches reality. " +
    "Always select exactly one reaction. If nothing changed, select 'no_effect'.",
  parameters: {
    type: "object",
    required: ["reaction_id"],
    properties: {
      reaction_id: {
        type: "string",
        // Populated dynamically per call — only valid ids accepted
        enum: []  // filled at call time from ReactionMenu.reactions.map(r => r.id)
      },
      reasoning: {
        type: "string",
        description:
          "One sentence explaining why this reaction is correct for this action."
      }
    }
  }
}
```

The `enum` array is populated dynamically by `getMetricReactionTools()` from the
`ReactionMenu` built for the current action. This is the only field the LLM
supplies. It cannot hallucinate a metric name, pattern, or speed — only a
pre-validated id.

`apply_metric_response` is **removed** from `EVENT_TOOLS`. It is no longer a
callable tool.

### 8.2 `getMetricReactionTools()` signature change

```typescript
export function getMetricReactionTools(
  scenario: LoadedScenario,
  menu: ReactionMenu, // NEW parameter
): LLMToolDefinition[];
```

The tool definition is reconstructed per call with the current reaction ids in the
enum. The menu is built before the LLM call in `_react()`.

---

## 9. Metric reaction engine changes (`engine/metric-reaction-engine.ts`)

### 9.1 Updated `_react()` flow

```typescript
async function _react(context: StakeholderContext): Promise<void> {
  // 1. Build the reaction menu for the last action
  const lastAction = context.auditLog[context.auditLog.length - 1];
  if (!lastAction) return;

  const menu = buildReactionMenu(
    lastAction,
    scenario,
    metricStore,
    getSimTime(),
  );

  // 2. Build messages with menu included in prompt
  const messages = _buildPrompt(context, menu);

  // 3. Build tool with current reaction ids in enum
  const tools = getMetricReactionTools(scenario, menu);

  // 4. Call LLM
  const response = await getLLMClient().call({
    role: "stakeholder",
    messages,
    tools,
    sessionId: context.sessionId,
  });

  // 5. Apply selected reaction
  for (const toolCall of response.toolCalls) {
    if (toolCall.tool !== "select_metric_reaction") continue;
    const reactionId = toolCall.params["reaction_id"] as string;
    _applySelectedReaction(reactionId, menu);
  }
}
```

### 9.2 `_applySelectedReaction()`

```typescript
function _applySelectedReaction(reactionId: string, menu: ReactionMenu): void {
  const reaction = menu.reactions.find((r) => r.id === reactionId);
  if (!reaction) {
    log.warn({ reactionId }, "Unknown reaction_id — no reaction applied");
    return;
  }
  if (reaction.overlays.length === 0) return; // no_effect

  for (const spec of reaction.overlays) {
    metricStore.applyActiveOverlay(spec.service, spec.metricId, spec.overlay);
    log.info(
      { service: spec.service, metricId: spec.metricId, reactionId },
      "Reaction applied",
    );
  }
}
```

### 9.3 Updated `_buildPrompt()` with menu

The user message gains a `## Available Reactions` section:

```
## Available Reactions
Select exactly one reaction id.

[full_recovery_ddb] Write throttles clear — 200 WCU covers 3× demand (~180 WCU)
  Use when: the new capacity is sufficient for current traffic.

[partial_recovery_ddb] Throttles reduce but persist
  Use when: new capacity improves but does not fully relieve the bottleneck.

[worsening_concurrent] Lambda concurrency worsens — more writers exhaust DDB faster
  Use when: the action made things worse.

[no_effect] No meaningful metric change
  Use when: the action did not address the active incident.
```

The capacity analysis section (§7.6) is included immediately before the reactions
section when the action is `scale_capacity` or `scale_cluster`.

---

## 10. Game loop additions (`engine/game-loop.ts`)

### 10.1 `scale_capacity` action handler

New `ActionType`: `scale_capacity`. Distinct from `scale_cluster` (which adjusts
ECS task / EC2 instance count). `scale_capacity` adjusts DynamoDB WCU/RCU,
Kinesis shards, or Lambda reserved concurrency.

```typescript
case "scale_capacity": {
  const componentId = params["componentId"] as string | undefined
  const writeCapacity = params["writeCapacity"] as number | undefined
  const readCapacity  = params["readCapacity"]  as number | undefined
  const shardCount    = params["shardCount"]    as number | undefined
  const desiredConcurrency = params["desiredConcurrency"] as number | undefined
  const billingMode   = params["billingMode"] as "provisioned" | "on_demand" | undefined

  // Find component in topology
  const component = scenario.topology.focalService.components?.find(c => c.id === componentId)
  if (!component) break

  const service = scenario.topology.focalService.name

  if (billingMode === "on_demand" && component.type === "dynamodb") {
    // On-demand removes the capacity ceiling — clear scripted overlays entirely
    metricStore.clearScriptedOverlays(service, "write_capacity_used")
    metricStore.clearScriptedOverlays(service, "write_throttles")
    const logEntry = { id: randomUUID(), simTime: clock.getSimTime(), level: "INFO" as const,
      service, message: `DynamoDB switched to on-demand billing — write capacity ceiling removed` }
    store.addLogEntry(logEntry); emit({ type: "log_entry", entry: logEntry })

  } else {
    // Provisioned capacity change — update resolvedValue to new operating point
    if (writeCapacity != null && component.type === "dynamodb") {
      const origUtil = component.writeUtilization ?? 0.6
      // resolvedValue = new capacity × original utilization fraction
      // (represents steady-state at the same traffic level with new capacity)
      metricStore.updateResolvedValue(service, "write_capacity_used", writeCapacity * origUtil)
    }
    if (readCapacity != null && component.type === "dynamodb") {
      const origUtil = component.readUtilization ?? 0.2
      metricStore.updateResolvedValue(service, "read_capacity_used", readCapacity * origUtil)
    }
    if (desiredConcurrency != null && component.type === "lambda") {
      const origUtil = component.lambdaUtilization ?? 0.35
      metricStore.updateResolvedValue(service, "concurrent_executions", desiredConcurrency * origUtil)
    }

    const logMessage = [
      writeCapacity != null ? `WCU: ${writeCapacity}` : null,
      readCapacity  != null ? `RCU: ${readCapacity}`  : null,
      shardCount    != null ? `Shards: ${shardCount}`  : null,
      desiredConcurrency != null ? `Concurrency: ${desiredConcurrency}` : null,
    ].filter(Boolean).join(", ")
    const logEntry = { id: randomUUID(), simTime: clock.getSimTime(), level: "INFO" as const,
      service, message: `Capacity updated — ${component.label}: ${logMessage}` }
    store.addLogEntry(logEntry); emit({ type: "log_entry", entry: logEntry })
  }
  break
}
```

---

## 11. Remediation panel auto-filtering (`components/tabs/RemediationsPanel.tsx`)

### 11.1 `getComponentCapabilities()`

```typescript
export interface ServiceCapabilities {
  canRestart: boolean; // ecs_cluster | ec2_fleet | rds | elasticache
  canScaleHosts: boolean; // ecs_cluster | ec2_fleet
  canScaleConcurrency: boolean; // lambda
  canScaleCapacity: boolean; // dynamodb | kinesis_stream
  canSwitchBillingMode: boolean; // dynamodb
  canThrottle: boolean; // load_balancer | api_gateway (for ThrottleSection)
  hasQueues: boolean; // kinesis_stream | sqs_queue
}

export function getComponentCapabilities(
  components: ServiceComponent[],
): ServiceCapabilities;
```

### 11.2 New `ScaleConcurrencySection` (lambda only)

Rendered when `caps.canScaleConcurrency`. Shows current `reservedConcurrency`
from the component definition. Same UX as `ScaleSection` — "Desired concurrency:"
number input pre-populated with current value. Dispatches `scale_capacity` with
`{ componentId, desiredConcurrency }`.

### 11.3 New `ScaleCapacitySection` (DynamoDB / Kinesis)

Rendered when `caps.canScaleCapacity`. Per component:

- DynamoDB: "Write capacity (WCU):" + "Read capacity (RCU):" inputs pre-populated
  from component definition. "Billing mode:" toggle: Provisioned → On Demand.
- Kinesis: "Shard count:" input pre-populated.

Dispatches `scale_capacity` with appropriate params.

---

## 12. LLM prompt enrichment (`engine/metric-reaction-engine.ts`)

### 12.1 Service architecture section (new)

Added to the user message when `topology.focalService.components.length > 0`:

```
## Service Architecture
payment-service (API):
  [load_balancer] ALB → [ecs_cluster] ECS: 4 tasks (cpu=55%) →
  [kinesis_stream] payment-events: 4 shards →
  [lambda] processor: concurrency=200 (util=35%) →
  [dynamodb] payments: wcu=100 rcu=500 (wUtil=60%)

Active incidents:
  [ddb_write_saturation] onset=t+0: DynamoDB write saturation (saturation overlay)
    Propagation: alb → ecs → payment_stream → processor → payments_ddb
```

### 12.2 Capacity analysis section

Included when the action is `scale_capacity` or `scale_cluster`:

```
## Capacity Analysis
Component: payments_ddb (DynamoDB)  |  Action: writeCapacity 100 → 200 WCU
Baseline write rate: 60 WCU
Traffic magnitude: 3.0× (incident: ddb_write_saturation)
Estimated demand: 60 × 3.0 = 180 WCU
New headroom: 200 - 180 = +20 WCU  →  SUFFICIENT
```

---

## 13. Backwards compatibility

**Existing scenarios with authored `ops_dashboard.focal_service.metrics`:**
The loader detects `ops_dashboard` is present and skips `deriveMetricsFromComponents()`.
All existing behaviour is unchanged. `overlayApplications[]` is populated with a
single entry from the existing single-overlay fields.

**Existing `apply_metric_response` tool calls in mock fixtures:**
The fixture YAML (`scenarios/_fixture/mock-llm-responses.yaml`) uses
`apply_metric_response`. This will break after the tool is removed. The fixture
must be updated to use `select_metric_reaction` with a valid `reaction_id`. The
mock provider `createFixtureMockProvider()` is updated accordingly.

**`topology.focal_service` as plain string:**
The loader emits a clear validation error: "topology.focal_service must be an
object. Migrate: `focal_service: payment-service` → `focal_service: {name:
payment-service, description: '...', components: []}`. Existing plain-string
topology is not auto-promoted — it requires explicit migration to ensure the
author provides a description.

---

## 14. Payment scenario migration

`scenarios/payment-db-pool-exhaustion/scenario.yaml` is updated to the new
topology schema as a reference implementation demonstrating the fully-specified
component approach. After migration:

- `topology.focal_service` is an object with 5 components and 1 incident
- `ops_dashboard.focal_service.metrics` is **removed** — auto-derived from components
- The `throttle_payment` remediation action retains its `throttle_targets` (from LLD 11 Phase F)
- New `scale_capacity` actions are added for DDB WCU increase and on-demand switch

---

## 15. Test plan

| Test file                                   | What is verified                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `component-metrics.test.ts`                 | `deriveBaseline()`, `incidentPeakValue()`, `lagSeconds` for all component types                                     |
| `component-topology.test.ts`                | `findEntrypoint()`, `propagationPath()`, `propagationLag()`; single-entrypoint validation                           |
| `scenario/loader.test.ts` (extended)        | `deriveMetricsFromComponents()` output matches expected `MetricConfig[]`; multi-incident composition                |
| `metrics/series.test.ts` (extended)         | `generateOneSeries()` with 0, 1, 2 overlay applications; `endSecond` returns to baseline                            |
| `metrics/metric-store.test.ts` (extended)   | `updateResolvedValue()`, `clearScriptedOverlays()`; `_computeScriptedValue()` with multi-incident                   |
| `reaction-menu.test.ts`                     | Menu always contains recovery + worsening + no_effect; correct overlays per component type; capacity adequacy logic |
| `metric-reaction-engine.test.ts` (extended) | `_applySelectedReaction()` applies correct overlays; unknown reaction_id is no-op; menu is built before LLM call    |
| `RemediationsPanel.test.tsx` (extended)     | `ScaleConcurrencySection` renders for lambda; `ScaleCapacitySection` renders for dynamodb; billing mode toggle      |

All tests are written before implementation (TDD). Each step validates before
proceeding to the next.
