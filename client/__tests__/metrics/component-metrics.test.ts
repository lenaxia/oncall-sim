/**
 * Tests for metrics/component-metrics.ts:
 * COMPONENT_METRICS registry — ComponentMetricSpec for each ComponentType
 *
 * Written before implementation — all should fail until the module exists.
 */

import { describe, it, expect } from "vitest";
import { COMPONENT_METRICS } from "../../src/metrics/component-metrics";
import type {
  ServiceComponent,
  EcsClusterComponent,
  Ec2FleetComponent,
  DynamoDbComponent,
  LambdaComponent,
  RdsComponent,
  LoadBalancerComponent,
  ApiGatewayComponent,
  ElasticacheComponent,
  SqsQueueComponent,
  KinesisStreamComponent,
} from "../../src/scenario/types";
import type { OverlayType } from "../../src/metrics/types";

// ── TypeScript exhaustiveness ─────────────────────────────────────────────────

describe("COMPONENT_METRICS — exhaustiveness", () => {
  it("has an entry for every ComponentType", () => {
    const expectedTypes = [
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
    ];
    for (const t of expectedTypes) {
      expect(COMPONENT_METRICS).toHaveProperty(t);
    }
  });

  it("s3 and scheduler produce no metrics (empty arrays)", () => {
    expect(COMPONENT_METRICS["s3"]).toHaveLength(0);
    expect(COMPONENT_METRICS["scheduler"]).toHaveLength(0);
  });
});

// ── onset_overlay pass-through contract ───────────────────────────────────────
// All specs except the physically-constrained ones must pass the authored
// onset_overlay through unchanged. This is the core of the fix.

describe("COMPONENT_METRICS — onset_overlay pass-through", () => {
  const allOverlays: OverlayType[] = [
    "spike_and_sustain",
    "gradual_degradation",
    "saturation",
    "sudden_drop",
  ];

  // Specs that are physically constrained (must NOT pass through)
  const alwaysSaturation = [
    { type: "lambda", archetype: "concurrent_executions" },
    { type: "dynamodb", archetype: "write_capacity_used" },
    { type: "dynamodb", archetype: "read_capacity_used" },
    { type: "rds", archetype: "connection_pool_used" },
  ];
  const alwaysSpike = [{ type: "dynamodb", archetype: "write_throttles" }];
  // cert_expiry: sudden_drop → sudden_drop, else "none"

  it("constrained saturation specs always return saturation regardless of authored value", () => {
    for (const { type, archetype } of alwaysSaturation) {
      const spec = COMPONENT_METRICS[
        type as keyof typeof COMPONENT_METRICS
      ].find((s) => s.archetype === archetype)!;
      for (const o of allOverlays) {
        expect(spec.overlayForIncident(o)).toBe("saturation");
      }
    }
  });

  it("write_throttles always returns spike_and_sustain regardless of authored value", () => {
    for (const { type, archetype } of alwaysSpike) {
      const spec = COMPONENT_METRICS[
        type as keyof typeof COMPONENT_METRICS
      ].find((s) => s.archetype === archetype)!;
      for (const o of allOverlays) {
        expect(spec.overlayForIncident(o)).toBe("spike_and_sustain");
      }
    }
  });

  it("cert_expiry returns sudden_drop only for sudden_drop, none otherwise", () => {
    for (const type of ["load_balancer", "api_gateway"] as const) {
      const spec = COMPONENT_METRICS[type].find(
        (s) => s.archetype === "cert_expiry",
      )!;
      expect(spec.overlayForIncident("sudden_drop")).toBe("sudden_drop");
      expect(spec.overlayForIncident("spike_and_sustain")).toBe("none");
      expect(spec.overlayForIncident("gradual_degradation")).toBe("none");
      expect(spec.overlayForIncident("saturation")).toBe("none");
    }
  });

  // All other specs in all component types should pass through
  const passThrough = [
    {
      type: "load_balancer",
      archetypes: [
        "request_rate",
        "error_rate",
        "fault_rate",
        "p50_latency_ms",
        "p95_latency_ms",
        "p99_latency_ms",
      ],
    },
    {
      type: "api_gateway",
      archetypes: [
        "request_rate",
        "error_rate",
        "fault_rate",
        "p50_latency_ms",
        "p95_latency_ms",
        "p99_latency_ms",
      ],
    },
    {
      type: "ecs_cluster",
      archetypes: [
        "availability",
        "cpu_utilization",
        "memory_jvm",
        "error_rate",
        "fault_rate",
        "p50_latency_ms",
        "p95_latency_ms",
        "p99_latency_ms",
        "thread_count",
      ],
    },
    {
      type: "ec2_fleet",
      archetypes: [
        "availability",
        "cpu_utilization",
        "memory_system",
        "error_rate",
        "fault_rate",
        "p50_latency_ms",
        "p95_latency_ms",
        "p99_latency_ms",
        "disk_usage",
        "disk_iops",
        "network_in_bytes",
        "network_out_bytes",
      ],
    },
    {
      type: "lambda",
      archetypes: ["availability", "error_rate", "p99_latency_ms"],
    },
    { type: "kinesis_stream", archetypes: ["queue_depth", "throughput_bytes"] },
    { type: "sqs_queue", archetypes: ["queue_depth", "queue_age_ms"] },
    {
      type: "rds",
      archetypes: [
        "availability",
        "cpu_utilization",
        "p50_latency_ms",
        "p99_latency_ms",
      ],
    },
    { type: "elasticache", archetypes: ["cpu_utilization", "cache_hit_rate"] },
  ];

  for (const { type, archetypes } of passThrough) {
    it(`${type} — pass-through archetypes respect authored onset_overlay`, () => {
      const specs = COMPONENT_METRICS[type as keyof typeof COMPONENT_METRICS];
      for (const archetype of archetypes) {
        const spec = specs.find((s) => s.archetype === archetype);
        expect(spec, `spec for ${type}.${archetype} not found`).toBeDefined();
        for (const o of allOverlays) {
          expect(spec!.overlayForIncident(o)).toBe(o);
        }
      }
    });
  }
});

