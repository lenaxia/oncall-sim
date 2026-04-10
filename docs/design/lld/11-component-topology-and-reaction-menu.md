# LLD 11 — Component Topology, Auto-Generated Metrics, and Reaction Menu

**Phase:** 11
**Depends on:** LLD 01–10 (all implemented and passing)
**Status:** Design — not yet implemented

---

## Purpose

Three tightly related changes that together eliminate manual metric authoring and
make LLM metric reactions reliable:

1. **Component topology** — `topology.focal_service` becomes a rich object
   describing the microservice's internal architecture (components with types,
   capacity, and a data-flow graph). `topology.upstream` and `topology.downstream`
   become arrays of `ServiceNode` objects with optional components.

2. **Auto-generated metrics** — `ops_dashboard` is removed entirely. The system
   derives all metric configs, baseline values, and incident overlay parameters
   from the component graph and `incidents[]` array. Authors declare architecture
   and intent; the system handles metric plumbing.

3. **Reaction menu** — `apply_metric_response` is replaced by
   `select_metric_reaction`. The engine pre-computes named outcomes before each
   LLM call. The LLM selects one outcome by id. Magic-string metric names,
   freeform pattern selection, and LLM-driven arithmetic are eliminated.

---

## Scope

### New files

```
client/src/metrics/
  component-metrics.ts        # canonical metric specs and baseline derivation per ComponentType
  reaction-menu.ts            # builds pre-computed ReactionMenu per trainee action

client/src/scenario/
  component-topology.ts       # graph utilities: entrypoint, propagation path, lag
```

### Modified files

```
shared/types/events.ts
  # Add: MetricOverlaySpec, MetricReaction, ReactionMenu
  # Add to ActionType: "scale_capacity"

client/src/scenario/types.ts
  # Replace TopologyConfig (flat strings) with ServiceNode objects
  # Add: ComponentType, ServiceComponent, IncidentConfig, ServiceCategory
  # Remove: FocalServiceConfig, CorrelatedServiceConfig, OpsDashboardConfig,
  #         ServiceScale (all replaced by component-derived data)
  # Move preIncidentSeconds, resolutionSeconds to TimelineConfig or ServiceNode
  # Add typicalRps to ServiceNode

client/src/scenario/schema.ts
  # Add: ComponentSchema, IncidentConfigSchema, ServiceNodeSchema
  # Replace topology schema
  # Remove: OpsDashboardSchema, ServiceScaleSchema, FocalServiceConfig schema fields

client/src/scenario/loader.ts
  # transform() rewrites: no ops_dashboard transform, topology becomes ServiceNode objects
  # Add: deriveMetricsFromComponents() call in transform()
  # derive FocalServiceConfig/OpsDashboardConfig equivalent from components for
  #   downstream metric pipeline compatibility (see §6)

client/src/scenario/validator.ts
  # Add: entrypoint uniqueness, input reference validity, incident-component existence

client/src/metrics/types.ts
  # Replace single-overlay fields on ResolvedMetricParams with overlayApplications[]
  # Add OverlayApplication interface

client/src/metrics/series.ts
  # generateOneSeries(): loop overlayApplications instead of single applyIncidentOverlay call

client/src/metrics/metric-store.ts
  # _computeScriptedValue(): loop overlayApplications, respect endSecond
  # Add: updateResolvedValue(), clearScriptedOverlays()

client/src/metrics/resolver.ts
  # resolveMetricParams(): build overlayApplications[] from MetricConfig.incidentResponses[]
  # (MetricConfig grows incidentResponses array from component derivation output)

client/src/metrics/metric-summary.ts
  # Update to use new LoadedScenario shape (no ops_dashboard)

client/src/metrics/correlation.ts
  # Update to use new LoadedScenario shape (no ops_dashboard.correlatedServices)

client/src/metrics/generator.ts
  # Update to use new LoadedScenario shape

client/src/engine/game-loop.ts
  # Add scale_capacity action handler
  # Update scale_cluster to use topology component reference

client/src/engine/metric-reaction-engine.ts
  # _react(): build ReactionMenu before LLM call
  # Replace _applyMetricResponse() with _applySelectedReaction()
  # _buildPrompt(): add ## Service Architecture and ## Capacity Analysis sections

client/src/llm/tool-definitions.ts
  # Replace apply_metric_response with select_metric_reaction
  # getMetricReactionTools() accepts ReactionMenu parameter

client/src/context/ScenarioContext.tsx
  # Expose topology.focalService.components in ScenarioConfig

client/src/components/tabs/RemediationsPanel.tsx
  # Gate RestartSection, ScaleSection on component capabilities
  # Add ScaleConcurrencySection (lambda), ScaleCapacitySection (dynamodb/kinesis)

scenarios/_fixture/scenario.yaml
  # Migrate topology.focal_service to ServiceNode object with components + incidents
  # Remove ops_dashboard
  # Update llm_event_tools: apply_metric_response → select_metric_reaction

scenarios/payment-db-pool-exhaustion/scenario.yaml
  # Same migration
```

### Test files

```
client/__tests__/metrics/component-metrics.test.ts       # new
client/__tests__/metrics/reaction-menu.test.ts           # new
client/__tests__/scenario/component-topology.test.ts     # new
client/__tests__/scenario/loader.test.ts                 # extend
client/__tests__/metrics/series.test.ts                  # extend
client/__tests__/metrics/metric-store.test.ts            # extend
client/__tests__/engine/metric-reaction-engine.test.ts   # extend
client/__tests__/tabs/RemediationsPanel.test.tsx         # extend
```

---

## 1. Types

### 1.1 Component type vocabulary (`scenario/types.ts`)

