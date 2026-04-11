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
  DynamoDbComponent,
  LambdaComponent,
  RdsComponent,
  LoadBalancerComponent,
  KinesisStreamComponent,
} from "../../src/scenario/types";

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

  it("has cpu, memory_jvm, error_rate, fault_rate, p50, p95, p99", () => {
    const archetypes = specs.map((s) => s.archetype);
    expect(archetypes).toContain("cpu_utilization");
    expect(archetypes).toContain("memory_jvm");
    expect(archetypes).toContain("error_rate");
    expect(archetypes).toContain("fault_rate");
    expect(archetypes).toContain("p50_latency_ms");
    expect(archetypes).toContain("p95_latency_ms");
    expect(archetypes).toContain("p99_latency_ms");
    expect(archetypes).toHaveLength(7);
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

  it("memory_jvm overlay is gradual_degradation", () => {
    const spec = specs.find((s) => s.archetype === "memory_jvm")!;
    expect(spec.overlayForIncident("gradual_degradation")).toBe(
      "gradual_degradation",
    );
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

  it("write_throttles overlay is spike_and_sustain", () => {
    const spec = specs.find((s) => s.archetype === "write_throttles")!;
    expect(spec.overlayForIncident("spike_and_sustain")).toBe(
      "spike_and_sustain",
    );
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

  it("has concurrent_executions, error_rate, p99_latency_ms", () => {
    const archetypes = specs.map((s) => s.archetype);
    expect(archetypes).toContain("concurrent_executions");
    expect(archetypes).toContain("error_rate");
    expect(archetypes).toContain("p99_latency_ms");
    expect(archetypes).toHaveLength(3);
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

  it("has connection_pool_used, cpu_utilization, p50_latency_ms, p99_latency_ms", () => {
    const archetypes = specs.map((s) => s.archetype);
    expect(archetypes).toContain("connection_pool_used");
    expect(archetypes).toContain("cpu_utilization");
    expect(archetypes).toContain("p50_latency_ms");
    expect(archetypes).toContain("p99_latency_ms");
    expect(archetypes).toHaveLength(4);
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