// ── load_balancer ─────────────────────────────────────────────────────────────

describe("COMPONENT_METRICS.load_balancer", () => {
  const alb: LoadBalancerComponent = {
    id: "alb",
    type: "load_balancer",
    label: "ALB",
    inputs: [],
  };
  const specs = COMPONENT_METRICS["load_balancer"];

  it("has request_rate, error_rate, fault_rate, p50, p95, p99, cert_expiry archetypes", () => {
    const archetypes = specs.map((s) => s.archetype);
    expect(archetypes).toContain("request_rate");
    expect(archetypes).toContain("error_rate");
    expect(archetypes).toContain("fault_rate");
    expect(archetypes).toContain("p50_latency_ms");
    expect(archetypes).toContain("p95_latency_ms");
    expect(archetypes).toContain("p99_latency_ms");
    expect(archetypes).toContain("cert_expiry");
    expect(archetypes).toHaveLength(7);
  });

  it("request_rate deriveBaseline returns typicalRps", () => {
    const spec = specs.find((s) => s.archetype === "request_rate")!;
    expect(spec.deriveBaseline(alb, 200)).toBe(200);
    expect(spec.deriveBaseline(alb, 0)).toBe(0);
  });

  it("request_rate resolvedValue returns typicalRps", () => {
    const spec = specs.find((s) => s.archetype === "request_rate")!;
    expect(spec.resolvedValue(alb, 150)).toBe(150);
  });

  it("error_rate deriveBaseline is constant (not rps-dependent)", () => {
    const spec = specs.find((s) => s.archetype === "error_rate")!;
    expect(spec.deriveBaseline(alb, 100)).toBe(spec.deriveBaseline(alb, 9999));
  });

  it("fault_rate baseline is lower than error_rate baseline", () => {
    const errorSpec = specs.find((s) => s.archetype === "error_rate")!;
    const faultSpec = specs.find((s) => s.archetype === "fault_rate")!;
    expect(faultSpec.deriveBaseline(alb, 100)).toBeLessThan(
      errorSpec.deriveBaseline(alb, 100),
    );
  });

  it("p50 baseline < p95 baseline < p99 baseline (latency distribution)", () => {
    const p50 = specs.find((s) => s.archetype === "p50_latency_ms")!;
    const p95 = specs.find((s) => s.archetype === "p95_latency_ms")!;
    const p99 = specs.find((s) => s.archetype === "p99_latency_ms")!;
    expect(p50.deriveBaseline(alb, 100)).toBeLessThan(
      p95.deriveBaseline(alb, 100),
    );
    expect(p95.deriveBaseline(alb, 100)).toBeLessThan(
      p99.deriveBaseline(alb, 100),
    );
  });

  it("all latency specs have ceiling: null (uncapped)", () => {
    for (const s of specs.filter((s) => s.archetype.includes("latency"))) {
      expect(s.ceiling(alb)).toBeNull();
    }
  });
});