```typescript
export type ComponentType =
  | "load_balancer" // ALB/NLB — HTTP/HTTPS entrypoint; throttle point
  | "api_gateway" // API Gateway — HTTP entrypoint; rate-limiting point
  | "ecs_cluster" // ECS tasks (Fargate or EC2-backed) — scalable, restartable
  | "ec2_fleet" // EC2 autoscaling group — scalable, restartable
  | "lambda" // Lambda function — concurrency-capped, not restartable
  | "kinesis_stream" // Kinesis data stream — shard-scalable; no utilization concept
  | "sqs_queue" // SQS queue — no hard capacity ceiling; no utilization concept
  | "dynamodb" // DynamoDB table — WCU/RCU scalable; billing mode switchable
  | "rds" // RDS instance or Aurora cluster — scalable, restartable
  | "elasticache" // Redis/Memcached — node-scalable, restartable
  | "s3" // S3 bucket — no compute; batch/ETL source only
  | "scheduler"; // EventBridge/cron — batch entrypoint; no scale controls
```

### 1.2 Service component (`scenario/types.ts`)

```typescript
export interface ServiceComponent {
  id: string; // unique within this service; referenced by inputs[] and incidents
  type: ComponentType;
  label: string; // human-readable, shown in UI and LLM prompts

  // The data-flow graph within the service.
  // inputs[] lists the ids of components whose output feeds into this component.
  // A component with inputs:[] receives traffic from outside the service boundary
  // (the "entrypoint"). Exactly one entrypoint per service is required.
  inputs: string[];

  // ── Capacity fields — only applicable to certain component types ────────────

  // ecs_cluster, ec2_fleet, rds, elasticache
  instanceCount?: number; // current running count
  utilization?: number; // fraction [0,1]; baseline = utilization × 100% for cpu

  // lambda
  reservedConcurrency?: number; // hard ceiling on simultaneous executions
  lambdaUtilization?: number; // fraction [0,1]; baseline concurrent = reserved × util

  // kinesis_stream
  shardCount?: number;

  // dynamodb
  writeCapacity?: number; // provisioned WCU; ignored when billingMode=on_demand
  readCapacity?: number; // provisioned RCU
  writeUtilization?: number; // fraction [0,1]; baseline write_capacity_used = wcu × util
  readUtilization?: number; // fraction [0,1]
  billingMode?: "provisioned" | "on_demand"; // default: provisioned

  // rds
  maxConnections?: number;
  connectionUtilization?: number; // fraction [0,1]
}
```

**Utilization is not applicable to `kinesis_stream`, `sqs_queue`, `load_balancer`,
`api_gateway`, `s3`, or `scheduler`** — these components have no hard capacity
ceiling that utilization would measure. The validator emits a warning (not error)
if utilization is set on these types.

### 1.3 Incident config (`scenario/types.ts`)

Uses existing `OverlayType` vocabulary unchanged.

```typescript
export interface IncidentConfig {
  id: string;
  affectedComponent: string; // component id within this service's components[]
  description: string; // shown verbatim in LLM prompt; factual, not a hint
  onsetOverlay: OverlayType; // spike_and_sustain | gradual_degradation |
  // saturation | sudden_drop
  onsetSecond: number; // when the effect begins (same semantics as today)
  magnitude: number; // multiplier on the affected component's baseline.
  // For saturation: 1.0 = fills to capacity ceiling.
  // For spike_and_sustain: 3.0 = 3× baseline.
  rampDurationSeconds?: number; // default 30; only meaningful for spike_and_sustain
  endSecond?: number; // absent = sustained until trainee acts.
  // present = effect ends at endSecond; metric returns
  // organically to baseline (no shaped recovery).
}
```

### 1.4 Service node and topology (`scenario/types.ts`)

```typescript
export type ServiceCategory = "api" | "worker" | "pipeline" | "console";

export interface ServiceNode {
  name: string;
  category?: ServiceCategory; // required on focal_service; optional on up/downstream
  description: string;
  owner?: string; // persona id or team name; used for "who to page" context
  typicalRps?: number; // primary traffic volume signal for baseline derivation.
  // Required on focal_service when components are defined.
  // Optional on up/downstream.
  components?: ServiceComponent[];
  incidents?: IncidentConfig[]; // only meaningful on focal_service
}

// Replaces the current flat TopologyConfig entirely.
export interface TopologyConfig {
  focalService: ServiceNode;
  upstream: ServiceNode[];
  downstream: ServiceNode[];
}
```

**`preIncidentSeconds` and `resolutionSeconds`** are timing parameters for metric
generation that currently live in `ops_dashboard`. They move to `TimelineConfig`:

```typescript
export interface TimelineConfig {
  defaultSpeed: 1 | 2 | 5 | 10;
  durationMinutes: number;
  preIncidentSeconds: number; // NEW: was ops_dashboard.preIncidentSeconds
  resolutionSeconds: number; // NEW: was ops_dashboard.resolutionSeconds; default 15
}
```

**`trafficProfile`** currently lives on `FocalServiceConfig`. It moves to `ServiceNode`
as an optional field that defaults to `"always_on_api"` for `api` category:

```typescript
export interface ServiceNode {
  // ...existing fields...
  trafficProfile?: TrafficProfile; // default: "always_on_api" for api, "none" for others
}
```

**`health`** (drives noise multiplier in resolver) moves to `ServiceNode`:

```typescript
export interface ServiceNode {
  // ...existing fields...
  health?: HealthLevel; // default: "healthy"
}
```

**Correlated services** (currently `ops_dashboard.correlatedServices[]`) are
replaced by `topology.downstream[]` entries that have `components` defined. A
downstream `ServiceNode` with `components` defined is eligible for correlated
metric generation. A downstream node without `components` is display-only
(shown in topology diagram, accessible to LLM context, but no metrics generated).

