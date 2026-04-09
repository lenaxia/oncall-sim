// loader.test.ts — browser port of the server scenario loader tests.
// Uses loadScenarioFromText() with resolveFile callbacks instead of fs + temp dirs.

import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import {
  loadScenarioFromText,
  toScenarioSummary,
  isScenarioLoadError,
} from "../../src/scenario/loader";
import { getFixtureScenario } from "../../src/testutil/index";
import fixtureYaml from "../../../scenarios/_fixture/scenario.yaml?raw";

// ── helpers ───────────────────────────────────────────────────────────────────

// Resolve file that always rejects (simulates missing file)
const noopResolve = (_: string): Promise<string> =>
  Promise.reject(new Error("not found"));

// Resolve file that returns a given content map
function makeResolve(files: Record<string, string>) {
  return (rel: string): Promise<string> => {
    if (files[rel] !== undefined) return Promise.resolve(files[rel]);
    return Promise.reject(new Error(`file not found: ${rel}`));
  };
}

// Parse the fixture YAML to a mutable object
function parseFixtureYaml(): Record<string, unknown> {
  return yaml.load(fixtureYaml) as Record<string, unknown>;
}

// ── loadScenarioFromText — happy paths ────────────────────────────────────────

describe("loadScenarioFromText — happy paths", () => {
  it("fixture scenario loads without errors", async () => {
    const result = await loadScenarioFromText(fixtureYaml, noopResolve);
    expect(isScenarioLoadError(result)).toBe(false);
  });

  it("returns LoadedScenario with correct id", async () => {
    const result = await loadScenarioFromText(fixtureYaml, noopResolve);
    expect(isScenarioLoadError(result)).toBe(false);
    if (!isScenarioLoadError(result)) {
      expect(result.id).toBe("_fixture");
    }
  });

  it("returns LoadedScenario with correct title", async () => {
    const result = await loadScenarioFromText(fixtureYaml, noopResolve);
    if (!isScenarioLoadError(result)) {
      expect(result.title).toBe("Fixture Scenario");
    }
  });

  it("has at least one persona", async () => {
    const result = await loadScenarioFromText(fixtureYaml, noopResolve);
    if (!isScenarioLoadError(result)) {
      expect(result.personas.length).toBeGreaterThan(0);
      expect(result.personas[0].id).toBe("fixture-persona");
    }
  });

  it("has at least one alarm", async () => {
    const result = await loadScenarioFromText(fixtureYaml, noopResolve);
    if (!isScenarioLoadError(result)) {
      expect(result.alarms.length).toBeGreaterThan(0);
      expect(result.alarms[0].id).toBe("fixture-alarm-001");
    }
  });

  it("wiki page content is loaded (inline content — non-empty string)", async () => {
    const result = await loadScenarioFromText(fixtureYaml, noopResolve);
    if (!isScenarioLoadError(result)) {
      expect(result.wiki.pages.length).toBeGreaterThan(0);
      expect(typeof result.wiki.pages[0].content).toBe("string");
      expect(result.wiki.pages[0].content.length).toBeGreaterThan(0);
    }
  });

  it("LoadedScenario has no metrics field — metrics are session-scoped", async () => {
    const result = await loadScenarioFromText(fixtureYaml, noopResolve);
    if (!isScenarioLoadError(result)) {
      expect(
        (result as unknown as Record<string, unknown>)["metrics"],
      ).toBeUndefined();
    }
  });

  it("camelCase transformation is applied — service_type → serviceType", async () => {
    const result = await loadScenarioFromText(fixtureYaml, noopResolve);
    if (!isScenarioLoadError(result)) {
      expect(result.serviceType).toBe("api");
      expect(
        (result as unknown as Record<string, unknown>)["service_type"],
      ).toBeUndefined();
    }
  });

  it("opsDashboard.focalService has correct name and trafficProfile", async () => {
    const result = await loadScenarioFromText(fixtureYaml, noopResolve);
    if (!isScenarioLoadError(result)) {
      expect(result.opsDashboard.focalService.name).toBe("fixture-service");
      expect(result.opsDashboard.focalService.trafficProfile).toBe(
        "always_on_api",
      );
    }
  });
});

// ── ops_dashboard_file resolution ────────────────────────────────────────────