// ── api_gateway ───────────────────────────────────────────────────────────────

describe("COMPONENT_METRICS.api_gateway", () => {
  const apigw: ApiGatewayComponent = {
    id: "apigw",
    type: "api_gateway",
    label: "APIGW",
    inputs: [],
  };
  const specs = COMPONENT_METRICS["api_gateway"];

  it("has request_rate, error_rate, fault_rate, p50, p95, p99, cert_expiry", () => {
    const archetypes = specs.map((s) => s.archetype);
    expect(archetypes).toContain("request_rate");
    expect(archetypes).toContain("error_rate");
    expect(archetypes).toContain("fault_rate");
    expect(archetypes).toContain("p50_latency_ms");
    expect(archetypes).toContain("p95_latency_ms");
    expect(archetypes).toContain("p99_latency_ms");
    expect(archetypes).toContain("cert_expiry");
    expect(archetypes).toHaveLength(7);
  });

  it("error_rate baseline is lower than load_balancer error_rate baseline (APIGW is gateway, fewer errors)", () => {
    const apigwErr = specs.find((s) => s.archetype === "error_rate")!;
    const lbErr = COMPONENT_METRICS["load_balancer"].find(
      (s) => s.archetype === "error_rate",
    )!;
    expect(apigwErr.deriveBaseline(apigw, 100)).toBeLessThan(
      lbErr.deriveBaseline(
        { id: "", type: "load_balancer", label: "", inputs: [] },
        100,
      ),
    );
  });

  it("request_rate baseline equals typicalRps", () => {
    const spec = specs.find((s) => s.archetype === "request_rate")!;
    expect(spec.deriveBaseline(apigw, 500)).toBe(500);
  });

  it("p50 < p95 < p99 latency ordering", () => {
    const p50 = specs.find((s) => s.archetype === "p50_latency_ms")!;
    const p95 = specs.find((s) => s.archetype === "p95_latency_ms")!;
    const p99 = specs.find((s) => s.archetype === "p99_latency_ms")!;
    expect(p50.deriveBaseline(apigw, 100)).toBeLessThan(
      p95.deriveBaseline(apigw, 100),
    );
    expect(p95.deriveBaseline(apigw, 100)).toBeLessThan(
      p99.deriveBaseline(apigw, 100),
    );
  });
});

// ── ecs_cluster ───────────────────────────────────────────────────────────────

describe("COMPONENT_METRICS.ecs_cluster", () => {
  const ecs: EcsClusterComponent = {
    id: "ecs",
    type: "ecs_cluster",
    label: "ECS",
    inputs: ["alb"],
    instanceCount: 4,
    utilization: 0.55,
  };
  const specs = COMPONENT_METRICS["ecs_cluster"];

  it("has cpu, memory_jvm, error_rate, fault_rate, p50, p95, p99, availability, thread_count", () => {
    const archetypes = specs.map((s) => s.archetype);
    expect(archetypes).toContain("availability");
    expect(archetypes).toContain("cpu_utilization");
    expect(archetypes).toContain("memory_jvm");
    expect(archetypes).toContain("error_rate");
    expect(archetypes).toContain("fault_rate");
    expect(archetypes).toContain("p50_latency_ms");
    expect(archetypes).toContain("p95_latency_ms");
    expect(archetypes).toContain("p99_latency_ms");
    expect(archetypes).toContain("thread_count");
    expect(archetypes).toHaveLength(9);
  });

  it("cpu baseline = utilization × 100", () => {
    const spec = specs.find((s) => s.archetype === "cpu_utilization")!;
    expect(spec.deriveBaseline(ecs, 100)).toBeCloseTo(55, 5);
  });

  it("cpu incidentPeakValue is clamped to 95", () => {
    const spec = specs.find((s) => s.archetype === "cpu_utilization")!;
    // magnitude=20 would produce 55 * 20 * 0.7 = 770 → clamped to 95
    expect(spec.incidentPeakValue(55, 20, ecs)).toBe(95);
  });

  it("cpu ceiling is 100", () => {
    const spec = specs.find((s) => s.archetype === "cpu_utilization")!;
    expect(spec.ceiling(ecs)).toBe(100);
  });

  it("memory_jvm baseline = instanceCount × 768", () => {
    const spec = specs.find((s) => s.archetype === "memory_jvm")!;
    expect(spec.deriveBaseline(ecs, 100)).toBe(4 * 768);
  });

  it("memory_jvm overlay is gradual_degradation (pass-through of gradual_degradation)", () => {
    const spec = specs.find((s) => s.archetype === "memory_jvm")!;
    expect(spec.overlayForIncident("gradual_degradation")).toBe(
      "gradual_degradation",
    );
  });

  it("availability baseline is 99.9", () => {
    const spec = specs.find((s) => s.archetype === "availability")!;
    expect(spec.deriveBaseline(ecs, 100)).toBe(99.9);
    expect(spec.resolvedValue(ecs, 100)).toBe(99.9);
  });

  it("availability ceiling is null (low-direction metric, not capacity-bounded)", () => {
    const spec = specs.find((s) => s.archetype === "availability")!;
    expect(spec.ceiling(ecs)).toBeNull();
  });

  it("thread_count baseline = instanceCount × 50", () => {
    const spec = specs.find((s) => s.archetype === "thread_count")!;
    expect(spec.deriveBaseline(ecs, 100)).toBe(4 * 50);
  });

  it("thread_count resolvedValue = instanceCount × 50", () => {
    const spec = specs.find((s) => s.archetype === "thread_count")!;
    expect(spec.resolvedValue(ecs, 100)).toBe(4 * 50);
  });
});

