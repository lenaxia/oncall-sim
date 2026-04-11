/**
 * Tests for per-metric reactions.
 * The LLM returns metric_reactions[] — one entry per metric it wants to affect.
 * Unspecified metrics default to no_effect.
 */

import { describe, it, expect, vi } from "vitest";
import { createMetricReactionEngine } from "../../src/engine/metric-reaction-engine";
import { createMetricStore } from "../../src/metrics/metric-store";
import {
  buildLoadedScenario,
  clearFixtureCache,
} from "../../src/testutil/index";
import type { ResolvedMetricParams } from "../../src/metrics/types";
import type { StakeholderContext } from "../../src/engine/game-loop";

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

function makeStoreWithTwoMetrics() {
  clearFixtureCache();
  const scenario = buildLoadedScenario({
    engine: {
      tickIntervalSeconds: 15,
      defaultTab: "email",
      llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
    },
  });
  const store = createMetricStore(
    { "fixture-service": { error_rate: [], write_throttles: [] } },
    {
      "fixture-service": {
        error_rate: makeRpWithIncident("error_rate", {
          baselineValue: 0.5,
          resolvedValue: 0.5,
          peakValue: 15,
        }),
        write_throttles: makeRpWithIncident("write_throttles", {
          baselineValue: 0,
          resolvedValue: 0,
          peakValue: 40,
        }),
      },
    },
  );
  return { scenario, store };
}

function makeCtx(
  scenario: ReturnType<typeof buildLoadedScenario>,
  overrides: Partial<StakeholderContext> = {},
): StakeholderContext {
  return {
    sessionId: "s",
    scenario,
    simTime: 60,
    auditLog: [{ action: "trigger_rollback", params: {}, simTime: 55 }],
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
    directlyAddressed: new Set(),
    metricSummary: { simTime: 60, narratives: [] },
    triggeredByAction: true,
    ...overrides,
  };
}

// ── Tool schema ───────────────────────────────────────────────────────────────

describe("select_metric_reaction — per-metric schema", () => {
  it("tool has metric_reactions array as required top-level field", async () => {
    const { getMetricReactionTools } =
      await import("../../src/llm/tool-definitions");
    const { scenario } = makeStoreWithTwoMetrics();
    const tools = getMetricReactionTools(scenario);
    expect(tools).toHaveLength(1);

    const params = tools[0].parameters as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(params.required).toContain("metric_reactions");
    expect(params.properties).toHaveProperty("metric_reactions");
  });

  it("metric_reactions is an array of objects with metric_id and outcome required", async () => {
    const { getMetricReactionTools } =
      await import("../../src/llm/tool-definitions");
    const { scenario } = makeStoreWithTwoMetrics();
    const tools = getMetricReactionTools(scenario);

    const params = tools[0].parameters as {
      properties: {
        metric_reactions: {
          type: string;
          items: {
            required: string[];
            properties: Record<string, unknown>;
          };
        };
      };
    };
    const items = params.properties.metric_reactions.items;
    expect(items.required).toContain("metric_id");
    expect(items.required).toContain("outcome");
    // pattern, speed, magnitude, sustained are present but not required
    expect(items.properties).toHaveProperty("metric_id");
    expect(items.properties).toHaveProperty("outcome");
    expect(items.properties).toHaveProperty("pattern");
    expect(items.properties).toHaveProperty("speed");
    expect(items.properties).toHaveProperty("magnitude");
    expect(items.properties).toHaveProperty("sustained");
    expect(items.properties).toHaveProperty("oscillating_mode");
    expect(items.properties).toHaveProperty("cycle_seconds");
  });

  it("old top-level outcome/pattern/speed are no longer required", async () => {
    const { getMetricReactionTools } =
      await import("../../src/llm/tool-definitions");
    const { scenario } = makeStoreWithTwoMetrics();
    const tools = getMetricReactionTools(scenario);

    const params = tools[0].parameters as { required: string[] };
    expect(params.required).not.toContain("outcome");
    expect(params.required).not.toContain("pattern");
  });
});

// ── Per-metric dispatch ───────────────────────────────────────────────────────

