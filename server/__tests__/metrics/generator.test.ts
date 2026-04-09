import { describe, it, expect, beforeEach } from "vitest";
import { generateAllMetrics } from "../../src/metrics/generator";
import {
  getFixtureScenario,
  clearFixtureCache,
} from "../../src/testutil/index";

beforeEach(() => clearFixtureCache());

describe("generateAllMetrics with fixture scenario", () => {
  it("returns series for focal service metrics", () => {
    const scenario = getFixtureScenario();
    const { series } = generateAllMetrics(scenario, "session-1");
    expect(series["fixture-service"]).toBeDefined();
    expect(series["fixture-service"]["error_rate"]).toBeDefined();
    expect(series["fixture-service"]["error_rate"].length).toBeGreaterThan(0);
  });

  it("series length = pre_incident_seconds / resolution_seconds + 1 (t <= 0 only)", () => {
    const scenario = getFixtureScenario();
    const { series } = generateAllMetrics(scenario, "session-1");
    const { preIncidentSeconds } = scenario.opsDashboard;
    const resolutionSeconds = 15;
    // Only t <= 0 points: from -preIncidentSeconds to 0
    const expectedLength =
      Math.floor(preIncidentSeconds / resolutionSeconds) + 1;
    const s = series["fixture-service"]["error_rate"];
    expect(s.length).toBe(expectedLength);
  });

  it("all t values within expected range (t <= 0 only)", () => {
    const scenario = getFixtureScenario();
    const { series } = generateAllMetrics(scenario, "session-1");
    const { preIncidentSeconds } = scenario.opsDashboard;
    const s = series["fixture-service"]["error_rate"];
    s.forEach(({ t }) => {
      expect(t).toBeGreaterThanOrEqual(-preIncidentSeconds);
      expect(t).toBeLessThanOrEqual(0);
    });
  });

  it("same sessionId → identical series (PRNG determinism)", () => {
    const scenario = getFixtureScenario();
    const a = generateAllMetrics(scenario, "session-same");
    const b = generateAllMetrics(scenario, "session-same");
    const seriesA = a.series["fixture-service"]["error_rate"];
    const seriesB = b.series["fixture-service"]["error_rate"];
    expect(seriesA).toEqual(seriesB);
  });

  it("different sessionId → different series", () => {
    const scenario = getFixtureScenario();
    const a = generateAllMetrics(scenario, "session-A");
    const b = generateAllMetrics(scenario, "session-B");
    const seriesA = a.series["fixture-service"]["error_rate"].map((p) => p.v);
    const seriesB = b.series["fixture-service"]["error_rate"].map((p) => p.v);
    const allSame = seriesA.every((v, i) => v === seriesB[i]);
    expect(allSame).toBe(false);
  });

  it("all v values are non-negative (clamping works)", () => {
    const scenario = getFixtureScenario();
    const { series } = generateAllMetrics(scenario, "session-clamp");
    for (const service of Object.values(series)) {
      for (const s of Object.values(service)) {
        s.forEach(({ v }) => expect(v).toBeGreaterThanOrEqual(0));
      }
    }
  });

  it("returns series for all correlated services", () => {
    const scenario = getFixtureScenario();
    const withCorrelated = {
      ...scenario,
      opsDashboard: {
        ...scenario.opsDashboard,
        correlatedServices: [
          {
            name: "downstream-service",
            correlation: "exonerated" as const,
            health: "healthy" as const,
          },
        ],
      },
    };
    const { series } = generateAllMetrics(withCorrelated, "session-1");
    expect(series["downstream-service"]).toBeDefined();
    expect(Object.keys(series["downstream-service"]).length).toBeGreaterThan(0);
  });

  it("series_override bypasses generation layers", () => {
    const scenario = getFixtureScenario();
    const modified = {
      ...scenario,
      opsDashboard: {
        ...scenario.opsDashboard,
        focalService: {
          ...scenario.opsDashboard.focalService,
          metrics: [
            {
              archetype: "error_rate",
              seriesOverride: [
                { t: -15, v: 99 },
                { t: 0, v: 98 },
              ],
            },
          ],
        },
      },
    };
    const { series } = generateAllMetrics(
      modified as typeof scenario,
      "session-override",
    );
    const s = series["fixture-service"]["error_rate"];
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual({ t: -15, v: 99 });
    expect(s[1]).toEqual({ t: 0, v: 98 });
  });
});

// ── resolvedParams return value ───────────────────────────────────────────────

describe("generateAllMetrics — resolvedParams", () => {
  it("returns resolvedParams for all focal service metrics", () => {
    const scenario = getFixtureScenario();
    const { resolvedParams } = generateAllMetrics(scenario, "session-1");
    expect(resolvedParams["fixture-service"]).toBeDefined();
    expect(resolvedParams["fixture-service"]["error_rate"]).toBeDefined();
  });

  it("resolvedParams keys match series keys", () => {
    const scenario = getFixtureScenario();
    const { series, resolvedParams } = generateAllMetrics(
      scenario,
      "session-1",
    );
    for (const service of Object.keys(series)) {
      expect(resolvedParams[service]).toBeDefined();
      for (const metricId of Object.keys(series[service])) {
        expect(resolvedParams[service][metricId]).toBeDefined();
      }
    }
  });

  it("resolvedParams resolvedValue equals baselineValue when resolved_value not authored", () => {
    const scenario = getFixtureScenario();
    const { resolvedParams } = generateAllMetrics(scenario, "session-1");
    const params = resolvedParams["fixture-service"]["error_rate"];
    expect(params.resolvedValue).toBe(params.baselineValue);
  });

  it("resolvedParams resolvedValue equals authored resolved_value when present", () => {
    const scenario = getFixtureScenario();
    const modified = {
      ...scenario,
      opsDashboard: {
        ...scenario.opsDashboard,
        focalService: {
          ...scenario.opsDashboard.focalService,
          metrics: [
            { archetype: "error_rate", baselineValue: 1.0, resolvedValue: 520 },
          ],
        },
      },
    };
    const { resolvedParams } = generateAllMetrics(modified, "session-1");
    expect(resolvedParams["fixture-service"]["error_rate"].resolvedValue).toBe(
      520,
    );
  });
});