// ── ec2_fleet ─────────────────────────────────────────────────────────────────

describe("COMPONENT_METRICS.ec2_fleet", () => {
  const ec2: Ec2FleetComponent = {
    id: "ec2",
    type: "ec2_fleet",
    label: "EC2",
    inputs: [],
    instanceCount: 3,
    utilization: 0.45,
    diskUtilization: 0.6,
  };
  const ec2NoDisk: Ec2FleetComponent = {
    ...ec2,
    diskUtilization: undefined,
  };
  const specs = COMPONENT_METRICS["ec2_fleet"];

  it("has availability, cpu, memory_system, error_rate, fault_rate, p50, p95, p99, disk_usage, disk_iops, network_in, network_out", () => {
    const archetypes = specs.map((s) => s.archetype);
    expect(archetypes).toContain("availability");
    expect(archetypes).toContain("cpu_utilization");
    expect(archetypes).toContain("memory_system");
    expect(archetypes).toContain("error_rate");
    expect(archetypes).toContain("fault_rate");
    expect(archetypes).toContain("p50_latency_ms");
    expect(archetypes).toContain("p95_latency_ms");
    expect(archetypes).toContain("p99_latency_ms");
    expect(archetypes).toContain("disk_usage");
    expect(archetypes).toContain("disk_iops");
    expect(archetypes).toContain("network_in_bytes");
    expect(archetypes).toContain("network_out_bytes");
    expect(archetypes).toHaveLength(12);
  });

  it("cpu baseline = utilization × 100", () => {
    const spec = specs.find((s) => s.archetype === "cpu_utilization")!;
    expect(spec.deriveBaseline(ec2, 100)).toBeCloseTo(45, 5);
  });

  it("cpu ceiling is 100", () => {
    const spec = specs.find((s) => s.archetype === "cpu_utilization")!;
    expect(spec.ceiling(ec2)).toBe(100);
  });

  it("memory_system baseline = instanceCount × 1024", () => {
    const spec = specs.find((s) => s.archetype === "memory_system")!;
    expect(spec.deriveBaseline(ec2, 100)).toBe(3 * 1024);
  });

  it("availability baseline is 99.9", () => {
    const spec = specs.find((s) => s.archetype === "availability")!;
    expect(spec.deriveBaseline(ec2, 100)).toBe(99.9);
    expect(spec.ceiling(ec2)).toBeNull();
  });

  it("disk_usage baseline = diskUtilization × 100 when set", () => {
    const spec = specs.find((s) => s.archetype === "disk_usage")!;
    expect(spec.deriveBaseline(ec2, 100)).toBeCloseTo(60, 5);
  });

  it("disk_usage baseline defaults to 40 when diskUtilization is omitted", () => {
    const spec = specs.find((s) => s.archetype === "disk_usage")!;
    expect(spec.deriveBaseline(ec2NoDisk, 100)).toBeCloseTo(40, 5);
  });

  it("disk_usage ceiling is 100", () => {
    const spec = specs.find((s) => s.archetype === "disk_usage")!;
    expect(spec.ceiling(ec2)).toBe(100);
  });

  it("disk_usage incidentPeakValue is clamped to 99", () => {
    const spec = specs.find((s) => s.archetype === "disk_usage")!;
    // magnitude=5 would overflow → clamped to 99
    expect(spec.incidentPeakValue(60, 5, ec2)).toBe(99);
  });

  it("disk_iops baseline scales with typicalRps", () => {
    const spec = specs.find((s) => s.archetype === "disk_iops")!;
    expect(spec.deriveBaseline(ec2, 200)).toBe(100);
    expect(spec.deriveBaseline(ec2, 400)).toBe(200);
  });

  it("network_in_bytes baseline scales with typicalRps", () => {
    const spec = specs.find((s) => s.archetype === "network_in_bytes")!;
    expect(spec.deriveBaseline(ec2, 100)).toBe(150000);
  });

  it("network_out_bytes baseline scales with typicalRps and is larger than network_in", () => {
    const specIn = specs.find((s) => s.archetype === "network_in_bytes")!;
    const specOut = specs.find((s) => s.archetype === "network_out_bytes")!;
    expect(specOut.deriveBaseline(ec2, 100)).toBeGreaterThan(
      specIn.deriveBaseline(ec2, 100),
    );
  });
});

