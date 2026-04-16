import { describe, it, expect } from "vitest";
import { lintScenario } from "../../src/scenario/lint";
import type { RawScenarioConfig } from "../../src/scenario/schema";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePersona(id: string) {
  return {
    id,
    display_name: "Test Persona",
    job_title: "SRE",
    team: "Platform",
    initiates_contact: false,
    cooldown_seconds: 60,
    silent_until_contacted: false,
    system_prompt: "You are a test persona.",
  };
}

function makeAction(id: string, isCorrect: boolean) {
  return {
    id,
    type: "rollback" as const,
    service: "svc",
    is_correct_fix: isCorrect,
  };
}

function makeComponent(id: string, inputs: string[] = []) {
  return { id, type: "load_balancer" as const, label: id, inputs };
}

function makeIncident(id: string, affectedComponent: string, onsetSecond = 0) {
  return {
    id,
    affected_component: affectedComponent,
    description: "test incident",
    onset_overlay: "spike_and_sustain" as const,
    onset_second: onsetSecond,
    magnitude: 2.0,
  };
}

function makeMinimalDraft(): Partial<RawScenarioConfig> {
  return {
    id: "test",
    title: "Test",
    description: "desc",
    difficulty: "easy" as const,
    tags: [],
    timeline: {
      default_speed: 1 as const,
      duration_minutes: 15,
      pre_incident_seconds: 300,
    },
    topology: {
      focal_service: {
        name: "svc",
        description: "test service",
        components: [makeComponent("alb")],
        incidents: [],
      },
      upstream: [],
      downstream: [],
    },
    personas: [makePersona("p1")],
    remediation_actions: [makeAction("r1", true)],
    evaluation: {
      root_cause: "something broke",
      relevant_actions: [],
      red_herrings: [],
      debrief_context: "debrief here",
    },
    engine: { llm_event_tools: [] },
    email: [],
    chat: { channels: [], messages: [] },
    ticketing: [],
    alarms: [],
    wiki: { pages: [] },
    cicd: { pipelines: [], deployments: [] },
    logs: [],
    log_patterns: [],
    background_logs: [],
    feature_flags: [],
    host_groups: [],
  };
}

// ── Happy paths ───────────────────────────────────────────────────────────────

describe("lintScenario — happy paths", () => {
  it("returns empty array for a fully valid draft (partial: false)", () => {
    const draft = makeMinimalDraft();
    const errors = lintScenario(draft, { partial: false });
    expect(errors).toEqual([]);
  });

  it("returns empty array for an empty draft (partial: true)", () => {
    const errors = lintScenario({}, { partial: true });
    expect(errors).toEqual([]);
  });

  it("partial: true skips at_least_one_persona when personas absent", () => {
    const draft: Partial<RawScenarioConfig> = { title: "hello" };
    const errors = lintScenario(draft, { partial: true });
    const rule = errors.find((e) => e.rule === "at_least_one_persona");
    expect(rule).toBeUndefined();
  });

  it("partial: true skips correct_fix_exists when remediation_actions absent", () => {
    const draft: Partial<RawScenarioConfig> = { title: "hello" };
    const errors = lintScenario(draft, { partial: true });
    const rule = errors.find((e) => e.rule === "correct_fix_exists");
    expect(rule).toBeUndefined();
  });

  it("partial: true skips incident_onset_in_range when timeline absent", () => {
    const draft: Partial<RawScenarioConfig> = {
      topology: {
        focal_service: {
          name: "svc",
          description: "d",
          components: [makeComponent("alb")],
          incidents: [makeIncident("i1", "alb", 99999)],
        },
        upstream: [],
        downstream: [],
      },
    };
    const errors = lintScenario(draft, { partial: true });
    const rule = errors.find((e) => e.rule === "incident_onset_in_range");
    expect(rule).toBeUndefined();
  });
});

// ── Rule: at_least_one_persona ────────────────────────────────────────────────

describe("lintScenario — at_least_one_persona", () => {
  it("fails with partial: false when personas is empty", () => {
    const draft = makeMinimalDraft();
    draft.personas = [];
    const errors = lintScenario(draft, { partial: false });
    const err = errors.find((e) => e.rule === "at_least_one_persona");
    expect(err).toBeDefined();
    expect(err!.source).toBe("lint");
    expect(err!.path).toBe("personas");
  });

  it("fails with partial: true when personas array is explicitly empty", () => {
    const draft: Partial<RawScenarioConfig> = { personas: [] };
    const errors = lintScenario(draft, { partial: true });
    const err = errors.find((e) => e.rule === "at_least_one_persona");
    expect(err).toBeDefined();
  });
});

