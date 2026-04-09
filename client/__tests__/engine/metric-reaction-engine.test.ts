import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { createMetricReactionEngine } from "../../src/engine/metric-reaction-engine";
import { createMetricStore } from "../../src/metrics/metric-store";
import {
  getFixtureScenario,
  clearFixtureCache,
} from "../../src/testutil/index";
import type { ResolvedMetricParams } from "../../src/metrics/types";
import type { TimeSeriesPoint } from "@shared/types/events";
import type { LLMClient } from "../../src/llm/llm-client";
import type { StakeholderContext } from "../../src/engine/game-loop";
import type { LoadedScenario } from "../../src/scenario/types";


let _fixture: LoadedScenario;

beforeAll(async () => {
  _fixture = await getFixtureScenario();
});
beforeEach(() => clearFixtureCache());

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
  const scenario = _fixture
  return {
    sessionId: "test-session",
    scenario,
    simTime: 60,
    auditLog: [],
    conversations: {
      emails: [],
      chatChannels: {},
      tickets: [],
      ticketComments: {},
      logs: [],
      alarms: [],
      deployments: {},
      pipelines: [],
      pages: [],
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

function makeScenarioWithApplyMetric(scenario: LoadedScenario): LoadedScenario {
  return {
    ...scenario,
    engine: {
      ...scenario.engine,
      llmEventTools: [
        ...scenario.engine.llmEventTools.filter(
          (t) => t.tool !== "apply_metric_response",
        ),
        { tool: "apply_metric_response", enabled: true },
      ],
    },
  };
}

// ── happy paths ───────────────────────────────────────────────────────────────

describe("MetricReactionEngine — apply_metric_response happy paths", () => {
  it("valid call → applyActiveOverlay called with correct params", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = createMetricStore(
      { "fixture-service": { error_rate: makeHistorical(10) } },
      { "fixture-service": { error_rate: makeRp() } },
    );
    const spy = vi.spyOn(store, "applyActiveOverlay");

    const llm = makeMockLLM([
      {
        tool: "apply_metric_response",
        params: {
          affected_metrics: [
            {
              service: "fixture-service",
              metric_id: "error_rate",
              direction: "recovery",
              pattern: "smooth_decay",
              speed: "5m",
              magnitude: "full",
            },
          ],
        },
      },
    ]);

    const engine = createMetricReactionEngine(llm, scenario, store, () => 60);
    await engine.react(makeContext({ scenario }));

    expect(spy).toHaveBeenCalledOnce();
    const overlay = spy.mock.calls[0][2];
    expect(overlay.pattern).toBe("smooth_decay");
    expect(overlay.speedSeconds).toBe(300);
    expect(overlay.sustained).toBe(true); // default
  });

  it("direction=worsening → targetValue resolves toward incidentPeak", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = createMetricStore(
      { "fixture-service": { error_rate: makeHistorical(5) } },
      {
        "fixture-service": {
          error_rate: makeRp({ peakValue: 14, resolvedValue: 1 }),
        },
      },
    );
    const spy = vi.spyOn(store, "applyActiveOverlay");

    const llm = makeMockLLM([
      {
        tool: "apply_metric_response",
        params: {
          affected_metrics: [
            {
              service: "fixture-service",
              metric_id: "error_rate",
              direction: "worsening",
              pattern: "smooth_decay",
              speed: "1m",
              magnitude: "full",
            },
          ],
        },
      },
    ]);

    const engine = createMetricReactionEngine(llm, scenario, store, () => 60);
    await engine.react(makeContext({ scenario }));
    expect(spy.mock.calls[0][2].targetValue).toBe(14);
  });

  it("magnitude=partial → targetValue is midpoint between current and resolved", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = createMetricStore(
      { "fixture-service": { error_rate: makeHistorical(10) } },
      {
        "fixture-service": {
          error_rate: makeRp({ peakValue: 14, resolvedValue: 1 }),
        },
      },
    );
    const spy = vi.spyOn(store, "applyActiveOverlay");

    const llm = makeMockLLM([
      {
        tool: "apply_metric_response",
        params: {
          affected_metrics: [
            {
              service: "fixture-service",
              metric_id: "error_rate",
              direction: "recovery",
              pattern: "smooth_decay",
              speed: "5m",
              magnitude: "partial",
            },
          ],
        },
      },
    ]);

    const engine = createMetricReactionEngine(llm, scenario, store, () => 60);
    await engine.react(makeContext({ scenario }));
    // midpoint between currentValue(10) and resolvedValue(1) = 5.5
    expect(spy.mock.calls[0][2].targetValue).toBeCloseTo(5.5);
  });

  it("sustained=false is passed through to overlay", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = createMetricStore(
      { "fixture-service": { error_rate: makeHistorical(10) } },
      { "fixture-service": { error_rate: makeRp() } },
    );
    const spy = vi.spyOn(store, "applyActiveOverlay");

    const llm = makeMockLLM([
      {
        tool: "apply_metric_response",
        params: {
          affected_metrics: [
            {
              service: "fixture-service",
              metric_id: "error_rate",
              direction: "worsening",
              pattern: "blip_then_decay",
              speed: "1m",
              magnitude: "full",
              sustained: false,
            },
          ],
        },
      },
    ]);

    const engine = createMetricReactionEngine(llm, scenario, store, () => 60);
    await engine.react(makeContext({ scenario }));
    expect(spy.mock.calls[0][2].sustained).toBe(false);
  });

  it("oscillating with no oscillation_mode → defaults to damping", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = createMetricStore(
      { "fixture-service": { error_rate: makeHistorical(10) } },
      { "fixture-service": { error_rate: makeRp() } },
    );
    const spy = vi.spyOn(store, "applyActiveOverlay");

    const llm = makeMockLLM([
      {
        tool: "apply_metric_response",
        params: {
          affected_metrics: [
            {
              service: "fixture-service",
              metric_id: "error_rate",
              direction: "recovery",
              pattern: "oscillating",
              speed: "5m",
              magnitude: "full",
            },
          ],
        },
      },
    ]);

    const engine = createMetricReactionEngine(llm, scenario, store, () => 60);
    await engine.react(makeContext({ scenario }));
    expect(spy.mock.calls[0][2].oscillationMode).toBe("damping");
  });

  it("cycle_seconds clamped to [30, 300]", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = createMetricStore(
      { "fixture-service": { error_rate: makeHistorical(10) } },
      { "fixture-service": { error_rate: makeRp() } },
    );
    const spy = vi.spyOn(store, "applyActiveOverlay");

    const llm = makeMockLLM([
      {
        tool: "apply_metric_response",
        params: {
          affected_metrics: [
            {
              service: "fixture-service",
              metric_id: "error_rate",
              direction: "recovery",
              pattern: "oscillating",
              speed: "5m",
              magnitude: "full",
              oscillation_mode: "sustained",
              cycle_seconds: 5,
            },
          ],
        },
      },
    ]);

    const engine = createMetricReactionEngine(llm, scenario, store, () => 60);
    await engine.react(makeContext({ scenario }));
    expect(spy.mock.calls[0][2].cycleSeconds).toBe(30);
  });

  it("applyActiveOverlay uses getSimTime() not context.simTime", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = createMetricStore(
      { "fixture-service": { error_rate: makeHistorical(10) } },
      { "fixture-service": { error_rate: makeRp() } },
    );
    const spy = vi.spyOn(store, "applyActiveOverlay");

    const llm = makeMockLLM([
      {
        tool: "apply_metric_response",
        params: {
          affected_metrics: [
            {
              service: "fixture-service",
              metric_id: "error_rate",
              direction: "recovery",
              pattern: "smooth_decay",
              speed: "5m",
              magnitude: "full",
            },
          ],
        },
      },
    ]);

    // context.simTime = 60, but getSimTime() returns 120 (LLM returned later)
    const engine = createMetricReactionEngine(llm, scenario, store, () => 120);
    await engine.react(makeContext({ scenario, simTime: 60 }));
    expect(spy.mock.calls[0][2].startSimTime).toBe(120);
  });
});