// ── elasticache ───────────────────────────────────────────────────────────────

describe("COMPONENT_METRICS.elasticache", () => {
  const cache: ElasticacheComponent = {
    id: "cache",
    type: "elasticache",
    label: "Cache",
    inputs: ["ecs"],
    instanceCount: 2,
    utilization: 0.3,
  };
  const specs = COMPONENT_METRICS["elasticache"];

  it("has cpu_utilization and cache_hit_rate", () => {
    const archetypes = specs.map((s) => s.archetype);
    expect(archetypes).toContain("cpu_utilization");
    expect(archetypes).toContain("cache_hit_rate");
    expect(archetypes).toHaveLength(2);
  });

  it("cpu baseline = utilization × 100", () => {
    const spec = specs.find((s) => s.archetype === "cpu_utilization")!;
    expect(spec.deriveBaseline(cache, 100)).toBeCloseTo(30, 5);
  });

  it("cache_hit_rate baseline is a high healthy value (> 70)", () => {
    const spec = specs.find((s) => s.archetype === "cache_hit_rate")!;
    expect(spec.deriveBaseline(cache, 100)).toBeGreaterThan(70);
  });

  it("cache_hit_rate resolvedValue equals baseline (recovers to healthy)", () => {
    const spec = specs.find((s) => s.archetype === "cache_hit_rate")!;
    expect(spec.resolvedValue(cache, 100)).toBe(
      spec.deriveBaseline(cache, 100),
    );
  });

  it("cache_hit_rate ceiling is null", () => {
    const spec = specs.find((s) => s.archetype === "cache_hit_rate")!;
    expect(spec.ceiling(cache)).toBeNull();
  });
});

// ── sqs_queue ─────────────────────────────────────────────────────────────────

describe("COMPONENT_METRICS.sqs_queue", () => {
  const sqs: SqsQueueComponent = {
    id: "sqs",
    type: "sqs_queue",
    label: "Queue",
    inputs: ["ecs"],
  };
  const specs = COMPONENT_METRICS["sqs_queue"];

  it("has queue_depth and queue_age_ms", () => {
    const archetypes = specs.map((s) => s.archetype);
    expect(archetypes).toContain("queue_depth");
    expect(archetypes).toContain("queue_age_ms");
    expect(archetypes).toHaveLength(2);
  });

  it("queue_depth baseline is 0 (healthy queue is empty)", () => {
    const spec = specs.find((s) => s.archetype === "queue_depth")!;
    expect(spec.deriveBaseline(sqs, 100)).toBe(0);
  });

  it("queue_age_ms baseline is a small positive value (healthy)", () => {
    const spec = specs.find((s) => s.archetype === "queue_age_ms")!;
    expect(spec.deriveBaseline(sqs, 100)).toBeGreaterThan(0);
    expect(spec.deriveBaseline(sqs, 100)).toBeLessThan(1000);
  });

  it("queue_depth resolvedValue is 0 (queue drains on recovery)", () => {
    const spec = specs.find((s) => s.archetype === "queue_depth")!;
    expect(spec.resolvedValue(sqs, 100)).toBe(0);
  });
});

