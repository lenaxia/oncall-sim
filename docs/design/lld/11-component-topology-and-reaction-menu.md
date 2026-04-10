# LLD 11 — Component Topology, Auto-Generated Metrics, and Reaction Menu

**Phase:** 11
**Depends on:** LLD 01–10 (all implemented and passing)
**Status:** Design — not yet implemented

---

## Purpose

Three tightly related changes:

1. **Component topology** — `topology.focal_service` becomes a rich object
   describing the microservice's internal architecture as a typed, extensible
   discriminated union of `ServiceComponent` subtypes. Each subtype has only
   the capacity fields that apply to it. Adding a new component type requires
   adding a new union member and a new `COMPONENT_METRICS` entry — no existing
   code changes.

   `ServiceCategory` (`service_type` in YAML) is **removed entirely** — it is
   not rendered in the UI, not used by the metric pipeline, and not sent to the
   LLM. The component graph expresses service structure more precisely. `tags`
   and `difficulty` on the scenario remain for ScenarioPicker filtering.

2. **Auto-generated ops dashboard** — `ops_dashboard` is removed from YAML
   entirely. The loader derives the equivalent `FocalServiceConfig` (and
   correlated service configs) from the component graph at load time.
   `LoadedScenario.opsDashboard` remains as a runtime-derived field so the
   metric pipeline (resolver, generator, metric-summary) is unchanged.

3. **Reaction menu** — `apply_metric_response` is replaced by
   `select_metric_reaction`. The engine pre-computes exactly four named outcomes
   before each LLM call: `full_recovery`, `partial_recovery`, `worsening`,
   `no_effect`. The LLM selects one. The engine applies the pre-computed
   `ActiveOverlay` objects. No magic strings, no LLM arithmetic.

---

## Scope

### New files

```
client/src/metrics/
  component-metrics.ts        # ComponentMetricSpec registry keyed by ComponentType
  reaction-menu.ts            # builds 4-option ReactionMenu per trainee action

client/src/scenario/
  component-topology.ts       # graph utilities: entrypoint, propagation path, lag
```

### Modified files

```
shared/types/events.ts
  + MetricOverlaySpec, MetricReaction, ReactionMenu
  + "scale_capacity" to ActionType

client/src/scenario/types.ts
  - TopologyConfig (flat strings)
  - FocalServiceConfig, CorrelatedServiceConfig, OpsDashboardConfig, ServiceScale
    (remain as internal/derived types; removed from authored types)
  - service_type: ServiceType  ← REMOVED ENTIRELY (not rendered, not used in logic)
  - ServiceCategory type         ← REMOVED ENTIRELY
  + ComponentType, ServiceComponent (discriminated union), IncidentConfig
  + ServiceNode, TopologyConfig (object form)
  ~ TimelineConfig: add preIncidentSeconds, resolutionSeconds

client/src/scenario/schema.ts
  + ComponentSchema (discriminated union via z.discriminatedUnion)
  + IncidentConfigSchema, ServiceNodeSchema
  ~ topology: replace flat-string form with ServiceNodeSchema objects
  ~ timeline: add pre_incident_seconds, resolution_seconds
  - ops_dashboard, ops_dashboard_file, service_type
    (all removed from ScenarioSchema)

client/src/scenario/loader.ts
  ~ transform(): topology objects replace flat strings; ops_dashboard derived
  + deriveOpsDashboard(): produces FocalServiceConfig + CorrelatedServiceConfig[]
    from component graph (called from transform())

client/src/scenario/validator.ts
  + entrypoint uniqueness, input reference validity, cycle detection,
    incident component validity, typical_rps required when components present

client/src/metrics/types.ts
  + OverlayApplication (replaces 7 flat overlay fields on ResolvedMetricParams)
  ~ ResolvedMetricParams: single overlay fields → overlayApplications[]

client/src/metrics/patterns/incident-overlay.ts
  ~ applyIncidentOverlay(): add explicit OverlayApplication parameter

client/src/metrics/series.ts
  ~ generateOneSeries(): loop overlayApplications[]

client/src/metrics/metric-store.ts
  ~ _computeScriptedValue(): loop overlayApplications[], respect endSecond
  + updateResolvedValue(), clearScriptedOverlays()

client/src/metrics/resolver.ts
  ~ resolveMetricParams(): build overlayApplications[] from MetricConfig

client/src/engine/game-loop.ts
  + scale_capacity action handler

client/src/engine/metric-reaction-engine.ts
  ~ _react(): build ReactionMenu; skip LLM when only no_effect
  ~ _buildPrompt(): add ## Service Architecture, ## Capacity Analysis,
    ## Available Reactions sections
  ~ replace _applyMetricResponse() with _applySelectedReaction()

client/src/llm/tool-definitions.ts
  ~ replace apply_metric_response with select_metric_reaction
  ~ getMetricReactionTools() accepts ReactionMenu parameter

client/src/context/ScenarioContext.tsx
  + expose topology.focalService.components in ScenarioConfig

client/src/components/tabs/RemediationsPanel.tsx
  + getComponentCapabilities(), ScaleConcurrencySection, ScaleCapacitySection
  ~ gate existing sections on component capabilities

scenarios/_fixture/scenario.yaml
  ~ full migration: topology object, no ops_dashboard, select_metric_reaction
scenarios/_fixture/mock-llm-responses.yaml
  ~ apply_metric_response → select_metric_reaction

scenarios/payment-db-pool-exhaustion/scenario.yaml
  ~ full migration
```

### Test files

```
client/__tests__/metrics/component-metrics.test.ts       new
client/__tests__/metrics/reaction-menu.test.ts           new
client/__tests__/scenario/component-topology.test.ts     new
client/__tests__/scenario/loader.test.ts                 extend
client/__tests__/metrics/series.test.ts                  extend
client/__tests__/metrics/metric-store.test.ts            extend
client/__tests__/engine/metric-reaction-engine.test.ts   extend
client/__tests__/tabs/RemediationsPanel.test.tsx         extend
```

---

## 1. Types

### 1.1 `ServiceCategory` — removed