The correlation type (`upstream_impact | exonerated | independent`) moves to
`ServiceNode`:

```typescript
export interface ServiceNode {
  // ...existing fields...
  correlation?: CorrelationType; // only meaningful on downstream nodes; default: "independent"
  lagSeconds?: number; // correlation propagation lag; only for upstream_impact
  impactFactor?: number; // 0–1; only for upstream_impact
}
```

### 1.5 Multi-incident overlay composition (`metrics/types.ts`)

```typescript
// Replaces the seven individual overlay fields on ResolvedMetricParams.
// applyIncidentOverlay() reads these fields; the spread { ...params, ...app }
// in series.ts and metric-store.ts satisfies the params contract.
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
  resolvedValue: number; // mutable post-session-start via updateResolvedValue()
  rhythmProfile: TrafficProfile;
  inheritsRhythm: boolean;
  noiseType: NoiseType;
  noiseLevelMultiplier: number;
  seriesOverride: Array<{ t: number; v: number }> | null;
  seed: number;

  // Ordered by onsetSecond ascending.
  // [] = no incident effect (pure baseline + rhythm + noise).
  // Single entry = same as the old single-overlay fields.
  // Multiple entries = multiple incidents compound sequentially.
  overlayApplications: OverlayApplication[];
}
```

The legacy fields `overlay`, `onsetSecond`, `peakValue`, `dropFactor`, `ceiling`,
`saturationDurationSeconds`, `rampDurationSeconds` are **removed** from
`ResolvedMetricParams`. All callers that read these fields are updated to read
`overlayApplications[0]` or iterate the array.

`applyIncidentOverlay()` currently reads `params.overlay`, `params.onsetSecond`,
etc. It is updated to accept an explicit `app: OverlayApplication` parameter
rather than reading from `params`. Signature becomes:

```typescript
export function applyIncidentOverlay(
  series: number[],
  params: ResolvedMetricParams, // still needed for baselineValue, ceiling fallback
  app: OverlayApplication,
  tAxis: number[],
): number[];
```

### 1.6 Reaction menu types (`shared/types/events.ts`)

```typescript
export interface MetricOverlaySpec {
  service: string;
  metricId: string;
  overlay: ActiveOverlay; // fully pre-computed including targetValue, pattern, speedSeconds
}

export interface MetricReaction {
  id: string; // stable within a menu; used as enum value in select_metric_reaction
  label: string; // shown to LLM: brief description
  description: string; // shown to LLM: when to select this reaction
  overlays: MetricOverlaySpec[];
}

export interface ReactionMenu {
  actionType: string; // ActionType value that triggered this menu
  reactions: MetricReaction[];
  // Invariant: at least one recovery candidate, at least one worsening candidate,
  // exactly one no_effect candidate (id: "no_effect", overlays: []).
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
  typical_rps: z.number().positive().optional(),
  traffic_profile: z
    .enum([
      "business_hours_web",
      "business_hours_b2b",
      "always_on_api",
      "batch_nightly",
      "batch_weekly",
      "none",
    ])
    .optional(),
  health: z.enum(["healthy", "degraded", "flaky"]).optional(),
  correlation: z
    .enum(["upstream_impact", "exonerated", "independent"])
    .optional(),
  lag_seconds: z.number().optional(),
  impact_factor: z.number().min(0).max(1).optional(),
  components: z.array(ComponentSchema).optional().default([]),
  incidents: z.array(IncidentConfigSchema).optional().default([]),
});
```

### 2.4 Timeline schema additions

```typescript
const TimelineSchema = z.object({
  default_speed: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(5),
    z.literal(10),
  ]),
  duration_minutes: z.number().positive(),
  pre_incident_seconds: z.number().positive().optional().default(300),
  resolution_seconds: z.number().positive().optional().default(15),
});
```

### 2.5 Topology schema replacement

```typescript
topology: z.object({
  focal_service: ServiceNodeSchema,
  upstream: z.array(ServiceNodeSchema).optional().default([]),
  downstream: z.array(ServiceNodeSchema).optional().default([]),
});
```

### 2.6 `ops_dashboard` removed

`ops_dashboard` and `ops_dashboard_file` are removed from `ScenarioSchema`
entirely. No optional fallback — the field does not exist in the new schema.

The top-level `service_type` field is also removed — `ServiceCategory` on
`focal_service` replaces it for the scenario picker.

---

## 3. Cross-reference validation (`scenario/validator.ts`)

New rules added to `validateCrossReferences()`:

1. **`focal_service.typical_rps` required when components present.** If
   `focal_service.components.length > 0` and `focal_service.typical_rps` is
   absent, emit error: "topology.focal_service.typical_rps is required when
   components are defined."

2. **Entrypoint uniqueness.** For any service with `components.length > 0`:
   exactly one component must have `inputs: []`. Zero or more than one is an error.

3. **Input id validity.** Every id in `component.inputs[]` must reference an id
   that exists in the same service's components array. Forward references are
   valid (validated after full parse).

4. **No cycles.** The component graph must be a DAG. Detect cycles via DFS and
   emit an error if found.

5. **Incident component validity.** Every `incident.affected_component` must be
   a component id in `focal_service.components`.

6. **`category` required on `focal_service`.** Emit error if absent.

---

## 4. Component-to-metric mapping (`metrics/component-metrics.ts`)

Defines the canonical metric archetypes per `ComponentType`, baseline derivation,
incident sensitivity, propagation lag, and overlay selection.

