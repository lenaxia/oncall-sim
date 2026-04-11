import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { generateAllMetrics } from "../../src/metrics/generator";
import {
  getFixtureScenario,
  clearFixtureCache,
} from "../../src/testutil/index";
import type { LoadedScenario } from "../../src/scenario/types";

let _fixture: LoadedScenario;

beforeAll(async () => {
  _fixture = await getFixtureScenario();
});

beforeEach(() => clearFixtureCache());

describe("generateAllMetrics with fixture scenario", () => {
  it("returns series for focal service metrics", () => {
    const { series } = generateAllMetrics(_fixture, "session-1");
    expect(series["fixture-service"]).toBeDefined();
    expect(series["fixture-service"]["error_rate"]).toBeDefined();
    expect(series["fixture-service"]["error_rate"].length).toBeGreaterThan(0);
  });

  it("series length = pre_incident_seconds / 60 + 1 (t <= 0, 1-minute resolution)", () => {
    const { series } = generateAllMetrics(_fixture, "session-1");
    const { preIncidentSeconds } = _fixture.opsDashboard;
    const expectedLength = Math.floor(preIncidentSeconds / 60) + 1;
    const s = series["fixture-service"]["error_rate"];
    expect(s.length).toBe(expectedLength);
  });

  it("all t values within expected range (t <= 0 only)", () => {
    const { series } = generateAllMetrics(_fixture, "session-1");
    const { preIncidentSeconds } = _fixture.opsDashboard;
    const s = series["fixture-service"]["error_rate"];
    s.forEach(({ t }) => {
      expect(t).toBeGreaterThanOrEqual(-preIncidentSeconds);
      expect(t).toBeLessThanOrEqual(0);
    });
  });

  it("same sessionId -> identical series (PRNG determinism)", () => {
    const a = generateAllMetrics(_fixture, "session-same");
    const b = generateAllMetrics(_fixture, "session-same");
    expect(a.series["fixture-service"]["error_rate"]).toEqual(
      b.series["fixture-service"]["error_rate"],
    );
  });

  it("different sessionId -> different series", () => {
    const a = generateAllMetrics(_fixture, "session-A");
    const b = generateAllMetrics(_fixture, "session-B");
    const seriesA = a.series["fixture-service"]["error_rate"].map((p) => p.v);
    const seriesB = b.series["fixture-service"]["error_rate"].map((p) => p.v);
    expect(seriesA.every((v, i) => v === seriesB[i])).toBe(false);
  });

  it("all v values are non-negative (clamping works)", () => {
    const { series } = generateAllMetrics(_fixture, "session-clamp");
    for (const service of Object.values(series)) {
      for (const s of Object.values(service)) {
        s.forEach(({ v }) => expect(v).toBeGreaterThanOrEqual(0));
      }
    }
  });

  it("returns series for all correlated services", () => {
    const withCorrelated = {
      ..._fixture,
      opsDashboard: {
        ..._fixture.opsDashboard,
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
    const modified = {
      ..._fixture,
      opsDashboard: {
        ..._fixture.opsDashboard,
        focalService: {
          ..._fixture.opsDashboard.focalService,
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
      modified as typeof _fixture,
      "session-override",
    );
    const s = series["fixture-service"]["error_rate"];
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual({ t: -15, v: 99 });
    expect(s[1]).toEqual({ t: 0, v: 98 });
  });
});

describe("generateAllMetrics - resolvedParams", () => {
  it("returns resolvedParams for all focal service metrics", () => {
    const { resolvedParams } = generateAllMetrics(_fixture, "session-1");
    expect(resolvedParams["fixture-service"]).toBeDefined();
    expect(resolvedParams["fixture-service"]["error_rate"]).toBeDefined();
  });

  it("resolvedParams keys match series keys", () => {
    const { series, resolvedParams } = generateAllMetrics(
      _fixture,
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
    const { resolvedParams } = generateAllMetrics(_fixture, "session-1");
    const params = resolvedParams["fixture-service"]["error_rate"];
    expect(params.resolvedValue).toBe(params.baselineValue);
  });

  it("resolvedParams resolvedValue equals authored resolved_value when present", () => {
    const modified = {
      ..._fixture,
      opsDashboard: {
        ..._fixture.opsDashboard,
        focalService: {
          ..._fixture.opsDashboard.focalService,
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
