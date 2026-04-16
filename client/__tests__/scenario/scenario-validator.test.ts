import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import fixtureYaml from "../../../scenarios/_fixture/scenario.yaml?raw";
import {
  ScenarioValidator,
  type ScenarioValidationError,
} from "../../src/scenario/validator";
import { ScenarioSchema } from "../../src/scenario/schema";

type RawConfig = ReturnType<typeof ScenarioSchema.parse>;

function loadFixtureRaw(): unknown {
  return yaml.load(fixtureYaml);
}

function loadFixtureParsed(): RawConfig {
  return ScenarioSchema.parse(yaml.load(fixtureYaml));
}

// ── ScenarioValidator.full ────────────────────────────────────────────────────

describe("ScenarioValidator.full — happy paths", () => {
  it("returns ok:true for the fixture scenario", () => {
    const result = ScenarioValidator.full(loadFixtureRaw());
    expect(result.ok).toBe(true);
  });

  it("data matches direct ScenarioSchema.parse output", () => {
    const result = ScenarioValidator.full(loadFixtureRaw());
    if (!result.ok) throw new Error("expected ok");
    const direct = loadFixtureParsed();
    expect(result.data).toEqual(direct);
  });
});

describe("ScenarioValidator.full — schema errors", () => {
  it("returns ok:false with source:schema for non-object input", () => {
    const result = ScenarioValidator.full("not an object");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].source).toBe("schema");
  });

  it("returns ok:false with source:schema when required field missing", () => {
    const raw = loadFixtureRaw() as Record<string, unknown>;
    const result = ScenarioValidator.full({ ...raw, title: undefined });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const schemaErr = result.errors.find((e) => e.source === "schema");
    expect(schemaErr).toBeDefined();
    expect(schemaErr!.path).toContain("title");
  });

  it("returns ok:false with source:schema for wrong field type", () => {
    const raw = loadFixtureRaw() as Record<string, unknown>;
    const result = ScenarioValidator.full({ ...raw, difficulty: 42 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.source === "schema")).toBe(true);
  });
});