describe("loadScenarioFromText — ops_dashboard_file", () => {
  it("ops_dashboard_file reference is resolved and merged correctly", async () => {
    const fixtureObj = parseFixtureYaml();
    const ops = fixtureObj["ops_dashboard"];
    delete fixtureObj["ops_dashboard"];
    fixtureObj["ops_dashboard_file"] = "metrics.yaml";

    const modifiedYaml = yaml.dump(fixtureObj);
    const resolve = makeResolve({ "metrics.yaml": yaml.dump(ops) });

    const result = await loadScenarioFromText(modifiedYaml, resolve);
    if (isScenarioLoadError(result)) console.error(result.errors);
    expect(isScenarioLoadError(result)).toBe(false);
    if (!isScenarioLoadError(result)) {
      expect(result.opsDashboard.focalService.name).toBe("fixture-service");
    }
  });
});

// ── email body_file resolution ────────────────────────────────────────────────

describe("loadScenarioFromText — email body_file resolution", () => {
  it("email body_file content is loaded into memory", async () => {
    const fixtureObj = parseFixtureYaml();
    const emails = fixtureObj["email"] as Array<Record<string, unknown>>;
    const emailBody = emails[0]["body"] as string;
    emails[0] = { ...emails[0], body: undefined, body_file: "email-body.md" };

    const modifiedYaml = yaml.dump(fixtureObj);
    const resolve = makeResolve({ "email-body.md": emailBody });

    const result = await loadScenarioFromText(modifiedYaml, resolve);
    if (isScenarioLoadError(result)) console.error(result.errors);
    expect(isScenarioLoadError(result)).toBe(false);
    if (!isScenarioLoadError(result)) {
      expect(result.emails[0].body.length).toBeGreaterThan(0);
    }
  });
});

// ── error paths ───────────────────────────────────────────────────────────────

