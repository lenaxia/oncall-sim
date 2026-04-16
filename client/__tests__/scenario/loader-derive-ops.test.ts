/**
 * Tests for Step 3: deriveOpsDashboard() in loader.ts
 *
 * Tests that the loader correctly derives OpsDashboardConfig from the
 * component graph, replacing the old ops_dashboard YAML section.
 *
 * Written before implementation — all should fail until deriveOpsDashboard
 * replaces the current stub in loader.ts.
 */

import { describe, it, expect } from "vitest";
import {
  loadScenarioFromText,
  isScenarioLoadError,
} from "../../src/scenario/loader";
import yaml from "js-yaml";

const noopResolve = (_: string): Promise<string> =>
  Promise.reject(new Error("not found"));

// ── helpers ───────────────────────────────────────────────────────────────────

function makeScenarioYaml(
  topology: unknown,
  extra: Record<string, unknown> = {},
): string {
  const base: Record<string, unknown> = {
    id: "test",
    title: "Test",
    description: "test",
    difficulty: "easy",
    tags: [],
    timeline: { default_speed: 1, duration_minutes: 15 },
    topology,
    engine: {},
    email: [],
    chat: { channels: [], messages: [] },
    ticketing: [],
    alarms: [],
    wiki: { pages: [{ title: "p", content: "c" }] },
    cicd: {},
    personas: [
      {
        id: "p1",
        display_name: "P1",
        job_title: "SRE",
        team: "Platform",
        initiates_contact: false,
        cooldown_seconds: 30,
        silent_until_contacted: false,
        system_prompt: "test",
      },
    ],
    remediation_actions: [],
    evaluation: {
      root_cause: "test",
      relevant_actions: [],
      red_herrings: [],
      debrief_context: "test",
    },
    ...extra,
  };
  return yaml.dump(base);
}

// ── empty components → minimal config ────────────────────────────────────────

describe("deriveOpsDashboard — empty components", () => {
  it("focal_service with no components → opsDashboard.focalService.metrics = []", async () => {
    const yamlStr = makeScenarioYaml({
      focal_service: { name: "svc", description: "test" },
      upstream: [],
      downstream: [],
    });
    const result = await loadScenarioFromText(yamlStr, noopResolve);
    expect(isScenarioLoadError(result)).toBe(false);
    if (!isScenarioLoadError(result)) {
      expect(result.opsDashboard.focalService.metrics).toHaveLength(0);
      expect(result.opsDashboard.focalService.name).toBe("svc");
    }
  });

  it("focal_service with no components → correlatedServices = []", async () => {
    const yamlStr = makeScenarioYaml({
      focal_service: { name: "svc", description: "test" },
      upstream: [],
      downstream: [],
    });
    const result = await loadScenarioFromText(yamlStr, noopResolve);
    if (!isScenarioLoadError(result)) {
      expect(result.opsDashboard.correlatedServices).toHaveLength(0);
    }
  });
});

// ── single component — load_balancer ─────────────────────────────────────────

