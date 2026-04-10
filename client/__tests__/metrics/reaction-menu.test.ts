/**
 * Tests for reaction-menu.ts (templated design) and the updated
 * select_metric_reaction tool + engine behavior.
 */

import { describe, it, expect, vi } from "vitest";
import { buildReactionTemplate } from "../../src/metrics/reaction-menu";
import type { AuditEntry } from "@shared/types/events";
import type { LoadedScenario } from "../../src/scenario/types";
import { buildLoadedScenario } from "../../src/testutil/index";
import { generateAllMetrics } from "../../src/metrics/generator";
import { createMetricStore } from "../../src/metrics/metric-store";
import type { ResolvedMetricParams } from "../../src/metrics/types";

function makeScenario(overrides: Partial<LoadedScenario> = {}): LoadedScenario {
  return buildLoadedScenario(overrides);
}

function makeEntry(action: string, simTime = 60): AuditEntry {
  return { action: action as AuditEntry["action"], params: {}, simTime };
}

function makeRpWithIncident(
  metricId: string,
  overrides: Partial<ResolvedMetricParams> = {},
): ResolvedMetricParams {
  return {
    metricId,
    service: "fixture-service",
    archetype: metricId,
    label: metricId,
    unit: "",
    fromSecond: -300,
    toSecond: 900,
    resolutionSeconds: 15,
    baselineValue: 1,
    resolvedValue: 1,
    rhythmProfile: "none",
    inheritsRhythm: false,
    noiseType: "none",
    noiseLevelMultiplier: 1,
    overlayApplications: [
      {
        overlay: "spike_and_sustain" as const,
        onsetSecond: 0,
        peakValue: 10,
        dropFactor: 10,
        ceiling: 10,
        rampDurationSeconds: 0,
        saturationDurationSeconds: 60,
      },
    ],
    overlay: "none",
    onsetSecond: 0,
    peakValue: 10,
    dropFactor: 1,
    ceiling: 10,
    saturationDurationSeconds: 60,
    rampDurationSeconds: 0,
    seriesOverride: null,
    seed: 42,
    ...overrides,
  };
}

// ── buildReactionTemplate — invariants ────────────────────────────────────────

describe("buildReactionTemplate — structure", () => {
  it("always returns exactly 4 hints", () => {
    const scenario = makeScenario();
    const { series, resolvedParams } = generateAllMetrics(scenario, "s");
    const store = createMetricStore(series, resolvedParams);

    const template = buildReactionTemplate(
      [makeEntry("trigger_rollback")],
      scenario,
      store,
      60,
    );
    expect(template.hints).toHaveLength(4);
  });

  it("hints have outcomes: full_recovery, partial_recovery, worsening, no_effect", () => {
    const scenario = makeScenario();
    const { series, resolvedParams } = generateAllMetrics(scenario, "s");
    const store = createMetricStore(series, resolvedParams);

    const template = buildReactionTemplate(
      [makeEntry("trigger_rollback")],
      scenario,
      store,
      60,
    );
    const outcomes = template.hints.map((h) => h.outcome);
    expect(outcomes).toContain("full_recovery");
    expect(outcomes).toContain("partial_recovery");
    expect(outcomes).toContain("worsening");
    expect(outcomes).toContain("no_effect");
  });

  it("primaryActionType is set to the last action's type", () => {
    const scenario = makeScenario();
    const { series, resolvedParams } = generateAllMetrics(scenario, "s");
    const store = createMetricStore(series, resolvedParams);

    const template = buildReactionTemplate(
      [makeEntry("trigger_rollback", 50), makeEntry("scale_cluster", 55)],
      scenario,
      store,
      60,
    );
    expect(template.primaryActionType).toBe("scale_cluster");
  });

  it("activeMetrics is empty when no incidents are active", () => {
    const scenario = makeScenario();
    const { series, resolvedParams } = generateAllMetrics(scenario, "s");
    for (const svcParams of Object.values(resolvedParams)) {
      for (const rp of Object.values(svcParams)) {
        rp.overlayApplications = [];
      }
    }
    const store = createMetricStore(series, resolvedParams);

    const template = buildReactionTemplate(
      [makeEntry("trigger_rollback")],
      scenario,
      store,
      60,
    );
    expect(template.activeMetrics).toHaveLength(0);
  });

  it("activeMetrics contains all metrics with active incident overlays", () => {
    const scenario = makeScenario();
    const store = createMetricStore(
      { "fixture-service": { error_rate: [], cpu_utilization: [] } },
      {
        "fixture-service": {
          error_rate: makeRpWithIncident("error_rate"),
          cpu_utilization: makeRpWithIncident("cpu_utilization"),
        },
      },
    );

    const template = buildReactionTemplate(
      [makeEntry("trigger_rollback")],
      scenario,
      store,
      60,
    );
    const metricIds = template.activeMetrics.map((m) => m.metricId);
    expect(metricIds).toContain("error_rate");
    expect(metricIds).toContain("cpu_utilization");
  });

  it("all actions passed in appear in template.actions", () => {
    const scenario = makeScenario();
    const { series, resolvedParams } = generateAllMetrics(scenario, "s");
    const store = createMetricStore(series, resolvedParams);

    const actions = [
      makeEntry("trigger_rollback", 50),
      makeEntry("restart_service", 52),
      makeEntry("scale_cluster", 55),
    ];
    const template = buildReactionTemplate(actions, scenario, store, 60);
    expect(template.actions).toHaveLength(3);
    expect(template.actions.map((a) => a.action)).toContain("restart_service");
  });
});