`ServiceCategory` (`service_type` in YAML) is removed. Audit of the codebase:

- Not rendered in any UI component (ScenarioPicker renders `difficulty` and `tags`)
- Not read by the metric pipeline
- Not included in any LLM prompt
- Tested only for its own schema presence, not for any downstream effect

The component graph (`ServiceNode.components[]`) expresses what kind of service
this is more precisely than a string label. `tags` on the scenario remains for
ScenarioPicker filtering and search.

`ServiceType`, `ServiceCategory`, and `service_type` are deleted from:
`scenario/types.ts`, `scenario/schema.ts`, `scenario/loader.ts`,
`context/ScenarioContext.tsx`, `testutil/index.tsx`, and both scenario YAML files.

### 1.2 `ComponentType` — closed discriminant

`ComponentType` drives structural behaviour: which capacity fields exist, which
metrics are auto-generated, which remediation controls are shown. It must be
exhaustively handled in `COMPONENT_METRICS` and `ComponentSchema`. Adding a new
type requires adding a new union member, a new `ComponentSchema` branch, and a
new `COMPONENT_METRICS` entry — and nothing else.

```typescript
export type ComponentType =
  | "load_balancer" // ALB/NLB — HTTP/HTTPS entrypoint; throttle point
  | "api_gateway" // API Gateway — HTTP entrypoint; rate-limiting point
  | "ecs_cluster" // ECS tasks (Fargate or EC2-backed) — scalable, restartable
  | "ec2_fleet" // EC2 ASG — scalable, restartable
  | "lambda" // Lambda function — concurrency-capped, not restartable
  | "kinesis_stream" // Kinesis data stream — shard-scalable
  | "sqs_queue" // SQS queue — no hard capacity ceiling
  | "dynamodb" // DynamoDB table — WCU/RCU scalable; billing mode switchable
  | "rds" // RDS instance or Aurora cluster — scalable, restartable
  | "elasticache" // Redis/Memcached — node-scalable, restartable
  | "s3" // S3 bucket — no compute; batch/ETL source only
  | "scheduler"; // EventBridge/cron — batch entrypoint; no scale controls
```

### 1.3 `ServiceComponent` — discriminated union

Each member has exactly the capacity fields that apply to its type. No other
member's fields bleed in. TypeScript narrows correctly on `component.type`.
The registry `COMPONENT_METRICS` consumes the narrowed type — no unsafe casts.

```typescript
// ── Shared base ───────────────────────────────────────────────────────────────

interface ServiceComponentBase {
  id: string; // unique within this service; referenced by inputs[] and incidents
  label: string; // human-readable; shown in UI and LLM prompts
  inputs: string[]; // ids of components whose output feeds into this one.
  // inputs:[] means this component is the service entrypoint.
  // Exactly one entrypoint per service (validated).
}

// ── Concrete subtypes ─────────────────────────────────────────────────────────

export interface LoadBalancerComponent extends ServiceComponentBase {
  type: "load_balancer";
  // No capacity fields — ALB is a pass-through with no authoring knobs
}

export interface ApiGatewayComponent extends ServiceComponentBase {
  type: "api_gateway";
  // No capacity fields — throttle limits are defined in throttle_targets on the action
}

export interface EcsClusterComponent extends ServiceComponentBase {
  type: "ecs_cluster";
  instanceCount: number; // current running task count
  utilization: number; // fraction [0,1]; cpu baseline = utilization × 100%
}

export interface Ec2FleetComponent extends ServiceComponentBase {
  type: "ec2_fleet";
  instanceCount: number;
  utilization: number;
}

export interface LambdaComponent extends ServiceComponentBase {
  type: "lambda";
  reservedConcurrency: number; // hard ceiling on simultaneous executions
  lambdaUtilization: number; // fraction [0,1]; baseline concurrent = reserved × util
}

export interface KinesisStreamComponent extends ServiceComponentBase {
  type: "kinesis_stream";
  shardCount: number;
  // No utilization — Kinesis throughput scales with load; no fixed ceiling
}

export interface SqsQueueComponent extends ServiceComponentBase {
  type: "sqs_queue";
  // No capacity fields — SQS has no hard ceiling modelled here
}

export interface DynamoDbComponent extends ServiceComponentBase {
  type: "dynamodb";
  writeCapacity: number; // provisioned WCU; ignored when billingMode=on_demand
  readCapacity: number; // provisioned RCU
  writeUtilization: number; // fraction [0,1]; baseline write_capacity_used = wcu × util
  readUtilization: number; // fraction [0,1]
  billingMode: "provisioned" | "on_demand"; // default: provisioned
}

export interface RdsComponent extends ServiceComponentBase {
  type: "rds";
  instanceCount: number;
  maxConnections: number; // max_connections parameter value
  utilization: number; // fraction [0,1]; cpu baseline = utilization × 100%
  connectionUtilization: number; // fraction [0,1]; baseline connections = max × util
}

export interface ElasticacheComponent extends ServiceComponentBase {
  type: "elasticache";
  instanceCount: number;
  utilization: number; // fraction [0,1]
}

export interface S3Component extends ServiceComponentBase {
  type: "s3";
  // No capacity fields
}

export interface SchedulerComponent extends ServiceComponentBase {
  type: "scheduler";
  // No capacity fields
}

// ── Union ─────────────────────────────────────────────────────────────────────

export type ServiceComponent =
  | LoadBalancerComponent
  | ApiGatewayComponent
  | EcsClusterComponent
  | Ec2FleetComponent
  | LambdaComponent
  | KinesisStreamComponent
  | SqsQueueComponent
  | DynamoDbComponent
  | RdsComponent
  | ElasticacheComponent
  | S3Component
  | SchedulerComponent;
```

**Adding a new component type** requires:

1. Add a new interface extending `ServiceComponentBase`
2. Add it to the `ServiceComponent` union
3. Add a `ComponentSchema` branch (§2.1)
4. Add a `COMPONENT_METRICS` entry (§4)

No existing code changes. The TypeScript exhaustiveness check in
`COMPONENT_METRICS` will fail to compile until the new entry is added.

### 1.4 `IncidentConfig`