describe("select_metric_reaction — per-metric dispatch", () => {
  it("different outcomes applied to different metrics", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithTwoMetrics();
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
                {
                  metric_id: "write_throttles",
                  outcome: "partial_recovery",
                  pattern: "smooth_decay",
                  speed: "15m",
                  magnitude: 0.3,
                },
              ],
              reasoning:
                "Rollback fixes app errors immediately; throttle events take longer to drain.",
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

    expect(applySpy).toHaveBeenCalledTimes(2);

    const errorRateCall = applySpy.mock.calls.find(
      (c) => c[1] === "error_rate",
    )!;
    expect(errorRateCall).toBeDefined();
    expect(errorRateCall[2].pattern).toBe("cliff");
    expect(errorRateCall[2].speedSeconds).toBe(60); // 1m
    // full_recovery at magnitude=1.0: target = resolvedValue = 0.5
    expect(errorRateCall[2].targetValue).toBeCloseTo(0.5, 3);

    const throttleCall = applySpy.mock.calls.find(
      (c) => c[1] === "write_throttles",
    )!;
    expect(throttleCall).toBeDefined();
    expect(throttleCall[2].pattern).toBe("smooth_decay");
    expect(throttleCall[2].speedSeconds).toBe(900); // 15m
    // partial_recovery magnitude=0.3: target = current + (resolved - current) * 0.3
    // current ≈ 0 (baseline), resolved = 0 → target = 0
    expect(throttleCall[2].targetValue).toBeCloseTo(0, 3);
  });

  it("metric with no_effect outcome is skipped — applyActiveOverlay not called for it", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithTwoMetrics();
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
                {
                  metric_id: "write_throttles",
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

    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(applySpy.mock.calls[0][1]).toBe("error_rate");
  });

  it("metric not in metric_reactions is implicitly no_effect — not called", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithTwoMetrics();
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    // LLM only specifies error_rate; write_throttles omitted entirely
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

    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(applySpy.mock.calls[0][1]).toBe("error_rate");
  });

  it("worsening on one metric, recovery on another", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithTwoMetrics();
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
                  magnitude: 0.5,
                },
                {
                  metric_id: "write_throttles",
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
      () => 60,
    );
    await engine.react(makeCtx(scenario));

    expect(applySpy).toHaveBeenCalledTimes(2);

    const errorCall = applySpy.mock.calls.find((c) => c[1] === "error_rate")!;
    const throttleCall = applySpy.mock.calls.find(
      (c) => c[1] === "write_throttles",
    )!;

    // error_rate worsening: target > currentValue
    const errRp = store.getResolvedParams("fixture-service", "error_rate")!;
    const errCurrent =
      store.getCurrentValue("fixture-service", "error_rate", 60) ??
      errRp.baselineValue;
    expect(errorCall[2].targetValue).toBeGreaterThan(errCurrent);

    // write_throttles full_recovery: target = resolvedValue = 0
    expect(throttleCall[2].targetValue).toBeCloseTo(0, 3);
  });

  it("unknown metric_id in metric_reactions is silently skipped", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithTwoMetrics();
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                {
                  metric_id: "phantom_metric",
                  outcome: "full_recovery",
                  pattern: "cliff",
                },
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
      () => 60,
    );
    await engine.react(makeCtx(scenario));

    // phantom_metric skipped, error_rate applied
    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(applySpy.mock.calls[0][1]).toBe("error_rate");
  });

  it("empty metric_reactions array — no overlays applied", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithTwoMetrics();
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: { metric_reactions: [] },
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

    expect(applySpy).not.toHaveBeenCalled();
  });

  it("per-metric sustained=false is respected", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithTwoMetrics();
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
                {
                  metric_id: "write_throttles",
                  outcome: "full_recovery",
                  pattern: "cliff",
                  sustained: true,
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

    const errorCall = applySpy.mock.calls.find((c) => c[1] === "error_rate")!;
    const throttleCall = applySpy.mock.calls.find(
      (c) => c[1] === "write_throttles",
    )!;
    expect(errorCall[2].sustained).toBe(false);
    expect(throttleCall[2].sustained).toBe(true);
  });
});

// ── Prompt ────────────────────────────────────────────────────────────────────

describe("select_metric_reaction — prompt lists metrics individually", () => {
  it("prompt shows each active incident metric with its current state and hint", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const { scenario, store } = makeStoreWithTwoMetrics();
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

    // Both metrics should be listed individually with hints
    expect(capturedMsg).toContain("error_rate");
    expect(capturedMsg).toContain("write_throttles");
    // Prompt should show per-metric hints
    expect(capturedMsg).toContain("cliff"); // suggested for rollback
    expect(capturedMsg).toContain("full_recovery");
    expect(capturedMsg).toContain("partial_recovery");
    expect(capturedMsg).toContain("worsening");
    expect(capturedMsg).toContain("no_effect");
  });
});
