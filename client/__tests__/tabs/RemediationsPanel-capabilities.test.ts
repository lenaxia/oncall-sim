/**
 * Tests for Step 6: getComponentCapabilities() and ScaleConcurrencySection,
 * ScaleCapacitySection in RemediationsPanel.
 *
 * Written before implementation — all should fail until code is added.
 */

import { describe, it, expect } from "vitest";
import { getComponentCapabilities } from "../../src/components/tabs/RemediationsPanel";
import type { ServiceComponent } from "../../src/scenario/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function lb(id = "alb"): ServiceComponent {
  return { id, type: "load_balancer", label: "ALB", inputs: [] };
}
function ecs(id = "ecs"): ServiceComponent {
  return {
    id,
    type: "ecs_cluster",
    label: "ECS",
    inputs: ["alb"],
    instanceCount: 4,
    utilization: 0.55,
  };
}
function ddb(id = "ddb"): ServiceComponent {
  return {
    id,
    type: "dynamodb",
    label: "DDB",
    inputs: ["ecs"],
    writeCapacity: 100,
    readCapacity: 500,
    writeUtilization: 0.6,
    readUtilization: 0.2,
    billingMode: "provisioned",
  };
}
function ddbOnDemand(id = "ddb"): ServiceComponent {
  return {
    id,
    type: "dynamodb",
    label: "DDB",
    inputs: ["ecs"],
    writeCapacity: 100,
    readCapacity: 500,
    writeUtilization: 0.6,
    readUtilization: 0.2,
    billingMode: "on_demand",
  };
}
function kinesis(id = "stream"): ServiceComponent {
  return {
    id,
    type: "kinesis_stream",
    label: "Stream",
    inputs: ["ecs"],
    shardCount: 4,
  };
}
function lambdaFn(id = "fn"): ServiceComponent {
  return {
    id,
    type: "lambda",
    label: "Fn",
    inputs: ["stream"],
    reservedConcurrency: 200,
    lambdaUtilization: 0.35,
  };
}
function rds(id = "db"): ServiceComponent {
  return {
    id,
    type: "rds",
    label: "DB",
    inputs: ["ecs"],
    instanceCount: 1,
    maxConnections: 500,
    utilization: 0.4,
    connectionUtilization: 0.6,
  };
}
function cache(id = "cache"): ServiceComponent {
  return {
    id,
    type: "elasticache",
    label: "Cache",
    inputs: ["ecs"],
    instanceCount: 1,
    utilization: 0.3,
  };
}
function gateway(id = "apigw"): ServiceComponent {
  return { id, type: "api_gateway", label: "API GW", inputs: [] };
}

// ── getComponentCapabilities ───────────────────────────────────────────────────

describe("getComponentCapabilities", () => {
  it("empty components → all false", () => {
    const caps = getComponentCapabilities([]);
    expect(caps.canRestart).toBe(false);
    expect(caps.canScaleHosts).toBe(false);
    expect(caps.canScaleConcurrency).toBe(false);
    expect(caps.canScaleCapacity).toBe(false);
    expect(caps.canSwitchBillingMode).toBe(false);
    expect(caps.canThrottle).toBe(false);
  });

  it("load_balancer only → canThrottle=true, rest false", () => {
    const caps = getComponentCapabilities([lb()]);
    expect(caps.canThrottle).toBe(true);
    expect(caps.canRestart).toBe(false);
    expect(caps.canScaleHosts).toBe(false);
    expect(caps.canScaleConcurrency).toBe(false);
    expect(caps.canScaleCapacity).toBe(false);
  });

  it("api_gateway → canThrottle=true", () => {
    const caps = getComponentCapabilities([gateway()]);
    expect(caps.canThrottle).toBe(true);
  });

  it("ecs_cluster → canRestart=true, canScaleHosts=true", () => {
    const caps = getComponentCapabilities([lb(), ecs()]);
    expect(caps.canRestart).toBe(true);
    expect(caps.canScaleHosts).toBe(true);
  });

  it("ec2_fleet → canRestart=true, canScaleHosts=true", () => {
    const ec2: ServiceComponent = {
      id: "ec2",
      type: "ec2_fleet",
      label: "EC2",
      inputs: ["alb"],
      instanceCount: 3,
      utilization: 0.4,
    };
    const caps = getComponentCapabilities([lb(), ec2]);
    expect(caps.canRestart).toBe(true);
    expect(caps.canScaleHosts).toBe(true);
  });

  it("lambda → canScaleConcurrency=true", () => {
    const caps = getComponentCapabilities([lb(), ecs(), lambdaFn()]);
    expect(caps.canScaleConcurrency).toBe(true);
  });

  it("dynamodb → canScaleCapacity=true", () => {
    const caps = getComponentCapabilities([lb(), ecs(), ddb()]);
    expect(caps.canScaleCapacity).toBe(true);
  });

  it("kinesis_stream → canScaleCapacity=true", () => {
    const caps = getComponentCapabilities([lb(), ecs(), kinesis()]);
    expect(caps.canScaleCapacity).toBe(true);
  });

  it("dynamodb provisioned → canSwitchBillingMode=true", () => {
    const caps = getComponentCapabilities([lb(), ecs(), ddb()]);
    expect(caps.canSwitchBillingMode).toBe(true);
  });

  it("dynamodb on_demand → canSwitchBillingMode=false", () => {
    const caps = getComponentCapabilities([lb(), ecs(), ddbOnDemand()]);
    expect(caps.canSwitchBillingMode).toBe(false);
  });

  it("rds → canRestart=true", () => {
    const caps = getComponentCapabilities([lb(), ecs(), rds()]);
    expect(caps.canRestart).toBe(true);
  });

  it("elasticache → canRestart=true", () => {
    const caps = getComponentCapabilities([lb(), ecs(), cache()]);
    expect(caps.canRestart).toBe(true);
  });

  it("full stack → all capabilities present", () => {
    const caps = getComponentCapabilities([lb(), ecs(), lambdaFn(), ddb()]);
    expect(caps.canRestart).toBe(true);
    expect(caps.canScaleHosts).toBe(true);
    expect(caps.canScaleConcurrency).toBe(true);
    expect(caps.canScaleCapacity).toBe(true);
    expect(caps.canSwitchBillingMode).toBe(true);
    expect(caps.canThrottle).toBe(true);
  });
});