// ── Rule: at_least_one_remediation ────────────────────────────────────────────

describe("lintScenario — at_least_one_remediation", () => {
  it("fails with partial: false when remediation_actions is empty", () => {
    const draft = makeMinimalDraft();
    draft.remediation_actions = [];
    const errors = lintScenario(draft, { partial: false });
    const err = errors.find((e) => e.rule === "at_least_one_remediation");
    expect(err).toBeDefined();
    expect(err!.path).toBe("remediation_actions");
  });
});

// ── Rule: correct_fix_exists ──────────────────────────────────────────────────

describe("lintScenario — correct_fix_exists", () => {
  it("fails when all actions have is_correct_fix: false (partial: false)", () => {
    const draft = makeMinimalDraft();
    draft.remediation_actions = [
      makeAction("r1", false),
      makeAction("r2", false),
    ];
    const errors = lintScenario(draft, { partial: false });
    const err = errors.find((e) => e.rule === "correct_fix_exists");
    expect(err).toBeDefined();
    expect(err!.path).toBe("remediation_actions");
  });

  it("passes when at least one action has is_correct_fix: true", () => {
    const draft = makeMinimalDraft();
    draft.remediation_actions = [
      makeAction("r1", false),
      makeAction("r2", true),
    ];
    const errors = lintScenario(draft, { partial: false });
    expect(errors.find((e) => e.rule === "correct_fix_exists")).toBeUndefined();
  });

  it("fails with partial: true when remediation_actions present but none correct", () => {
    const draft: Partial<RawScenarioConfig> = {
      remediation_actions: [makeAction("r1", false)],
    };
    const errors = lintScenario(draft, { partial: true });
    const err = errors.find((e) => e.rule === "correct_fix_exists");
    expect(err).toBeDefined();
  });
});

// ── Rule: incident_onset_in_range ─────────────────────────────────────────────

describe("lintScenario — incident_onset_in_range", () => {
  it("fails when onset_second > duration_minutes * 60", () => {
    const draft = makeMinimalDraft();
    draft.timeline!.duration_minutes = 10; // 600s
    draft.topology!.focal_service.incidents = [makeIncident("i1", "alb", 700)];
    const errors = lintScenario(draft, { partial: false });
    const err = errors.find((e) => e.rule === "incident_onset_in_range");
    expect(err).toBeDefined();
    expect(err!.path).toContain("incidents");
  });

  it("passes when onset_second == duration_minutes * 60", () => {
    const draft = makeMinimalDraft();
    draft.timeline!.duration_minutes = 10; // 600s
    draft.topology!.focal_service.incidents = [makeIncident("i1", "alb", 600)];
    const errors = lintScenario(draft, { partial: false });
    expect(
      errors.find((e) => e.rule === "incident_onset_in_range"),
    ).toBeUndefined();
  });

  it("passes when onset_second is negative (within pre_incident window)", () => {
    const draft = makeMinimalDraft();
    draft.timeline!.duration_minutes = 10;
    draft.timeline!.pre_incident_seconds = 43200; // 12h
    draft.topology!.focal_service.incidents = [
      makeIncident("i1", "alb", -18000),
    ]; // 5h before
    const errors = lintScenario(draft, { partial: false });
    expect(
      errors.find((e) => e.rule === "incident_onset_in_range"),
    ).toBeUndefined();
  });

  it("fails when onset_second is more negative than -pre_incident_seconds", () => {
    const draft = makeMinimalDraft();
    draft.timeline!.duration_minutes = 10;
    draft.timeline!.pre_incident_seconds = 300; // only 5 minutes
    draft.topology!.focal_service.incidents = [
      makeIncident("i1", "alb", -18000),
    ];
    const errors = lintScenario(draft, { partial: false });
    const err = errors.find((e) => e.rule === "incident_onset_in_range");
    expect(err).toBeDefined();
  });
});

// ── Rule: incident_has_affected_component ─────────────────────────────────────

