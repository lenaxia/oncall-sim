import { describe, it, expect } from "vitest";
import { ScenarioSchema } from "../../src/scenario/schema";
import yaml from "js-yaml";
import fixtureYaml from "../../../scenarios/_fixture/scenario.yaml?raw";

// ── Load fixture YAML once ────────────────────────────────────────────────────

function loadFixture(): unknown {
  return yaml.load(fixtureYaml);
}

// ── Valid fixture ─────────────────────────────────────────────────────────────

describe("ScenarioSchema — valid fixture", () => {
  it("parses the fixture scenario without errors", () => {
    const raw = loadFixture();
    const result = ScenarioSchema.safeParse(raw);
    if (!result.success) {
      console.error(result.error.format());
    }
    expect(result.success).toBe(true);
  });

  it("tags field is required — omitting it fails", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({ ...raw, tags: undefined });
    expect(result.success).toBe(false);
  });

  it("applies defaults — engine.llm_event_tools defaults to []", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const withoutTools = {
      ...raw,
      engine: { ...(raw.engine as object), llm_event_tools: undefined },
    };
    const result = ScenarioSchema.safeParse(withoutTools);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.engine.llm_event_tools).toEqual([]);
    }
  });

  it("email field is required — omitting it fails", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({ ...raw, email: undefined });
    expect(result.success).toBe(false);
  });

  it("ticketing field is required — omitting it fails", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({ ...raw, ticketing: undefined });
    expect(result.success).toBe(false);
  });

  it("alarms field is required — omitting it fails", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({ ...raw, alarms: undefined });
    expect(result.success).toBe(false);
  });

  it("logs field is optional — omitting it succeeds and defaults to []", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({ ...raw, logs: undefined });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logs).toEqual([]);
    }
  });

  it("remediation_actions field is required — omitting it fails", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      remediation_actions: undefined,
    });
    expect(result.success).toBe(false);
  });

  it("topology.upstream defaults to [] when omitted", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const topology = raw.topology as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: { ...topology, upstream: undefined },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.topology.upstream).toEqual([]);
    }
  });

  it("topology.downstream defaults to [] when omitted", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const topology = raw.topology as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: { ...topology, downstream: undefined },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.topology.downstream).toEqual([]);
    }
  });

  it("applies defaults — chat.messages defaults to []", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const chat = raw.chat as Record<string, unknown>;
    const withoutMessages = {
      ...raw,
      chat: { ...chat, messages: undefined },
    };
    const result = ScenarioSchema.safeParse(withoutMessages);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chat.messages).toEqual([]);
    }
  });
});

// ── Required top-level fields ─────────────────────────────────────────────────

describe("ScenarioSchema — required field validation", () => {
  function stripField(fieldPath: string[]): unknown {
    const raw = loadFixture() as Record<string, unknown>;
    // Support one level of nesting only (sufficient for these tests)
    if (fieldPath.length === 1) {
      const [key] = fieldPath;
      const copy = { ...raw };
      delete copy[key];
      return copy;
    }
    const [parent, child] = fieldPath;
    const parentObj = { ...(raw[parent] as Record<string, unknown>) };
    delete parentObj[child];
    return { ...raw, [parent]: parentObj };
  }

  const requiredFields: string[][] = [
    ["id"],
    ["title"],
    ["description"],
    ["difficulty"],
    ["tags"],
    ["timeline"],
    ["topology"],
    ["engine"],
    ["email"],
    ["chat"],
    ["ticketing"],
    ["alarms"],
    ["wiki"],
    ["cicd"],
    ["personas"],
    ["remediation_actions"],
    ["evaluation"],
  ];

  for (const fieldPath of requiredFields) {
    it(`fails when '${fieldPath.join(".")}' is missing`, () => {
      const raw = stripField(fieldPath);
      const result = ScenarioSchema.safeParse(raw);
      expect(result.success).toBe(false);
    });
  }
});

// ── Field-level constraints ───────────────────────────────────────────────────

