import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import {
  loadAllScenarios,
  loadScenario,
  toScenarioSummary,
  isScenarioLoadError,
} from "../../src/scenario/loader";
import { getFixtureScenarioDir } from "../../src/testutil/index";

// ── loadScenario — happy paths ────────────────────────────────────────────────

describe("loadScenario — happy paths", () => {
  it("fixture scenario loads without errors", async () => {
    const result = await loadScenario(getFixtureScenarioDir());
    expect(isScenarioLoadError(result)).toBe(false);
  });

  it("returns LoadedScenario with correct id", async () => {
    const result = await loadScenario(getFixtureScenarioDir());
    expect(isScenarioLoadError(result)).toBe(false);
    if (!isScenarioLoadError(result)) {
      expect(result.id).toBe("_fixture");
    }
  });

  it("returns LoadedScenario with correct title", async () => {
    const result = await loadScenario(getFixtureScenarioDir());
    if (!isScenarioLoadError(result)) {
      expect(result.title).toBe("Fixture Scenario");
    }
  });

  it("has at least one persona", async () => {
    const result = await loadScenario(getFixtureScenarioDir());
    if (!isScenarioLoadError(result)) {
      expect(result.personas.length).toBeGreaterThan(0);
      expect(result.personas[0].id).toBe("fixture-persona");
    }
  });

  it("has at least one alarm", async () => {
    const result = await loadScenario(getFixtureScenarioDir());
    if (!isScenarioLoadError(result)) {
      expect(result.alarms.length).toBeGreaterThan(0);
      expect(result.alarms[0].id).toBe("fixture-alarm-001");
    }
  });

  it("wiki page content is loaded into memory (not just a file path)", async () => {
    const result = await loadScenario(getFixtureScenarioDir());
    if (!isScenarioLoadError(result)) {
      // The fixture wiki page has inline content (no body_file) — just verify it's non-empty
      expect(result.wiki.pages.length).toBeGreaterThan(0);
      expect(typeof result.wiki.pages[0].content).toBe("string");
      expect(result.wiki.pages[0].content.length).toBeGreaterThan(0);
    }
  });

  it("LoadedScenario has no metrics field — metrics are session-scoped", async () => {
    const result = await loadScenario(getFixtureScenarioDir());
    if (!isScenarioLoadError(result)) {
      expect(
        (result as unknown as Record<string, unknown>)["metrics"],
      ).toBeUndefined();
    }
  });

  it("camelCase transformation is applied — service_type → serviceType", async () => {
    const result = await loadScenario(getFixtureScenarioDir());
    if (!isScenarioLoadError(result)) {
      expect(result.serviceType).toBe("api");
      expect(
        (result as unknown as Record<string, unknown>)["service_type"],
      ).toBeUndefined();
    }
  });

  it("opsDashboard.focalService has correct name and trafficProfile", async () => {
    const result = await loadScenario(getFixtureScenarioDir());
    if (!isScenarioLoadError(result)) {
      expect(result.opsDashboard.focalService.name).toBe("fixture-service");
      expect(result.opsDashboard.focalService.trafficProfile).toBe(
        "always_on_api",
      );
    }
  });
});

// ── loadScenario — ops_dashboard_file ─────────────────────────────────────────

describe("loadScenario — ops_dashboard_file", () => {
  let tmpDir: string;

  beforeAll(async () => {
    // Build a valid scenario with ops_dashboard_file pointing to a separate file
    const fixtureDir = getFixtureScenarioDir();
    const fixtureSrc = fs.readFileSync(
      path.join(fixtureDir, "scenario.yaml"),
      "utf8",
    );
    const fixtureObj = (await import("js-yaml")).load(fixtureSrc) as Record<
      string,
      unknown
    >;

    // Extract ops_dashboard into a separate file
    const ops = fixtureObj["ops_dashboard"];
    delete fixtureObj["ops_dashboard"];
    fixtureObj["ops_dashboard_file"] = "metrics.yaml";

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oncall-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "scenario.yaml"),
      (await import("js-yaml")).dump(fixtureObj),
    );
    fs.writeFileSync(
      path.join(tmpDir, "metrics.yaml"),
      (await import("js-yaml")).dump(ops),
    );
  });

  it("ops_dashboard_file reference is resolved and merged correctly", async () => {
    const result = await loadScenario(tmpDir);
    if (isScenarioLoadError(result)) {
      console.error(result.errors);
    }
    expect(isScenarioLoadError(result)).toBe(false);
    if (!isScenarioLoadError(result)) {
      expect(result.opsDashboard.focalService.name).toBe("fixture-service");
    }
  });
});

// ── loadScenario — email body_file ────────────────────────────────────────────

