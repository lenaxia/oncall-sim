/**
 * Tests for Step 1: ComponentSchema, IncidentConfigSchema, ServiceNodeSchema,
 * TimelineSchema additions, topology replacement, and validator new rules.
 *
 * All tests written before implementation — they should fail until the code is in place.
 */

import { describe, it, expect } from "vitest";
import { ScenarioSchema } from "../../src/scenario/schema";
import { validateCrossReferences } from "../../src/scenario/validator";
import yaml from "js-yaml";
import fixtureYaml from "../../../scenarios/_fixture/scenario.yaml?raw";

// ── helpers ───────────────────────────────────────────────────────────────────

function loadFixture(): unknown {
  return yaml.load(fixtureYaml);
}

function parseFixture() {
  return ScenarioSchema.parse(loadFixture());
}

// ── 1. service_type removed from ScenarioSchema ───────────────────────────────

describe("ScenarioSchema — service_type removed", () => {
  it("fixture parses without service_type field", () => {
    const raw = loadFixture() as Record<string, unknown>;
    // Remove service_type entirely — schema must not require it
    const withoutServiceType = { ...raw };
    delete withoutServiceType["service_type"];
    expect(() => ScenarioSchema.parse(withoutServiceType)).not.toThrow();
  });

  it("presence of service_type does not cause parse failure (unknown keys stripped)", () => {
    // Zod strips unknown keys by default — extra field is silently ignored
    const raw = loadFixture() as Record<string, unknown>;
    const withServiceType = { ...raw, service_type: "api" };
    expect(() => ScenarioSchema.parse(withServiceType)).not.toThrow();
  });
});

// ── 2. ComponentSchema — discriminated union ──────────────────────────────────

