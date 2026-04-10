/**
 * Tests for the templated reaction menu — updated for per-metric reactions.
 * The LLM now returns metric_reactions[] with one entry per affected metric.
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
  return buildLoadedScenario({
    engine: {
      tickIntervalSeconds: 15,
      defaultTab: "email",
      llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
    },
    ...overrides,
  });
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

function makeStoreWithIncident(metricId = "error_rate") {
  const scenario = makeScenario();
  const store = createMetricStore(
    { "fixture-service": { [metricId]: [] } },
    { "fixture-service": { [metricId]: makeRpWithIncident(metricId) } },
  );
  return { scenario, store };
}

function makeCtx(scenario: LoadedScenario, overrides = {}) {
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
    ...overrides,
  };
}

// ── Tool schema ───────────────────────────────────────────────────────────────

describe("select_metric_reaction tool schema", () => {
  it("required field is metric_reactions (array)", async () => {
    const { getMetricReactionTools } =
      await import("../../src/llm/tool-definitions");
    const { scenario } = makeStoreWithIncident();
    const tools = getMetricReactionTools(scenario);
    const params = tools[0].parameters as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(params.required).toContain("metric_reactions");
    expect(params.properties).toHaveProperty("metric_reactions");
  });

  it("items in metric_reactions have outcome, pattern, speed, magnitude, sustained", async () => {
    const { getMetricReactionTools } =
      await import("../../src/llm/tool-definitions");
    const { scenario } = makeStoreWithIncident();
    const tools = getMetricReactionTools(scenario);
    const params = tools[0].parameters as {
      properties: {
        metric_reactions: {
          items: {
            required: string[];
            properties: Record<string, { type: string; enum?: string[] }>;
          };
        };
      };
    };
    const items = params.properties.metric_reactions.items;
    expect(items.required).toContain("metric_id");
    expect(items.required).toContain("outcome");
    expect(items.properties.outcome.enum).toContain("full_recovery");
    expect(items.properties.outcome.enum).toContain("partial_recovery");
    expect(items.properties.outcome.enum).toContain("worsening");
    expect(items.properties.outcome.enum).toContain("no_effect");
    expect(items.properties.pattern.enum).toContain("smooth_decay");
    expect(items.properties.pattern.enum).toContain("cliff");
    expect(items.properties).toHaveProperty("speed");
    expect(items.properties).toHaveProperty("magnitude");
    expect(items.properties).toHaveProperty("sustained");
    expect(items.properties).toHaveProperty("oscillating_mode");
    expect(items.properties).toHaveProperty("cycle_seconds");
  });

  it("top-level outcome/pattern/speed are NOT required", async () => {
    const { getMetricReactionTools } =
      await import("../../src/llm/tool-definitions");
    const { scenario } = makeStoreWithIncident();
    const tools = getMetricReactionTools(scenario);
    const params = tools[0].parameters as { required: string[] };
    expect(params.required).not.toContain("outcome");
    expect(params.required).not.toContain("pattern");
    expect(params.required).not.toContain("speed");
  });
});

// ── Engine behavior — per-metric dispatch ─────────────────────────────────────

describe("select_metric_reaction — engine per-metric dispatch", () => {
  it("full_recovery with smooth_decay applies smooth decay overlay to specified metric", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithIncident("error_rate");
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
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

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeCtx(scenario));

    expect(applySpy).toHaveBeenCalled();
    const overlay = applySpy.mock.calls[0][2];
    expect(overlay.pattern).toBe("smooth_decay");
    expect(overlay.speedSeconds).toBe(300);
    expect(overlay.targetValue).toBeCloseTo(1, 3); // resolvedValue
  });

  it("full_recovery with cliff applies cliff overlay", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithIncident("error_rate");
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
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
                  speed: "1m",
                },
              ],
            },
          },
        ],
      }),
    };

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeCtx(scenario));

    expect(applySpy).toHaveBeenCalled();
    expect(applySpy.mock.calls[0][2].pattern).toBe("cliff");
    expect(applySpy.mock.calls[0][2].speedSeconds).toBe(60);
  });

  it("partial_recovery targets midpoint", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithIncident("error_rate");
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                {
                  metric_id: "error_rate",
                  outcome: "partial_recovery",
                  pattern: "smooth_decay",
                  speed: "15m",
                },
              ],
            },
          },
        ],
      }),
    };

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeCtx(scenario));

    expect(applySpy).toHaveBeenCalled();
    expect(applySpy.mock.calls[0][2].speedSeconds).toBe(900);
  });

  it("worsening targets above current value", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithIncident("error_rate");
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                {
                  metric_id: "error_rate",
                  outcome: "worsening",
                  pattern: "blip_then_decay",
                  speed: "5m",
                },
              ],
            },
          },
        ],
      }),
    };

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeCtx(scenario));

    expect(applySpy).toHaveBeenCalled();
    const current =
      store.getCurrentValue("fixture-service", "error_rate", 60) ?? 1;
    expect(applySpy.mock.calls[0][2].targetValue).toBeGreaterThan(current);
  });

  it("no_effect — applyActiveOverlay not called", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithIncident("error_rate");
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
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
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeCtx(scenario));

    expect(llm.call).toHaveBeenCalled();
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("no active incident metrics — LLM not called", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const scenario = makeScenario();
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
});

// ── Magnitude, sustained, oscillating ────────────────────────────────────────

describe("select_metric_reaction — magnitude, sustained, oscillating (per-metric)", () => {
  it("partial_recovery magnitude=0.2 targets 20% toward resolved", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithIncident("error_rate");
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                {
                  metric_id: "error_rate",
                  outcome: "partial_recovery",
                  pattern: "smooth_decay",
                  magnitude: 0.2,
                },
              ],
            },
          },
        ],
      }),
    };

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeCtx(scenario));

    const rp = store.getResolvedParams("fixture-service", "error_rate")!;
    const current =
      store.getCurrentValue("fixture-service", "error_rate", 60) ??
      rp.baselineValue;
    const expected = current + (rp.resolvedValue - current) * 0.2;
    expect(applySpy.mock.calls[0][2].targetValue).toBeCloseTo(expected, 2);
  });

  it("worsening magnitude=0.3 targets 30% toward peak", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithIncident("error_rate");
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                {
                  metric_id: "error_rate",
                  outcome: "worsening",
                  pattern: "blip_then_decay",
                  magnitude: 0.3,
                },
              ],
            },
          },
        ],
      }),
    };

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeCtx(scenario));

    const rp = store.getResolvedParams("fixture-service", "error_rate")!;
    const current =
      store.getCurrentValue("fixture-service", "error_rate", 60) ??
      rp.baselineValue;
    const expected = current + (rp.peakValue - current) * 0.3;
    expect(applySpy.mock.calls[0][2].targetValue).toBeCloseTo(expected, 2);
  });

  it("magnitude omitted → defaults to 0.5 for partial_recovery", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithIncident("error_rate");
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                {
                  metric_id: "error_rate",
                  outcome: "partial_recovery",
                  pattern: "smooth_decay",
                },
              ],
            },
          },
        ],
      }),
    };

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeCtx(scenario));

    const rp = store.getResolvedParams("fixture-service", "error_rate")!;
    const current =
      store.getCurrentValue("fixture-service", "error_rate", 60) ??
      rp.baselineValue;
    const expected = current + (rp.resolvedValue - current) * 0.5;
    expect(applySpy.mock.calls[0][2].targetValue).toBeCloseTo(expected, 2);
  });

  it("sustained=false passed through", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithIncident("error_rate");
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                {
                  metric_id: "error_rate",
                  outcome: "partial_recovery",
                  pattern: "smooth_decay",
                  sustained: false,
                },
              ],
            },
          },
        ],
      }),
    };

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeCtx(scenario));
    expect(applySpy.mock.calls[0][2].sustained).toBe(false);
  });

  it("oscillating passes oscillating_mode and cycle_seconds", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithIncident("error_rate");
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                {
                  metric_id: "error_rate",
                  outcome: "worsening",
                  pattern: "oscillating",
                  oscillating_mode: "sustained",
                  cycle_seconds: 90,
                },
              ],
            },
          },
        ],
      }),
    };

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeCtx(scenario));
    expect(applySpy.mock.calls[0][2].oscillationMode).toBe("sustained");
    expect(applySpy.mock.calls[0][2].cycleSeconds).toBe(90);
  });

  it("oscillating defaults: damping, 60s", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithIncident("error_rate");
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                {
                  metric_id: "error_rate",
                  outcome: "partial_recovery",
                  pattern: "oscillating",
                },
              ],
            },
          },
        ],
      }),
    };

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeCtx(scenario));
    expect(applySpy.mock.calls[0][2].oscillationMode).toBe("damping");
    expect(applySpy.mock.calls[0][2].cycleSeconds).toBe(60);
  });

  it("applyActiveOverlay startSimTime matches getSimTime()", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithIncident("error_rate");
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
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
                },
              ],
            },
          },
        ],
      }),
    };

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 120,
    );
    await engine.react(makeCtx(scenario));
    expect(applySpy.mock.calls[0][2].startSimTime).toBe(120);
  });
});

// ── Prompt ────────────────────────────────────────────────────────────────────

describe("select_metric_reaction — prompt", () => {
  it("prompt includes all actions in the window", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithIncident("error_rate");
    let capturedMsg = "";

    const llm = {
      call: vi
        .fn()
        .mockImplementation(
          (req: { messages: Array<{ role: string; content: string }> }) => {
            capturedMsg =
              req.messages.find((m) => m.role === "user")?.content ?? "";
            return Promise.resolve({ toolCalls: [] });
          },
        ),
    };

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(
      makeCtx(scenario, {
        auditLog: [
          { action: "trigger_rollback" as const, params: {}, simTime: 50 },
          { action: "restart_service" as const, params: {}, simTime: 55 },
          { action: "scale_cluster" as const, params: {}, simTime: 58 },
        ],
      }),
    );

    expect(capturedMsg).toContain("trigger_rollback");
    expect(capturedMsg).toContain("restart_service");
    expect(capturedMsg).toContain("scale_cluster");
  });

  it("prompt includes per-metric hints with suggested pattern and speed", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithIncident("error_rate");
    let capturedMsg = "";

    const llm = {
      call: vi
        .fn()
        .mockImplementation(
          (req: { messages: Array<{ role: string; content: string }> }) => {
            capturedMsg =
              req.messages.find((m) => m.role === "user")?.content ?? "";
            return Promise.resolve({ toolCalls: [] });
          },
        ),
    };

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeCtx(scenario));

    expect(capturedMsg).toContain("error_rate");
    expect(capturedMsg).toContain("full_recovery");
    expect(capturedMsg).toContain("worsening");
    expect(capturedMsg).toContain("no_effect");
    // Rollback action → cliff suggested
    expect(capturedMsg).toContain("cliff");
  });
});