```typescript
export interface ComponentMetricSpec {
  archetype: string;

  // Derives the baseline value at the component from its capacity fields and
  // the service's typicalRps. Called once at scenario load time.
  deriveBaseline(component: ServiceComponent, typicalRps: number): number;

  // Computes the peak value for a given incident magnitude at this component.
  // Not always linear — cpu scales sub-linearly with rps due to parallelism slack.
  incidentPeakValue(
    baseline: number,
    magnitude: number,
    component: ServiceComponent,
  ): number;

  // Additional seconds of propagation lag from the incident's affected_component
  // to this component, accumulated along the graph path.
  lagSeconds: number;

  // Selects the appropriate OverlayType for this metric under the incident.
  // May differ from incident.onsetOverlay — e.g. capacity metrics use "saturation"
  // even when the entrypoint incident is "spike_and_sustain".
  overlayForIncident(incidentOverlay: OverlayType): OverlayType;

  // Hard ceiling for saturation overlays. null = no ceiling.
  ceiling(component: ServiceComponent): number | null;

  // Post-fix resolved value. Default = deriveBaseline().
  // Override when the correct fix changes the operating capacity.
  resolvedValue(component: ServiceComponent, typicalRps: number): number;
}
```

`COMPONENT_METRICS: Record<ComponentType, ComponentMetricSpec[]>` contains entries
for all 12 component types. Load balancer and api_gateway share similar specs.
Kinesis and SQS share queue-depth specs. Full registry defined in implementation;
the DDB and Lambda entries are the highest-stakes and specified explicitly in §7.5.

---

## 5. Propagation graph utilities (`scenario/component-topology.ts`)

```typescript
// Returns the single component with inputs:[] (the entrypoint).
// Throws LoadError if zero or multiple entrypoints found.
export function findEntrypoint(
  components: ServiceComponent[],
): ServiceComponent;

// Returns component ids in topological order from startId toward leaf components.
// Direction: follow which components list startId in their inputs[] — i.e. downstream.
// Example: components = [alb(inputs:[]), ecs(inputs:[alb]), lambda(inputs:[ecs])]
//   propagationPath("alb", components) → ["alb", "ecs", "lambda"]
//   propagationPath("ecs", components) → ["ecs", "lambda"]
export function propagationPath(
  startId: string,
  components: ServiceComponent[],
): string[];

// Returns accumulated lag in seconds along the propagation path from startId to targetId.
// Each component contributes the maximum lagSeconds across its metric specs.
export function propagationLag(
  startId: string,
  targetId: string,
  components: ServiceComponent[],
  metricSpecs: typeof COMPONENT_METRICS,
): number;
```

---

## 6. Metric derivation from components (`scenario/loader.ts`)

### 6.1 Where `deriveMetricsFromComponents()` fits

`transform()` in `loader.ts` currently calls `transformFocalService()` which
produces a `FocalServiceConfig` (with metrics) and `transformCorrelatedService()`
for correlated services. After this change, when the scenario has topology
components:

- `transformFocalService()` is replaced by `deriveFocalServiceConfig()` which
  calls `deriveMetricsFromComponents()` and returns a `FocalServiceConfig`-shaped
  object that the existing `generator.ts`, `resolver.ts`, and `metric-summary.ts`
  can consume unchanged.
- `transformCorrelatedService()` is replaced by `deriveCorrelatedServiceConfigs()`
  which produces `CorrelatedServiceConfig[]` from `topology.downstream[]` entries
  that have components.

This means `FocalServiceConfig` and `CorrelatedServiceConfig` remain as internal
types used by the metric pipeline. They are no longer authored in YAML — they are
derived. `OpsDashboardConfig` still exists as an internal intermediate type but is
never serialised to YAML.

### 6.2 `deriveMetricsFromComponents()` algorithm

```typescript
export function deriveMetricsFromComponents(
  node: ServiceNode,
  preIncidentSeconds: number,
  resolutionSeconds: number,
): {
  focalServiceConfig: FocalServiceConfig;
  correlatedServiceConfigs: CorrelatedServiceConfig[];
};
```

1. Find the entrypoint component via `findEntrypoint(node.components)`.
2. For each incident in `node.incidents`:
   a. Find `incident.affectedComponent` in `node.components`.
   b. Compute `propagationPath(incident.affectedComponent, node.components)`.
   c. For each component id in the path:
   - Look up `COMPONENT_METRICS[component.type]` → `ComponentMetricSpec[]`
   - For each spec: - `baselineValue` = `spec.deriveBaseline(component, node.typicalRps ?? 0)` - `onsetSecond` = `incident.onsetSecond + propagationLag(incident.affectedComponent, component.id, ...)` - `peakValue` = `spec.incidentPeakValue(baselineValue, incident.magnitude, component)` - `overlay` = `spec.overlayForIncident(incident.onsetOverlay)` - `ceiling` = `spec.ceiling(component) ?? peakValue` - `resolvedValue` = `spec.resolvedValue(component, node.typicalRps ?? 0)` - Build `OverlayApplication` from the above
     d. Group all `OverlayApplication` objects by archetype. Multiple incidents
     on the same archetype → multiple entries in `overlayApplications[]` sorted
     by `onsetSecond`.
3. Assemble `MetricConfig[]` — one per unique archetype found across all components.
   Each `MetricConfig` has `incidentResponses: OverlayApplication[]` (new field,
   mirrors `overlayApplications[]` before resolver processing).
4. Build `FocalServiceConfig` with:
   - `name`: `node.name`
   - `scale.typicalRps`: `node.typicalRps ?? 0`
   - `trafficProfile`: `node.trafficProfile ?? (node.category === "api" ? "always_on_api" : "none")`
   - `health`: `node.health ?? "healthy"`
   - `incidentType`: `"component_derived"` (sentinel; `INCIDENT_TYPE_REGISTRY` lookup skipped)
   - `metrics`: derived `MetricConfig[]`