```typescript
export interface IncidentConfig {
  id: string;
  affectedComponent: string; // component id in this service's components[]
  description: string; // shown verbatim in LLM prompt; factual, not a hint
  onsetOverlay: OverlayType; // reuses existing: spike_and_sustain |
  // gradual_degradation | saturation | sudden_drop
  onsetSecond: number;
  magnitude: number; // multiplier on affected component's baseline.
  // saturation: 1.0 = fills to capacity.
  // spike_and_sustain: 3.0 = 3× baseline.
  rampDurationSeconds?: number; // default 30; only for spike_and_sustain
  endSecond?: number; // absent = sustained. present = returns organically
  // to baseline at endSecond (no shaped recovery).
}
```

### 1.5 `ServiceNode` and `TopologyConfig`

```typescript
export interface ServiceNode {
  name: string;
  description: string;
  owner?: string; // persona id or team name; for "who to page" context
  typicalRps?: number; // required on focal_service when components defined;
  // primary traffic volume signal for baseline derivation
  trafficProfile?: TrafficProfile; // default derived from entrypoint component type (§6.2)
  health?: HealthLevel; // default: "healthy"; drives noise multiplier
  correlation?: CorrelationType; // downstream nodes only; default: "independent"
  lagSeconds?: number; // downstream nodes with upstream_impact correlation
  impactFactor?: number; // downstream nodes with upstream_impact correlation
  components?: ServiceComponent[];
  incidents?: IncidentConfig[]; // meaningful on focal_service; ignored on up/downstream
}

export interface TopologyConfig {
  focalService: ServiceNode;
  upstream: ServiceNode[];
  downstream: ServiceNode[];
}
```

**`preIncidentSeconds` and `resolutionSeconds`** move from `ops_dashboard` to
`TimelineConfig` — they are scenario-timing parameters:

```typescript
export interface TimelineConfig {
  defaultSpeed: 1 | 2 | 5 | 10;
  durationMinutes: number;
  preIncidentSeconds: number; // moved from ops_dashboard; default 300
  resolutionSeconds: number; // moved from ops_dashboard; default 15
}
```

### 1.6 Internal derived types (not in YAML)

These types remain in `scenario/types.ts` as internal types used by the metric
pipeline. They are derived by the loader — never authored.

`FocalServiceConfig`, `CorrelatedServiceConfig`, `OpsDashboardConfig`,
`ServiceScale` are kept as-is. The loader produces them from `ServiceNode` +
`ServiceComponent[]`. All downstream code (`resolver.ts`, `generator.ts`,
`metric-summary.ts`, etc.) continues to read `scenario.opsDashboard` unchanged.

`LoadedScenario.opsDashboard` remains on the runtime type, populated by the
loader. `ops_dashboard` as a YAML key does not exist.

### 1.7 Multi-incident overlay composition (`metrics/types.ts`)

```typescript
// Replaces the seven flat overlay fields on ResolvedMetricParams.
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
  // ... (all existing fields except the 7 overlay fields) ...
  overlayApplications: OverlayApplication[];
  // [] = pure baseline + rhythm + noise
  // [one] = single incident (equivalent to old single-overlay params)
  // [many] = multiple incidents compound in onset order
}
```

The old fields `overlay`, `onsetSecond`, `peakValue`, `dropFactor`, `ceiling`,
`saturationDurationSeconds`, `rampDurationSeconds` are removed. Every caller
is updated to use `overlayApplications[0]` or iterate.

### 1.8 Reaction menu types (`shared/types/events.ts`)

```typescript
export interface MetricOverlaySpec {
  service: string;
  metricId: string;
  overlay: ActiveOverlay; // fully pre-computed
}

export interface MetricReaction {
  id: "full_recovery" | "partial_recovery" | "worsening" | "no_effect";
  label: string; // shown to LLM
  description: string; // shown to LLM — when to select
  overlays: MetricOverlaySpec[];
}

// Invariant: exactly 4 reactions — one of each id.
export interface ReactionMenu {
  actionType: string; // ActionType that triggered this menu
  reactions: [
    MetricReaction & { id: "full_recovery" },
    MetricReaction & { id: "partial_recovery" },
    MetricReaction & { id: "worsening" },
    MetricReaction & { id: "no_effect" },
  ];
}
```

The tuple type enforces the invariant at compile time. The `no_effect` reaction
always has `overlays: []`. The other three always have non-empty `overlays`.

---

## 2. Schema (`scenario/schema.ts`)

### 2.1 `ComponentSchema` — discriminated union

```typescript
// Shared base fields — every component has these regardless of type
const ComponentBaseSchema = {
  id: z.string().min(1),
  label: z.string().min(1),
  inputs: z.array(z.string()),
};

const ComponentSchema = z.discriminatedUnion("type", [
  z.object({ ...ComponentBaseSchema, type: z.literal("load_balancer") }),
  z.object({ ...ComponentBaseSchema, type: z.literal("api_gateway") }),
  z.object({
    ...ComponentBaseSchema,
    type: z.literal("ecs_cluster"),
    instance_count: z.number().int().positive(),
    utilization: z.number().min(0).max(1),
  }),
  z.object({
    ...ComponentBaseSchema,
    type: z.literal("ec2_fleet"),
    instance_count: z.number().int().positive(),
    utilization: z.number().min(0).max(1),
  }),
  z.object({
    ...ComponentBaseSchema,
    type: z.literal("lambda"),
    reserved_concurrency: z.number().int().positive(),
    lambda_utilization: z.number().min(0).max(1),
  }),
  z.object({
    ...ComponentBaseSchema,
    type: z.literal("kinesis_stream"),
    shard_count: z.number().int().positive(),
  }),
  z.object({ ...ComponentBaseSchema, type: z.literal("sqs_queue") }),
  z.object({
    ...ComponentBaseSchema,
    type: z.literal("dynamodb"),
    write_capacity: z.number().int().positive(),
    read_capacity: z.number().int().positive(),
    write_utilization: z.number().min(0).max(1),
    read_utilization: z.number().min(0).max(1),
    billing_mode: z.enum(["provisioned", "on_demand"]).default("provisioned"),
  }),
  z.object({
    ...ComponentBaseSchema,
    type: z.literal("rds"),
    instance_count: z.number().int().positive(),
    max_connections: z.number().int().positive(),
    utilization: z.number().min(0).max(1),
    connection_utilization: z.number().min(0).max(1),
  }),
  z.object({
    ...ComponentBaseSchema,
    type: z.literal("elasticache"),
    instance_count: z.number().int().positive(),
    utilization: z.number().min(0).max(1),
  }),
  z.object({ ...ComponentBaseSchema, type: z.literal("s3") }),
  z.object({ ...ComponentBaseSchema, type: z.literal("scheduler") }),
]);
```

