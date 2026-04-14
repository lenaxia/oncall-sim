import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMetricReactionEngine } from "../../src/engine/metric-reaction-engine";
import { createMetricStore } from "../../src/metrics/metric-store";
import {
  buildLoadedScenario,
  clearFixtureCache,
} from "../../src/testutil/index";
import type { ResolvedMetricParams } from "../../src/metrics/types";
import type { TimeSeriesPoint } from "@shared/types/events";
import type { LLMClient } from "../../src/llm/llm-client";
import type { StakeholderContext } from "../../src/engine/game-loop";
import type { LoadedScenario } from "../../src/scenario/types";

let _fixture: LoadedScenario;

beforeEach(() => {
  clearFixtureCache();
  _fixture = buildLoadedScenario();
});

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRp(
  overrides: Partial<ResolvedMetricParams> = {},
): ResolvedMetricParams {
  return {
    metricId: "error_rate",
    service: "fixture-service",
    archetype: "error_rate",
    label: "Error Rate",
    unit: "percent",
    fromSecond: -60,
    toSecond: 300,
    resolutionSeconds: 60,
    baselineValue: 1.0,
    resolvedValue: 1.0,
    rhythmProfile: "none",
    inheritsRhythm: false,
    noiseType: "none",
    noiseLevelMultiplier: 1.0,
    overlayApplications: [],
    overlay: "none",
    onsetSecond: 0,
    peakValue: 14.0,
    dropFactor: 0.5,
    ceiling: 14.0,
    saturationDurationSeconds: 60,
    rampDurationSeconds: 30,
    seriesOverride: null,
    seed: 42,
    ...overrides,
  };
}

function makeHistorical(v = 10): TimeSeriesPoint[] {
  return [
    { t: -60, v },
    { t: 0, v },
  ];
}

function makeContext(
  overrides: Partial<StakeholderContext> = {},
): StakeholderContext {
  const scenario = _fixture;
  return {
    sessionId: "test-session",
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
    directlyAddressed: new Set(),
    metricSummary: { simTime: 60, narratives: [] },
    triggeredByAction: true,
    ...overrides,
  };
}

function makeMockLLM(
  toolCalls: Array<{ tool: string; params: Record<string, unknown> }>,
): LLMClient {
  return { call: vi.fn().mockResolvedValue({ toolCalls }) };
}

function makeScenarioWithSelectMetricReaction(
  scenario: LoadedScenario,
): LoadedScenario {
  return {
    ...scenario,
    engine: {
      ...scenario.engine,
      llmEventTools: [
        ...scenario.engine.llmEventTools.filter(
          (t) =>
            t.tool !== "apply_metric_response" &&
            t.tool !== "select_metric_reaction",
        ),
        { tool: "select_metric_reaction", enabled: true },
      ],
    },
  };
}
// Keep old name as alias for now to minimize diff
const makeScenarioWithApplyMetric = makeScenarioWithSelectMetricReaction;

// ── happy paths ───────────────────────────────────────────────────────────────