describe("deriveOpsDashboard — single load_balancer component", () => {
  const topology = {
    focal_service: {
      name: "payment-service",
      description: "test",
      typical_rps: 200,
      traffic_profile: "always_on_api",
      components: [
        { id: "alb", type: "load_balancer", label: "ALB", inputs: [] },
      ],
      incidents: [],
    },
    upstream: [],
    downstream: [],
  };

  it("produces metrics for all load_balancer archetypes", async () => {
    const yamlStr = makeScenarioYaml(topology);
    const result = await loadScenarioFromText(yamlStr, noopResolve);
    if (!isScenarioLoadError(result)) {
      const archetypes = result.opsDashboard.focalService.metrics.map(
        (m) => m.archetype,
      );
      expect(archetypes).toContain("request_rate");
      expect(archetypes).toContain("error_rate");
      expect(archetypes).toContain("fault_rate");
      expect(archetypes).toContain("p50_latency_ms");
      expect(archetypes).toContain("p95_latency_ms");
      expect(archetypes).toContain("p99_latency_ms");
    }
  });

  it("request_rate baselineValue = typicalRps", async () => {
    const yamlStr = makeScenarioYaml(topology);
    const result = await loadScenarioFromText(yamlStr, noopResolve);
    if (!isScenarioLoadError(result)) {
      const m = result.opsDashboard.focalService.metrics.find(
        (m) => m.archetype === "request_rate",
      );
      expect(m).toBeDefined();
      expect(m!.baselineValue).toBe(200);
    }
  });

  it("no incidents → incidentResponses is empty for all metrics", async () => {
    const yamlStr = makeScenarioYaml(topology);
    const result = await loadScenarioFromText(yamlStr, noopResolve);
    if (!isScenarioLoadError(result)) {
      for (const m of result.opsDashboard.focalService.metrics) {
        expect(m.incidentResponses ?? []).toHaveLength(0);
      }
    }
  });

  it("focalService.trafficProfile = always_on_api (from authored field)", async () => {
    const yamlStr = makeScenarioYaml(topology);
    const result = await loadScenarioFromText(yamlStr, noopResolve);
    if (!isScenarioLoadError(result)) {
      expect(result.opsDashboard.focalService.trafficProfile).toBe(
        "always_on_api",
      );
    }
  });
});

// ── linear chain — incident propagation ─────────────────────────────────────

describe("deriveOpsDashboard — incident propagation along chain", () => {
  const topology = {
    focal_service: {
      name: "payment-service",
      description: "test",
      typical_rps: 200,
      components: [
        { id: "alb", type: "load_balancer", label: "ALB", inputs: [] },
        {
          id: "ecs",
          type: "ecs_cluster",
          label: "ECS",
          instance_count: 4,
          utilization: 0.55,
          inputs: ["alb"],
        },
        {
          id: "ddb",
          type: "dynamodb",
          label: "DDB",
          write_capacity: 100,
          read_capacity: 500,
          write_utilization: 0.6,
          read_utilization: 0.2,
          billing_mode: "provisioned",
          inputs: ["ecs"],
        },
      ],
      incidents: [
        {
          id: "ddb_saturation",
          affected_component: "ddb",
          description: "DynamoDB write capacity exhausted.",
          onset_overlay: "saturation",
          onset_second: 0,
          magnitude: 1.0,
        },
      ],
    },
    upstream: [],
    downstream: [],
  };

  it("affected component (ddb) has incidentResponses for write_capacity_used", async () => {
    const yamlStr = makeScenarioYaml(topology);
    const result = await loadScenarioFromText(yamlStr, noopResolve);
    if (!isScenarioLoadError(result)) {
      const wcu = result.opsDashboard.focalService.metrics.find(
        (m) => m.archetype === "write_capacity_used",
      );
      expect(wcu).toBeDefined();
      expect(wcu!.incidentResponses).toBeDefined();
      expect(wcu!.incidentResponses!.length).toBeGreaterThan(0);
    }
  });

  it("upstream component (alb) gets error_rate overlay when propagation_direction is upstream (default)", async () => {
    const yamlStr = makeScenarioYaml(topology);
    const result = await loadScenarioFromText(yamlStr, noopResolve);
    if (!isScenarioLoadError(result)) {
      // Default propagation_direction is "upstream": blast radius from ddb is [ddb, ecs, alb].
      // alb registers error_rate first (entrypoint-closest). With alb in the blast radius,
      // it gets an overlay pushed for its error_rate spec.
      const alb_error = result.opsDashboard.focalService.metrics.find(
        (m) => m.archetype === "error_rate",
      );
      expect(alb_error).toBeDefined();
      expect(alb_error!.incidentResponses!.length).toBeGreaterThan(0);
    }
  });

  it("upstream component (alb) does NOT get overlays when propagation_direction is downstream", async () => {
    const downstreamTopology = {
      ...topology,
      focal_service: {
        ...topology.focal_service,
        incidents: [
          {
            id: "ddb_saturation",
            affected_component: "ddb",
            description: "DynamoDB write capacity exhausted.",
            onset_overlay: "saturation",
            onset_second: 0,
            magnitude: 1.0,
            propagation_direction: "downstream",
          },
        ],
      },
    };
    const yamlStr = makeScenarioYaml(downstreamTopology);
    const result = await loadScenarioFromText(yamlStr, noopResolve);
    if (!isScenarioLoadError(result)) {
      // downstream from ddb = [ddb] (nothing downstream of ddb).
      // alb is NOT in the blast radius — it should have no incident overlays.
      const alb_error = result.opsDashboard.focalService.metrics.find(
        (m) => m.archetype === "error_rate",
      );
      if (alb_error?.incidentResponses) {
        expect(alb_error.incidentResponses).toHaveLength(0);
      }
    }
  });

  it("ddb write_capacity_used overlay is saturation", async () => {
    const yamlStr = makeScenarioYaml(topology);
    const result = await loadScenarioFromText(yamlStr, noopResolve);
    if (!isScenarioLoadError(result)) {
      const wcu = result.opsDashboard.focalService.metrics.find(
        (m) => m.archetype === "write_capacity_used",
      );
      if (wcu?.incidentResponses?.length) {
        expect(wcu.incidentResponses[0].overlay).toBe("saturation");
      }
    }
  });

  it("ddb write_capacity_used peakValue = writeCapacity × magnitude = 100", async () => {
    const yamlStr = makeScenarioYaml(topology);
    const result = await loadScenarioFromText(yamlStr, noopResolve);
    if (!isScenarioLoadError(result)) {
      const wcu = result.opsDashboard.focalService.metrics.find(
        (m) => m.archetype === "write_capacity_used",
      );
      if (wcu?.incidentResponses?.length) {
        expect(wcu.incidentResponses[0].peakValue).toBe(100);
      }
    }
  });

  it("onsetSecond for ddb's own incident is 0 (no propagation to itself)", async () => {
    const yamlStr = makeScenarioYaml(topology);
    const result = await loadScenarioFromText(yamlStr, noopResolve);
    if (!isScenarioLoadError(result)) {
      const wcu = result.opsDashboard.focalService.metrics.find(
        (m) => m.archetype === "write_capacity_used",
      );
      if (wcu?.incidentResponses?.length) {
        expect(wcu.incidentResponses[0].onsetSecond).toBe(0);
      }
    }
  });
});