`z.discriminatedUnion("type", [...])` gives exhaustive parse errors and strong
inference. Adding a new component type: add a new `z.object` branch here and a
new member in the TypeScript union (§1.3) — nothing else changes.

### 2.2 `IncidentConfigSchema`

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

### 2.3 `ServiceNodeSchema`

```typescript
const ServiceNodeSchema = z.object({
  name: z.string().min(1),
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

### 2.4 `TimelineSchema` additions

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

### 2.6 Removals from `ScenarioSchema`

- `service_type` field — removed entirely (not used in any logic)
- `ops_dashboard` field — removed entirely
- `ops_dashboard_file` field — removed entirely

---

## 3. Cross-reference validation (`scenario/validator.ts`)

New rules added to `validateCrossReferences()`:

1. **`typical_rps` required.** If `focal_service.components.length > 0` and
   `focal_service.typical_rps` is absent, emit error.

2. **Entrypoint uniqueness.** For any service with `components.length > 0`:
   exactly one component must have `inputs: []`. Zero → error. Multiple → error.

3. **Input id validity.** Every id in `component.inputs[]` must reference an id
   that exists in the same service's `components[]`. Validated after full parse
   (ids resolved first).

4. **No cycles.** The component graph must be a DAG. Detect via DFS.

5. **Incident component validity.** Every `incident.affected_component` must be
   a component id in `focal_service.components`.

---

## 4. Component-to-metric registry (`metrics/component-metrics.ts`)

```typescript
export interface ComponentMetricSpec<
  T extends ServiceComponent = ServiceComponent,
> {
  archetype: string;

  // Narrowed to T — TypeScript guarantees correct capacity fields are accessed.
  deriveBaseline(component: T, typicalRps: number): number;
  incidentPeakValue(baseline: number, magnitude: number, component: T): number;
  lagSeconds: number;
  overlayForIncident(incidentOverlay: OverlayType): OverlayType;
  ceiling(component: T): number | null;
  resolvedValue(component: T, typicalRps: number): number;
}