describe("MetricReactionEngine — select_metric_reaction happy paths", () => {
  function makeStoreWithIncident() {
    const rp = makeRp({
      overlayApplications: [
        {
          overlay: "spike_and_sustain" as const,
          onsetSecond: 0,
          peakValue: 14,
          dropFactor: 14,
          ceiling: 14,
          rampDurationSeconds: 0,
          saturationDurationSeconds: 60,
        },
      ],
    });
    return createMetricStore(
      { "fixture-service": { error_rate: makeHistorical(10) } },
      { "fixture-service": { error_rate: rp } },
    );
  }

  it("full_recovery → applyActiveOverlay called when incident overlays exist", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = makeStoreWithIncident();
    const spy = vi.spyOn(store, "applyActiveOverlay");

    const llm = makeMockLLM([
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
    ]);

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeContext({ scenario }));

    expect(spy).toHaveBeenCalled();
    const overlay = spy.mock.calls[0][2];
    expect(overlay.pattern).toBe("smooth_decay");
  });

  it("worsening → applyActiveOverlay called with targetValue > currentValue", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = makeStoreWithIncident();
    const spy = vi.spyOn(store, "applyActiveOverlay");

    const llm = makeMockLLM([
      {
        tool: "select_metric_reaction",
        params: {
          metric_reactions: [
            {
              metric_id: "error_rate",
              outcome: "worsening",
              pattern: "blip_then_decay",
            },
          ],
        },
      },
    ]);

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeContext({ scenario }));

    expect(spy).toHaveBeenCalled();
    const overlay = spy.mock.calls[0][2];
    // worsening target is above current value (10)
    expect(overlay.targetValue).toBeGreaterThan(10);
  });

  it("partial_recovery → applyActiveOverlay called with targetValue between current and resolved", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const rp = makeRp({
      resolvedValue: 1.0,
      overlayApplications: [
        {
          overlay: "spike_and_sustain" as const,
          onsetSecond: 0,
          peakValue: 14,
          dropFactor: 14,
          ceiling: 14,
          rampDurationSeconds: 0,
          saturationDurationSeconds: 60,
        },
      ],
    });
    const store = createMetricStore(
      { "fixture-service": { error_rate: makeHistorical(10) } },
      { "fixture-service": { error_rate: rp } },
    );
    const spy = vi.spyOn(store, "applyActiveOverlay");

    const llm = makeMockLLM([
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
    ]);

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeContext({ scenario }));

    expect(spy).toHaveBeenCalled();
    const overlay = spy.mock.calls[0][2];
    // midpoint between current (10) and resolved (1) = 5.5
    expect(overlay.targetValue).toBeCloseTo(5.5, 0);
  });

  it("no_effect → applyActiveOverlay not called", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = makeStoreWithIncident();
    const spy = vi.spyOn(store, "applyActiveOverlay");

    const llm = makeMockLLM([
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
    ]);

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeContext({ scenario }));

    expect(spy).not.toHaveBeenCalled();
  });

  it("unknown reaction_id → applyActiveOverlay not called", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = makeStoreWithIncident();
    const spy = vi.spyOn(store, "applyActiveOverlay");

    const llm = makeMockLLM([
      {
        tool: "select_metric_reaction",
        params: {
          metric_reactions: [
            {
              metric_id: "error_rate",
              outcome: "invalid_id",
              pattern: "smooth_decay",
            },
          ],
        },
      },
    ]);

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeContext({ scenario }));

    expect(spy).not.toHaveBeenCalled();
  });

  it("outcome missing → applyActiveOverlay not called", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = makeStoreWithIncident();
    const spy = vi.spyOn(store, "applyActiveOverlay");

    const llm = makeMockLLM([{ tool: "select_metric_reaction", params: {} }]);

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeContext({ scenario }));

    expect(spy).not.toHaveBeenCalled();
  });

  it("applyActiveOverlay uses getSimTime() — startSimTime matches current sim time", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = makeStoreWithIncident();
    const spy = vi.spyOn(store, "applyActiveOverlay");

    const llm = makeMockLLM([
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
    ]);

    // getSimTime returns 120 — this should be the startSimTime in the overlay
    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 120,
    );
    await engine.react(makeContext({ scenario }));

    expect(spy).toHaveBeenCalled();
    const overlay = spy.mock.calls[0][2];
    expect(overlay.startSimTime).toBe(120);
  });
});

// ── error paths / no-op scenarios ────────────────────────────────────────────

describe("MetricReactionEngine — no-op scenarios", () => {
  it("triggeredByAction=false → LLM never called", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = createMetricStore(
      { "fixture-service": { error_rate: makeHistorical() } },
      { "fixture-service": { error_rate: makeRp() } },
    );
    const llm = makeMockLLM([]);
    const callSpy = vi.spyOn(llm, "call");

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeContext({ scenario, triggeredByAction: false }));
    expect(callSpy).not.toHaveBeenCalled();
  });

  it("select_metric_reaction disabled in scenario → LLM never called", async () => {
    const baseScenario = _fixture;
    const scenario = {
      ...baseScenario,
      engine: {
        ...baseScenario.engine,
        llmEventTools: baseScenario.engine.llmEventTools.filter(
          (t) =>
            t.tool !== "select_metric_reaction" &&
            t.tool !== "apply_metric_response",
        ),
      },
    };
    const store = createMetricStore(
      { "fixture-service": { error_rate: makeHistorical() } },
      { "fixture-service": { error_rate: makeRp() } },
    );
    const llm = makeMockLLM([]);
    const callSpy = vi.spyOn(llm, "call");

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeContext({ scenario }));
    expect(callSpy).not.toHaveBeenCalled();
  });
});