// ── dynamodb ─────────────────────────────────────────────────────────────────

describe("COMPONENT_METRICS.dynamodb", () => {
  const ddb: DynamoDbComponent = {
    id: "ddb",
    type: "dynamodb",
    label: "DDB",
    inputs: ["fn"],
    writeCapacity: 100,
    readCapacity: 500,
    writeUtilization: 0.6,
    readUtilization: 0.2,
    billingMode: "provisioned",
  };
  const specs = COMPONENT_METRICS["dynamodb"];

  it("has write_capacity_used, write_throttles, read_capacity_used", () => {
    const archetypes = specs.map((s) => s.archetype);
    expect(archetypes).toContain("write_capacity_used");
    expect(archetypes).toContain("write_throttles");
    expect(archetypes).toContain("read_capacity_used");
    expect(archetypes).toHaveLength(3);
  });

  it("write_capacity_used baseline = writeCapacity × writeUtilization", () => {
    const spec = specs.find((s) => s.archetype === "write_capacity_used")!;
    expect(spec.deriveBaseline(ddb, 100)).toBe(60); // 100 × 0.6
  });

  it("write_capacity_used ceiling = writeCapacity", () => {
    const spec = specs.find((s) => s.archetype === "write_capacity_used")!;
    expect(spec.ceiling(ddb)).toBe(100);
  });

  it("write_capacity_used saturation: magnitude=1.0 fills to full capacity", () => {
    const spec = specs.find((s) => s.archetype === "write_capacity_used")!;
    // magnitude=1.0 → peakValue = min(100, 100 × 1.0) = 100
    expect(spec.incidentPeakValue(60, 1.0, ddb)).toBe(100);
  });

  it("write_capacity_used saturation: magnitude=0.5 fills to half capacity", () => {
    const spec = specs.find((s) => s.archetype === "write_capacity_used")!;
    expect(spec.incidentPeakValue(60, 0.5, ddb)).toBe(50);
  });

  it("write_throttles baseline = 0", () => {
    const spec = specs.find((s) => s.archetype === "write_throttles")!;
    expect(spec.deriveBaseline(ddb, 100)).toBe(0);
  });

  it("write_throttles overlay is spike_and_sustain for all input values", () => {
    const spec = specs.find((s) => s.archetype === "write_throttles")!;
    for (const o of [
      "spike_and_sustain",
      "gradual_degradation",
      "saturation",
      "sudden_drop",
    ] as OverlayType[]) {
      expect(spec.overlayForIncident(o)).toBe("spike_and_sustain");
    }
  });

  it("read_capacity_used saturation: magnitude=1.0 fills to full read capacity", () => {
    const spec = specs.find((s) => s.archetype === "read_capacity_used")!;
    expect(spec.incidentPeakValue(100, 1.0, ddb)).toBe(500);
  });
});

// ── lambda ────────────────────────────────────────────────────────────────────

describe("COMPONENT_METRICS.lambda", () => {
  const fn: LambdaComponent = {
    id: "fn",
    type: "lambda",
    label: "fn",
    inputs: ["stream"],
    reservedConcurrency: 200,
    lambdaUtilization: 0.35,
  };
  const specs = COMPONENT_METRICS["lambda"];

  it("has concurrent_executions, error_rate, p99_latency_ms, availability", () => {
    const archetypes = specs.map((s) => s.archetype);
    expect(archetypes).toContain("availability");
    expect(archetypes).toContain("concurrent_executions");
    expect(archetypes).toContain("error_rate");
    expect(archetypes).toContain("p99_latency_ms");
    expect(archetypes).toHaveLength(4);
  });

  it("concurrent_executions baseline = reservedConcurrency × lambdaUtilization", () => {
    const spec = specs.find((s) => s.archetype === "concurrent_executions")!;
    expect(spec.deriveBaseline(fn, 100)).toBe(200 * 0.35);
  });

  it("concurrent_executions ceiling = reservedConcurrency", () => {
    const spec = specs.find((s) => s.archetype === "concurrent_executions")!;
    expect(spec.ceiling(fn)).toBe(200);
  });

  it("concurrent_executions saturation: magnitude=1.0 fills to reservedConcurrency", () => {
    const spec = specs.find((s) => s.archetype === "concurrent_executions")!;
    expect(spec.incidentPeakValue(70, 1.0, fn)).toBe(200);
  });

  it("concurrent_executions saturation: magnitude=0.5 fills to half", () => {
    const spec = specs.find((s) => s.archetype === "concurrent_executions")!;
    expect(spec.incidentPeakValue(70, 0.5, fn)).toBe(100);
  });

  it("concurrent_executions always returns saturation regardless of authored overlay", () => {
    const spec = specs.find((s) => s.archetype === "concurrent_executions")!;
    for (const o of [
      "spike_and_sustain",
      "gradual_degradation",
      "sudden_drop",
      "saturation",
    ] as OverlayType[]) {
      expect(spec.overlayForIncident(o)).toBe("saturation");
    }
  });

  it("availability baseline is 99.9", () => {
    const spec = specs.find((s) => s.archetype === "availability")!;
    expect(spec.deriveBaseline(fn, 100)).toBe(99.9);
    expect(spec.ceiling(fn)).toBeNull();
  });
});

