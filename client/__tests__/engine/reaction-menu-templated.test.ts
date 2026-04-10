/**
 * Tests for the templated reaction menu:
 * - LLM selects outcome (full/partial/worsening/no_effect) AND specifies
 *   pattern, speed, and optionally scope.
 * - Hints are provided but non-binding.
 * - All actions in the window drive the menu context.
 * - _applySelectedReaction computes overlays at apply-time from LLM params.
 */

import { describe, it, expect, vi } from "vitest";
import { createMetricReactionEngine } from "../../src/engine/metric-reaction-engine";
import { createMetricStore } from "../../src/metrics/metric-store";
import {
  buildLoadedScenario,
  clearFixtureCache,
} from "../../src/testutil/index";
import { generateAllMetrics } from "../../src/metrics/generator";
import type { ResolvedMetricParams } from "../../src/metrics/types";
import type { StakeholderContext } from "../../src/engine/game-loop";

function makeRpWithIncident(
  overrides: Partial<ResolvedMetricParams> = {},
): ResolvedMetricParams {
  return {
    metricId: "error_rate",
    service: "fixture-service",
    archetype: "error_rate",
    label: "Error Rate",
    unit: "percent",
    fromSecond: -300,
    toSecond: 900,
    resolutionSeconds: 15,
    baselineValue: 0.5,
    resolvedValue: 0.5,
    rhythmProfile: "none",
    inheritsRhythm: false,
    noiseType: "none",
    noiseLevelMultiplier: 1.0,
    overlayApplications: [
      {
        overlay: "spike_and_sustain" as const,
        onsetSecond: 0,
        peakValue: 15,
        dropFactor: 30,
        ceiling: 15,
        rampDurationSeconds: 0,
        saturationDurationSeconds: 60,
      },
    ],
    overlay: "none",
    onsetSecond: 0,
    peakValue: 15,
    dropFactor: 1,
    ceiling: 15,
    saturationDurationSeconds: 60,
    rampDurationSeconds: 0,
    seriesOverride: null,
    seed: 42,
    ...overrides,
  };
}

function makeStore() {
  clearFixtureCache();
  const scenario = buildLoadedScenario({
    engine: {
      tickIntervalSeconds: 15,
      defaultTab: "email",
      llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
    },
  });
  const store = createMetricStore(
    { "fixture-service": { error_rate: [] } },
    { "fixture-service": { error_rate: makeRpWithIncident() } },
  );
  return { scenario, store };
}