### 6.3 `MetricConfig` extension

`MetricConfig` gains `incidentResponses?: OverlayApplication[]` — an array of
pre-computed overlay applications. When present, `resolver.ts` populates
`ResolvedMetricParams.overlayApplications` directly from this array instead of
computing from `incidentPeak`, `incidentType`, etc. (those paths remain for
author-written metrics that were never authored).

Since `ops_dashboard` is removed from YAML, author-written `MetricConfig`
entries are no longer a path. This means the legacy `incidentPeak`, `incidentType`,
`incidentResponse` fields on `MetricConfig` are also removed from the schema.
The resolver's branching logic (Tier 1 / Tier 2 / explicit `incidentResponse`)
is replaced by a single path: populate `overlayApplications` from
`metricConfig.incidentResponses`.

---

## 7. Multi-incident overlay application

### 7.1 `applyIncidentOverlay()` signature update

```typescript
// Before:
export function applyIncidentOverlay(
  series: number[],
  params: ResolvedMetricParams,
  tAxis: number[],
): number[];

// After:
export function applyIncidentOverlay(
  series: number[],
  params: Pick<ResolvedMetricParams, "baselineValue">,
  app: OverlayApplication,
  tAxis: number[],
): number[];
```

`params` is narrowed to only the fields actually needed (`baselineValue`).
`app` provides all overlay-specific fields. The `params.overlay === "none"` guard
moves to the call site — callers simply skip the call for `app.overlay === "none"`.

### 7.2 `generateOneSeries()` (`metrics/series.ts`)

```typescript
export function generateOneSeries(
  params: ResolvedMetricParams,
): TimeSeriesPoint[] {
  if (params.seriesOverride) {
    return params.seriesOverride.map(({ t, v }) => ({ t, v }));
  }

  const { fromSecond, toSecond, resolutionSeconds } = params;
  const tAxis = buildTimeAxis(fromSecond, toSecond, resolutionSeconds);

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

  let result = tAxis.map((_, i) => baseline[i] + rhythm[i] + noise[i]);

  // Apply each overlay in onset order. Later overlays compound on top of earlier.
  const archDef = getArchetypeDefaults(params.archetype);
  for (const app of params.overlayApplications) {
    if (app.overlay === "none") continue;
    result = applyIncidentOverlay(result, params, app, tAxis);
  }

  return tAxis.map((t, i) => ({
    t,
    v: clampSeries([result[i]], archDef.minValue, archDef.maxValue)[0],
  }));
}
```

### 7.3 `_computeScriptedValue()` (`metrics/metric-store.ts`)

```typescript
function _computeScriptedValue(state: MetricState, t: number): number {
  const rp = state.resolvedParams;
  const base = generateBaseline(rp.baselineValue, [t])[0];
  const rhythm = rp.inheritsRhythm
    ? generateRhythm(rp.rhythmProfile, rp.baselineValue, [t])[0]
    : 0;
  let value = base + rhythm;

  for (const app of rp.overlayApplications) {
    if (app.overlay === "none") continue;
    if (t < app.onsetSecond) continue;
    if (app.endSecond != null && t >= app.endSecond) continue;
    [value] = applyIncidentOverlay([value], rp, app, [t]);
  }

  const archDef = getArchetypeDefaults(rp.archetype);
  return clampSeries([value], archDef.minValue, archDef.maxValue)[0];
}
```

When `t >= app.endSecond`, the scripted overlay does not apply. The metric
returns to `baseline + rhythm + noise` for those points — organic return to
baseline without a shaped recovery curve. If a shaped post-incident recovery is
needed, the author adds a second incident entry with `onsetSecond: endSecond` and
appropriate overlay.

### 7.4 New `MetricStore` methods

```typescript
// Called by the game loop after a scale_capacity action.
// Updates resolvedValue so LLM recovery targets the new operating point.
// Example: increase DDB WCU from 100→200; resolvedValue for write_capacity_used
//   becomes 200 × writeUtilization (e.g. 200 × 0.6 = 120 WCU).
updateResolvedValue(service: string, metricId: string, newValue: number): void;

// Called when DynamoDB switches to on_demand billing — removes the capacity ceiling.
// Clears overlayApplications that are saturation overlays for this metric.
// The active LLM-set overlay (if any) is unaffected.
clearScriptedOverlays(service: string, metricId: string): void;
```

---

## 8. Reaction menu (`metrics/reaction-menu.ts`)

### 8.1 Invariant

Every `ReactionMenu` has:

- ≥ 1 recovery candidate (metrics move toward `resolvedValue`)
- ≥ 1 worsening candidate (metrics move toward peak or beyond)
- Exactly 1 `no_effect` candidate (`id: "no_effect"`, `overlays: []`)

### 8.2 `buildReactionMenu()`

```typescript
export function buildReactionMenu(
  action: AuditEntry,
  scenario: LoadedScenario,
  metricStore: MetricStore,
  simTime: number,
): ReactionMenu;
```

Dispatches on `action.action`. Each active `ActionType` has a registered builder
function. The builder knows which component(s) the action targets (via `componentId`
in `action.params` or by action type), which incidents are active on those
components, and which metrics in the propagation path are affected.

For `scale_capacity`, `scale_cluster`, `restart_service`, `throttle_traffic`,
`toggle_feature_flag`, `emergency_deploy`, `trigger_rollback` — the builder
constructs full, worsening, and partial recovery candidates using
`buildRecoveryCandidate()` and `buildWorseningCandidate()`.