describe("loadScenarioFromText — error paths", () => {
  it("invalid YAML returns ScenarioLoadError", async () => {
    const result = await loadScenarioFromText("{ invalid yaml:", noopResolve);
    expect(isScenarioLoadError(result)).toBe(true);
  });

  it("Zod schema failure returns ScenarioLoadError with field paths", async () => {
    const result = await loadScenarioFromText(
      "id: missing-required-fields\n",
      noopResolve,
    );
    expect(isScenarioLoadError(result)).toBe(true);
    if (isScenarioLoadError(result)) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("cross-reference failure returns ScenarioLoadError with field paths", async () => {
    const fixtureObj = parseFixtureYaml();
    const alarms = fixtureObj["alarms"] as Array<Record<string, unknown>>;
    alarms[0] = { ...alarms[0], service: "nonexistent-service-xyz" };

    const result = await loadScenarioFromText(
      yaml.dump(fixtureObj),
      noopResolve,
    );
    expect(isScenarioLoadError(result)).toBe(true);
    if (isScenarioLoadError(result)) {
      const err = result.errors.find((e) => e.field.includes("service"));
      expect(err).toBeDefined();
    }
  });

  it("ops_dashboard + ops_dashboard_file both present returns error", async () => {
    const fixtureObj = parseFixtureYaml();
    fixtureObj["ops_dashboard_file"] = "metrics.yaml";

    const result = await loadScenarioFromText(
      yaml.dump(fixtureObj),
      noopResolve,
    );
    expect(isScenarioLoadError(result)).toBe(true);
    if (isScenarioLoadError(result)) {
      expect(
        result.errors.find((e) => e.field === "ops_dashboard_file"),
      ).toBeDefined();
    }
  });

  it("path traversal in file reference returns error", async () => {
    const fixtureObj = parseFixtureYaml();
    const wiki = fixtureObj["wiki"] as {
      pages: Array<Record<string, unknown>>;
    };
    wiki.pages[0] = {
      ...wiki.pages[0],
      content: undefined,
      content_file: "../../etc/passwd",
    };

    const result = await loadScenarioFromText(
      yaml.dump(fixtureObj),
      noopResolve,
    );
    expect(isScenarioLoadError(result)).toBe(true);
    if (isScenarioLoadError(result)) {
      expect(
        result.errors.find((e) => e.message.includes("traversal")),
      ).toBeDefined();
    }
  });

  it("missing referenced file returns error (resolveFile rejects)", async () => {
    const fixtureObj = parseFixtureYaml();
    const wiki = fixtureObj["wiki"] as {
      pages: Array<Record<string, unknown>>;
    };
    wiki.pages[0] = {
      ...wiki.pages[0],
      content: undefined,
      content_file: "ghost-file.md",
    };

    // resolveFile rejects for unknown files
    const result = await loadScenarioFromText(
      yaml.dump(fixtureObj),
      noopResolve,
    );
    expect(isScenarioLoadError(result)).toBe(true);
    if (isScenarioLoadError(result)) {
      expect(
        result.errors.find(
          (e) =>
            e.message.includes("ghost-file.md") ||
            e.field.includes("transform"),
        ),
      ).toBeDefined();
    }
  });
});

// ── toScenarioSummary ─────────────────────────────────────────────────────────

describe("toScenarioSummary", () => {
  it("returns only picker-screen fields", async () => {
    const result = await loadScenarioFromText(fixtureYaml, noopResolve);
    if (!isScenarioLoadError(result)) {
      const summary = toScenarioSummary(result);
      expect(Object.keys(summary).sort()).toEqual([
        "description",
        "difficulty",
        "id",
        "serviceType",
        "tags",
        "title",
      ]);
      expect(summary.id).toBe("_fixture");
      expect(summary.serviceType).toBe("api");
      expect(summary.difficulty).toBe("easy");
      expect(Array.isArray(summary.tags)).toBe(true);
    }
  });

  it("summary does not include personas, alarms, or opsDashboard", async () => {
    const result = await loadScenarioFromText(fixtureYaml, noopResolve);
    if (!isScenarioLoadError(result)) {
      const summary = toScenarioSummary(result);
      expect(
        (summary as unknown as Record<string, unknown>)["personas"],
      ).toBeUndefined();
      expect(
        (summary as unknown as Record<string, unknown>)["alarms"],
      ).toBeUndefined();
      expect(
        (summary as unknown as Record<string, unknown>)["opsDashboard"],
      ).toBeUndefined();
    }
  });
});

// ── isScenarioLoadError ───────────────────────────────────────────────────────

describe("isScenarioLoadError", () => {
  it("correctly identifies a ScenarioLoadError", () => {
    const err = {
      scenarioId: "test",
      errors: [{ scenarioId: "test", field: "x", message: "y" }],
    };
    expect(isScenarioLoadError(err)).toBe(true);
  });

  it("correctly identifies a LoadedScenario (not an error)", async () => {
    const result = await loadScenarioFromText(fixtureYaml, noopResolve);
    expect(isScenarioLoadError(result)).toBe(false);
  });
});

// ── resolved_value transform ──────────────────────────────────────────────────

describe("loadScenarioFromText — resolved_value metric field transform", () => {
  it("resolvedValue is undefined when resolved_value is omitted", async () => {
    const result = await loadScenarioFromText(fixtureYaml, noopResolve);
    expect(isScenarioLoadError(result)).toBe(false);
    if (!isScenarioLoadError(result)) {
      const metric = result.opsDashboard.focalService.metrics[0];
      expect(metric.resolvedValue).toBeUndefined();
    }
  });

  it("resolvedValue is populated when resolved_value is present in YAML", async () => {
    const modified = fixtureYaml.replace(
      /archetype:\s*error_rate/,
      "archetype: error_rate\n        resolved_value: 520",
    );
    const result = await loadScenarioFromText(modified, noopResolve);
    expect(isScenarioLoadError(result)).toBe(false);
    if (!isScenarioLoadError(result)) {
      const metric = result.opsDashboard.focalService.metrics[0];
      expect(metric.resolvedValue).toBe(520);
    }
  });
});

// ── getFixtureScenario testutil helper ────────────────────────────────────────

describe("getFixtureScenario testutil", () => {
  it("loads successfully", async () => {
    const scenario = await getFixtureScenario();
    expect(scenario.id).toBe("_fixture");
  });

  it("returns same object on second call (cached)", async () => {
    const a = await getFixtureScenario();
    const b = await getFixtureScenario();
    expect(a).toBe(b);
  });
});