describe("ComponentSchema — load_balancer", () => {
  it("parses a minimal load_balancer component", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: {
        focal_service: {
          name: "test-svc",
          description: "test",
          components: [
            { id: "alb", type: "load_balancer", label: "ALB", inputs: [] },
          ],
        },
        upstream: [],
        downstream: [],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects load_balancer with missing label", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: {
        focal_service: {
          name: "test-svc",
          description: "test",
          components: [{ id: "alb", type: "load_balancer", inputs: [] }],
        },
        upstream: [],
        downstream: [],
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("ComponentSchema — ecs_cluster", () => {
  it("parses ecs_cluster with required capacity fields", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: {
        focal_service: {
          name: "test-svc",
          description: "test",
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
          ],
        },
        upstream: [],
        downstream: [],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects ecs_cluster missing instance_count", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: {
        focal_service: {
          name: "test-svc",
          description: "test",
          components: [
            {
              id: "ecs",
              type: "ecs_cluster",
              label: "ECS",
              utilization: 0.5,
              inputs: [],
            },
          ],
        },
        upstream: [],
        downstream: [],
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects ecs_cluster with utilization > 1", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: {
        focal_service: {
          name: "test-svc",
          description: "test",
          components: [
            {
              id: "ecs",
              type: "ecs_cluster",
              label: "ECS",
              instance_count: 4,
              utilization: 1.5,
              inputs: [],
            },
          ],
        },
        upstream: [],
        downstream: [],
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("ComponentSchema — dynamodb", () => {
  it("parses dynamodb with all required fields", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: {
        focal_service: {
          name: "test-svc",
          description: "test",
          typical_rps: 100,
          components: [
            { id: "alb", type: "load_balancer", label: "ALB", inputs: [] },
            {
              id: "ddb",
              type: "dynamodb",
              label: "MyTable",
              write_capacity: 100,
              read_capacity: 500,
              write_utilization: 0.6,
              read_utilization: 0.2,
              billing_mode: "provisioned",
              inputs: ["alb"],
            },
          ],
        },
        upstream: [],
        downstream: [],
      },
    });
    expect(result.success).toBe(true);
  });

  it("defaults billing_mode to provisioned when omitted", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: {
        focal_service: {
          name: "test-svc",
          description: "test",
          typical_rps: 100,
          components: [
            {
              id: "ddb",
              type: "dynamodb",
              label: "MyTable",
              write_capacity: 100,
              read_capacity: 500,
              write_utilization: 0.6,
              read_utilization: 0.2,
              inputs: [],
            },
          ],
        },
        upstream: [],
        downstream: [],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const ddb = result.data.topology.focal_service.components[0];
      expect((ddb as { billing_mode: string }).billing_mode).toBe(
        "provisioned",
      );
    }
  });

  it("rejects unknown billing_mode value", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: {
        focal_service: {
          name: "test-svc",
          description: "test",
          components: [
            {
              id: "ddb",
              type: "dynamodb",
              label: "MyTable",
              write_capacity: 100,
              read_capacity: 500,
              write_utilization: 0.6,
              read_utilization: 0.2,
              billing_mode: "pay_per_request",
              inputs: [],
            },
          ],
        },
        upstream: [],
        downstream: [],
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("ComponentSchema — unknown type", () => {
  it("rejects a component with an unrecognised type", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: {
        focal_service: {
          name: "test-svc",
          description: "test",
          components: [
            { id: "x", type: "flux_capacitor", label: "X", inputs: [] },
          ],
        },
        upstream: [],
        downstream: [],
      },
    });
    expect(result.success).toBe(false);
  });
});

// ── 3. IncidentConfigSchema ───────────────────────────────────────────────────

describe("IncidentConfigSchema — valid", () => {
  const baseTopology = {
    focal_service: {
      name: "test-svc",
      description: "test",
      typical_rps: 100,
      components: [
        { id: "alb", type: "load_balancer", label: "ALB", inputs: [] },
      ],
      incidents: [
        {
          id: "inc-1",
          affected_component: "alb",
          description: "Error rate spike.",
          onset_overlay: "spike_and_sustain",
          onset_second: 0,
          magnitude: 3.0,
        },
      ],
    },
    upstream: [],
    downstream: [],
  };

  it("parses a valid incident", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({ ...raw, topology: baseTopology });
    expect(result.success).toBe(true);
  });
});

describe("IncidentConfigSchema — invalid", () => {
  function makeTopologyWithIncident(incident: unknown) {
    return {
      focal_service: {
        name: "test-svc",
        description: "test",
        typical_rps: 100,
        components: [
          { id: "alb", type: "load_balancer", label: "ALB", inputs: [] },
        ],
        incidents: [incident],
      },
      upstream: [],
      downstream: [],
    };
  }

  it("rejects saturation with magnitude > 1.0", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: makeTopologyWithIncident({
        id: "inc-1",
        affected_component: "alb",
        description: "Test.",
        onset_overlay: "saturation",
        onset_second: 0,
        magnitude: 1.5,
      }),
    });
    expect(result.success).toBe(false);
  });

  it("rejects sudden_drop with magnitude >= 1.0", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: makeTopologyWithIncident({
        id: "inc-1",
        affected_component: "alb",
        description: "Test.",
        onset_overlay: "sudden_drop",
        onset_second: 0,
        magnitude: 1.0,
      }),
    });
    expect(result.success).toBe(false);
  });

  it("rejects sudden_drop with magnitude exactly 1.0", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: makeTopologyWithIncident({
        id: "inc-1",
        affected_component: "alb",
        description: "Test.",
        onset_overlay: "sudden_drop",
        onset_second: 0,
        magnitude: 1.0,
      }),
    });
    expect(result.success).toBe(false);
  });

  it("rejects onset_overlay: none", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: makeTopologyWithIncident({
        id: "inc-1",
        affected_component: "alb",
        description: "Test.",
        onset_overlay: "none",
        onset_second: 0,
        magnitude: 1.0,
      }),
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative magnitude", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: makeTopologyWithIncident({
        id: "inc-1",
        affected_component: "alb",
        description: "Test.",
        onset_overlay: "spike_and_sustain",
        onset_second: 0,
        magnitude: -1,
      }),
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing description", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: makeTopologyWithIncident({
        id: "inc-1",
        affected_component: "alb",
        onset_overlay: "spike_and_sustain",
        onset_second: 0,
        magnitude: 2.0,
      }),
    });
    expect(result.success).toBe(false);
  });
});

