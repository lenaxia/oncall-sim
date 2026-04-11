/**
 * Tests for component-topology.ts:
 * findEntrypoint, propagationPath, propagationLag
 *
 * Written before implementation — all should fail until the module exists.
 */

import { describe, it, expect } from "vitest";
import {
  findEntrypoint,
  propagationPath,
  propagationLag,
} from "../../src/scenario/component-topology";
import type { ServiceComponent } from "../../src/scenario/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function lb(id: string, inputs: string[] = []): ServiceComponent {
  return { id, type: "load_balancer", label: id, inputs };
}

function ecs(id: string, inputs: string[]): ServiceComponent {
  return {
    id,
    type: "ecs_cluster",
    label: id,
    inputs,
    instanceCount: 2,
    utilization: 0.5,
  };
}

function ddb(id: string, inputs: string[]): ServiceComponent {
  return {
    id,
    type: "dynamodb",
    label: id,
    inputs,
    writeCapacity: 100,
    readCapacity: 500,
    writeUtilization: 0.6,
    readUtilization: 0.2,
    billingMode: "provisioned",
  };
}

function lambda(id: string, inputs: string[]): ServiceComponent {
  return {
    id,
    type: "lambda",
    label: id,
    inputs,
    reservedConcurrency: 200,
    lambdaUtilization: 0.35,
  };
}

function kinesis(id: string, inputs: string[]): ServiceComponent {
  return { id, type: "kinesis_stream", label: id, inputs, shardCount: 4 };
}

function s3(id: string, inputs: string[]): ServiceComponent {
  return { id, type: "s3", label: id, inputs };
}

function sched(id: string): ServiceComponent {
  return { id, type: "scheduler", label: id, inputs: [] };
}

// ── findEntrypoint ────────────────────────────────────────────────────────────

describe("findEntrypoint", () => {
  it("returns the single component with inputs: []", () => {
    const components = [lb("alb"), ecs("ecs", ["alb"])];
    const ep = findEntrypoint(components);
    expect(ep.id).toBe("alb");
  });

  it("throws when no component has inputs: []", () => {
    const components = [ecs("a", ["b"]), ecs("b", ["a"])];
    expect(() => findEntrypoint(components)).toThrow();
  });

  it("throws when multiple components have inputs: []", () => {
    const components = [lb("alb1"), lb("alb2"), ecs("ecs", ["alb1"])];
    expect(() => findEntrypoint(components)).toThrow();
  });

  it("works with a single component (it is its own entrypoint)", () => {
    const components = [lb("alb")];
    expect(findEntrypoint(components).id).toBe("alb");
  });
});

// ── propagationPath ───────────────────────────────────────────────────────────

describe("propagationPath", () => {
  it("returns ids in topological order from entrypoint", () => {
    const components = [
      lb("alb"),
      ecs("ecs", ["alb"]),
      kinesis("stream", ["ecs"]),
      lambda("fn", ["stream"]),
      ddb("ddb", ["fn"]),
    ];
    const path = propagationPath("alb", components);
    expect(path).toEqual(["alb", "ecs", "stream", "fn", "ddb"]);
  });

  it("starts from a mid-chain component — only returns downstream", () => {
    const components = [lb("alb"), ecs("ecs", ["alb"]), ddb("ddb", ["ecs"])];
    const path = propagationPath("ecs", components);
    expect(path).toEqual(["ecs", "ddb"]);
  });

  it("returns just the startId when it has no downstream", () => {
    const components = [lb("alb"), ecs("ecs", ["alb"])];
    const path = propagationPath("ecs", components);
    expect(path).toEqual(["ecs"]);
  });

  it("returns just [startId] when component list has only one node", () => {
    const components = [lb("alb")];
    expect(propagationPath("alb", components)).toEqual(["alb"]);
  });

  it("returns empty when startId does not exist in components", () => {
    const components = [lb("alb"), ecs("ecs", ["alb"])];
    expect(propagationPath("nonexistent", components)).toEqual([]);
  });

  it("handles a diamond topology without duplicates", () => {
    // alb → ecs-a, alb → ecs-b, ecs-a → ddb, ecs-b → ddb
    const components = [
      lb("alb"),
      ecs("ecs-a", ["alb"]),
      ecs("ecs-b", ["alb"]),
      ddb("ddb", ["ecs-a", "ecs-b"]),
    ];
    const path = propagationPath("alb", components);
    // ddb must appear exactly once
    expect(path.filter((id) => id === "ddb")).toHaveLength(1);
    // alb must be first
    expect(path[0]).toBe("alb");
    // ddb must appear after both ecs-a and ecs-b
    const ddbIdx = path.indexOf("ddb");
    expect(ddbIdx).toBeGreaterThan(path.indexOf("ecs-a"));
    expect(ddbIdx).toBeGreaterThan(path.indexOf("ecs-b"));
  });
});