describe("ScenarioValidator.full — cross_ref errors", () => {
  it("returns ok:false with source:cross_ref for unknown persona ref in chat", () => {
    const parsed = loadFixtureParsed();
    parsed.chat.messages[0] = { ...parsed.chat.messages[0], persona: "ghost" };
    const result = ScenarioValidator.full(parsed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const xref = result.errors.find((e) => e.source === "cross_ref");
    expect(xref).toBeDefined();
    expect(xref!.message).toContain("ghost");
  });
});

describe("ScenarioValidator.full — lint errors", () => {
  it("returns ok:true with warning when no correct fix exists (lint is non-blocking)", () => {
    const parsed = loadFixtureParsed();
    parsed.remediation_actions = parsed.remediation_actions.map((r) => ({
      ...r,
      is_correct_fix: false,
    }));
    const result = ScenarioValidator.full(parsed);
    // Lint does not block full() — it returns ok:true with a warning
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warn = result.warnings.find(
      (w) => w.source === "lint" && w.rule === "correct_fix_exists",
    );
    expect(warn).toBeDefined();
  });
});

// ── ScenarioValidator.partial ─────────────────────────────────────────────────

describe("ScenarioValidator.partial — happy paths", () => {
  it("returns ok:true for empty object", () => {
    const result = ScenarioValidator.partial({});
    expect(result.ok).toBe(true);
  });

  it("returns ok:true for draft with only title", () => {
    const result = ScenarioValidator.partial({ title: "My Scenario" });
    expect(result.ok).toBe(true);
  });

  it("returns ok:true for draft with valid partial topology", () => {
    const result = ScenarioValidator.partial({
      topology: {
        focal_service: {
          name: "my-service",
          description: "desc",
          components: [
            { id: "alb", type: "load_balancer", label: "ALB", inputs: [] },
          ],
          incidents: [],
        },
        upstream: [],
        downstream: [],
      },
    });
    expect(result.ok).toBe(true);
  });

  it("does NOT fail for missing required top-level fields (e.g. alarms)", () => {
    const result = ScenarioValidator.partial({
      title: "test",
      difficulty: "easy",
    });
    expect(result.ok).toBe(true);
  });

  it("returns ok:true for the full fixture as partial", () => {
    const result = ScenarioValidator.partial(loadFixtureRaw());
    expect(result.ok).toBe(true);
  });
});

describe("ScenarioValidator.partial — schema errors on present fields", () => {
  it("returns ok:false when a present field has wrong type", () => {
    const result = ScenarioValidator.partial({
      personas: [{ id: 123, display_name: "X" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const schemaErr = result.errors.find((e) => e.source === "schema");
    expect(schemaErr).toBeDefined();
  });

  it("returns ok:true with warning for duplicate persona ids (lint is non-blocking in partial)", () => {
    const result = ScenarioValidator.partial({
      personas: [
        {
          id: "dup",
          display_name: "A",
          job_title: "SRE",
          team: "T",
          initiates_contact: false,
          cooldown_seconds: 60,
          silent_until_contacted: false,
          system_prompt: "x",
        },
        {
          id: "dup",
          display_name: "B",
          job_title: "SRE",
          team: "T",
          initiates_contact: false,
          cooldown_seconds: 60,
          silent_until_contacted: false,
          system_prompt: "y",
        },
      ],
    });
    // Lint does not block partial() — returns ok:true with warning
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warn = result.warnings.find(
      (w) => w.source === "lint" && w.rule === "no_duplicate_persona_ids",
    );
    expect(warn).toBeDefined();
  });
});

// ── ScenarioValidator.section ─────────────────────────────────────────────────

describe("ScenarioValidator.section — personas", () => {
  it("returns ok:true for valid personas array", () => {
    const personas = [
      {
        id: "p1",
        display_name: "Alice",
        job_title: "SRE",
        team: "Platform",
        initiates_contact: false,
        cooldown_seconds: 60,
        silent_until_contacted: false,
        system_prompt: "You are Alice.",
      },
    ];
    const result = ScenarioValidator.section("personas", personas);
    expect(result.ok).toBe(true);
  });

  it("returns ok:false with source:schema for non-array", () => {
    const result = ScenarioValidator.section("personas", "not-an-array");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].source).toBe("schema");
  });

  it("returns ok:true with lint warning for duplicate persona ids", () => {
    const persona = {
      id: "dup",
      display_name: "A",
      job_title: "SRE",
      team: "T",
      initiates_contact: false,
      cooldown_seconds: 60,
      silent_until_contacted: false,
      system_prompt: "x",
    };
    const result = ScenarioValidator.section("personas", [persona, persona]);
    // Lint is non-blocking in section() too — warning on success
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warn = result.warnings.find(
      (w) => w.source === "lint" && w.rule === "no_duplicate_persona_ids",
    );
    expect(warn).toBeDefined();
  });
});

describe("ScenarioValidator.section — remediation_actions", () => {
  it("returns ok:true for valid actions with a correct fix", () => {
    const actions = [
      {
        id: "r1",
        type: "rollback" as const,
        service: "svc",
        is_correct_fix: true,
      },
    ];
    const result = ScenarioValidator.section("remediation_actions", actions);
    expect(result.ok).toBe(true);
  });

  it("returns ok:true with lint warning when no correct fix", () => {
    const actions = [
      {
        id: "r1",
        type: "rollback" as const,
        service: "svc",
        is_correct_fix: false,
      },
    ];
    const result = ScenarioValidator.section("remediation_actions", actions);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warn = result.warnings.find((w) => w.rule === "correct_fix_exists");
    expect(warn).toBeDefined();
  });
});

describe("ScenarioValidator.section — timeline", () => {
  it("returns ok:true for valid timeline", () => {
    const timeline = {
      default_speed: 2 as const,
      duration_minutes: 15,
      pre_incident_seconds: 300,
    };
    const result = ScenarioValidator.section("timeline", timeline);
    expect(result.ok).toBe(true);
  });

  it("returns ok:false when duration_minutes is 0 (caught by schema or lint)", () => {
    const timeline = {
      default_speed: 2 as const,
      duration_minutes: 0,
      pre_incident_seconds: 300,
    };
    const result = ScenarioValidator.section("timeline", timeline);
    // duration_minutes: 0 is rejected by Zod (.positive()) before lint runs.
    // Either schema or lint catching it is correct — the point is ok:false.
    expect(result.ok).toBe(false);
  });
});

describe("ScenarioValidator.section — evaluation", () => {
  it("returns ok:true with lint warning for empty root_cause", () => {
    const evaluation = {
      root_cause: "  ",
      relevant_actions: [],
      red_herrings: [],
      debrief_context: "context",
    };
    const result = ScenarioValidator.section("evaluation", evaluation);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.warnings.find((w) => w.rule === "evaluation_root_cause_non_empty"),
    ).toBeDefined();
  });
});

// ── ScenarioValidator.strict ──────────────────────────────────────────────────

describe("ScenarioValidator.strict — lint is blocking", () => {
  it("returns ok:false with source:lint when no correct fix (strict blocks)", () => {
    const parsed = loadFixtureParsed();
    parsed.remediation_actions = parsed.remediation_actions.map((r) => ({
      ...r,
      is_correct_fix: false,
    }));
    const result = ScenarioValidator.strict(parsed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const lint = result.errors.find(
      (e) => e.source === "lint" && e.rule === "correct_fix_exists",
    );
    expect(lint).toBeDefined();
  });

  it("returns ok:true with empty warnings for a fully valid scenario", () => {
    const result = ScenarioValidator.strict(loadFixtureRaw());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });

  it("still blocks on schema errors", () => {
    const raw = loadFixtureRaw() as Record<string, unknown>;
    const result = ScenarioValidator.strict({ ...raw, title: undefined });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].source).toBe("schema");
  });
});

// ── Error shape ───────────────────────────────────────────────────────────────

describe("ScenarioValidationError shape", () => {
  it("errors have source, path, and message fields", () => {
    const result = ScenarioValidator.full({ title: undefined });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const e of result.errors) {
      expect(typeof e.source).toBe("string");
      expect(typeof e.path).toBe("string");
      expect(typeof e.message).toBe("string");
    }
  });

  it("lint warnings on success have source, rule, path, and message fields", () => {
    const result = ScenarioValidator.partial({
      remediation_actions: [
        {
          id: "r1",
          type: "rollback" as const,
          service: "svc",
          is_correct_fix: false,
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.length).toBeGreaterThan(0);
    const warn = result.warnings.find((w) => w.source === "lint") as
      | ScenarioValidationError
      | undefined;
    expect(warn).toBeDefined();
    expect(typeof warn!.rule).toBe("string");
    expect(typeof warn!.path).toBe("string");
    expect(typeof warn!.message).toBe("string");
  });
});