// ── 4. TimelineSchema — pre_incident_seconds and resolution_seconds ────────────

describe("TimelineSchema — new fields", () => {
  it("parses timeline with pre_incident_seconds and resolution_seconds", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      timeline: {
        default_speed: 1,
        duration_minutes: 10,
        pre_incident_seconds: 600,
        resolution_seconds: 30,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeline.pre_incident_seconds).toBe(600);
      expect(result.data.timeline.resolution_seconds).toBe(30);
    }
  });

  it("defaults pre_incident_seconds to 43200 (12h) when omitted", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      timeline: { default_speed: 1, duration_minutes: 10 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeline.pre_incident_seconds).toBe(43200);
    }
  });

  it("defaults resolution_seconds to 15 when omitted", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      timeline: { default_speed: 1, duration_minutes: 10 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeline.resolution_seconds).toBe(15);
    }
  });

  it("rejects non-positive pre_incident_seconds", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      timeline: {
        default_speed: 1,
        duration_minutes: 10,
        pre_incident_seconds: 0,
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts large pre_incident_seconds (no upper cap)", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      timeline: {
        default_speed: 1,
        duration_minutes: 10,
        pre_incident_seconds: 86400, // 24h — valid for long-history scenarios
      },
    });
    expect(result.success).toBe(true);
  });
});

// ── 5. Topology schema — focal_service is now an object ───────────────────────

describe("TopologySchema — focal_service is object", () => {
  it("rejects focal_service as a plain string", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: {
        focal_service: "payment-service",
        upstream: [],
        downstream: [],
      },
    });
    expect(result.success).toBe(false);
  });

  it("parses focal_service as object with name + description", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: {
        focal_service: { name: "payment-service", description: "desc" },
        upstream: [],
        downstream: [],
      },
    });
    expect(result.success).toBe(true);
  });

  it("requires focal_service.name", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: {
        focal_service: { description: "desc" },
        upstream: [],
        downstream: [],
      },
    });
    expect(result.success).toBe(false);
  });

  it("requires focal_service.description", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: {
        focal_service: { name: "svc" },
        upstream: [],
        downstream: [],
      },
    });
    expect(result.success).toBe(false);
  });

  it("upstream and downstream are arrays of ServiceNode objects", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: {
        focal_service: { name: "svc", description: "desc" },
        upstream: [{ name: "upstream-svc", description: "u desc" }],
        downstream: [
          {
            name: "downstream-svc",
            description: "d desc",
            correlation: "exonerated",
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects upstream as array of strings", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: {
        focal_service: { name: "svc", description: "desc" },
        upstream: ["upstream-svc"],
        downstream: [],
      },
    });
    expect(result.success).toBe(false);
  });
});

// ── 6. ops_dashboard removed from schema ─────────────────────────────────────

describe("ScenarioSchema — ops_dashboard removed", () => {
  it("does not require ops_dashboard", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const withoutOps = { ...raw };
    delete withoutOps["ops_dashboard"];
    expect(() => ScenarioSchema.parse(withoutOps)).not.toThrow();
  });
});

// ── 7. Validator new rules ────────────────────────────────────────────────────

describe("validateCrossReferences — typical_rps required when components present", () => {
  it("errors when focal_service has components but no typical_rps", () => {
    const config = parseFixture();
    config.topology.focal_service.components = [
      { id: "alb", type: "load_balancer", label: "ALB", inputs: [] },
    ];
    // typical_rps not set
    delete (config.topology.focal_service as Record<string, unknown>)[
      "typical_rps"
    ];
    const errors = validateCrossReferences(config);
    expect(errors.some((e) => e.field.includes("typical_rps"))).toBe(true);
  });

  it("no error when focal_service has no components and no typical_rps", () => {
    const config = parseFixture();
    config.topology.focal_service.components = [];
    delete (config.topology.focal_service as Record<string, unknown>)[
      "typical_rps"
    ];
    const errors = validateCrossReferences(config);
    expect(errors.some((e) => e.field.includes("typical_rps"))).toBe(false);
  });
});

