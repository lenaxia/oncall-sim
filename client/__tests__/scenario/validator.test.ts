import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import fixtureYaml from "../../../scenarios/_fixture/scenario.yaml?raw";
import { validateCrossReferences } from "../../src/scenario/validator";
import { ScenarioSchema } from "../../src/scenario/schema";

type RawConfig = ReturnType<typeof ScenarioSchema.parse>;

function loadFixture(): RawConfig {
  return ScenarioSchema.parse(yaml.load(fixtureYaml));
}

// ── valid fixture ─────────────────────────────────────────────────────────────

describe("validateCrossReferences — valid fixture", () => {
  it("returns empty error array for the fixture scenario", () => {
    const config = loadFixture();
    const errors = validateCrossReferences(config);
    expect(errors).toEqual([]);
  });
});

// ── Rule 1 & 2: alarm service and metric_id ───────────────────────────────────

describe("validateCrossReferences — alarm validation", () => {
  it("alarm with bad metric_id returns error with correct field path", () => {
    const config = loadFixture();
    config.alarms[0] = { ...config.alarms[0], metric_id: "nonexistent_metric" };
    const errors = validateCrossReferences(config);
    const err = errors.find((e) => e.field.includes("metric_id"));
    expect(err).toBeDefined();
    expect(err!.field).toBe("alarms[0].metric_id");
    expect(err!.message).toContain("nonexistent_metric");
  });

  it("alarm with bad service returns error with correct field path", () => {
    const config = loadFixture();
    config.alarms[0] = { ...config.alarms[0], service: "nonexistent-service" };
    const errors = validateCrossReferences(config);
    const err = errors.find((e) => e.field === "alarms[0].service");
    expect(err).toBeDefined();
    expect(err!.message).toContain("nonexistent-service");
  });
});

// ── Rule 3: persona ID references ─────────────────────────────────────────────

describe("validateCrossReferences — persona references", () => {
  it("chat message with missing persona ID returns error", () => {
    const config = loadFixture();
    config.chat.messages[0] = {
      ...config.chat.messages[0],
      persona: "ghost-persona",
    };
    const errors = validateCrossReferences(config);
    const err = errors.find((e) => e.field.includes("chat.messages"));
    expect(err).toBeDefined();
    expect(err!.message).toContain("ghost-persona");
  });

  it("email from unknown persona returns error", () => {
    const config = loadFixture();
    config.email[0] = { ...config.email[0], from: "unknown-persona" };
    const errors = validateCrossReferences(config);
    const err = errors.find((e) => e.field.includes("email[0].from"));
    expect(err).toBeDefined();
  });

  it("ticket created_by unknown persona returns error", () => {
    const config = loadFixture();
    config.ticketing[0] = {
      ...config.ticketing[0],
      created_by: "unknown-persona",
    };
    const errors = validateCrossReferences(config);
    const err = errors.find((e) => e.field.includes("ticketing[0].created_by"));
    expect(err).toBeDefined();
  });

  it("email from trainee does not produce error", () => {
    const config = loadFixture();
    config.email[0] = { ...config.email[0], from: "trainee" };
    const errors = validateCrossReferences(config);
    expect(
      errors.find((e) => e.field.includes("email[0].from")),
    ).toBeUndefined();
  });
});

// ── Rule 4: ActionType in relevant_actions ────────────────────────────────────

describe("validateCrossReferences — ActionType validation", () => {
  it("invalid ActionType in relevant_actions returns error", () => {
    const config = loadFixture();
    config.evaluation.relevant_actions[0] = {
      ...config.evaluation.relevant_actions[0],
      action: "detonate_everything",
    };
    const errors = validateCrossReferences(config);
    const err = errors.find((e) =>
      e.field.includes("relevant_actions[0].action"),
    );
    expect(err).toBeDefined();
    expect(err!.message).toContain("detonate_everything");
  });

  it("valid ActionType trigger_rollback does not produce error", () => {
    const config = loadFixture();
    config.evaluation.relevant_actions[0] = {
      ...config.evaluation.relevant_actions[0],
      action: "trigger_rollback",
    };
    const errors = validateCrossReferences(config);
    expect(
      errors.find((e) => e.field.includes("relevant_actions[0].action")),
    ).toBeUndefined();
  });
});

// ── Rule 5: remediation_action_id cross-reference ─────────────────────────────

describe("validateCrossReferences — remediation_action_id cross-reference", () => {
  it("remediation_action_id referencing a non-existent id returns error", () => {
    const config = loadFixture();
    config.evaluation.relevant_actions[0] = {
      ...config.evaluation.relevant_actions[0],
      remediation_action_id: "nonexistent_remediation_action",
    };
    const errors = validateCrossReferences(config);
    const err = errors.find((e) => e.field.includes("remediation_action_id"));
    expect(err).toBeDefined();
    expect(err!.message).toContain("nonexistent_remediation_action");
  });

  it("remediation_action_id referencing a valid id does not produce error", () => {
    const config = loadFixture();
    // The fixture has one remediation action: 'rollback_fixture_service'
    const validId = config.remediation_actions[0].id;
    config.evaluation.relevant_actions[0] = {
      ...config.evaluation.relevant_actions[0],
      remediation_action_id: validId,
    };
    const errors = validateCrossReferences(config);
    expect(
      errors.find((e) => e.field.includes("remediation_action_id")),
    ).toBeUndefined();
  });

  it("omitting remediation_action_id does not produce error (field is optional)", () => {
    const config = loadFixture();
    // relevant_actions without remediation_action_id should pass
    config.evaluation.relevant_actions[0] = {
      action: "trigger_rollback",
      why: "Fixes the bug.",
    };
    const errors = validateCrossReferences(config);
    expect(
      errors.find((e) => e.field.includes("remediation_action_id")),
    ).toBeUndefined();
  });
});