// ── rds ───────────────────────────────────────────────────────────────────────

describe("COMPONENT_METRICS.rds", () => {
  const rds: RdsComponent = {
    id: "db",
    type: "rds",
    label: "DB",
    inputs: [],
    instanceCount: 1,
    maxConnections: 500,
    utilization: 0.4,
    connectionUtilization: 0.6,
  };
  const specs = COMPONENT_METRICS["rds"];

  it("has connection_pool_used, cpu_utilization, p50_latency_ms, p99_latency_ms, availability", () => {
    const archetypes = specs.map((s) => s.archetype);
    expect(archetypes).toContain("availability");
    expect(archetypes).toContain("connection_pool_used");
    expect(archetypes).toContain("cpu_utilization");
    expect(archetypes).toContain("p50_latency_ms");
    expect(archetypes).toContain("p99_latency_ms");
    expect(archetypes).toHaveLength(5);
  });

  it("connection_pool_used baseline = maxConnections × connectionUtilization", () => {
    const spec = specs.find((s) => s.archetype === "connection_pool_used")!;
    expect(spec.deriveBaseline(rds, 100)).toBe(500 * 0.6); // 300
  });

  it("connection_pool_used ceiling = maxConnections", () => {
    const spec = specs.find((s) => s.archetype === "connection_pool_used")!;
    expect(spec.ceiling(rds)).toBe(500);
  });

  it("connection_pool_used saturation: magnitude=1.0 fills to maxConnections", () => {
    const spec = specs.find((s) => s.archetype === "connection_pool_used")!;
    expect(spec.incidentPeakValue(300, 1.0, rds)).toBe(500);
  });

  it("connection_pool_used always returns saturation regardless of authored overlay", () => {
    const spec = specs.find((s) => s.archetype === "connection_pool_used")!;
    for (const o of [
      "spike_and_sustain",
      "gradual_degradation",
      "sudden_drop",
      "saturation",
    ] as OverlayType[]) {
      expect(spec.overlayForIncident(o)).toBe("saturation");
    }
  });

  it("availability baseline is 99.9", () => {
    const spec = specs.find((s) => s.archetype === "availability")!;
    expect(spec.deriveBaseline(rds, 100)).toBe(99.9);
    expect(spec.ceiling(rds)).toBeNull();
  });

  it("p50 baseline < p99 baseline", () => {
    const p50 = specs.find((s) => s.archetype === "p50_latency_ms")!;
    const p99 = specs.find((s) => s.archetype === "p99_latency_ms")!;
    expect(p50.deriveBaseline(rds, 100)).toBeLessThan(
      p99.deriveBaseline(rds, 100),
    );
  });
});

// ── kinesis_stream ────────────────────────────────────────────────────────────

describe("COMPONENT_METRICS.kinesis_stream", () => {
  const ks: KinesisStreamComponent = {
    id: "stream",
    type: "kinesis_stream",
    label: "stream",
    inputs: ["ecs"],
    shardCount: 4,
  };
  const specs = COMPONENT_METRICS["kinesis_stream"];

  it("has queue_depth and throughput_bytes", () => {
    const archetypes = specs.map((s) => s.archetype);
    expect(archetypes).toContain("queue_depth");
    expect(archetypes).toContain("throughput_bytes");
    expect(archetypes).toHaveLength(2);
  });

  it("throughput_bytes baseline scales with typicalRps", () => {
    const spec = specs.find((s) => s.archetype === "throughput_bytes")!;
    expect(spec.deriveBaseline(ks, 200)).toBeGreaterThan(
      spec.deriveBaseline(ks, 100),
    );
  });

  it("queue_depth baseline is 0 (healthy queue is empty)", () => {
    const spec = specs.find((s) => s.archetype === "queue_depth")!;
    expect(spec.deriveBaseline(ks, 100)).toBe(0);
  });
});