// ── getter-based LLM client ───────────────────────────────────────────────────

describe("MetricReactionEngine — getLLMClient getter", () => {
  function makeStoreWithIncident() {
    const rp = makeRp({
      overlayApplications: [
        {
          overlay: "spike_and_sustain" as const,
          onsetSecond: 0,
          peakValue: 14,
          dropFactor: 14,
          ceiling: 14,
          rampDurationSeconds: 0,
          saturationDurationSeconds: 60,
        },
      ],
    });
    return createMetricStore(
      { "fixture-service": { error_rate: makeHistorical(10) } },
      { "fixture-service": { error_rate: rp } },
    );
  }

  it("accepts () => LLMClient getter and calls the client it returns", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = makeStoreWithIncident();
    const spy = vi.spyOn(store, "applyActiveOverlay");

    const llm = makeMockLLM([
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
    ]);

    // Pass a getter function — this is how SessionContext wires it
    const getLLMClient = () => llm;
    const engine = createMetricReactionEngine(
      getLLMClient,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeContext({ scenario }));

    // The getter must have been called and the actual LLM client used
    expect(spy).toHaveBeenCalled();
    expect(llm.call).toHaveBeenCalledOnce();
  });

  it("getter called at react() time, not at construction time — picks up late-resolving client", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = makeStoreWithIncident();

    // Simulate the real pattern: tempLlm at construction, real client available later
    const tempLlm: LLMClient = {
      call: vi.fn().mockResolvedValue({ toolCalls: [] }),
    };
    const realLlm = makeMockLLM([
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
    ]);

    let currentClient: LLMClient = tempLlm;
    const getLLMClient = () => currentClient;

    const engine = createMetricReactionEngine(
      getLLMClient,
      scenario,
      store,
      () => 60,
    );

    // Before real client resolves — should use tempLlm
    await engine.react(makeContext({ scenario }));
    expect(tempLlm.call).toHaveBeenCalledOnce();
    expect(realLlm.call).not.toHaveBeenCalled();

    // After real client resolves — pass a context with a NEW action beyond
    // what was already processed (otherwise engine skips as already reacted)
    currentClient = realLlm;
    const newAuditLog = [
      { action: "trigger_rollback" as const, params: {}, simTime: 55 },
      { action: "restart_service" as const, params: {}, simTime: 58 },
    ];
    await engine.react(makeContext({ scenario, auditLog: newAuditLog }));
    expect(realLlm.call).toHaveBeenCalledOnce();
  });
});

// ── prompt context ────────────────────────────────────────────────────────────