For `ack_page`, `page_user`, `update_ticket`, `add_ticket_comment`,
`post_chat_message`, `reply_email`, `direct_message_persona` — the builder
returns a menu with only `no_effect` (communication actions cannot change metric
trajectories directly).

### 8.3 Candidate construction

```typescript
// Builds one MetricReaction with pre-computed ActiveOverlay for each affected metric.
function buildRecoveryCandidate(
  id: string,
  label: string,
  description: string,
  affected: Array<{
    service: string;
    metricId: string;
    pattern: ActiveOverlayPattern;
    speedSeconds: number;
  }>,
  magnitude: "full" | "partial",
  metricStore: MetricStore,
  simTime: number,
): MetricReaction;
```

For each entry in `affected`, `resolveReactiveTarget()` (existing function) computes
`targetValue` from `direction="recovery"`, `magnitude`, `currentValue`,
`rp.resolvedValue`, and `rp.peakValue`. The result is an `ActiveOverlay` with all
fields set — pattern, speedSeconds, targetValue, startValue, startSimTime,
`sustained: true`.

Worsening candidates use `direction="worsening"`. The `rp.peakValue` is the upper
bound; for already-at-peak metrics, `targetValue = currentValue * 1.2` (existing
behaviour from `resolveReactiveTarget`).

### 8.4 Capacity adequacy for `scale_capacity`

The `scale_capacity` builder pre-computes:

```
demandEstimate = baselineRate × incidentMagnitude
headroom = newCapacity - demandEstimate
```

If `headroom >= 0`: full recovery candidate is labeled "SUFFICIENT — new capacity
covers demand." If `headroom < 0`: no full recovery candidate is generated;
partial recovery candidate is labeled "INSUFFICIENT — demand exceeds new capacity."

This is the only arithmetic in the system. The LLM reads the conclusion.

### 8.5 Example menu

`scale_capacity({ componentId: "payments_ddb", writeCapacity: 200 })` with
traffic spike × 3.0 active, original WCU=100:

```
reactions: [
  {
    id: "full_recovery",
    label: "Write throttles clear — 200 WCU covers estimated demand (~180 WCU)",
    description: "Select when new capacity is sufficient for current traffic.",
    overlays: [
      { service: "payment-service", metricId: "write_capacity_used",
        overlay: { pattern: "smooth_decay", targetValue: 120, speedSeconds: 60,
                   startValue: <current>, startSimTime: <now>, sustained: true } },
      { service: "payment-service", metricId: "write_throttles",
        overlay: { pattern: "cliff", targetValue: 0, speedSeconds: 60, ... } },
      { service: "payment-service", metricId: "error_rate",
        overlay: { pattern: "smooth_decay", targetValue: 0.5, speedSeconds: 120, ... } },
    ]
  },
  {
    id: "worsening",
    label: "Situation worsens — incorrect action or side effect",
    description: "Select when the action made things worse (e.g. scaled wrong component).",
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
    description: "Select when the action did not affect the incident.",
    overlays: []
  }
]
```

---

## 9. Tool replacement (`llm/tool-definitions.ts`)

### 9.1 `select_metric_reaction`

```typescript
{
  name: "select_metric_reaction",
  description:
    "Select which pre-computed metric reaction applies to the trainee's action. " +
    "The system has pre-calculated all physically correct outcomes. " +
    "Select exactly one. If the action changed nothing, select 'no_effect'.",
  parameters: {
    type: "object",
    required: ["reaction_id"],
    properties: {
      reaction_id: {
        type: "string",
        enum: []  // populated dynamically from ReactionMenu.reactions.map(r => r.id)
      },
      reasoning: {
        type: "string",
        description: "One sentence explaining why this reaction is correct."
      }
    }
  }
}
```

`apply_metric_response` is **removed** from `EVENT_TOOLS`. It no longer exists.

### 9.2 `getMetricReactionTools()` updated signature

```typescript
export function getMetricReactionTools(
  scenario: LoadedScenario,
  menu: ReactionMenu,
): LLMToolDefinition[];
```

Returns the `select_metric_reaction` tool with the `reaction_id` enum populated
from `menu.reactions.map(r => r.id)`. If `menu.reactions` is empty (should never
happen given the invariant), returns `[]`.

### 9.3 `llm_event_tools` config

The scenario YAML field `llm_event_tools` continues to gate whether the metric
reaction engine fires. The tool name changes from `"apply_metric_response"` to
`"select_metric_reaction"`. Both scenario files are updated.

---

## 10. Metric reaction engine (`engine/metric-reaction-engine.ts`)

### 10.1 Updated `_react()` flow

```typescript
async function _react(context: StakeholderContext): Promise<void> {
  const lastAction = context.auditLog[context.auditLog.length - 1];
  if (!lastAction) return;

  const menu = buildReactionMenu(
    lastAction,
    scenario,
    metricStore,
    getSimTime(),
  );

  // No meaningful reactions possible for this action type (e.g. communication actions)
  if (menu.reactions.length <= 1) return; // only no_effect → skip LLM call

  const messages = _buildPrompt(context, menu);
  const tools = getMetricReactionTools(scenario, menu);

  let response;
  try {
    response = await getLLMClient().call({
      role: "stakeholder",
      messages,
      tools,
      sessionId: context.sessionId,
    });
  } catch (err) {
    if (err instanceof LLMError) {
      log.error({ code: err.code }, "LLM error");
      return;
    }
    throw err;
  }

  for (const toolCall of response.toolCalls) {
    if (toolCall.tool !== "select_metric_reaction") continue;
    _applySelectedReaction(toolCall.params["reaction_id"] as string, menu);
  }
}
```

When `menu.reactions.length <= 1` (only `no_effect` present), the engine skips
the LLM call entirely. This handles communication actions cheaply.

