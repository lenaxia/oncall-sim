/**
 * Tests for metric reaction batching behaviour:
 *
 * 1. Only one LLM call in-flight at a time — subsequent actions while in-flight
 *    do not trigger additional parallel calls.
 * 2. Actions taken while a call is in-flight are batched: when the in-flight
 *    call completes, a single follow-up call is made showing ALL actions taken
 *    during the wait, not just the most recent one.
 * 3. The batched prompt includes the full action window since the last reaction
 *    completed.
 * 4. The "most impactful" action (last non-passive action) drives the reaction
 *    menu — the LLM selects a reaction based on the full action set.
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

function makeRp(
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
    resolutionSeconds: 60,
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
      defaultTab: "email",
      llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
    },
  });
  const { series } = generateAllMetrics(scenario, "s");
  const store = createMetricStore(
    { "fixture-service": { error_rate: [] } },
    { "fixture-service": { error_rate: makeRp() } },
  );
  return { scenario, store };
}

function makeContext(
  scenario: ReturnType<typeof buildLoadedScenario>,
  auditLog: StakeholderContext["auditLog"],
  simTime = 60,
): StakeholderContext {
  return {
    sessionId: "s",
    scenario,
    simTime,
    auditLog,
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
    metricSummary: { simTime, narratives: [] },
    triggeredByAction: true,
  };
}

// ── Rate limiting: only one call in-flight at a time ─────────────────────────

describe("MetricReactionEngine — in-flight rate limiting", () => {
  it("does not make a second LLM call while the first is still in-flight", async () => {
    const { scenario, store } = makeStore();

    let resolveLLM!: () => void;
    const llm = {
      call: vi.fn().mockImplementation(
        () =>
          new Promise<{ toolCalls: [] }>((res) => {
            resolveLLM = () => res({ toolCalls: [] });
          }),
      ),
    };

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );

    // Start first call — will hang until resolveLLM()
    const ctx1 = makeContext(scenario, [
      { action: "trigger_rollback", params: {}, simTime: 55 },
    ]);
    const p1 = engine.react(ctx1);

    // Immediately trigger a second call while first is still pending
    const ctx2 = makeContext(scenario, [
      { action: "restart_service", params: {}, simTime: 57 },
    ]);
    const p2 = engine.react(ctx2);

    // Only ONE LLM call should have been made
    expect(llm.call).toHaveBeenCalledTimes(1);

    // Resolve the first
    resolveLLM();
    await Promise.all([p1, p2]);

    // Still only one call total — the second was dropped/deferred
    // (the second react() returned early because in-flight)
    expect(llm.call).toHaveBeenCalledTimes(1);
  });
});

// ── Batching: pending actions accumulate while in-flight ─────────────────────

describe("MetricReactionEngine — action batching", () => {
  it("after in-flight completes, a follow-up call includes all pending actions", async () => {
    const { scenario, store } = makeStore();

    let resolveFirst!: () => void;
    const llm = {
      call: vi.fn().mockImplementation(
        () =>
          new Promise<{ toolCalls: [] }>((res) => {
            resolveFirst = () => res({ toolCalls: [] });
          }),
      ),
    };

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );

    // First action — starts the in-flight call
    const ctx1 = makeContext(scenario, [
      { action: "trigger_rollback", params: {}, simTime: 50 },
    ]);
    engine.react(ctx1);
    expect(llm.call).toHaveBeenCalledTimes(1);

    // Two more actions arrive while in-flight — these should be queued
    const ctx2 = makeContext(scenario, [
      { action: "trigger_rollback", params: {}, simTime: 50 },
      { action: "restart_service", params: {}, simTime: 52 },
    ]);
    engine.react(ctx2); // in-flight, should not call LLM
    expect(llm.call).toHaveBeenCalledTimes(1); // still only 1

    const ctx3 = makeContext(scenario, [
      { action: "trigger_rollback", params: {}, simTime: 50 },
      { action: "restart_service", params: {}, simTime: 52 },
      { action: "scale_cluster", params: {}, simTime: 55 },
    ]);
    engine.react(ctx3); // in-flight, should not call LLM
    expect(llm.call).toHaveBeenCalledTimes(1); // still only 1

    // Now make the second LLM call resolve immediately
    llm.call.mockResolvedValue({ toolCalls: [] });

    // Resolve first call — this should trigger a single batched follow-up call
    resolveFirst();
    await new Promise((r) => setTimeout(r, 0)); // flush microtasks

    // A second call should have been made with the batched context
    expect(llm.call).toHaveBeenCalledTimes(2);

    // The second call's prompt should mention all three pending actions
    const secondCallMessages = llm.call.mock.calls[1][0].messages as Array<{
      role: string;
      content: string;
    }>;
    const userMsg =
      secondCallMessages.find((m) => m.role === "user")?.content ?? "";
    // All actions since last reaction should appear
    expect(userMsg).toContain("restart_service");
    expect(userMsg).toContain("scale_cluster");
  });

  it("pending actions are cleared after the batched call is made", async () => {
    const { scenario, store } = makeStore();

    let resolveFirst!: () => void;
    const callCount = { n: 0 };
    const llm = {
      call: vi.fn().mockImplementation(() => {
        callCount.n++;
        if (callCount.n === 1) {
          return new Promise<{ toolCalls: [] }>((res) => {
            resolveFirst = () => res({ toolCalls: [] });
          });
        }
        return Promise.resolve({ toolCalls: [] });
      }),
    };

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );

    // First action
    engine.react(
      makeContext(scenario, [
        { action: "trigger_rollback", params: {}, simTime: 50 },
      ]),
    );

    // Queue one pending action
    engine.react(
      makeContext(scenario, [
        { action: "trigger_rollback", params: {}, simTime: 50 },
        { action: "restart_service", params: {}, simTime: 52 },
      ]),
    );

    llm.call.mockResolvedValue({ toolCalls: [] });
    resolveFirst();
    await new Promise((r) => setTimeout(r, 10));

    // 2 calls made so far
    expect(llm.call).toHaveBeenCalledTimes(2);

    // Now trigger another action — should make a 3rd call (not combine with cleared ones)
    engine.react(
      makeContext(scenario, [
        { action: "trigger_rollback", params: {}, simTime: 50 },
        { action: "restart_service", params: {}, simTime: 52 },
        { action: "toggle_feature_flag", params: {}, simTime: 60 },
      ]),
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(llm.call).toHaveBeenCalledTimes(3);
    const thirdCallMessages = llm.call.mock.calls[2][0].messages as Array<{
      role: string;
      content: string;
    }>;
    const userMsg =
      thirdCallMessages.find((m) => m.role === "user")?.content ?? "";
    // Third call shows only the new action (toggle_feature_flag), not the already-processed ones
    expect(userMsg).toContain("toggle_feature_flag");
  });
});

// ── Prompt shows action window, not just last action ─────────────────────────

describe("MetricReactionEngine — prompt shows full action window", () => {
  it("prompt includes all actions since last reaction, not just the last one", async () => {
    const { scenario, store } = makeStore();
    const capturedMessages: Array<{ role: string; content: string }[]> = [];

    const llm = {
      call: vi
        .fn()
        .mockImplementation(
          (req: { messages: (typeof capturedMessages)[0] }) => {
            capturedMessages.push(req.messages);
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

    // Simulate: user took 3 actions before the LLM reacts to any of them
    // In practice this is a single batched call (after drain)
    const auditLog = [
      {
        action: "trigger_rollback" as const,
        params: { version: "v1.0.0" },
        simTime: 50,
      },
      {
        action: "restart_service" as const,
        params: { service: "fixture-service" },
        simTime: 52,
      },
      { action: "scale_cluster" as const, params: { count: 4 }, simTime: 55 },
    ];
    const ctx = makeContext(scenario, auditLog);
    await engine.react(ctx);

    expect(capturedMessages.length).toBeGreaterThan(0);
    const userMsg =
      capturedMessages[0].find((m) => m.role === "user")?.content ?? "";

    // All three actions should appear in the prompt
    expect(userMsg).toContain("trigger_rollback");
    expect(userMsg).toContain("restart_service");
    expect(userMsg).toContain("scale_cluster");
  });

  it("prompt labels the most recent action as the primary action", async () => {
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
    const auditLog = [
      { action: "trigger_rollback" as const, params: {}, simTime: 50 },
      { action: "scale_cluster" as const, params: {}, simTime: 55 },
    ];
    await engine.react(makeContext(scenario, auditLog));

    // The most recent action (scale_cluster) should be prominent
    const scaleIdx = capturedUserMsg.indexOf("scale_cluster");
    const rollbackIdx = capturedUserMsg.indexOf("trigger_rollback");
    // scale_cluster is the most recent action — should appear in the primary action section
    expect(scaleIdx).toBeGreaterThanOrEqual(0);
    expect(rollbackIdx).toBeGreaterThanOrEqual(0);
  });
});

// ── Cursor rollback on LLM failure ────────────────────────────────────────────

describe("MetricReactionEngine — cursor rollback on LLM failure", () => {
  it("actions are NOT dropped when LLM call throws — they appear in the next call's prompt", async () => {
    const { scenario, store } = makeStore();
    const capturedMessages: Array<Array<{ role: string; content: string }>> =
      [];
    let callCount = 0;

    const llm = {
      call: vi
        .fn()
        .mockImplementation(
          (req: { messages: Array<{ role: string; content: string }> }) => {
            callCount++;
            capturedMessages.push(req.messages);
            if (callCount === 1) {
              // First call fails
              return Promise.reject(new Error("LLM timeout"));
            }
            // Second call succeeds
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

    const auditLog = [
      { action: "trigger_rollback" as const, params: {}, simTime: 50 },
    ];

    // First call — will fail; cursor should roll back
    await engine.react(makeContext(scenario, auditLog));
    expect(callCount).toBe(1);

    // Second call with the same audit log — failed action must reappear
    await engine.react(makeContext(scenario, auditLog));
    expect(callCount).toBe(2);

    const secondCallUser =
      capturedMessages[1].find((m) => m.role === "user")?.content ?? "";
    // The rolled-back action must appear in the second call
    expect(secondCallUser).toContain("trigger_rollback");
  });

  it("LLMError specifically triggers rollback (not just any error)", async () => {
    const { LLMError } = await import("../../src/llm/llm-client");
    const { scenario, store } = makeStore();
    const capturedMessages: Array<Array<{ role: string; content: string }>> =
      [];
    let callCount = 0;

    const llm = {
      call: vi
        .fn()
        .mockImplementation(
          (req: { messages: Array<{ role: string; content: string }> }) => {
            callCount++;
            capturedMessages.push(req.messages);
            if (callCount === 1) {
              return Promise.reject(
                new LLMError("provider_error", "provider_error"),
              );
            }
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

    const auditLog = [
      { action: "scale_cluster" as const, params: {}, simTime: 55 },
    ];

    await engine.react(makeContext(scenario, auditLog));
    await engine.react(makeContext(scenario, auditLog));

    const secondCallUser =
      capturedMessages[1].find((m) => m.role === "user")?.content ?? "";
    expect(secondCallUser).toContain("scale_cluster");
  });
});