// ── Rule 6: alarm service uses topology names (not ops_dashboard) ─────────────

describe("validateCrossReferences — alarm service validation uses topology", () => {
  it("alarm with service matching focal_service.name passes", () => {
    const config = loadFixture();
    // fixture focal_service.name is 'fixture-service'
    config.alarms[0] = { ...config.alarms[0], service: "fixture-service" };
    const errors = validateCrossReferences(config);
    expect(errors.find((e) => e.field === "alarms[0].service")).toBeUndefined();
  });

  it("alarm with service not in topology returns error", () => {
    const config = loadFixture();
    config.alarms[0] = { ...config.alarms[0], service: "phantom-service" };
    const errors = validateCrossReferences(config);
    const err = errors.find((e) => e.field === "alarms[0].service");
    expect(err).toBeDefined();
    expect(err!.message).toContain("phantom-service");
  });

  it("alarm with service matching a downstream node passes", () => {
    const config = loadFixture();
    config.topology.downstream = [
      {
        name: "downstream-svc",
        description: "downstream",
        components: [],
        incidents: [],
      },
    ];
    config.alarms[0] = { ...config.alarms[0], service: "downstream-svc" };
    const errors = validateCrossReferences(config);
    expect(errors.find((e) => e.field === "alarms[0].service")).toBeUndefined();
  });
});

// ── Rule 7: metric_id is a registered archetype ───────────────────────────────

describe("validateCrossReferences — alarm metric_id archetype validation", () => {
  it("alarm with unregistered metric_id returns error", () => {
    const config = loadFixture();
    config.alarms[0] = {
      ...config.alarms[0],
      metric_id: "made_up_archetype_xyz",
    };
    const errors = validateCrossReferences(config);
    const err = errors.find((e) => e.field.includes("metric_id"));
    expect(err).toBeDefined();
    expect(err!.message).toContain("made_up_archetype_xyz");
  });

  it("alarm with valid archetype error_rate does not produce error", () => {
    const config = loadFixture();
    config.alarms[0] = { ...config.alarms[0], metric_id: "error_rate" };
    const errors = validateCrossReferences(config);
    expect(errors.find((e) => e.field.includes("metric_id"))).toBeUndefined();
  });
});

// ── Rule 8: file reference path traversal ────────────────────────────────────

describe("validateCrossReferences — ops_dashboard_file path traversal", () => {
  it("ops_dashboard_file with path traversal returns error", () => {
    const config = loadFixture();
    (config as Record<string, unknown>)["ops_dashboard_file"] =
      "../../../etc/passwd";
    const errors = validateCrossReferences(config);
    const err = errors.find((e) => e.field === "ops_dashboard_file");
    expect(err).toBeDefined();
    expect(err!.message).toContain("traversal");
  });
});

// ── Rule 9: duplicate IDs ─────────────────────────────────────────────────────

describe("validateCrossReferences — duplicate IDs", () => {
  it("duplicate alarm IDs returns error", () => {
    const config = loadFixture();
    config.alarms = [config.alarms[0], { ...config.alarms[0] }];
    const errors = validateCrossReferences(config);
    const err = errors.find((e) => e.field === "alarms");
    expect(err).toBeDefined();
    expect(err!.message).toContain("Duplicate");
  });

  it("duplicate persona IDs returns error", () => {
    const config = loadFixture();
    config.personas = [config.personas[0], { ...config.personas[0] }];
    const errors = validateCrossReferences(config);
    const err = errors.find((e) => e.field === "personas");
    expect(err).toBeDefined();
    expect(err!.message).toContain("Duplicate");
  });
});

// ── All errors collected (not fail-fast) ──────────────────────────────────────

describe("validateCrossReferences — collects all errors", () => {
  it("multiple violations all appear in the returned array", () => {
    const config = loadFixture();
    // Introduce two independent errors
    config.alarms[0] = { ...config.alarms[0], service: "bad-service" };
    config.evaluation.relevant_actions[0] = {
      ...config.evaluation.relevant_actions[0],
      action: "not_an_action",
    };
    const errors = validateCrossReferences(config);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Rule 10: file references ──────────────────────────────────────────────────

describe("validateCrossReferences — file references", () => {
  it("path traversal in file reference returns error", () => {
    const config = loadFixture();
    config.email[0] = {
      ...config.email[0],
      body: undefined,
      body_file: "../../../etc/passwd",
    };
    const errors = validateCrossReferences(config);
    const err = errors.find((e) => e.field.includes("body_file"));
    expect(err).toBeDefined();
    expect(err!.message).toContain("traversal");
  });

  it("missing referenced file: validator does not check existence (browser port)", () => {
    // The browser validator omits fs.accessSync — file existence is checked at resolve time.
    // The validator only catches path traversal.
    const config = loadFixture();
    config.wiki.pages[0] = {
      ...config.wiki.pages[0],
      content: undefined,
      content_file: "nonexistent-file.md",
    };
    const errors = validateCrossReferences(config);
    // No error from validator — existence verified by resolveFile rejection in loader
    const err = errors.find((e) => e.field.includes("content_file"));
    expect(err).toBeUndefined();
  });
});