### 10.2 `_applySelectedReaction()`

```typescript
function _applySelectedReaction(reactionId: string, menu: ReactionMenu): void {
  const reaction = menu.reactions.find((r) => r.id === reactionId);
  if (!reaction) {
    log.warn({ reactionId }, "Unknown reaction_id — no reaction applied");
    return;
  }
  for (const spec of reaction.overlays) {
    metricStore.applyActiveOverlay(spec.service, spec.metricId, spec.overlay);
    log.info({ service: spec.service, metricId: spec.metricId, reactionId });
  }
}
```

### 10.3 `_buildPrompt()` additions

Two new sections in the user message when topology components are present:

**`## Service Architecture`** (always included when components defined):

```
payment-service (API):
  [load_balancer] ALB → [ecs_cluster] ECS: 4 tasks (cpu baseline=55%) →
  [kinesis_stream] payment-events: 4 shards →
  [lambda] processor: concurrency=200 (util=35%) →
  [dynamodb] payments: wcu=100 rcu=500 (wUtil=60%)

Active incidents:
  [ddb_write_saturation] t=0: saturation overlay on payments_ddb
    Description: DynamoDB write capacity exhausted under sustained load
    Propagation path: alb → ecs → payment_stream → processor → payments_ddb
```

**`## Capacity Analysis`** (only for `scale_capacity` or `scale_cluster`):

```
Component: payments_ddb (DynamoDB)
  Previous WCU: 100  |  New WCU: 200
  Baseline write rate: 60 WCU  |  Traffic magnitude: 3.0×
  Estimated demand: 60 × 3.0 = 180 WCU
  Result: SUFFICIENT (+20 WCU headroom — throttles should clear)
```

**`## Available Reactions`** (always included):

```
Select exactly one reaction_id.

[full_recovery] Write throttles clear — 200 WCU covers estimated demand (~180 WCU)
  Use when: the new capacity is sufficient for current traffic.

[worsening] Situation worsens — incorrect action or side effect
  Use when: the action made things worse.

[no_effect] No meaningful metric change
  Use when: the action did not affect the incident.
```

---

## 11. Game loop additions (`engine/game-loop.ts`)

### 11.1 `scale_capacity` action type

Add `"scale_capacity"` to `ActionType` in `shared/types/events.ts`.

The `scale_capacity` handler in `game-loop.ts`:

```typescript
case "scale_capacity": {
  const componentId        = params["componentId"]         as string | undefined;
  const writeCapacity      = params["writeCapacity"]        as number | undefined;
  const readCapacity       = params["readCapacity"]         as number | undefined;
  const shardCount         = params["shardCount"]           as number | undefined;
  const desiredConcurrency = params["desiredConcurrency"]   as number | undefined;
  const billingMode        = params["billingMode"]          as "provisioned" | "on_demand" | undefined;

  const component = scenario.topology.focalService.components
    ?.find(c => c.id === componentId);
  if (!component) break;

  const service = scenario.topology.focalService.name;

  if (billingMode === "on_demand" && component.type === "dynamodb") {
    metricStore.clearScriptedOverlays(service, "write_capacity_used");
    metricStore.clearScriptedOverlays(service, "write_throttles");
    // Log and emit
  } else {
    // Update resolvedValue to new operating point
    if (writeCapacity != null && component.type === "dynamodb") {
      metricStore.updateResolvedValue(service, "write_capacity_used",
        writeCapacity * (component.writeUtilization ?? 0.6));
    }
    if (readCapacity != null && component.type === "dynamodb") {
      metricStore.updateResolvedValue(service, "read_capacity_used",
        readCapacity * (component.readUtilization ?? 0.2));
    }
    if (desiredConcurrency != null && component.type === "lambda") {
      metricStore.updateResolvedValue(service, "concurrent_executions",
        desiredConcurrency * (component.lambdaUtilization ?? 0.35));
    }
    // Log and emit
  }
  break;
}
```

`scale_capacity` is not in `PASSIVE_ACTIONS` — it triggers the metric reaction
engine.

---

## 12. Remediation panel (`components/tabs/RemediationsPanel.tsx`)

### 12.1 `getComponentCapabilities()`

```typescript
export interface ServiceCapabilities {
  canRestart: boolean; // ecs_cluster | ec2_fleet | rds | elasticache
  canScaleHosts: boolean; // ecs_cluster | ec2_fleet
  canScaleConcurrency: boolean; // lambda
  canScaleCapacity: boolean; // dynamodb | kinesis_stream
  canSwitchBillingMode: boolean; // dynamodb
  canThrottle: boolean; // load_balancer | api_gateway
}

export function getComponentCapabilities(
  components: ServiceComponent[],
): ServiceCapabilities;
```

This function is pure (no side effects), exported, and tested independently.

### 12.2 Section visibility gating

`RemediationsPanel` reads `useScenario().scenario.topology.focalService.components`
(exposed via `ScenarioContext`) and calls `getComponentCapabilities()` to determine
which sections to render.

### 12.3 New `ScaleConcurrencySection`

Shown when `caps.canScaleConcurrency`. UX mirrors `ScaleSection`:

- Label: "Desired concurrency:"
- Input pre-populated from component `reservedConcurrency`
- Apply disabled when value equals current
- Dispatches `scale_capacity { componentId, desiredConcurrency }`

### 12.4 New `ScaleCapacitySection`

Shown when `caps.canScaleCapacity`. For each qualifying component:

- DynamoDB: "Write capacity (WCU):" and "Read capacity (RCU):" inputs pre-populated
  from component definition. Toggle: "Billing mode: Provisioned / On Demand".
  On-demand toggle bypasses the numeric inputs and dispatches
  `scale_capacity { componentId, billingMode: "on_demand" }`.