// ── propagationLag ────────────────────────────────────────────────────────────

describe("propagationLag", () => {
  it("returns 0 when startId === targetId", () => {
    const components = [lb("alb"), ecs("ecs", ["alb"])];
    expect(propagationLag("alb", "alb", components)).toBe(0);
  });

  it("returns 0 when targetId is not downstream of startId (upstream component)", () => {
    const components = [lb("alb"), ecs("ecs", ["alb"])];
    // alb is upstream of ecs, not downstream
    expect(propagationLag("ecs", "alb", components)).toBe(0);
  });

  it("returns 0 when targetId does not exist", () => {
    const components = [lb("alb"), ecs("ecs", ["alb"])];
    expect(propagationLag("alb", "nonexistent", components)).toBe(0);
  });

  it("accumulates lag from start to target along the path (skipping startId's own lag)", () => {
    // path: alb → ecs → stream → fn → ddb
    // propagationLag("alb", "ddb") = ecs_lag + stream_lag + fn_lag + ddb_lag
    // (alb itself is skipped — it's the origin)
    // ecs: max lag = 30 (memory_jvm, error_rate, fault_rate all have 30)
    // stream: max lag = 30
    // fn (lambda): max lag = 60 (error_rate)
    // ddb: max lag = 65 (write_throttles)
    // total = 30 + 30 + 60 + 65 = 185
    const components = [
      lb("alb"),
      ecs("ecs", ["alb"]),
      kinesis("stream", ["ecs"]),
      lambda("fn", ["stream"]),
      ddb("ddb", ["fn"]),
    ];
    const lag = propagationLag("alb", "ddb", components);
    expect(lag).toBe(185);
  });

  it("components with no specs (s3, scheduler) contribute 0 lag", () => {
    const components = [sched("sched"), s3("bucket", ["sched"])];
    expect(propagationLag("sched", "bucket", components)).toBe(0);
  });

  it("returns 0 for start to immediate next component if that component has 0 lag", () => {
    // scheduler has no specs → contributes 0 lag
    const components = [sched("sched"), s3("bucket", ["sched"])];
    const lag = propagationLag("sched", "bucket", components);
    // s3 also has no specs → 0 total
    expect(lag).toBe(0);
  });

  it("single hop: returns target component's own max lag", () => {
    // ecs max lag = 30 (memory_jvm, error_rate, fault_rate all 30)
    // alb is skipped (origin), only ecs contributes
    const components = [lb("alb"), ecs("ecs", ["alb"])];
    const lag = propagationLag("alb", "ecs", components);
    expect(lag).toBe(30); // ecs max lag
  });

  it("multi-hop lag > single-hop lag when intermediate components have non-zero lag", () => {
    const components = [lb("alb"), ecs("ecs", ["alb"]), ddb("ddb", ["ecs"])];
    const singleHop = propagationLag("alb", "ecs", components); // ecs lag = 30
    const multiHop = propagationLag("alb", "ddb", components); // ecs lag + ddb lag = 30 + 65 = 95
    expect(multiHop).toBeGreaterThan(singleHop);
    expect(singleHop).toBe(30);
    expect(multiHop).toBe(95);
  });
});