// Exhaustive map — TypeScript ensures all ComponentType values are covered.
// Adding a new ComponentType that is not in this map causes a compile error.
export const COMPONENT_METRICS: {
  [K in ComponentType]: ComponentMetricSpec<
    Extract<ServiceComponent, { type: K }>
  >[];
} = {
  load_balancer: [
    {
      archetype: "request_rate",
      deriveBaseline: (_, rps) => rps,
      incidentPeakValue: (b, m) => b * m,
      lagSeconds: 0,
      overlayForIncident: (o) => o,
      ceiling: () => null,
      resolvedValue: (_, rps) => rps,
    },
    {
      archetype: "error_rate",
      deriveBaseline: () => 0.5,
      incidentPeakValue: (b, m) => b * m * 2,
      lagSeconds: 30,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 0.5,
    },
    {
      archetype: "p99_latency_ms",
      deriveBaseline: () => 50,
      incidentPeakValue: (b, m) => b * m * 3,
      lagSeconds: 15,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 50,
    },
  ],

  ecs_cluster: [
    {
      archetype: "cpu_utilization",
      deriveBaseline: (c) => c.utilization * 100,
      incidentPeakValue: (b, m, c) => Math.min(95, b * m * 0.7),
      lagSeconds: 0,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => 100,
      resolvedValue: (c) => c.utilization * 100,
    },
    {
      archetype: "p99_latency_ms",
      deriveBaseline: () => 80,
      incidentPeakValue: (b, m) => b * m * 4,
      lagSeconds: 15,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 80,
    },
  ],

  lambda: [
    {
      archetype: "concurrent_executions",
      deriveBaseline: (c) => c.reservedConcurrency * c.lambdaUtilization,
      incidentPeakValue: (b, m, c) => Math.min(c.reservedConcurrency, b * m),
      lagSeconds: 45,
      overlayForIncident: () => "saturation",
      ceiling: (c) => c.reservedConcurrency,
      resolvedValue: (c) => c.reservedConcurrency * c.lambdaUtilization,
    },
    {
      archetype: "error_rate",
      deriveBaseline: () => 0,
      incidentPeakValue: (_, m) => 15 * m,
      lagSeconds: 60,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 0,
    },
    {
      archetype: "p99_latency_ms",
      deriveBaseline: () => 300,
      incidentPeakValue: (b, m) => b * m * 2,
      lagSeconds: 45,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 300,
    },
  ],

  dynamodb: [
    {
      archetype: "write_capacity_used",
      deriveBaseline: (c) => c.writeCapacity * c.writeUtilization,
      incidentPeakValue: (b, m, c) => Math.min(c.writeCapacity, b * m),
      lagSeconds: 60,
      overlayForIncident: () => "saturation",
      ceiling: (c) => c.writeCapacity,
      resolvedValue: (c) => c.writeCapacity * c.writeUtilization,
    },
    {
      archetype: "write_throttles",
      deriveBaseline: () => 0,
      incidentPeakValue: (_, m) => 40 * m,
      lagSeconds: 65,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 0,
    },
    {
      archetype: "read_capacity_used",
      deriveBaseline: (c) => c.readCapacity * c.readUtilization,
      incidentPeakValue: (b, m, c) => Math.min(c.readCapacity, b * m * 0.3),
      lagSeconds: 60,
      overlayForIncident: () => "saturation",
      ceiling: (c) => c.readCapacity,
      resolvedValue: (c) => c.readCapacity * c.readUtilization,
    },
  ],

  kinesis_stream: [
    {
      archetype: "queue_depth",
      deriveBaseline: () => 0,
      incidentPeakValue: (_, m) => m * 5000,
      lagSeconds: 30,
      overlayForIncident: () => "gradual_degradation",
      ceiling: () => null,
      resolvedValue: () => 0,
    },
    {
      archetype: "throughput_bytes",
      deriveBaseline: (_, rps) => rps * 1500,
      incidentPeakValue: (b, m) => b * m,
      lagSeconds: 30,
      overlayForIncident: (o) => o,
      ceiling: () => null,
      resolvedValue: (_, rps) => rps * 1500,
    },
  ],

  sqs_queue: [
    {
      archetype: "queue_depth",
      deriveBaseline: () => 0,
      incidentPeakValue: (_, m) => m * 1000,
      lagSeconds: 30,
      overlayForIncident: () => "gradual_degradation",
      ceiling: () => null,
      resolvedValue: () => 0,
    },
    {
      archetype: "queue_age_ms",
      deriveBaseline: () => 100,
      incidentPeakValue: (b, m) => b * m * 5,
      lagSeconds: 60,
      overlayForIncident: () => "gradual_degradation",
      ceiling: () => null,
      resolvedValue: () => 100,
    },
  ],

  rds: [
    {
      archetype: "connection_pool_used",
      deriveBaseline: (c) => c.maxConnections * c.connectionUtilization,
      incidentPeakValue: (b, m, c) => Math.min(c.maxConnections, b * m * 0.8),
      lagSeconds: 0,
      overlayForIncident: () => "saturation",
      ceiling: (c) => c.maxConnections,
      resolvedValue: (c) => c.maxConnections * c.connectionUtilization,
    },
    {
      archetype: "cpu_utilization",
      deriveBaseline: (c) => c.utilization * 100,
      incidentPeakValue: (b, m) => Math.min(95, b * m * 0.5),
      lagSeconds: 0,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => 100,
      resolvedValue: (c) => c.utilization * 100,
    },
    {
      archetype: "p99_latency_ms",
      deriveBaseline: () => 5,
      incidentPeakValue: (b, m) => b * m * 20,
      lagSeconds: 15,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 5,
    },
  ],

  elasticache: [
    {
      archetype: "cpu_utilization",
      deriveBaseline: (c) => c.utilization * 100,
      incidentPeakValue: (b, m) => Math.min(95, b * m * 0.6),
      lagSeconds: 0,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => 100,
      resolvedValue: (c) => c.utilization * 100,
    },
  ],

  api_gateway: [
    {
      archetype: "request_rate",
      deriveBaseline: (_, rps) => rps,
      incidentPeakValue: (b, m) => b * m,
      lagSeconds: 0,
      overlayForIncident: (o) => o,
      ceiling: () => null,
      resolvedValue: (_, rps) => rps,
    },
    {
      archetype: "error_rate",
      deriveBaseline: () => 0.1,
      incidentPeakValue: (b, m) => b * m * 3,
      lagSeconds: 15,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 0.1,
    },
  ],

  ec2_fleet: [
    // Same shape as ecs_cluster — different defaults reflect EC2 boot time
    {
      archetype: "cpu_utilization",
      deriveBaseline: (c) => c.utilization * 100,
      incidentPeakValue: (b, m) => Math.min(95, b * m * 0.7),
      lagSeconds: 0,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => 100,
      resolvedValue: (c) => c.utilization * 100,
    },
  ],

  s3: [], // no metrics generated — S3 is a data source only
  scheduler: [], // no metrics generated — scheduler is an event trigger only
};
```

The mapped type `{ [K in ComponentType]: ... }` forces exhaustive coverage.
TypeScript will not compile if a `ComponentType` value has no entry.

---

## 5. Propagation graph utilities (`scenario/component-topology.ts`)

```typescript
// Returns the single component with inputs:[] — the entrypoint.
// Throws if zero or multiple entrypoints.
export function findEntrypoint(
  components: ServiceComponent[],
): ServiceComponent;

// Returns component ids in topological order starting from startId.
// "Forward" = follows who lists startId in their inputs[], then their outputs, etc.
//
// Example: [alb(inputs:[]), ecs(inputs:[alb]), kinesis(inputs:[ecs]), lambda(inputs:[kinesis])]
//   propagationPath("alb") → ["alb", "ecs", "kinesis", "lambda"]
//   propagationPath("ecs") → ["ecs", "kinesis", "lambda"]
//
// Implementation: BFS from startId, at each step find components
// whose inputs[] contains the current id.
export function propagationPath(
  startId: string,
  components: ServiceComponent[],
): string[];