- Kinesis: "Shard count:" input pre-populated from `shardCount`.

Dispatches `scale_capacity` with appropriate params.

---

## 13. Scenario migration

Both scenarios are fully migrated. No `ops_dashboard` key remains in any YAML file.

### 13.1 `scenarios/_fixture/scenario.yaml`

```yaml
# Before:
service_type: api
topology:
  focal_service: fixture-service
  upstream: []
  downstream: []

# After: (minimal — fixture only needs enough for tests to pass)
topology:
  focal_service:
    name: fixture-service
    category: api
    description: "Minimal fixture service for automated tests."
    typical_rps: 100
    health: healthy
    traffic_profile: always_on_api
    components:
      - id: alb
        type: load_balancer
        label: "ALB"
        inputs: []
      - id: app
        type: ecs_cluster
        label: "fixture-service ECS"
        instance_count: 2
        utilization: 0.40
        inputs: [alb]
    incidents:
      - id: error_rate_spike
        affected_component: app
        description: "Error rate elevated due to misconfiguration."
        onset_overlay: spike_and_sustain
        onset_second: 0
        magnitude: 20.0   # 20× baseline error rate → ~10%
  upstream: []
  downstream: []

timeline:
  default_speed: 1
  duration_minutes: 10
  pre_incident_seconds: 300
  resolution_seconds: 15
```

`service_type` top-level field is removed (replaced by `focal_service.category`).

The `llm_event_tools` section updates `apply_metric_response` → `select_metric_reaction`:

```yaml
llm_event_tools:
  - tool: fire_alarm
    max_calls: 1
  - tool: inject_log_entry
    enabled: true
  - tool: select_metric_reaction
    enabled: true
```

The fixture `mock-llm-responses.yaml` is updated: the `apply_metric_response`
tool_call entry is replaced with:

```yaml
- tool: select_metric_reaction
  params:
    reaction_id: full_recovery
    reasoning: "The action addressed the root cause — error rate should recover."
```

### 13.2 `scenarios/payment-db-pool-exhaustion/scenario.yaml`

Full topology with 5 components and 1 incident. `ops_dashboard` section removed.
`throttle_targets` on `throttle_payment` action retained (from LLD §F).
New `scale_capacity` remediation actions added.

```yaml
topology:
  focal_service:
    name: payment-service
    category: api
    description: "Payment processing microservice."
    owner: sara-chen
    typical_rps: 200
    traffic_profile: always_on_api
    health: degraded
    components:
      - id: alb
        type: load_balancer
        label: "Application Load Balancer"
        inputs: []
      - id: ecs
        type: ecs_cluster
        label: "payment-service ECS (Fargate)"
        instance_count: 4
        utilization: 0.55
        inputs: [alb]
      - id: payment_stream
        type: kinesis_stream
        label: "payment-events"
        shard_count: 4
        inputs: [ecs]
      - id: processor
        type: lambda
        label: "payment-event-processor"
        reserved_concurrency: 200
        lambda_utilization: 0.35
        inputs: [payment_stream]
      - id: payments_ddb
        type: dynamodb
        label: "payments DynamoDB table"
        write_capacity: 100
        read_capacity: 500
        write_utilization: 0.60
        read_utilization: 0.20
        inputs: [processor]
    incidents:
      - id: ddb_write_saturation
        affected_component: payments_ddb
        description: "DynamoDB write capacity exhausted under sustained high checkout volume."
        onset_overlay: saturation
        onset_second: 0
        magnitude: 1.0
  upstream:
    - name: api-gateway
      description: "AWS API Gateway routes inbound payment API traffic."
  downstream:
    - name: postgres-primary
      description: "Legacy PostgreSQL — read-only fraud history lookups."
      correlation: exonerated
    - name: fraud-service
      description: "Synchronous fraud scoring. Called per checkout."
      correlation: independent

timeline:
  default_speed: 2
  duration_minutes: 15
  pre_incident_seconds: 43200
  resolution_seconds: 60
```

---

## 14. Test plan

All tests follow TDD: write failing test → implement → validate → proceed.

| Test file                                 | Verifies                                                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `component-topology.test.ts` (new)        | `findEntrypoint`: zero, one, two entrypoints; `propagationPath`: linear chain, branched graph; cycle detection                                                                   |
| `component-metrics.test.ts` (new)         | `deriveBaseline` for each type; `incidentPeakValue` linear and sub-linear; `ceiling` null vs value                                                                               |
| `scenario/loader.test.ts` (extend)        | `deriveMetricsFromComponents` with 1 incident, 2 incidents same metric, `endSecond`; `FocalServiceConfig` has correct metrics + overlayApplications                              |
| `metrics/series.test.ts` (extend)         | `generateOneSeries` with 0, 1, 2 `overlayApplications`; `endSecond` causes return to baseline                                                                                    |
| `metrics/metric-store.test.ts` (extend)   | `updateResolvedValue`, `clearScriptedOverlays`; `_computeScriptedValue` skips overlay past `endSecond`; multi-incident compounds                                                 |
| `reaction-menu.test.ts` (new)             | Menu invariant (recovery + worsening + no_effect); capacity adequacy SUFFICIENT vs INSUFFICIENT; communication actions → only no_effect                                          |
| `metric-reaction-engine.test.ts` (extend) | `_applySelectedReaction` applies overlays; unknown reaction_id is no-op; LLM not called when only no_effect in menu                                                              |
| `RemediationsPanel.test.tsx` (extend)     | `getComponentCapabilities` correct for each type combination; `ScaleConcurrencySection` renders for lambda; `ScaleCapacitySection` renders for dynamodb with billing mode toggle |