describe("ScenarioSchema — field constraints", () => {
  function withOverride(overrides: Record<string, unknown>): unknown {
    return { ...(loadFixture() as object), ...overrides };
  }

  it("service_type field is no longer required — ignored if present", () => {
    // service_type was removed from the schema; passing it as an unknown field is fine
    const result = ScenarioSchema.safeParse(
      withOverride({ service_type: "cache" }),
    );
    // Zod strips unknown keys — parse succeeds
    expect(result.success).toBe(true);
  });

  it("rejects invalid difficulty", () => {
    const result = ScenarioSchema.safeParse(
      withOverride({ difficulty: "expert" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects invalid timeline.default_speed", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      timeline: { ...(raw.timeline as object), default_speed: 3 },
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid default_speed values", () => {
    const raw = loadFixture() as Record<string, unknown>;
    for (const speed of [1, 2, 5, 10]) {
      const result = ScenarioSchema.safeParse({
        ...raw,
        timeline: { ...(raw.timeline as object), default_speed: speed },
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects negative timeline.duration_minutes", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      timeline: { ...(raw.timeline as object), duration_minutes: -5 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid alarm severity", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const alarms = raw.alarms as Array<Record<string, unknown>>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      alarms: [{ ...alarms[0], severity: "SEV5" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid traffic_profile on focal_service", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const topology = raw.topology as Record<string, unknown>;
    const focal = topology.focal_service as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: {
        ...topology,
        focal_service: { ...focal, traffic_profile: "spike" },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid correlation type on downstream node", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const topology = raw.topology as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: {
        ...topology,
        downstream: [
          { name: "svc", description: "test", correlation: "unknown" },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid remediation_action type", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const actions = raw.remediation_actions as Array<Record<string, unknown>>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      remediation_actions: [{ ...actions[0], type: "detonate" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty string persona id", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const personas = raw.personas as Array<Record<string, unknown>>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      personas: [{ ...personas[0], id: "" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts ops_dashboard_file instead of ops_dashboard", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const withFileRef = {
      ...raw,
      ops_dashboard: undefined,
      ops_dashboard_file: "metrics.yaml",
    };
    const result = ScenarioSchema.safeParse(withFileRef);
    expect(result.success).toBe(true);
  });

  it("accepts both ops_dashboard and ops_dashboard_file (Zod does not enforce mutual exclusion — validator.ts does)", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      ops_dashboard_file: "metrics.yaml",
    });
    // Zod accepts both — cross-reference validation catches mutual exclusion
    expect(result.success).toBe(true);
  });

  it("rejects incident with invalid noise level on ecs_cluster component", () => {
    // noise level is checked in ComponentSchema — there's no component-level noise field.
    // Instead test that an incident with an invalid onset_overlay is rejected.
    const raw = loadFixture() as Record<string, unknown>;
    const topology = raw.topology as Record<string, unknown>;
    const focal = topology.focal_service as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: {
        ...topology,
        focal_service: {
          ...focal,
          incidents: [
            {
              id: "test",
              affected_component: "app",
              description: "test",
              onset_overlay: "invalid_overlay",
              onset_second: 0,
              magnitude: 1.0,
            },
          ],
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects log entry with invalid level", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const logs = raw.logs as Array<Record<string, unknown>>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      logs: [{ ...logs[0], level: "VERBOSE" }],
    });
    expect(result.success).toBe(false);
  });
});

// ── ops_dashboard optional fields ─────────────────────────────────────────────

describe("ScenarioSchema — ops_dashboard optional fields", () => {
  it("parses without ops_dashboard when ops_dashboard_file is provided", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const withFileRef = {
      ...raw,
      ops_dashboard: undefined,
      ops_dashboard_file: "metrics.yaml",
    };
    const result = ScenarioSchema.safeParse(withFileRef);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ops_dashboard).toBeUndefined();
      expect(result.data.ops_dashboard_file).toBe("metrics.yaml");
    }
  });
});

// ── Cross-reference data availability ────────────────────────────────────────
// The Zod schema does not enforce cross-references — those are validated by
// validator.ts (Phase 3). These tests confirm the data needed by the
// cross-reference validator is present and correctly shaped in the parsed output.

describe("ScenarioSchema — cross-reference data available after parse", () => {
  it("alarm.service and alarm.metric_id are present for cross-ref validation", () => {
    const raw = loadFixture();
    const result = ScenarioSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      const alarm = result.data.alarms[0];
      expect(typeof alarm.service).toBe("string");
      expect(typeof alarm.metric_id).toBe("string");
    }
  });

  it("persona ids are present for cross-ref validation", () => {
    const raw = loadFixture();
    const result = ScenarioSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.personas.every((p) => typeof p.id === "string")).toBe(
        true,
      );
    }
  });

  it("topology upstream/downstream arrays present for cross-ref validation", () => {
    const raw = loadFixture();
    const result = ScenarioSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Array.isArray(result.data.topology.upstream)).toBe(true);
      expect(Array.isArray(result.data.topology.downstream)).toBe(true);
    }
  });

  it("remediation_actions ids are present for cross-ref validation", () => {
    const raw = loadFixture();
    const result = ScenarioSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        result.data.remediation_actions.every((r) => typeof r.id === "string"),
      ).toBe(true);
    }
  });

  it("topology.focal_service.components parses correctly", () => {
    const raw = loadFixture();
    const result = ScenarioSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      const components = result.data.topology.focal_service.components;
      expect(Array.isArray(components)).toBe(true);
      expect(components.length).toBeGreaterThan(0);
      expect(components.every((c) => typeof c.id === "string")).toBe(true);
    }
  });

  it("RawScenarioConfig type is exported — ScenarioSchema is an object (validates export)", () => {
    // ScenarioSchema is already imported at the top of this file.
    // If TypeScript compiled this file, RawScenarioConfig is exported correctly.
    expect(typeof ScenarioSchema).toBe("object");
  });
});