// Accumulated lag from startId to targetId along propagationPath.
// Each component contributes max(lagSeconds) across its metric specs.
export function propagationLag(
  startId: string,
  targetId: string,
  components: ServiceComponent[],
): number;
```

---

## 6. Metric derivation from components (`scenario/loader.ts`)

### 6.1 How `LoadedScenario.opsDashboard` is populated

`LoadedScenario.opsDashboard` stays as a runtime field. The loader's `transform()`
function no longer reads it from YAML (there is no `ops_dashboard` key). Instead:

```typescript
// In transform():
const opsDashboard = deriveOpsDashboard(
  raw.topology.focal_service, // after ServiceNode transform
  raw.timeline.pre_incident_seconds,
  raw.timeline.resolution_seconds,
);
```

`deriveOpsDashboard()` returns an `OpsDashboardConfig` with `focalService` and
`correlatedServices` populated from the component graph. All downstream code
(`resolver.ts`, `generator.ts`, etc.) reads `scenario.opsDashboard` unchanged.

### 6.2 `deriveOpsDashboard()` algorithm

```typescript
function deriveOpsDashboard(
  node: ServiceNode,
  preIncidentSeconds: number,
  resolutionSeconds: number,
): OpsDashboardConfig;
```

1. Find entrypoint component via `findEntrypoint(node.components)`.
2. For each component in `propagationPath(entrypoint.id, node.components)`:
   a. Look up `COMPONENT_METRICS[component.type]` for its `ComponentMetricSpec[]`.
   b. For each spec: compute `baselineValue`, `resolvedValue` from capacity fields.
   c. For each incident in `node.incidents`:
   - Compute propagation lag from `incident.affectedComponent` to this component.
   - Compute `onsetSecond = incident.onsetSecond + lag`.
   - Compute `peakValue = spec.incidentPeakValue(baseline, incident.magnitude, component)`.
   - Compute `overlay = spec.overlayForIncident(incident.onsetOverlay)`.
   - Build `OverlayApplication`.
     d. Group `OverlayApplication[]` by archetype. Multiple incidents → multiple
     entries sorted by `onsetSecond`.
3. Build `MetricConfig[]` from all collected (archetype, overlayApplications, baseline,
   resolvedValue) tuples. One `MetricConfig` per unique archetype across all components.
4. Produce `FocalServiceConfig`:
   - `name`: node.name
   - `scale.typicalRps`: node.typicalRps
   - `trafficProfile`: node.trafficProfile ?? deriveTrafficProfile(entrypoint.type)
     where deriveTrafficProfile: load_balancer|api_gateway→'always_on_api';
     kinesis_stream|sqs_queue→'none'; scheduler→'batch_nightly'; default→'none'
   - `health`: node.health ?? "healthy"
   - `incidentType`: `"component_derived"` (sentinel; bypasses `INCIDENT_TYPE_REGISTRY` lookup)
   - `metrics`: derived `MetricConfig[]`
5. For each `topology.downstream[]` entry with `components.length > 0`: derive
   `CorrelatedServiceConfig` similarly (its own component graph, correlation type
   from `node.correlation`).

### 6.3 `MetricConfig` change

`MetricConfig` gains `incidentResponses?: OverlayApplication[]`. When present,
`resolver.ts` populates `ResolvedMetricParams.overlayApplications` directly from
this array. The legacy paths (`incidentPeak`, `incidentType`, `incidentResponse`)
are removed from `MetricConfig` since `ops_dashboard` no longer exists in YAML.
`resolver.ts` simplifies to a single path:

```typescript
resolvedParams.overlayApplications = metricConfig.incidentResponses ?? [];
```

---

## 7. Multi-incident overlay application

### 7.1 `applyIncidentOverlay()` updated signature

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
  baselineValue: number, // only field needed from ResolvedMetricParams
  app: OverlayApplication, // explicit overlay application
  tAxis: number[],
): number[];
```

Callers pass `params.baselineValue` and the specific `app`. The function no
longer reads anything from `params` beyond `baselineValue`. This removes the
coupling between `applyIncidentOverlay` and `ResolvedMetricParams`.

### 7.2 `generateOneSeries()` (`metrics/series.ts`)

```typescript
let result = tAxis.map((_, i) => baseline[i] + rhythm[i] + noise[i]);
const archDef = getArchetypeDefaults(params.archetype);
for (const app of params.overlayApplications) {
  if (app.overlay === "none") continue;
  result = applyIncidentOverlay(result, params.baselineValue, app, tAxis);
}
return tAxis.map((t, i) => ({
  t,
  v: clampSeries([result[i]], archDef.minValue, archDef.maxValue)[0],
}));
```

### 7.3 `_computeScriptedValue()` (`metrics/metric-store.ts`)

```typescript
function _computeScriptedValue(state: MetricState, t: number): number {
  const rp = state.resolvedParams;
  let value =
    generateBaseline(rp.baselineValue, [t])[0] +
    (rp.inheritsRhythm
      ? generateRhythm(rp.rhythmProfile, rp.baselineValue, [t])[0]
      : 0);

  for (const app of rp.overlayApplications) {
    if (app.overlay === "none") continue;
    if (t < app.onsetSecond) continue;
    if (app.endSecond != null && t >= app.endSecond) continue;
    [value] = applyIncidentOverlay([value], rp.baselineValue, app, [t]);
  }
  const archDef = getArchetypeDefaults(rp.archetype);
  return clampSeries([value], archDef.minValue, archDef.maxValue)[0];
}
```

### 7.4 New `MetricStore` methods

```typescript
// Called by game loop after scale_capacity. Updates the target value the LLM
// reaction engine will use for "full recovery" magnitude.
updateResolvedValue(service: string, metricId: string, newValue: number): void;

// Called when DynamoDB switches to on_demand. Removes saturation overlays
// from overlayApplications for this metric so the ceiling no longer applies.
// The active LLM-set overlay (if any) is unaffected.
clearScriptedOverlays(service: string, metricId: string): void;
```

---

## 8. Reaction menu (`metrics/reaction-menu.ts`)

### 8.1 Invariant (enforced by type)

Every `ReactionMenu` has exactly 4 reactions in a fixed tuple. TypeScript enforces
this at the construction site — `buildReactionMenu()` returns the tuple type.

| id                 | Meaning                                           |
| ------------------ | ------------------------------------------------- |
| `full_recovery`    | Action fully addressed the root cause             |
| `partial_recovery` | Action helped but does not fully fix the incident |
| `worsening`        | Action made the incident worse                    |
| `no_effect`        | Action had no effect on the incident trajectory   |

### 8.2 `buildReactionMenu()`

```typescript
export function buildReactionMenu(
  action: AuditEntry,
  scenario: LoadedScenario,
  metricStore: MetricStore,
  simTime: number,
): ReactionMenu;
```

Constructs all four candidates unconditionally. The content of each candidate
varies based on the action type and incident context, but all four are always
present.

For **communication actions** (`post_chat_message`, `reply_email`,
`direct_message_persona`, `ack_page`, `page_user`, `update_ticket`,
`add_ticket_comment`): all three non-`no_effect` candidates have
`overlays: []` with labels making clear they are not applicable. The metric
reaction engine sees `full_recovery.overlays.length === 0` for these actions and
skips the LLM call entirely.

Actually — better: for communication actions the metric reaction engine filters
them out in `PASSIVE_ACTIONS` before `buildReactionMenu()` is even called. The
LLM call is never made. `buildReactionMenu()` only needs to handle active
remediation actions.