describe("validateCrossReferences — entrypoint uniqueness", () => {
  it("errors when no component has inputs: []", () => {
    const config = parseFixture();
    config.topology.focal_service.components = [
      { id: "a", type: "load_balancer", label: "A", inputs: ["b"] },
      { id: "b", type: "load_balancer", label: "B", inputs: ["a"] },
    ];
    config.topology.focal_service.typical_rps = 100;
    const errors = validateCrossReferences(config);
    expect(errors.some((e) => e.field.includes("entrypoint"))).toBe(true);
  });

  it("errors when multiple components have inputs: []", () => {
    const config = parseFixture();
    config.topology.focal_service.components = [
      { id: "a", type: "load_balancer", label: "A", inputs: [] },
      { id: "b", type: "load_balancer", label: "B", inputs: [] },
    ];
    config.topology.focal_service.typical_rps = 100;
    const errors = validateCrossReferences(config);
    expect(errors.some((e) => e.field.includes("entrypoint"))).toBe(true);
  });

  it("no error when exactly one component has inputs: []", () => {
    const config = parseFixture();
    config.topology.focal_service.typical_rps = 100;
    config.topology.focal_service.components = [
      { id: "alb", type: "load_balancer", label: "ALB", inputs: [] },
      {
        id: "ecs",
        type: "ecs_cluster",
        label: "ECS",
        instance_count: 2,
        utilization: 0.5,
        inputs: ["alb"],
      },
    ];
    const errors = validateCrossReferences(config);
    expect(errors.some((e) => e.field.includes("entrypoint"))).toBe(false);
  });
});

describe("validateCrossReferences — input id validity", () => {
  it("errors when a component references a non-existent input id", () => {
    const config = parseFixture();
    config.topology.focal_service.typical_rps = 100;
    config.topology.focal_service.components = [
      { id: "alb", type: "load_balancer", label: "ALB", inputs: [] },
      {
        id: "ecs",
        type: "ecs_cluster",
        label: "ECS",
        instance_count: 2,
        utilization: 0.5,
        inputs: ["nonexistent"],
      },
    ];
    const errors = validateCrossReferences(config);
    expect(errors.some((e) => e.field.includes("inputs"))).toBe(true);
  });

  it("no error when all input ids are valid", () => {
    const config = parseFixture();
    config.topology.focal_service.typical_rps = 100;
    config.topology.focal_service.components = [
      { id: "alb", type: "load_balancer", label: "ALB", inputs: [] },
      {
        id: "ecs",
        type: "ecs_cluster",
        label: "ECS",
        instance_count: 2,
        utilization: 0.5,
        inputs: ["alb"],
      },
    ];
    const errors = validateCrossReferences(config);
    expect(errors.some((e) => e.field.includes("inputs"))).toBe(false);
  });
});

describe("validateCrossReferences — cycle detection", () => {
  it("errors when component graph has a cycle", () => {
    const config = parseFixture();
    config.topology.focal_service.typical_rps = 100;
    config.topology.focal_service.components = [
      { id: "a", type: "load_balancer", label: "A", inputs: [] },
      {
        id: "b",
        type: "ecs_cluster",
        label: "B",
        instance_count: 2,
        utilization: 0.5,
        inputs: ["a", "c"],
      },
      {
        id: "c",
        type: "ecs_cluster",
        label: "C",
        instance_count: 2,
        utilization: 0.5,
        inputs: ["b"],
      },
    ];
    const errors = validateCrossReferences(config);
    expect(errors.some((e) => e.field.includes("cycle"))).toBe(true);
  });

  it("errors when a component self-references via inputs", () => {
    const config = parseFixture();
    config.topology.focal_service.typical_rps = 100;
    config.topology.focal_service.components = [
      { id: "a", type: "load_balancer", label: "A", inputs: [] },
      {
        id: "b",
        type: "ecs_cluster",
        label: "B",
        instance_count: 2,
        utilization: 0.5,
        inputs: ["a", "b"],
      },
    ];
    const errors = validateCrossReferences(config);
    expect(errors.some((e) => e.field.includes("cycle"))).toBe(true);
  });

  it("no error for a valid linear chain", () => {
    const config = parseFixture();
    config.topology.focal_service.typical_rps = 100;
    config.topology.focal_service.components = [
      { id: "alb", type: "load_balancer", label: "ALB", inputs: [] },
      {
        id: "ecs",
        type: "ecs_cluster",
        label: "ECS",
        instance_count: 2,
        utilization: 0.5,
        inputs: ["alb"],
      },
      {
        id: "ddb",
        type: "dynamodb" as const,
        label: "DDB",
        write_capacity: 100,
        read_capacity: 500,
        write_utilization: 0.6,
        read_utilization: 0.2,
        billing_mode: "provisioned" as const,
        inputs: ["ecs"],
      },
    ];
    const errors = validateCrossReferences(config);
    expect(errors.some((e) => e.field.includes("cycle"))).toBe(false);
  });
});