// ── Hint derivation ───────────────────────────────────────────────────────────

describe("buildReactionTemplate — hints", () => {
  it("rollback action hints suggest cliff pattern", () => {
    const scenario = makeScenario();
    const { series, resolvedParams } = generateAllMetrics(scenario, "s");
    const store = createMetricStore(series, resolvedParams);

    const template = buildReactionTemplate(
      [makeEntry("trigger_rollback")],
      scenario,
      store,
      60,
    );
    const fullHint = template.hints.find((h) => h.outcome === "full_recovery")!;
    expect(fullHint.suggestedPattern).toBe("cliff");
    expect(fullHint.suggestedSpeed).toBe("1m");
  });

  it("scale_cluster action hints suggest smooth_decay at 5m", () => {
    const scenario = makeScenario();
    const { series, resolvedParams } = generateAllMetrics(scenario, "s");
    const store = createMetricStore(series, resolvedParams);

    const template = buildReactionTemplate(
      [makeEntry("scale_cluster")],
      scenario,
      store,
      60,
    );
    const fullHint = template.hints.find((h) => h.outcome === "full_recovery")!;
    expect(fullHint.suggestedPattern).toBe("smooth_decay");
    expect(fullHint.suggestedSpeed).toBe("5m");
  });

  it("throttle_traffic hints suggest stepped pattern", () => {
    const scenario = makeScenario();
    const { series, resolvedParams } = generateAllMetrics(scenario, "s");
    const store = createMetricStore(series, resolvedParams);

    const template = buildReactionTemplate(
      [makeEntry("throttle_traffic")],
      scenario,
      store,
      60,
    );
    const fullHint = template.hints.find((h) => h.outcome === "full_recovery")!;
    expect(fullHint.suggestedPattern).toBe("stepped");
  });
});

// ── tool definition ───────────────────────────────────────────────────────────