// ── preIncidentSeconds and resolutionSeconds from timeline ────────────────────

describe("deriveOpsDashboard — timeline values", () => {
  it("preIncidentSeconds comes from timeline.pre_incident_seconds", async () => {
    const yamlStr = makeScenarioYaml(
      {
        focal_service: { name: "svc", description: "test" },
        upstream: [],
        downstream: [],
      },
      {
        timeline: {
          default_speed: 1,
          duration_minutes: 10,
          pre_incident_seconds: 600,
        },
      },
    );
    const result = await loadScenarioFromText(yamlStr, noopResolve);
    if (!isScenarioLoadError(result)) {
      expect(result.opsDashboard.preIncidentSeconds).toBe(600);
    }
  });

  it("resolutionSeconds is a sim engine constant — not authored in scenario YAML", async () => {
    // SIM_RESOLUTION_SECONDS=60 is defined in loader.ts, not in the scenario config.
    // Passing resolution_seconds in the YAML is silently ignored (unknown key stripped by Zod).
    const yamlStr = makeScenarioYaml(
      {
        focal_service: { name: "svc", description: "test" },
        upstream: [],
        downstream: [],
      },
      {
        timeline: {
          default_speed: 1,
          duration_minutes: 10,
          resolution_seconds: 30, // unknown key — stripped
        },
      },
    );
    const result = await loadScenarioFromText(yamlStr, noopResolve);
    if (!isScenarioLoadError(result)) {
      // opsDashboard no longer carries resolutionSeconds
      expect(result.opsDashboard).not.toHaveProperty("resolutionSeconds");
    }
  });
});

// ── downstream correlated services ───────────────────────────────────────────