describe("validateCrossReferences — incident component validity", () => {
  it("errors when affected_component references non-existent component id", () => {
    const config = parseFixture();
    config.topology.focal_service.typical_rps = 100;
    config.topology.focal_service.components = [
      { id: "alb", type: "load_balancer", label: "ALB", inputs: [] },
    ];
    config.topology.focal_service.incidents = [
      {
        id: "inc-1",
        affected_component: "nonexistent",
        description: "test",
        onset_overlay: "spike_and_sustain" as const,
        onset_second: 0,
        magnitude: 2.0,
      },
    ];
    const errors = validateCrossReferences(config);
    expect(errors.some((e) => e.field.includes("affected_component"))).toBe(
      true,
    );
  });

  it("no error when affected_component is a valid component id", () => {
    const config = parseFixture();
    config.topology.focal_service.typical_rps = 100;
    config.topology.focal_service.components = [
      { id: "alb", type: "load_balancer", label: "ALB", inputs: [] },
    ];
    config.topology.focal_service.incidents = [
      {
        id: "inc-1",
        affected_component: "alb",
        description: "test",
        onset_overlay: "spike_and_sustain" as const,
        onset_second: 0,
        magnitude: 2.0,
      },
    ];
    const errors = validateCrossReferences(config);
    expect(errors.some((e) => e.field.includes("affected_component"))).toBe(
      false,
    );
  });
});

describe("validateCrossReferences — incidents on non-focal nodes warning", () => {
  it("emits a warning when a downstream node has incidents", () => {
    const config = parseFixture();
    config.topology.downstream = [
      {
        name: "downstream-svc",
        description: "desc",
        correlation: "independent" as const,
        components: [],
        incidents: [
          {
            id: "inc-1",
            affected_component: "something",
            description: "test",
            onset_overlay: "spike_and_sustain" as const,
            onset_second: 0,
            magnitude: 2.0,
          },
        ],
      },
    ];
    const errors = validateCrossReferences(config);
    // Must be a warning — field includes "downstream" and message says "ignored"
    const warning = errors.find(
      (e) => e.field.includes("downstream") && e.message.includes("ignored"),
    );
    expect(warning).toBeDefined();
  });
});

describe("validateCrossReferences — alarm service validation uses topology", () => {
  it("accepts alarm.service matching topology focal_service name", () => {
    const config = parseFixture();
    // The fixture topology.focal_service.name is now "fixture-service"
    config.alarms[0] = {
      ...config.alarms[0],
      service: config.topology.focal_service.name,
    };
    const errors = validateCrossReferences(config);
    expect(errors.some((e) => e.field === "alarms[0].service")).toBe(false);
  });

  it("rejects alarm.service not in topology", () => {
    const config = parseFixture();
    config.alarms[0] = { ...config.alarms[0], service: "phantom-service" };
    const errors = validateCrossReferences(config);
    expect(errors.some((e) => e.field === "alarms[0].service")).toBe(true);
  });
});