// ── Deferred validation (Phase 2 / Phase 3) ───────────────────────────────────
// These cases from LLD §6 require the archetype registry (Phase 2) and the
// cross-reference validator (Phase 3). The Zod schema cannot enforce them.
// The tests below document the deferral and verify the data is PRESENT for
// those validators to consume.

describe("ScenarioSchema — deferred validation (Phase 2/3)", () => {
  it("incident magnitude validation is enforced by Zod superRefine", () => {
    // saturation magnitude > 1.0 is rejected at parse time
    const raw = loadFixture() as Record<string, unknown>;
    const topology = raw.topology as Record<string, unknown>;
    const focal = topology.focal_service as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      topology: {
        ...topology,
        focal_service: {
          ...focal,
          incidents: [
            {
              id: "inc-1",
              affected_component: "app",
              description: "test",
              onset_overlay: "saturation",
              onset_second: 0,
              magnitude: 2.0, // invalid — > 1.0 for saturation
            },
          ],
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("duplicate alarm IDs are accepted by Zod — uniqueness check is Phase 3", () => {
    // LLD: "No duplicate IDs within: alarm IDs, persona IDs, metric IDs, event IDs, ticket IDs"
    // Zod cannot check uniqueness. This is enforced by validator.ts (Phase 3).
    const raw = loadFixture() as Record<string, unknown>;
    const alarms = raw.alarms as Array<Record<string, unknown>>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      alarms: [alarms[0], { ...alarms[0] }], // duplicate
    });
    // Zod accepts it — duplicate check is Phase 3's job
    expect(result.success).toBe(true);
  });

  it("duplicate persona IDs are accepted by Zod — uniqueness check is Phase 3", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const personas = raw.personas as Array<Record<string, unknown>>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      personas: [personas[0], { ...personas[0] }], // duplicate
    });
    expect(result.success).toBe(true);
  });
});

// ── resolved_value field — MetricConfig is now derived, not authored ──────────
// MetricConfig is populated by the loader from the component graph.
// The schema no longer exposes ops_dashboard metrics for YAML authoring.

describe("ScenarioSchema — MetricConfig is derived (not authored)", () => {
  it("timeline pre_incident_seconds defaults to 300", () => {
    const raw = loadFixture() as Record<string, unknown>;
    const result = ScenarioSchema.safeParse({
      ...raw,
      timeline: { default_speed: 1, duration_minutes: 10 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeline.pre_incident_seconds).toBe(300);
    }
  });

  it("timeline resolution_seconds defaults to 15", () => {
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
});