describe("loadScenario — email body_file resolution", () => {
  let tmpDir: string;

  beforeAll(async () => {
    const fixtureDir = getFixtureScenarioDir();
    const fixtureSrc = fs.readFileSync(
      path.join(fixtureDir, "scenario.yaml"),
      "utf8",
    );
    const fixtureObj = (await import("js-yaml")).load(fixtureSrc) as Record<
      string,
      unknown
    >;

    // Replace inline body with body_file reference
    const emails = fixtureObj["email"] as Array<Record<string, unknown>>;
    const emailBody = emails[0]["body"] as string;
    emails[0] = { ...emails[0], body: undefined, body_file: "email-body.md" };

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oncall-test-"));
    // Write ops_dashboard inline (required by validator — no ops_dashboard_file)
    fs.writeFileSync(
      path.join(tmpDir, "scenario.yaml"),
      (await import("js-yaml")).dump(fixtureObj),
    );
    fs.writeFileSync(path.join(tmpDir, "email-body.md"), emailBody);
  });

  it("email body_file content is loaded into memory", async () => {
    const result = await loadScenario(tmpDir);
    if (isScenarioLoadError(result)) {
      console.error(result.errors);
    }
    expect(isScenarioLoadError(result)).toBe(false);
    if (!isScenarioLoadError(result)) {
      expect(result.emails[0].body.length).toBeGreaterThan(0);
    }
  });
});

// ── loadScenario — error paths ────────────────────────────────────────────────

describe("loadScenario — error paths", () => {
  it("missing scenario.yaml returns ScenarioLoadError", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oncall-test-"));
    const result = await loadScenario(tmpDir);
    expect(isScenarioLoadError(result)).toBe(true);
    if (isScenarioLoadError(result)) {
      expect(result.errors[0].message).toContain("scenario.yaml");
    }
  });

  it("Zod schema failure returns ScenarioLoadError with field paths", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oncall-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "scenario.yaml"),
      "id: missing-required-fields\n",
    );
    const result = await loadScenario(tmpDir);
    expect(isScenarioLoadError(result)).toBe(true);
    if (isScenarioLoadError(result)) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("cross-reference failure returns ScenarioLoadError with field paths", async () => {
    const fixtureDir = getFixtureScenarioDir();
    const fixtureSrc = fs.readFileSync(
      path.join(fixtureDir, "scenario.yaml"),
      "utf8",
    );
    const fixtureObj = (await import("js-yaml")).load(fixtureSrc) as Record<
      string,
      unknown
    >;
    // Inject a cross-reference error: alarm with bad service
    const alarms = fixtureObj["alarms"] as Array<Record<string, unknown>>;
    alarms[0] = { ...alarms[0], service: "nonexistent-service-xyz" };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oncall-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "scenario.yaml"),
      (await import("js-yaml")).dump(fixtureObj),
    );
    const result = await loadScenario(tmpDir);
    expect(isScenarioLoadError(result)).toBe(true);
    if (isScenarioLoadError(result)) {
      const err = result.errors.find((e) => e.field.includes("service"));
      expect(err).toBeDefined();
    }
  });

  it("ops_dashboard + ops_dashboard_file both present returns error", async () => {
    const fixtureDir = getFixtureScenarioDir();
    const fixtureSrc = fs.readFileSync(
      path.join(fixtureDir, "scenario.yaml"),
      "utf8",
    );
    const fixtureObj = (await import("js-yaml")).load(fixtureSrc) as Record<
      string,
      unknown
    >;
    // Keep ops_dashboard and add ops_dashboard_file
    fixtureObj["ops_dashboard_file"] = "metrics.yaml";

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oncall-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "scenario.yaml"),
      (await import("js-yaml")).dump(fixtureObj),
    );
    const result = await loadScenario(tmpDir);
    expect(isScenarioLoadError(result)).toBe(true);
    if (isScenarioLoadError(result)) {
      expect(
        result.errors.find((e) => e.field === "ops_dashboard_file"),
      ).toBeDefined();
    }
  });

  it("path traversal in file reference returns error", async () => {
    const fixtureDir = getFixtureScenarioDir();
    const fixtureSrc = fs.readFileSync(
      path.join(fixtureDir, "scenario.yaml"),
      "utf8",
    );
    const fixtureObj = (await import("js-yaml")).load(fixtureSrc) as Record<
      string,
      unknown
    >;
    const wiki = fixtureObj["wiki"] as {
      pages: Array<Record<string, unknown>>;
    };
    wiki.pages[0] = {
      ...wiki.pages[0],
      content: undefined,
      content_file: "../../etc/passwd",
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oncall-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "scenario.yaml"),
      (await import("js-yaml")).dump(fixtureObj),
    );
    const result = await loadScenario(tmpDir);
    expect(isScenarioLoadError(result)).toBe(true);
    if (isScenarioLoadError(result)) {
      expect(
        result.errors.find((e) => e.message.includes("traversal")),
      ).toBeDefined();
    }
  });

  it("missing referenced file returns error", async () => {
    const fixtureDir = getFixtureScenarioDir();
    const fixtureSrc = fs.readFileSync(
      path.join(fixtureDir, "scenario.yaml"),
      "utf8",
    );
    const fixtureObj = (await import("js-yaml")).load(fixtureSrc) as Record<
      string,
      unknown
    >;
    const wiki = fixtureObj["wiki"] as {
      pages: Array<Record<string, unknown>>;
    };
    wiki.pages[0] = {
      ...wiki.pages[0],
      content: undefined,
      content_file: "ghost-file.md",
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oncall-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "scenario.yaml"),
      (await import("js-yaml")).dump(fixtureObj),
    );
    const result = await loadScenario(tmpDir);
    expect(isScenarioLoadError(result)).toBe(true);
    if (isScenarioLoadError(result)) {
      expect(
        result.errors.find((e) => e.message.includes("ghost-file.md")),
      ).toBeDefined();
    }
  });
});