describe("deriveOpsDashboard — downstream correlated services", () => {
  it("downstream node with no components → minimal CorrelatedServiceConfig", async () => {
    const yamlStr = makeScenarioYaml({
      focal_service: { name: "svc", description: "test", typical_rps: 100 },
      upstream: [],
      downstream: [
        { name: "db", description: "Legacy DB", correlation: "exonerated" },
      ],
    });
    const result = await loadScenarioFromText(yamlStr, noopResolve);
    if (!isScenarioLoadError(result)) {
      expect(result.opsDashboard.correlatedServices).toHaveLength(1);
      const cs = result.opsDashboard.correlatedServices[0];
      expect(cs.name).toBe("db");
      expect(cs.correlation).toBe("exonerated");
    }
  });

  it("upstream nodes are NOT included in correlatedServices", async () => {
    const yamlStr = makeScenarioYaml({
      focal_service: { name: "svc", description: "test" },
      upstream: [{ name: "api-gw", description: "API Gateway" }],
      downstream: [],
    });
    const result = await loadScenarioFromText(yamlStr, noopResolve);
    if (!isScenarioLoadError(result)) {
      expect(result.opsDashboard.correlatedServices).toHaveLength(0);
    }
  });
});

// ── archetype collision — multiple components with same archetype ─────────────

describe("deriveOpsDashboard — archetype collision", () => {
  it("two components generating error_rate → one MetricConfig entry (entrypoint-closest wins)", async () => {
    const yamlStr = makeScenarioYaml({
      focal_service: {
        name: "svc",
        description: "test",
        typical_rps: 100,
        components: [
          { id: "alb", type: "load_balancer", label: "ALB", inputs: [] },
          {
            id: "ecs",
            type: "ecs_cluster",
            label: "ECS",
            instance_count: 2,
            utilization: 0.4,
            inputs: ["alb"],
          },
        ],
        incidents: [],
      },
      upstream: [],
      downstream: [],
    });
    const result = await loadScenarioFromText(yamlStr, noopResolve);
    if (!isScenarioLoadError(result)) {
      const errorRateMetrics = result.opsDashboard.focalService.metrics.filter(
        (m) => m.archetype === "error_rate",
      );
      // Only one error_rate MetricConfig despite both alb and ecs generating it
      expect(errorRateMetrics).toHaveLength(1);
      // The entrypoint-closest (alb) has baseline 0.5
      expect(errorRateMetrics[0].baselineValue).toBe(0.5);
    }
  });
});

// ── fixture scenario loads correctly ─────────────────────────────────────────

describe("deriveOpsDashboard — fixture scenario", () => {
  it("fixture scenario produces non-empty metrics from components", async () => {
    const fixtureYaml =
      await import("../../../scenarios/_fixture/scenario.yaml?raw").then(
        (m) => m.default,
      );
    const result = await loadScenarioFromText(fixtureYaml, noopResolve);
    expect(isScenarioLoadError(result)).toBe(false);
    if (!isScenarioLoadError(result)) {
      // Fixture has alb (load_balancer) and app (ecs_cluster)
      expect(result.opsDashboard.focalService.metrics.length).toBeGreaterThan(
        0,
      );
      expect(result.opsDashboard.focalService.name).toBe("fixture-service");
      // Should have metrics from both alb and ecs
      const archetypes = result.opsDashboard.focalService.metrics.map(
        (m) => m.archetype,
      );
      expect(archetypes).toContain("cpu_utilization"); // from ecs
      expect(archetypes).toContain("request_rate"); // from alb
    }
  });

  it("fixture incident produces incidentResponses on affected metrics", async () => {
    const fixtureYaml =
      await import("../../../scenarios/_fixture/scenario.yaml?raw").then(
        (m) => m.default,
      );
    const result = await loadScenarioFromText(fixtureYaml, noopResolve);
    if (!isScenarioLoadError(result)) {
      // Fixture has incident on ecs_cluster (spike_and_sustain, magnitude=20)
      // cpu_utilization should have an incidentResponse
      const cpu = result.opsDashboard.focalService.metrics.find(
        (m) => m.archetype === "cpu_utilization",
      );
      expect(cpu).toBeDefined();
      expect(cpu!.incidentResponses).toBeDefined();
      expect(cpu!.incidentResponses!.length).toBeGreaterThan(0);
      expect(cpu!.incidentResponses![0].overlay).toBe("spike_and_sustain");
    }
  });
});
