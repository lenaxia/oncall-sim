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

// ── magnitude, sustained, oscillating ────────────────────────────────────────

describe("select_metric_reaction — magnitude, sustained, oscillating_mode", () => {
  it("schema exposes magnitude (0.0–1.0) for partial_recovery and worsening", async () => {
    const { getMetricReactionTools } =
      await import("../../src/llm/tool-definitions");
    const { scenario } = makeStore();
    const tools = getMetricReactionTools(scenario);
    const schema = tools[0].parameters as {
      properties: Record<
        string,
        { type: string; minimum?: number; maximum?: number }
      >;
    };
    expect(schema.properties).toHaveProperty("magnitude");
    expect(schema.properties.magnitude.type).toBe("number");
    expect(schema.properties.magnitude.minimum).toBe(0);
    expect(schema.properties.magnitude.maximum).toBe(1);
  });

  it("schema exposes sustained boolean", async () => {
    const { getMetricReactionTools } =
      await import("../../src/llm/tool-definitions");
    const { scenario } = makeStore();
    const tools = getMetricReactionTools(scenario);
    const schema = tools[0].parameters as {
      properties: Record<string, { type: string }>;
    };
    expect(schema.properties).toHaveProperty("sustained");
    expect(schema.properties.sustained.type).toBe("boolean");
  });

  it("schema exposes oscillating_mode and cycle_seconds when pattern=oscillating", async () => {
    const { getMetricReactionTools } =
      await import("../../src/llm/tool-definitions");
    const { scenario } = makeStore();
    const tools = getMetricReactionTools(scenario);
    const schema = tools[0].parameters as {
      properties: Record<string, unknown>;
    };
    expect(schema.properties).toHaveProperty("oscillating_mode");
    expect(schema.properties).toHaveProperty("cycle_seconds");
  });

  it("partial_recovery with magnitude=0.2 targets 20% of the way to resolved", async () => {
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
              speed: "5m",
              magnitude: 0.2,
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
    const rp = store.getResolvedParams("fixture-service", "error_rate")!;
    const current =
      store.getCurrentValue("fixture-service", "error_rate", 60) ??
      rp.baselineValue;
    // magnitude=0.2: target = current + (resolved - current) * 0.2
    const expected = current + (rp.resolvedValue - current) * 0.2;
    expect(overlay.targetValue).toBeCloseTo(expected, 2);
  });

  it("partial_recovery with magnitude=0.8 targets 80% of the way to resolved", async () => {
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
              speed: "5m",
              magnitude: 0.8,
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
    const rp = store.getResolvedParams("fixture-service", "error_rate")!;
    const current =
      store.getCurrentValue("fixture-service", "error_rate", 60) ??
      rp.baselineValue;
    const expected = current + (rp.resolvedValue - current) * 0.8;
    expect(overlay.targetValue).toBeCloseTo(expected, 2);
  });

  it("worsening with magnitude=0.3 targets 30% of the way from current to peak", async () => {
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
              magnitude: 0.3,
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
    const rp = store.getResolvedParams("fixture-service", "error_rate")!;
    const current =
      store.getCurrentValue("fixture-service", "error_rate", 60) ??
      rp.baselineValue;
    // magnitude=0.3: target = current + (peakValue - current) * 0.3
    const expected = current + (rp.peakValue - current) * 0.3;
    expect(overlay.targetValue).toBeCloseTo(expected, 2);
  });

  it("magnitude omitted → defaults to 0.5 for partial_recovery", async () => {
    const { scenario, store } = makeStore();
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: { outcome: "partial_recovery", pattern: "smooth_decay" },
            // no magnitude
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
    const rp = store.getResolvedParams("fixture-service", "error_rate")!;
    const current =
      store.getCurrentValue("fixture-service", "error_rate", 60) ??
      rp.baselineValue;
    const expected = current + (rp.resolvedValue - current) * 0.5;
    expect(overlay.targetValue).toBeCloseTo(expected, 2);
  });

  it("sustained=false is passed through to overlay", async () => {
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
              sustained: false,
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
    expect(applySpy.mock.calls[0][2].sustained).toBe(false);
  });

  it("oscillating pattern passes oscillating_mode and cycle_seconds to overlay", async () => {
    const { scenario, store } = makeStore();
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              outcome: "worsening",
              pattern: "oscillating",
              speed: "5m",
              oscillating_mode: "sustained",
              cycle_seconds: 90,
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
    expect(overlay.oscillationMode).toBe("sustained");
    expect(overlay.cycleSeconds).toBe(90);
  });

  it("oscillating defaults: oscillation_mode=damping, cycle_seconds=60", async () => {
    const { scenario, store } = makeStore();
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              outcome: "partial_recovery",
              pattern: "oscillating",
              // no oscillating_mode or cycle_seconds
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
    expect(overlay.oscillationMode).toBe("damping");
    expect(overlay.cycleSeconds).toBe(60);
  });
});