// ── lagSeconds ordering ───────────────────────────────────────────────────────

describe("COMPONENT_METRICS — lagSeconds is non-negative for all specs", () => {
  it("all specs have lagSeconds >= 0", () => {
    for (const [type, specs] of Object.entries(COMPONENT_METRICS)) {
      for (const spec of specs) {
        expect(spec.lagSeconds).toBeGreaterThanOrEqual(0);
        // Type annotation check — lagSeconds must be a number
        expect(typeof spec.lagSeconds).toBe("number");
      }
    }
  });
});

// ── no NaN baselines ──────────────────────────────────────────────────────────
// Validates that all required fields being present produces finite, non-NaN
// baselines. If any formula accesses an undefined field this will catch it.

describe("COMPONENT_METRICS — no NaN baselines with valid inputs", () => {
  const fixtures: Record<string, ServiceComponent> = {
    load_balancer: { id: "x", type: "load_balancer", label: "x", inputs: [] },
    api_gateway: { id: "x", type: "api_gateway", label: "x", inputs: [] },
    ecs_cluster: {
      id: "x",
      type: "ecs_cluster",
      label: "x",
      inputs: [],
      instanceCount: 4,
      utilization: 0.4,
    } as EcsClusterComponent,
    ec2_fleet: {
      id: "x",
      type: "ec2_fleet",
      label: "x",
      inputs: [],
      instanceCount: 3,
      utilization: 0.4,
      diskUtilization: 0.5,
    } as Ec2FleetComponent,
    lambda: {
      id: "x",
      type: "lambda",
      label: "x",
      inputs: [],
      reservedConcurrency: 100,
      lambdaUtilization: 0.4,
    } as LambdaComponent,
    kinesis_stream: {
      id: "x",
      type: "kinesis_stream",
      label: "x",
      inputs: [],
      shardCount: 4,
    } as KinesisStreamComponent,
    sqs_queue: {
      id: "x",
      type: "sqs_queue",
      label: "x",
      inputs: [],
    } as SqsQueueComponent,
    dynamodb: {
      id: "x",
      type: "dynamodb",
      label: "x",
      inputs: [],
      writeCapacity: 100,
      readCapacity: 500,
      writeUtilization: 0.3,
      readUtilization: 0.2,
      billingMode: "provisioned",
    } as DynamoDbComponent,
    rds: {
      id: "x",
      type: "rds",
      label: "x",
      inputs: [],
      instanceCount: 1,
      maxConnections: 500,
      utilization: 0.4,
      connectionUtilization: 0.35,
    } as RdsComponent,
    elasticache: {
      id: "x",
      type: "elasticache",
      label: "x",
      inputs: [],
      instanceCount: 2,
      utilization: 0.3,
    } as ElasticacheComponent,
    s3: { id: "x", type: "s3", label: "x", inputs: [] },
    scheduler: { id: "x", type: "scheduler", label: "x", inputs: [] },
  };

  it("deriveBaseline returns finite non-NaN for all component types with valid inputs", () => {
    for (const [type, component] of Object.entries(fixtures)) {
      const specs = COMPONENT_METRICS[type as keyof typeof COMPONENT_METRICS];
      for (const spec of specs) {
        const baseline = spec.deriveBaseline(component as never, 100);
        expect(
          Number.isFinite(baseline),
          `${type}.${spec.archetype} deriveBaseline returned ${baseline}`,
        ).toBe(true);
      }
    }
  });

  it("disk_usage deriveBaseline defaults to 40 when diskUtilization is undefined", () => {
    const ec2NoDisk: Ec2FleetComponent = {
      id: "x",
      type: "ec2_fleet",
      label: "x",
      inputs: [],
      instanceCount: 3,
      utilization: 0.4,
      // diskUtilization intentionally omitted
    };
    const spec = COMPONENT_METRICS["ec2_fleet"].find(
      (s) => s.archetype === "disk_usage",
    )!;
    const baseline = spec.deriveBaseline(ec2NoDisk, 100);
    expect(baseline).toBe(40);
    expect(Number.isFinite(baseline)).toBe(true);
  });
});