describe("lintScenario — incident_has_affected_component", () => {
  it("fails when affected_component is not in focal_service.components", () => {
    const draft = makeMinimalDraft();
    draft.topology!.focal_service.incidents = [
      makeIncident("i1", "nonexistent", 0),
    ];
    const errors = lintScenario(draft, { partial: false });
    const err = errors.find(
      (e) => e.rule === "incident_has_affected_component",
    );
    expect(err).toBeDefined();
    expect(err!.message).toContain("nonexistent");
  });

  it("passes when affected_component exists in components", () => {
    const draft = makeMinimalDraft();
    draft.topology!.focal_service.incidents = [makeIncident("i1", "alb", 0)];
    const errors = lintScenario(draft, { partial: false });
    expect(
      errors.find((e) => e.rule === "incident_has_affected_component"),
    ).toBeUndefined();
  });

  it("runs even in partial mode when both incidents and components are present", () => {
    const draft: Partial<RawScenarioConfig> = {
      topology: {
        focal_service: {
          name: "svc",
          description: "d",
          components: [makeComponent("alb")],
          incidents: [makeIncident("i1", "missing", 0)],
        },
        upstream: [],
        downstream: [],
      },
    };
    const errors = lintScenario(draft, { partial: true });
    const err = errors.find(
      (e) => e.rule === "incident_has_affected_component",
    );
    expect(err).toBeDefined();
  });
});

// ── Rule: evaluation_root_cause_non_empty ─────────────────────────────────────

describe("lintScenario — evaluation_root_cause_non_empty", () => {
  it("fails when root_cause is whitespace-only", () => {
    const draft = makeMinimalDraft();
    draft.evaluation!.root_cause = "   ";
    const errors = lintScenario(draft, { partial: false });
    const err = errors.find(
      (e) => e.rule === "evaluation_root_cause_non_empty",
    );
    expect(err).toBeDefined();
    expect(err!.path).toBe("evaluation.root_cause");
  });

  it("fails when root_cause is empty string", () => {
    const draft = makeMinimalDraft();
    draft.evaluation!.root_cause = "";
    const errors = lintScenario(draft, { partial: false });
    expect(
      errors.find((e) => e.rule === "evaluation_root_cause_non_empty"),
    ).toBeDefined();
  });

  it("passes when root_cause has content", () => {
    const draft = makeMinimalDraft();
    draft.evaluation!.root_cause = "DB pool exhausted";
    const errors = lintScenario(draft, { partial: false });
    expect(
      errors.find((e) => e.rule === "evaluation_root_cause_non_empty"),
    ).toBeUndefined();
  });
});

// ── Rule: no_duplicate_persona_ids ────────────────────────────────────────────

describe("lintScenario — no_duplicate_persona_ids", () => {
  it("fails when two personas share the same id", () => {
    const draft = makeMinimalDraft();
    draft.personas = [makePersona("p1"), makePersona("p1")];
    const errors = lintScenario(draft, { partial: false });
    const err = errors.find((e) => e.rule === "no_duplicate_persona_ids");
    expect(err).toBeDefined();
    expect(err!.message).toContain("p1");
  });

  it("runs in partial mode when 2+ personas present", () => {
    const draft: Partial<RawScenarioConfig> = {
      personas: [makePersona("dup"), makePersona("dup")],
    };
    const errors = lintScenario(draft, { partial: true });
    expect(
      errors.find((e) => e.rule === "no_duplicate_persona_ids"),
    ).toBeDefined();
  });

  it("passes when all persona ids are unique", () => {
    const draft = makeMinimalDraft();
    draft.personas = [makePersona("p1"), makePersona("p2")];
    const errors = lintScenario(draft, { partial: false });
    expect(
      errors.find((e) => e.rule === "no_duplicate_persona_ids"),
    ).toBeUndefined();
  });
});

// ── Rule: no_duplicate_action_ids ─────────────────────────────────────────────

describe("lintScenario — no_duplicate_action_ids", () => {
  it("fails when two actions share the same id", () => {
    const draft = makeMinimalDraft();
    draft.remediation_actions = [
      makeAction("r1", true),
      makeAction("r1", false),
    ];
    const errors = lintScenario(draft, { partial: false });
    const err = errors.find((e) => e.rule === "no_duplicate_action_ids");
    expect(err).toBeDefined();
    expect(err!.message).toContain("r1");
  });
});

// ── Rule: persona_refs_valid ──────────────────────────────────────────────────