describe("getMetricReactionTools — select_metric_reaction schema", () => {
  it("returns tool when enabled in scenario", async () => {
    const { getMetricReactionTools } =
      await import("../../src/llm/tool-definitions");
    const scenario = makeScenario({
      engine: {
        tickIntervalSeconds: 15,
        defaultTab: "email",
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
    });
    const tools = getMetricReactionTools(scenario);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("select_metric_reaction");
  });

  it("outcome has all four values (inside metric_reactions items)", async () => {
    const { getMetricReactionTools } =
      await import("../../src/llm/tool-definitions");
    const scenario = makeScenario({
      engine: {
        tickIntervalSeconds: 15,
        defaultTab: "email",
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
    });
    const tools = getMetricReactionTools(scenario);
    const items = (
      tools[0].parameters as {
        properties: {
          metric_reactions: {
            items: { properties: Record<string, { enum?: string[] }> };
          };
        };
      }
    ).properties.metric_reactions.items;
    expect(items.properties.outcome.enum).toContain("full_recovery");
    expect(items.properties.outcome.enum).toContain("partial_recovery");
    expect(items.properties.outcome.enum).toContain("worsening");
    expect(items.properties.outcome.enum).toContain("no_effect");
  });

  it("pattern, speed are present in metric_reactions items (scope removed — superseded by per-metric design)", async () => {
    const { getMetricReactionTools } =
      await import("../../src/llm/tool-definitions");
    const scenario = makeScenario({
      engine: {
        tickIntervalSeconds: 15,
        defaultTab: "email",
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
    });
    const tools = getMetricReactionTools(scenario);
    const items = (
      tools[0].parameters as {
        properties: {
          metric_reactions: { items: { properties: Record<string, unknown> } };
        };
      }
    ).properties.metric_reactions.items;
    expect(items.properties).toHaveProperty("pattern");
    expect(items.properties).toHaveProperty("speed");
    // scope is no longer needed — the LLM specifies metric_id per entry
    expect(items.properties).not.toHaveProperty("scope");
  });
});

// ── engine behavior ───────────────────────────────────────────────────────────

describe("metric-reaction-engine — select_metric_reaction (templated)", () => {
  function makeEngine(overrides: Partial<LoadedScenario> = {}) {
    const scenario = makeScenario({
      engine: {
        tickIntervalSeconds: 15,
        defaultTab: "email",
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
      ...overrides,
    });
    const store = createMetricStore(
      { "fixture-service": { error_rate: [] } },
      { "fixture-service": { error_rate: makeRpWithIncident("error_rate") } },
    );
    return { scenario, store };
  }

  function makeCtx(scenario: LoadedScenario) {
    return {
      sessionId: "s",
      scenario,
      simTime: 60,
      auditLog: [
        { action: "trigger_rollback" as const, params: {}, simTime: 55 },
      ],
      simState: {
        emails: [],
        chatChannels: {},
        tickets: [],
        ticketComments: {},
        logs: [],
        alarms: [],
        deployments: {},
        pipelines: [],
        pages: [],
        throttles: [],
      },
      personaCooldowns: {},
      directlyAddressed: new Set<string>(),
      metricSummary: { simTime: 60, narratives: [] },
      triggeredByAction: true,
    };
  }

  it("LLM is not called when no incident metrics are active", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const scenario = makeScenario({
      engine: {
        tickIntervalSeconds: 15,
        defaultTab: "email",
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
    });
    const { series, resolvedParams } = generateAllMetrics(scenario, "s");
    for (const svcP of Object.values(resolvedParams)) {
      for (const rp of Object.values(svcP)) rp.overlayApplications = [];
    }
    const store = createMetricStore(series, resolvedParams);
    const mockLLM = { call: vi.fn() };

    const engine = createMetricReactionEngine(
      () => mockLLM,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeCtx(scenario));
    expect(mockLLM.call).not.toHaveBeenCalled();
  });

  it("full_recovery outcome → applyActiveOverlay called with targetValue = resolvedValue", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeEngine();
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const mockLLM = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                {
                  metric_id: "error_rate",
                  outcome: "full_recovery",
                  pattern: "smooth_decay",
                  speed: "5m",
                },
              ],
            },
          },
        ],
      }),
    };

    const { createMetricReactionEngine: cre } =
      await import("../../src/engine/metric-reaction-engine");
    const engine = cre(
      () => mockLLM,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeCtx(scenario));

    expect(applySpy).toHaveBeenCalled();
    expect(applySpy.mock.calls[0][2].targetValue).toBeCloseTo(1, 3); // resolvedValue
    expect(applySpy.mock.calls[0][2].pattern).toBe("smooth_decay");
    expect(applySpy.mock.calls[0][2].speedSeconds).toBe(300);
  });

  it("no_effect outcome → applyActiveOverlay not called", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeEngine();
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const mockLLM = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                {
                  metric_id: "error_rate",
                  outcome: "no_effect",
                  pattern: "smooth_decay",
                },
              ],
            },
          },
        ],
      }),
    };

    const engine = createMetricReactionEngine(
      () => mockLLM,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeCtx(scenario));

    expect(mockLLM.call).toHaveBeenCalled();
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("scope restricts which metrics receive the overlay", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const scenario = makeScenario({
      engine: {
        tickIntervalSeconds: 15,
        defaultTab: "email",
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
    });
    const store = createMetricStore(
      { "fixture-service": { error_rate: [], cpu_utilization: [] } },
      {
        "fixture-service": {
          error_rate: makeRpWithIncident("error_rate"),
          cpu_utilization: makeRpWithIncident("cpu_utilization"),
        },
      },
    );
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const mockLLM = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                {
                  metric_id: "error_rate",
                  outcome: "full_recovery",
                  pattern: "cliff",
                },
                // cpu_utilization intentionally omitted — implicit no_effect
              ],
            },
          },
        ],
      }),
    };

    const engine = createMetricReactionEngine(
      () => mockLLM,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeCtx(scenario));

    const affected = applySpy.mock.calls.map((c) => c[1]);
    expect(affected).toContain("error_rate");
    expect(affected).not.toContain("cpu_utilization");
  });
});