describe("MetricReactionEngine — prompt includes rich context", () => {
  const activeRp = () =>
    makeRp({
      overlayApplications: [
        {
          overlay: "spike_and_sustain" as const,
          onsetSecond: 0,
          peakValue: 14,
          dropFactor: 14,
          ceiling: 14,
          rampDurationSeconds: 0,
          saturationDurationSeconds: 60,
        },
      ],
    });

  it("prompt includes current metric values", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = createMetricStore(
      { "fixture-service": { error_rate: makeHistorical(12.5) } },
      { "fixture-service": { error_rate: activeRp() } },
    );

    let capturedMessages: import("../../src/llm/llm-client").LLMMessage[] = [];
    const llm: LLMClient = {
      call: vi.fn().mockImplementation(async (req) => {
        capturedMessages = req.messages;
        return { toolCalls: [] };
      }),
    };

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(makeContext({ scenario }));

    const userMsg =
      capturedMessages.find((m) => m.role === "user")?.content ?? "";
    expect(userMsg).toContain("error_rate");
    expect(userMsg).toContain("12.5");
  });

  it("prompt includes alarm state", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = createMetricStore(
      { "fixture-service": { error_rate: makeHistorical(10) } },
      { "fixture-service": { error_rate: activeRp() } },
    );

    let capturedMessages: import("../../src/llm/llm-client").LLMMessage[] = [];
    const llm: LLMClient = {
      call: vi.fn().mockImplementation(async (req) => {
        capturedMessages = req.messages;
        return { toolCalls: [] };
      }),
    };

    const context = makeContext({
      scenario,
      simState: {
        emails: [],
        chatChannels: {},
        tickets: [],
        ticketComments: {},
        logs: [],
        deployments: {},
        pipelines: [],
        pages: [],
        throttles: [],
        alarms: [
          {
            id: "alarm-001",
            service: "fixture-service",
            metricId: "error_rate",
            condition: "error_rate > 5%",
            value: 12.5,
            severity: "SEV2",
            status: "firing",
            simTime: 0,
          },
        ],
      },
    });

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(context);

    const userMsg =
      capturedMessages.find((m) => m.role === "user")?.content ?? "";
    expect(userMsg).toContain("alarm-001");
    expect(userMsg).toContain("firing");
  });

  it("prompt includes the specific action taken", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = createMetricStore(
      { "fixture-service": { error_rate: makeHistorical(10) } },
      { "fixture-service": { error_rate: activeRp() } },
    );

    let capturedMessages: import("../../src/llm/llm-client").LLMMessage[] = [];
    const llm: LLMClient = {
      call: vi.fn().mockImplementation(async (req) => {
        capturedMessages = req.messages;
        return { toolCalls: [] };
      }),
    };

    const context = makeContext({
      scenario,
      auditLog: [
        {
          action: "scale_cluster",
          params: { service: "fixture-service", direction: "up", count: 4 },
          simTime: 55,
        },
      ],
    });

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      store,
      () => 60,
    );
    await engine.react(context);

    const userMsg =
      capturedMessages.find((m) => m.role === "user")?.content ?? "";
    expect(userMsg).toContain("scale_cluster");
    expect(userMsg).toContain("fixture-service");
  });
});

// ── passive action filtering ──────────────────────────────────────────────────

describe("MetricReactionEngine — passive action filtering", () => {
  const PASSIVE_ACTIONS = [
    "open_tab",
    "search_logs",
    "view_metric",
    "read_wiki_page",
    "view_deployment_history",
    "view_pipeline",
    "monitor_recovery",
  ] as const;

  const ACTIVE_ACTIONS = [
    "restart_service",
    "scale_cluster",
    "throttle_traffic",
    "suppress_alarm",
    "toggle_feature_flag",
    "override_blocker",
  ] as const;

  for (const action of PASSIVE_ACTIONS) {
    it(`${action} → LLM never called (passive/observational)`, async () => {
      const scenario = makeScenarioWithApplyMetric(_fixture);
      const store = createMetricStore(
        { "fixture-service": { error_rate: makeHistorical() } },
        { "fixture-service": { error_rate: makeRp() } },
      );
      const llm = makeMockLLM([]);
      const callSpy = vi.spyOn(llm, "call");

      const engine = createMetricReactionEngine(
        () => llm,
        scenario,
        store,
        () => 60,
      );
      await engine.react(
        makeContext({
          scenario,
          auditLog: [{ action, params: {}, simTime: 55 }],
        }),
      );
      expect(callSpy).not.toHaveBeenCalled();
    });
  }

  for (const action of ACTIVE_ACTIONS) {
    it(`${action} → LLM called when incidents are active`, async () => {
      const scenario = makeScenarioWithApplyMetric(_fixture);
      // Store with active incident overlay so hasEffect = true
      const rp = makeRp({
        overlayApplications: [
          {
            overlay: "spike_and_sustain" as const,
            onsetSecond: 0,
            peakValue: 14,
            dropFactor: 14,
            ceiling: 14,
            rampDurationSeconds: 0,
            saturationDurationSeconds: 60,
          },
        ],
      });
      const store = createMetricStore(
        { "fixture-service": { error_rate: makeHistorical(10) } },
        { "fixture-service": { error_rate: rp } },
      );
      const llm = makeMockLLM([]);
      const callSpy = vi.spyOn(llm, "call");

      const engine = createMetricReactionEngine(
        () => llm,
        scenario,
        store,
        () => 60,
      );
      await engine.react(
        makeContext({
          scenario,
          auditLog: [{ action, params: {}, simTime: 55 }],
        }),
      );
      expect(callSpy).toHaveBeenCalledOnce();
    });
  }
});