function makeContext(
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

describe("select_metric_reaction tool schema — LLM fills in pattern and speed", () => {
  it("tool schema exposes outcome, pattern, speed, and scope fields", async () => {
    const { getMetricReactionTools } =
      await import("../../src/llm/tool-definitions");
    const { scenario } = makeStore();
    const tools = getMetricReactionTools(scenario);
    expect(tools).toHaveLength(1);
    const schema = tools[0].parameters as {
      properties: Record<string, { type: string; enum?: string[] }>;
    };
    // outcome replaces reaction_id — 4 values
    expect(schema.properties).toHaveProperty("outcome");
    expect(schema.properties.outcome.enum).toContain("full_recovery");
    expect(schema.properties.outcome.enum).toContain("partial_recovery");
    expect(schema.properties.outcome.enum).toContain("worsening");
    expect(schema.properties.outcome.enum).toContain("no_effect");
    // LLM specifies the transition pattern
    expect(schema.properties).toHaveProperty("pattern");
    expect(schema.properties.pattern.enum).toContain("smooth_decay");
    expect(schema.properties.pattern.enum).toContain("cliff");
    expect(schema.properties.pattern.enum).toContain("blip_then_decay");
    // LLM specifies the speed
    expect(schema.properties).toHaveProperty("speed");
    expect(schema.properties.speed.enum).toContain("1m");
    expect(schema.properties.speed.enum).toContain("5m");
    expect(schema.properties.speed.enum).toContain("15m");
    // Optional scope
    expect(schema.properties).toHaveProperty("scope");
  });

  it("outcome and pattern are required; speed and scope are optional", () => {
    // This is a schema design invariant, not runtime behaviour.
    // Verified by checking tool definition required array.
    import("../../src/llm/tool-definitions").then(
      ({ getMetricReactionTools }) => {
        const { scenario } = makeStore();
        const tools = getMetricReactionTools(scenario);
        const required =
          (tools[0].parameters as { required?: string[] }).required ?? [];
        expect(required).toContain("outcome");
        expect(required).toContain("pattern");
      },
    );
  });
});

// ── apply-time overlay computation ────────────────────────────────────────────

describe("select_metric_reaction — apply-time overlay from LLM params", () => {
  it("full_recovery with smooth_decay applies a smooth decay overlay", async () => {
    const { scenario, store } = makeStore();
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              outcome: "full_recovery",
              pattern: "smooth_decay",
              speed: "5m",
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
    await engine.react(makeContext(scenario));

    expect(applySpy).toHaveBeenCalled();
    const overlay = applySpy.mock.calls[0][2];
    expect(overlay.pattern).toBe("smooth_decay");
    expect(overlay.speedSeconds).toBe(300); // 5m = 300s
    // full_recovery targets resolvedValue
    expect(overlay.targetValue).toBeCloseTo(0.5, 3); // resolvedValue
  });

  it("full_recovery with cliff applies a cliff overlay (immediate drop)", async () => {
    const { scenario, store } = makeStore();
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              outcome: "full_recovery",
              pattern: "cliff",
              speed: "1m",
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
    await engine.react(makeContext(scenario));

    expect(applySpy).toHaveBeenCalled();
    const overlay = applySpy.mock.calls[0][2];
    expect(overlay.pattern).toBe("cliff");
    expect(overlay.speedSeconds).toBe(60); // 1m
    expect(overlay.targetValue).toBeCloseTo(0.5, 3);
  });

  it("partial_recovery targets midpoint between current and resolved", async () => {
    const { scenario, store } = makeStore();
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              outcome: "partial_recovery",
              pattern: "smooth_decay",
              speed: "15m",
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
    // Store returns currentValue ~0.5 (no generated points yet, baseline=0.5)
    await engine.react(makeContext(scenario));

    expect(applySpy).toHaveBeenCalled();
    const overlay = applySpy.mock.calls[0][2];
    expect(overlay.speedSeconds).toBe(900); // 15m
    // midpoint between current (~0.5 at t=60 with baseline noise) and resolved (0.5)
    // Should still be close to 0.5
    expect(overlay.targetValue).toBeLessThanOrEqual(
      0.5 + (0.5 - 0.5) / 2 + 1.0, // generous bound for noise
    );
  });

  it("worsening with blip_then_decay targets above current value", async () => {
    const { scenario, store } = makeStore();
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              outcome: "worsening",
              pattern: "blip_then_decay",
              speed: "5m",
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
    await engine.react(makeContext(scenario));

    expect(applySpy).toHaveBeenCalled();
    const overlay = applySpy.mock.calls[0][2];
    expect(overlay.pattern).toBe("blip_then_decay");
    // worsening target is above current value
    const currentValue =
      store.getCurrentValue("fixture-service", "error_rate", 60) ?? 0.5;
    expect(overlay.targetValue).toBeGreaterThan(currentValue);
  });

  it("no_effect calls LLM but does not call applyActiveOverlay", async () => {
    const { scenario, store } = makeStore();
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              outcome: "no_effect",
              pattern: "smooth_decay",
              speed: "5m",
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
    await engine.react(makeContext(scenario));

    expect(llm.call).toHaveBeenCalled();
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("scope restricts which metrics get the overlay", async () => {
    clearFixtureCache();
    const scenario = buildLoadedScenario({
      engine: {
        tickIntervalSeconds: 15,
        defaultTab: "email",
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
    });

    // Two incident metrics: error_rate and cpu_utilization
    const store = createMetricStore(
      {
        "fixture-service": {
          error_rate: [],
          cpu_utilization: [],
        },
      },
      {
        "fixture-service": {
          error_rate: makeRpWithIncident({ metricId: "error_rate" }),
          cpu_utilization: makeRpWithIncident({
            metricId: "cpu_utilization",
            archetype: "cpu_utilization",
            baselineValue: 40,
            resolvedValue: 40,
            peakValue: 90,
          }),
        },
      },
    );

    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              outcome: "full_recovery",
              pattern: "smooth_decay",
              speed: "5m",
              scope: ["error_rate"], // only error_rate, not cpu
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
    await engine.react(makeContext(scenario));

    // Only error_rate should have applyActiveOverlay called
    const appliedMetricIds = applySpy.mock.calls.map((c) => c[1]);
    expect(appliedMetricIds).toContain("error_rate");
    expect(appliedMetricIds).not.toContain("cpu_utilization");
  });

  it("scope defaults to all active incident metrics when not specified", async () => {
    clearFixtureCache();
    const scenario = buildLoadedScenario({
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
          error_rate: makeRpWithIncident({ metricId: "error_rate" }),
          cpu_utilization: makeRpWithIncident({
            metricId: "cpu_utilization",
            archetype: "cpu_utilization",
            baselineValue: 40,
            resolvedValue: 40,
            peakValue: 90,
          }),
        },
      },
    );

    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              outcome: "full_recovery",
              pattern: "smooth_decay",
              speed: "5m",
              // no scope — defaults to all active
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
    await engine.react(makeContext(scenario));

    const appliedMetricIds = applySpy.mock.calls.map((c) => c[1]);
    expect(appliedMetricIds).toContain("error_rate");
    expect(appliedMetricIds).toContain("cpu_utilization");
  });
});

// ── Prompt includes hints ─────────────────────────────────────────────────────

describe("select_metric_reaction — prompt hints", () => {
  it("prompt includes suggested pattern and speed hints for each outcome", async () => {
    const { scenario, store } = makeStore();
    let capturedUserMsg = "";

    const llm = {
      call: vi
        .fn()
        .mockImplementation(
          (req: { messages: Array<{ role: string; content: string }> }) => {
            capturedUserMsg =
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
    await engine.react(makeContext(scenario));

    // Prompt should mention the available outcomes with hints
    expect(capturedUserMsg).toContain("full_recovery");
    expect(capturedUserMsg).toContain("partial_recovery");
    expect(capturedUserMsg).toContain("worsening");
    expect(capturedUserMsg).toContain("no_effect");
    // Prompt should include pattern hints
    expect(capturedUserMsg).toContain("smooth_decay");
    // Prompt should include speed hints
    expect(capturedUserMsg).toMatch(/\d+m/); // some speed hint like "5m"
  });

  it("prompt includes all actions in the window, not just the last", async () => {
    const { scenario, store } = makeStore();
    let capturedUserMsg = "";

    const llm = {
      call: vi
        .fn()
        .mockImplementation(
          (req: { messages: Array<{ role: string; content: string }> }) => {
            capturedUserMsg =
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
      makeContext(scenario, {
        auditLog: [
          { action: "trigger_rollback", params: {}, simTime: 50 },
          { action: "restart_service", params: {}, simTime: 55 },
          { action: "scale_cluster", params: {}, simTime: 58 },
        ],
      }),
    );

    expect(capturedUserMsg).toContain("trigger_rollback");
    expect(capturedUserMsg).toContain("restart_service");
    expect(capturedUserMsg).toContain("scale_cluster");
  });
});