### 8.3 Capacity adequacy pre-computation (for `scale_capacity`, `scale_cluster`)

```typescript
interface CapacityAdequacy {
  componentLabel: string;
  originalCapacity: number;
  newCapacity: number;
  baselineRate: number;
  magnitude: number;
  estimatedDemand: number;
  headroom: number;
  sufficient: boolean;
}
```

The adequacy result determines which candidate labels and overlay targets are
used. If `sufficient = true`, `full_recovery` gets meaningful recovery overlays
targeting `resolvedValue`. If `sufficient = false`, `full_recovery` still exists
(the LLM must always have the option) but its label says "Full recovery —
capacity would need to exceed demand" and its overlays target `resolvedValue`
anyway (the system presents the option; the LLM decides whether to select it
based on the adequacy context it received).

### 8.4 Example — `scale_capacity({ componentId: "payments_ddb", writeCapacity: 200 })`

All four candidates, always present:

```
full_recovery:
  label: "Write throttles clear — 200 WCU covers estimated demand (~180 WCU)"
  description: "Select when new capacity is sufficient for current traffic load."
  overlays:
    write_capacity_used → smooth_decay to resolvedValue (120 WCU)
    write_throttles     → cliff to 0
    error_rate          → smooth_decay to resolvedValue (0.5%)

partial_recovery:
  label: "Throttles reduce but persist — improvement but not fully resolved"
  description: "Select when the action helps but the root cause is not fully addressed."
  overlays:
    write_capacity_used → smooth_decay to midpoint(current, resolvedValue)
    write_throttles     → smooth_decay to midpoint(current, 0)
    error_rate          → smooth_decay to midpoint(current, resolvedValue)

worsening:
  label: "Situation worsens — incorrect action or counterproductive side effect"
  description: "Select when this action made the incident worse."
  overlays:
    write_throttles → spike_and_sustain toward peakValue × 1.2
    error_rate      → spike_and_sustain toward peakValue × 1.2

no_effect:
  label: "No meaningful metric change"
  description: "Select when this action did not affect the incident trajectory."
  overlays: []
```

---

## 9. Tool replacement (`llm/tool-definitions.ts`)

### 9.1 `select_metric_reaction`

```typescript
{
  name: "select_metric_reaction",
  description:
    "Select the pre-computed metric reaction that best represents the outcome " +
    "of the trainee's action. Always select exactly one. " +
    "full_recovery = action fully resolves the incident. " +
    "partial_recovery = action helps but does not fully fix it. " +
    "worsening = action made things worse. " +
    "no_effect = action had no impact on the incident.",
  parameters: {
    type: "object",
    required: ["reaction_id"],
    properties: {
      reaction_id: {
        type: "string",
        enum: ["full_recovery", "partial_recovery", "worsening", "no_effect"]
        // Note: enum is static — ids are fixed across all menus. No dynamic population needed.
      },
      reasoning: {
        type: "string",
        description: "One sentence explaining why this reaction is correct."
      }
    }
  }
}
```

The `reaction_id` enum is **static** — the four values are always the same. This
simplifies `getMetricReactionTools()` (no longer needs to accept a `menu` param).
The menu's `overlays` per candidate vary, but the LLM only sees the ids, which
are constant. The `## Available Reactions` section in the prompt provides the
per-call descriptions.

`apply_metric_response` is removed from `EVENT_TOOLS`.

`getMetricReactionTools()` signature:

```typescript
export function getMetricReactionTools(
  scenario: LoadedScenario,
): LLMToolDefinition[];
```

No `menu` parameter needed — the tool schema is static.

### 9.2 `llm_event_tools` config

Scenario YAML replaces `apply_metric_response` with `select_metric_reaction`:

```yaml
llm_event_tools:
  - tool: select_metric_reaction
    enabled: true
```

---

## 10. Metric reaction engine (`engine/metric-reaction-engine.ts`)

### 10.1 `_react()` — skip LLM for no-op menus

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

  // If all non-no_effect candidates have empty overlays, no LLM call is needed.
  const hasEffect = menu.reactions.some(
    (r) => r.id !== "no_effect" && r.overlays.length > 0,
  );
  if (!hasEffect) return;

  const messages = _buildPrompt(context, menu);
  const tools = getMetricReactionTools(scenario);

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
      log.error({ code: err.code });
      return;
    }
    throw err;
  }

  for (const toolCall of response.toolCalls) {
    if (toolCall.tool !== "select_metric_reaction") continue;
    const reactionId = toolCall.params["reaction_id"] as string;
    _applySelectedReaction(reactionId, menu);
  }
}
```

### 10.2 `_applySelectedReaction()`

```typescript
function _applySelectedReaction(reactionId: string, menu: ReactionMenu): void {
  const reaction = menu.reactions.find((r) => r.id === reactionId);
  if (!reaction) {
    log.warn({ reactionId }, "Unknown reaction_id — defaulting to no_effect");
    return;
  }
  for (const spec of reaction.overlays) {
    metricStore.applyActiveOverlay(spec.service, spec.metricId, spec.overlay);
    log.info({ service: spec.service, metricId: spec.metricId, reactionId });
  }
}
```

### 10.3 `_buildPrompt()` additions

**`## Service Architecture`** (when components defined):

```
payment-service (API):
  [load_balancer] ALB (inputs: external)
  [ecs_cluster] payment-service ECS: 4 tasks, cpu baseline=55% (inputs: ALB)
  [kinesis_stream] payment-events: 4 shards (inputs: ECS)
  [lambda] payment-event-processor: concurrency=200, util=35% (inputs: payment-events)
  [dynamodb] payments: wcu=100 rcu=500, wUtil=60% (inputs: payment-event-processor)

Active incidents:
  [ddb_write_saturation] onset=t+0 saturation @ payments_ddb
    "DynamoDB write capacity exhausted under sustained high checkout volume."
    Propagation: ALB → ECS → payment-events → processor → payments_ddb
```

**`## Capacity Analysis`** (scale_capacity and scale_cluster only):