describe("lintScenario — persona_refs_valid", () => {
  it("fails when chat message references unknown persona id", () => {
    const draft = makeMinimalDraft();
    draft.chat = {
      channels: [{ id: "c1", name: "#general" }],
      messages: [
        {
          id: "m1",
          at_second: 0,
          channel: "c1",
          persona: "ghost",
          text: "hello",
        },
      ],
    };
    const errors = lintScenario(draft, { partial: false });
    const err = errors.find((e) => e.rule === "persona_refs_valid");
    expect(err).toBeDefined();
    expect(err!.message).toContain("ghost");
  });

  it("fails when email from references unknown persona id", () => {
    const draft = makeMinimalDraft();
    draft.email = [
      {
        id: "e1",
        at_second: 0,
        thread_id: "t1",
        from: "nobody",
        to: "trainee",
        subject: "hi",
        body: "body",
      },
    ];
    const errors = lintScenario(draft, { partial: false });
    const err = errors.find((e) => e.rule === "persona_refs_valid");
    expect(err).toBeDefined();
    expect(err!.message).toContain("nobody");
  });

  it("passes when email from is 'trainee'", () => {
    const draft = makeMinimalDraft();
    draft.email = [
      {
        id: "e1",
        at_second: 0,
        thread_id: "t1",
        from: "trainee",
        to: "trainee",
        subject: "hi",
        body: "body",
      },
    ];
    const errors = lintScenario(draft, { partial: false });
    expect(errors.find((e) => e.rule === "persona_refs_valid")).toBeUndefined();
  });

  it("passes when chat message persona matches a known persona id", () => {
    const draft = makeMinimalDraft();
    draft.personas = [makePersona("p1")];
    draft.chat = {
      channels: [{ id: "c1", name: "#general" }],
      messages: [
        {
          id: "m1",
          at_second: 0,
          channel: "c1",
          persona: "p1",
          text: "hello",
        },
      ],
    };
    const errors = lintScenario(draft, { partial: false });
    expect(errors.find((e) => e.rule === "persona_refs_valid")).toBeUndefined();
  });

  it("runs in partial mode when both chat and personas are present", () => {
    const draft: Partial<RawScenarioConfig> = {
      personas: [makePersona("p1")],
      chat: {
        channels: [],
        messages: [
          {
            id: "m1",
            at_second: 0,
            channel: "c1",
            persona: "ghost",
            text: "x",
          },
        ],
      },
    };
    const errors = lintScenario(draft, { partial: true });
    expect(errors.find((e) => e.rule === "persona_refs_valid")).toBeDefined();
  });
});

// ── Rule: duration_positive ───────────────────────────────────────────────────

describe("lintScenario — duration_positive", () => {
  it("fails when duration_minutes is 0 (partial: false)", () => {
    const draft = makeMinimalDraft();
    draft.timeline!.duration_minutes = 0;
    const errors = lintScenario(draft, { partial: false });
    const err = errors.find((e) => e.rule === "duration_positive");
    expect(err).toBeDefined();
    expect(err!.path).toBe("timeline.duration_minutes");
  });

  it("runs in partial mode when timeline present with duration 0", () => {
    const draft: Partial<RawScenarioConfig> = {
      timeline: {
        default_speed: 1 as const,
        duration_minutes: 0,
        pre_incident_seconds: 300,
      },
    };
    const errors = lintScenario(draft, { partial: true });
    expect(errors.find((e) => e.rule === "duration_positive")).toBeDefined();
  });
});

// ── Rule: focal_service_has_components ────────────────────────────────────────

describe("lintScenario — focal_service_has_components", () => {
  it("does NOT fail in partial:false mode (strict:false) when focal_service has no components", () => {
    const draft = makeMinimalDraft();
    draft.topology!.focal_service.components = [];
    const errors = lintScenario(draft, { partial: false });
    expect(
      errors.find((e) => e.rule === "focal_service_has_components"),
    ).toBeUndefined();
  });

  it("fails in strict mode when focal_service has no components", () => {
    const draft = makeMinimalDraft();
    draft.topology!.focal_service.components = [];
    const errors = lintScenario(draft, { partial: false, strict: true });
    const err = errors.find((e) => e.rule === "focal_service_has_components");
    expect(err).toBeDefined();
  });

  it("skipped in partial mode when topology absent", () => {
    const draft: Partial<RawScenarioConfig> = { title: "t" };
    const errors = lintScenario(draft, { partial: true });
    expect(
      errors.find((e) => e.rule === "focal_service_has_components"),
    ).toBeUndefined();
  });
});

// ── Multiple errors returned simultaneously ───────────────────────────────────

describe("lintScenario — multiple simultaneous errors", () => {
  it("returns all applicable errors in a single call", () => {
    const draft = makeMinimalDraft();
    draft.personas = [];
    draft.remediation_actions = [];
    draft.evaluation!.root_cause = "";
    const errors = lintScenario(draft, { partial: false });
    const rules = errors.map((e) => e.rule);
    expect(rules).toContain("at_least_one_persona");
    expect(rules).toContain("at_least_one_remediation");
    expect(rules).toContain("correct_fix_exists");
    expect(rules).toContain("evaluation_root_cause_non_empty");
  });
});
