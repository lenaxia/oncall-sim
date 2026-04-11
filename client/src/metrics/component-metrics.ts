// Component-to-metric registry.
// Each entry defines how to derive metric baselines, incident peaks, and
// overlay parameters from the component's capacity fields.
//
// The generic parameter T narrows to the specific component subtype,
// ensuring only the correct capacity fields are accessed.

import type {
  ComponentType,
  ServiceComponent,
  LoadBalancerComponent,
  ApiGatewayComponent,
  EcsClusterComponent,
  Ec2FleetComponent,
  LambdaComponent,
  KinesisStreamComponent,
  SqsQueueComponent,
  DynamoDbComponent,
  RdsComponent,
  ElasticacheComponent,
  S3Component,
  SchedulerComponent,
} from "../scenario/types";
import type { OverlayType } from "./types";

export interface ComponentMetricSpec<
  T extends ServiceComponent = ServiceComponent,
> {
  archetype: string;

  /** Derives baseline metric value from component capacity + traffic volume. */
  deriveBaseline(component: T, typicalRps: number): number;

  /** Derives peak value during an incident. Semantics depend on overlay type:
   *  - spike_and_sustain/gradual_degradation: peak = magnitude × baseline
   *  - saturation: peak = capacity × magnitude (not baseline-based)
   *  - sudden_drop: peak = baseline × magnitude (target value after drop)
   */
  incidentPeakValue(baseline: number, magnitude: number, component: T): number;

  /** Propagation lag in seconds before this component's metrics reflect the incident. */
  lagSeconds: number;

  /** Maps the authored onset_overlay to the overlay type used for this archetype. */
  overlayForIncident(incidentOverlay: OverlayType): OverlayType;

  /** Hard ceiling for saturation overlays. null = no ceiling (archetype maxValue used). */
  ceiling(component: T): number | null;

  /** Metric value after a full recovery. */
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
      deriveBaseline: (_c, rps) => rps,
      incidentPeakValue: (b, m) => b * m,
      lagSeconds: 0,
      overlayForIncident: (o) => o,
      ceiling: () => null,
      resolvedValue: (_c, rps) => rps,
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
      archetype: "fault_rate",
      deriveBaseline: () => 0.1,
      incidentPeakValue: (b, m) => b * m * 10,
      lagSeconds: 30,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 0.1,
    },
    {
      archetype: "p50_latency_ms",
      deriveBaseline: () => 15,
      incidentPeakValue: (b, m) => b * m * 3,
      lagSeconds: 15,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 15,
    },
    {
      archetype: "p95_latency_ms",
      deriveBaseline: () => 35,
      incidentPeakValue: (b, m) => b * m * 3,
      lagSeconds: 15,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 35,
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
    {
      // cert_expiry: countdown from baseline (days remaining) to 0 at expiry.
      // Incident uses sudden_drop with magnitude near 0 to model the cert expiring.
      archetype: "cert_expiry",
      deriveBaseline: () => 90, // 90 days remaining at scenario start
      incidentPeakValue: (b, m) => b * m,
      lagSeconds: 0,
      overlayForIncident: () => "sudden_drop",
      ceiling: () => null,
      resolvedValue: () => 90,
    },
  ] satisfies ComponentMetricSpec<LoadBalancerComponent>[],

  ecs_cluster: [
    {
      archetype: "cpu_utilization",
      deriveBaseline: (c) => c.utilization * 100,
      incidentPeakValue: (b, m, _c) => Math.min(95, b * m * 0.7),
      lagSeconds: 0,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => 100,
      resolvedValue: (c) => c.utilization * 100,
    },
    {
      archetype: "memory_jvm",
      deriveBaseline: (c) => c.instanceCount * 768,
      incidentPeakValue: (b, m) => b * m,
      lagSeconds: 30,
      overlayForIncident: () => "gradual_degradation",
      ceiling: () => null,
      resolvedValue: (c) => c.instanceCount * 768,
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
      archetype: "fault_rate",
      deriveBaseline: () => 0.1,
      incidentPeakValue: (b, m) => b * m * 10,
      lagSeconds: 30,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 0.1,
    },
    {
      archetype: "p50_latency_ms",
      deriveBaseline: () => 25,
      incidentPeakValue: (b, m) => b * m * 3,
      lagSeconds: 15,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 25,
    },
    {
      archetype: "p95_latency_ms",
      deriveBaseline: () => 55,
      incidentPeakValue: (b, m) => b * m * 3,
      lagSeconds: 15,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 55,
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
  ] satisfies ComponentMetricSpec<EcsClusterComponent>[],

  lambda: [
    {
      archetype: "concurrent_executions",
      deriveBaseline: (c) => c.reservedConcurrency * c.lambdaUtilization,
      incidentPeakValue: (_b, m, c) =>
        Math.min(c.reservedConcurrency, c.reservedConcurrency * m),
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
  ] satisfies ComponentMetricSpec<LambdaComponent>[],

  dynamodb: [
    {
      archetype: "write_capacity_used",
      deriveBaseline: (c) => c.writeCapacity * c.writeUtilization,
      incidentPeakValue: (_b, m, c) =>
        Math.min(c.writeCapacity, c.writeCapacity * m),
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
      incidentPeakValue: (_b, m, c) =>
        Math.min(c.readCapacity, c.readCapacity * m),
      lagSeconds: 60,
      overlayForIncident: () => "saturation",
      ceiling: (c) => c.readCapacity,
      resolvedValue: (c) => c.readCapacity * c.readUtilization,
    },
  ] satisfies ComponentMetricSpec<DynamoDbComponent>[],

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
      deriveBaseline: (_c, rps) => rps * 1500,
      incidentPeakValue: (b, m) => b * m,
      lagSeconds: 30,
      overlayForIncident: (o) => o,
      ceiling: () => null,
      resolvedValue: (_c, rps) => rps * 1500,
    },
  ] satisfies ComponentMetricSpec<KinesisStreamComponent>[],

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
  ] satisfies ComponentMetricSpec<SqsQueueComponent>[],

  rds: [
    {
      archetype: "connection_pool_used",
      deriveBaseline: (c) => c.maxConnections * c.connectionUtilization,
      incidentPeakValue: (_b, m, c) =>
        Math.min(c.maxConnections, c.maxConnections * m),
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
      archetype: "p50_latency_ms",
      deriveBaseline: () => 2,
      incidentPeakValue: (b, m) => b * m * 8,
      lagSeconds: 15,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 2,
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
  ] satisfies ComponentMetricSpec<RdsComponent>[],

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
    {
      // cache_hit_rate: percentage of requests served from cache.
      // Healthy baseline is high (82%). A stampede or cold cache causes
      // a sudden_drop to near 0; recovers as TTLs fill back in.
      archetype: "cache_hit_rate",
      deriveBaseline: () => 82,
      incidentPeakValue: (b, m) => b * m,
      lagSeconds: 0,
      overlayForIncident: () => "sudden_drop",
      ceiling: () => null,
      resolvedValue: () => 82,
    },
  ] satisfies ComponentMetricSpec<ElasticacheComponent>[],

  api_gateway: [
    {
      archetype: "request_rate",
      deriveBaseline: (_c, rps) => rps,
      incidentPeakValue: (b, m) => b * m,
      lagSeconds: 0,
      overlayForIncident: (o) => o,
      ceiling: () => null,
      resolvedValue: (_c, rps) => rps,
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
    {
      archetype: "fault_rate",
      deriveBaseline: () => 0.05,
      incidentPeakValue: (b, m) => b * m * 10,
      lagSeconds: 15,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 0.05,
    },
    {
      archetype: "p50_latency_ms",
      deriveBaseline: () => 50,
      incidentPeakValue: (b, m) => b * m * 3,
      lagSeconds: 15,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 50,
    },
    {
      archetype: "p95_latency_ms",
      deriveBaseline: () => 120,
      incidentPeakValue: (b, m) => b * m * 3,
      lagSeconds: 15,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 120,
    },
    {
      archetype: "p99_latency_ms",
      deriveBaseline: () => 200,
      incidentPeakValue: (b, m) => b * m * 4,
      lagSeconds: 15,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 200,
    },
    {
      archetype: "cert_expiry",
      deriveBaseline: () => 90,
      incidentPeakValue: (b, m) => b * m,
      lagSeconds: 0,
      overlayForIncident: () => "sudden_drop",
      ceiling: () => null,
      resolvedValue: () => 90,
    },
  ] satisfies ComponentMetricSpec<ApiGatewayComponent>[],

  ec2_fleet: [
    {
      archetype: "cpu_utilization",
      deriveBaseline: (c) => c.utilization * 100,
      incidentPeakValue: (b, m, _c) => Math.min(95, b * m * 0.7),
      lagSeconds: 0,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => 100,
      resolvedValue: (c) => c.utilization * 100,
    },
    {
      archetype: "memory_system",
      deriveBaseline: (c) => c.instanceCount * 1024,
      incidentPeakValue: (b, m) => b * m,
      lagSeconds: 30,
      overlayForIncident: () => "gradual_degradation",
      ceiling: () => null,
      resolvedValue: (c) => c.instanceCount * 1024,
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
      archetype: "fault_rate",
      deriveBaseline: () => 0.1,
      incidentPeakValue: (b, m) => b * m * 10,
      lagSeconds: 30,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 0.1,
    },
    {
      archetype: "p50_latency_ms",
      deriveBaseline: () => 25,
      incidentPeakValue: (b, m) => b * m * 3,
      lagSeconds: 15,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 25,
    },
    {
      archetype: "p95_latency_ms",
      deriveBaseline: () => 55,
      incidentPeakValue: (b, m) => b * m * 3,
      lagSeconds: 15,
      overlayForIncident: () => "spike_and_sustain",
      ceiling: () => null,
      resolvedValue: () => 55,
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
  ] satisfies ComponentMetricSpec<Ec2FleetComponent>[],

  s3: [] satisfies ComponentMetricSpec<S3Component>[],
  scheduler: [] satisfies ComponentMetricSpec<SchedulerComponent>[],
};