```
Component: payments_ddb (DynamoDB)
  Previous WCU: 100  →  New WCU: 200
  Baseline write rate: 60 WCU  |  Traffic magnitude: 3.0×
  Estimated demand: 60 × 3.0 = 180 WCU
  Headroom: +20 WCU  →  SUFFICIENT
```

**`## Available Reactions`** (always):

```
Select exactly one reaction_id.

[full_recovery] Write throttles clear — 200 WCU covers estimated demand
  Use when: action fully resolves the incident.

[partial_recovery] Throttles reduce but persist
  Use when: action helps but does not fully fix the root cause.

[worsening] Situation worsens
  Use when: action made things worse.

[no_effect] No meaningful metric change
  Use when: action had no impact on the incident trajectory.
```

---

## 11. Game loop (`engine/game-loop.ts`)

Add `"scale_capacity"` to `ActionType`. Add handler (same as in prior draft —
unchanged from §10 of the previous version). `scale_capacity` is not in
`PASSIVE_ACTIONS`.

---

## 12. Remediation panel (`components/tabs/RemediationsPanel.tsx`)

### 12.1 `getComponentCapabilities()`

Takes `ServiceComponent[]`. Uses TypeScript type narrowing on `component.type`
to determine capabilities. No switch statement needed — `Array.some()` with type
predicates.

```typescript
export function getComponentCapabilities(
  components: ServiceComponent[],
): ServiceCapabilities {
  return {
    canRestart: components.some(
      (c) =>
        c.type === "ecs_cluster" ||
        c.type === "ec2_fleet" ||
        c.type === "rds" ||
        c.type === "elasticache",
    ),
    canScaleHosts: components.some(
      (c) => c.type === "ecs_cluster" || c.type === "ec2_fleet",
    ),
    canScaleConcurrency: components.some((c) => c.type === "lambda"),
    canScaleCapacity: components.some(
      (c) => c.type === "dynamodb" || c.type === "kinesis_stream",
    ),
    canSwitchBillingMode: components.some(
      (c) => c.type === "dynamodb" && c.billingMode !== "on_demand",
    ),
    canThrottle: components.some(
      (c) => c.type === "load_balancer" || c.type === "api_gateway",
    ),
  };
}
```

New sections `ScaleConcurrencySection` (lambda) and `ScaleCapacitySection`
(dynamodb/kinesis) are added as described in the previous draft — no changes.

---

## 13. Scenario migration

### 13.1 `scenarios/_fixture/scenario.yaml`

Minimal migration — fixture only needs enough structure for tests:

```yaml
topology:
  focal_service:
    name: fixture-service
    description: "Minimal fixture service for automated tests."
    typical_rps: 100
    traffic_profile: always_on_api
    health: healthy
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
        magnitude: 20.0
  upstream: []
  downstream: []

timeline:
  default_speed: 1
  duration_minutes: 10
  pre_incident_seconds: 300
  resolution_seconds: 15

engine:
  tick_interval_seconds: 15
  default_tab: email
  llm_event_tools:
    - tool: select_metric_reaction
      enabled: true
    - tool: fire_alarm
      max_calls: 1
    - tool: inject_log_entry
      enabled: true
```

`mock-llm-responses.yaml` updated:

```yaml
# Replace apply_metric_response entry:
- trigger: after_action:trigger_rollback
  tool_calls:
    - tool: select_metric_reaction
      params:
        reaction_id: full_recovery
        reasoning: "Rollback to previous version resolves the incident."
```

### 13.2 `scenarios/payment-db-pool-exhaustion/scenario.yaml`

```yaml
topology:
  focal_service:
    name: payment-service
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
        billing_mode: provisioned
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
      description: "Synchronous fraud scoring service. Called per checkout request."
      correlation: independent

timeline:
  default_speed: 2
  duration_minutes: 15
  pre_incident_seconds: 43200
  resolution_seconds: 60

engine:
  tick_interval_seconds: 15
  default_tab: email
  llm_event_tools:
    - tool: select_metric_reaction
      enabled: true
    - tool: inject_log_entry
      enabled: true
    - tool: fire_alarm
      max_calls: 2
```

`ops_dashboard` section is **gone entirely**.

---

## 14. Test plan

TDD: failing test before each implementation step. Validate before proceeding.

| Test file                        | What is verified                                                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `component-topology.test.ts`     | `findEntrypoint`: zero/one/two entrypoints; `propagationPath`: linear chain, starts mid-chain; cycle detection throws                                                                                                                             |
| `component-metrics.test.ts`      | `deriveBaseline` for each component type (narrowed type safety verified); `incidentPeakValue` linear vs sub-linear; `ceiling` null vs value; TypeScript exhaustiveness (all `ComponentType` values present)                                       |
| `scenario/loader.test.ts`        | `deriveOpsDashboard` produces correct `FocalServiceConfig.metrics` for 1 incident; 2 incidents on same archetype → 2 `overlayApplications`; `endSecond` carried through; `CorrelatedServiceConfig` from downstream with components                |
| `metrics/series.test.ts`         | `generateOneSeries` with 0/1/2 `overlayApplications`; `endSecond` causes return to baseline at that t                                                                                                                                             |
| `metrics/metric-store.test.ts`   | `updateResolvedValue`; `clearScriptedOverlays` removes saturation entries; `_computeScriptedValue` skips overlay past `endSecond`; multi-incident compounds correctly                                                                             |
| `reaction-menu.test.ts`          | All 4 candidates always present; `no_effect` always has `overlays: []`; other three have non-empty `overlays`; capacity adequate → `full_recovery` targets `resolvedValue`; capacity inadequate → `full_recovery` still present with same targets |
| `metric-reaction-engine.test.ts` | `_applySelectedReaction` applies correct overlays; unknown id → no-op; LLM not called when all non-no_effect candidates have empty overlays                                                                                                       |
| `RemediationsPanel.test.tsx`     | `getComponentCapabilities` correct for each type combination; `ScaleConcurrencySection` shows for lambda; `ScaleCapacitySection` shows for dynamodb; billing mode toggle dispatches correctly                                                     |