// ── error paths ───────────────────────────────────────────────────────────────

describe("MetricReactionEngine — apply_metric_response error paths", () => {
  it("unknown service → skipped, other entries still applied", async () => {
    const baseScenario = _fixture
    const scenario = makeScenarioWithApplyMetric({
      ...baseScenario,
      opsDashboard: {
        ...baseScenario.opsDashboard,
        focalService: {
          ...baseScenario.opsDashboard.focalService,
          metrics: [
            { archetype: "error_rate", baselineValue: 1, resolvedValue: 1 },
            {
              archetype: "p99_latency_ms",
              baselineValue: 100,
              resolvedValue: 100,
            },
          ],
        },
      },
    });
    const store = createMetricStore(
      {
        "fixture-service": {
          error_rate: makeHistorical(10),
          p99_latency_ms: makeHistorical(500),
        },
      },
      {
        "fixture-service": {
          error_rate: makeRp({ metricId: "error_rate" }),
          p99_latency_ms: makeRp({
            metricId: "p99_latency_ms",
            peakValue: 2000,
          }),
        },
      },
    );
    const spy = vi.spyOn(store, "applyActiveOverlay");

    const llm = makeMockLLM([
      {
        tool: "apply_metric_response",
        params: {
          affected_metrics: [
            {
              service: "no-such-service",
              metric_id: "error_rate",
              direction: "recovery",
              pattern: "smooth_decay",
              speed: "5m",
              magnitude: "full",
            },
            {
              service: "fixture-service",
              metric_id: "error_rate",
              direction: "recovery",
              pattern: "smooth_decay",
              speed: "5m",
              magnitude: "full",
            },
          ],
        },
      },
    ]);

    const engine = createMetricReactionEngine(llm, scenario, store, () => 60);
    await engine.react(makeContext({ scenario }));
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toBe("fixture-service");
  });

  it("unknown metric_id → skipped, does not crash", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = createMetricStore(
      { "fixture-service": { error_rate: makeHistorical(10) } },
      { "fixture-service": { error_rate: makeRp() } },
    );
    const spy = vi.spyOn(store, "applyActiveOverlay");

    const llm = makeMockLLM([
      {
        tool: "apply_metric_response",
        params: {
          affected_metrics: [
            {
              service: "fixture-service",
              metric_id: "no_such_metric",
              direction: "recovery",
              pattern: "smooth_decay",
              speed: "5m",
              magnitude: "full",
            },
          ],
        },
      },
    ]);

    const engine = createMetricReactionEngine(llm, scenario, store, () => 60);
    await engine.react(makeContext({ scenario }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("triggeredByAction=false → LLM never called", async () => {
    const scenario = makeScenarioWithApplyMetric(_fixture);
    const store = createMetricStore(
      { "fixture-service": { error_rate: makeHistorical() } },
      { "fixture-service": { error_rate: makeRp() } },
    );
    const llm = makeMockLLM([]);
    const callSpy = vi.spyOn(llm, "call");

    const engine = createMetricReactionEngine(llm, scenario, store, () => 60);
    await engine.react(makeContext({ scenario, triggeredByAction: false }));
    expect(callSpy).not.toHaveBeenCalled();
  });

  it("apply_metric_response disabled in scenario → LLM never called", async () => {
    const baseScenario = _fixture
    const scenario = {
      ...baseScenario,
      engine: {
        ...baseScenario.engine,
        llmEventTools: baseScenario.engine.llmEventTools.filter(
          (t) => t.tool !== "apply_metric_response",
        ),
      },
    };
    const store = createMetricStore(
      { "fixture-service": { error_rate: makeHistorical() } },
      { "fixture-service": { error_rate: makeRp() } },
    );
    const llm = makeMockLLM([]);
    const callSpy = vi.spyOn(llm, "call");

    const engine = createMetricReactionEngine(llm, scenario, store, () => 60);
    await engine.react(makeContext({ scenario }));
    expect(callSpy).not.toHaveBeenCalled();
  });
});