// ── loadAllScenarios ──────────────────────────────────────────────────────────

describe("loadAllScenarios", () => {
  it("returns empty map for empty directory", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oncall-test-"));
    const map = await loadAllScenarios(tmpDir);
    expect(map.size).toBe(0);
  });

  it("returns empty map for nonexistent directory (no throw)", async () => {
    const map = await loadAllScenarios("/nonexistent/path/to/scenarios");
    expect(map.size).toBe(0);
  });

  it("skips _fixture directory", async () => {
    // The scenarios/ dir has _fixture/ — it should never appear in the map
    const scenariosDir = path.resolve(getFixtureScenarioDir(), "..");
    const map = await loadAllScenarios(scenariosDir);
    expect(map.has("_fixture")).toBe(false);
  });

  it("valid scenario added to map, invalid excluded", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oncall-test-"));
    // Create a valid scenario dir by copying the fixture
    const validDir = path.join(tmpDir, "valid-scenario");
    fs.mkdirSync(validDir);
    const fixtureSrc = fs.readFileSync(
      path.join(getFixtureScenarioDir(), "scenario.yaml"),
      "utf8",
    );
    const fixtureObj = (await import("js-yaml")).load(fixtureSrc) as Record<
      string,
      unknown
    >;
    fixtureObj["id"] = "valid-scenario";
    fs.writeFileSync(
      path.join(validDir, "scenario.yaml"),
      (await import("js-yaml")).dump(fixtureObj),
    );

    // Create an invalid scenario dir
    const invalidDir = path.join(tmpDir, "invalid-scenario");
    fs.mkdirSync(invalidDir);
    fs.writeFileSync(path.join(invalidDir, "scenario.yaml"), "id: broken\n");

    const map = await loadAllScenarios(tmpDir);
    expect(map.has("valid-scenario")).toBe(true);
    expect(map.has("invalid-scenario")).toBe(false);
  });
});

// ── toScenarioSummary ─────────────────────────────────────────────────────────

describe("toScenarioSummary", () => {
  it("returns only picker-screen fields", async () => {
    const result = await loadScenario(getFixtureScenarioDir());
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
    const result = await loadScenario(getFixtureScenarioDir());
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
      scenarioDir: "/tmp/test",
      errors: [{ scenarioId: "test", field: "x", message: "y" }],
    };
    expect(isScenarioLoadError(err)).toBe(true);
  });

  it("correctly identifies a LoadedScenario (not an error)", async () => {
    const result = await loadScenario(getFixtureScenarioDir());
    expect(isScenarioLoadError(result)).toBe(false);
  });
});

// ── resolved_value transform ───────────────────────────────────────────────────

describe("loadScenario — resolved_value metric field transform", () => {
  it("resolvedValue is undefined when resolved_value is omitted", async () => {
    const result = await loadScenario(getFixtureScenarioDir());
    expect(isScenarioLoadError(result)).toBe(false);
    if (!isScenarioLoadError(result)) {
      const metric = result.opsDashboard.focalService.metrics[0];
      expect(metric.resolvedValue).toBeUndefined();
    }
  });

  it("resolvedValue is populated when resolved_value is present in YAML", async () => {
    // Write a temp scenario dir with resolved_value in the metric config.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oncall-test-"));
    const fixtureYaml = fs.readFileSync(
      path.join(getFixtureScenarioDir(), "scenario.yaml"),
      "utf8",
    );
    // Inject resolved_value: 520 into the first metric line
    const modified = fixtureYaml.replace(
      /archetype:\s*error_rate/,
      "archetype: error_rate\n        resolved_value: 520",
    );
    fs.writeFileSync(path.join(tmpDir, "scenario.yaml"), modified);
    // Copy mock-llm-responses.yaml
    fs.copyFileSync(
      path.join(getFixtureScenarioDir(), "mock-llm-responses.yaml"),
      path.join(tmpDir, "mock-llm-responses.yaml"),
    );
    const result = await loadScenario(tmpDir);
    fs.rmSync(tmpDir, { recursive: true });
    expect(isScenarioLoadError(result)).toBe(false);
    if (!isScenarioLoadError(result)) {
      const metric = result.opsDashboard.focalService.metrics[0];
      expect(metric.resolvedValue).toBe(520);
    }
  });
});
