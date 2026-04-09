import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStakeholderEngine } from "../../src/engine/stakeholder-engine";
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
    resolutionSeconds: 15,
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

function makeSeries(v = 10): TimeSeriesPoint[] {
  const pts: TimeSeriesPoint[] = [];
  for (let t = 0; t <= 300; t += 15) pts.push({ t, v });
  return pts;
}

function makeContext(
  overrides: Partial<StakeholderContext> = {},
): StakeholderContext {
  const scenario = getFixtureScenario();
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
    ...overrides,
  };
}

// Mock LLM that returns apply_metric_response tool call
function makeMockLLM(
  toolCalls: Array<{ tool: string; params: Record<string, unknown> }>,
): LLMClient {
  return {
    call: vi.fn().mockResolvedValue({ toolCalls }),
  };
}

function makeScenarioWithApplyMetric(scenario: LoadedScenario): LoadedScenario {
  return {
    ...scenario,
    engine: {
      ...scenario.engine,
      llmEventTools: [
        ...scenario.engine.llmEventTools,
        { tool: "apply_metric_response", enabled: true },
      ],
    },
  };
}

// ── apply_metric_response — happy paths ───────────────────────────────────────

describe("StakeholderEngine — apply_metric_response happy paths", () => {
  it("valid single-metric call → metricStore.applyReactiveOverlay called with correct params", async () => {
    const scenario = makeScenarioWithApplyMetric(getFixtureScenario());
    const series = { "fixture-service": { error_rate: makeSeries(10) } };
    const rp = { "fixture-service": { error_rate: makeRp() } };
    const store = createMetricStore(series, rp);
    const spy = vi.spyOn(store, "applyReactiveOverlay");

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

    const engine = createStakeholderEngine(llm, scenario, store);
    const events = await engine.tick(makeContext({ scenario }));

    expect(spy).toHaveBeenCalledOnce();
    const callArgs = spy.mock.calls[0];
    expect(callArgs[0].service).toBe("fixture-service");
    expect(callArgs[0].metricId).toBe("error_rate");
    expect(callArgs[0].direction).toBe("recovery");
    expect(callArgs[0].pattern).toBe("smooth_decay");
    expect(callArgs[0].speedSeconds).toBe(300); // '5m' = 300s
    expect(callArgs[0].magnitude).toBe("full");
    // No SimEvents returned from apply_metric_response
    expect(events.filter((e) => e.type === "metric_update")).toHaveLength(0);
  });

  it("valid multi-metric call → applyReactiveOverlay called once per valid entry", async () => {
    const baseScenario = getFixtureScenario();
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
    const series = {
      "fixture-service": {
        error_rate: makeSeries(10),
        p99_latency_ms: makeSeries(500),
      },
    };
    const rp = {
      "fixture-service": {
        error_rate: makeRp({ metricId: "error_rate" }),
        p99_latency_ms: makeRp({
          metricId: "p99_latency_ms",
          peakValue: 2000,
          resolvedValue: 100,
        }),
      },
    };
    const store = createMetricStore(series, rp);
    const spy = vi.spyOn(store, "applyReactiveOverlay");

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
            {
              service: "fixture-service",
              metric_id: "p99_latency_ms",
              direction: "recovery",
              pattern: "queue_burndown",
              speed: "15m",
              magnitude: "full",
            },
          ],
        },
      },
    ]);

    const engine = createStakeholderEngine(llm, scenario, store);
    await engine.tick(makeContext({ scenario }));

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("direction=worsening → targetValue resolves toward incidentPeak", async () => {
    const scenario = makeScenarioWithApplyMetric(getFixtureScenario());
    const series = { "fixture-service": { error_rate: makeSeries(5) } };
    const rp = {
      "fixture-service": {
        error_rate: makeRp({
          currentValue: 5,
          peakValue: 14,
          resolvedValue: 1,
        } as Partial<ResolvedMetricParams>),
      },
    };
    const store = createMetricStore(series, rp);
    const spy = vi.spyOn(store, "applyReactiveOverlay");

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

    const engine = createStakeholderEngine(llm, scenario, store);
    await engine.tick(makeContext({ scenario }));
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].direction).toBe("worsening");
    expect(spy.mock.calls[0][0].targetValue).toBe(14); // incidentPeak
  });

  it("magnitude=partial → targetValue is midpoint", async () => {
    const scenario = makeScenarioWithApplyMetric(getFixtureScenario());
    const series = { "fixture-service": { error_rate: makeSeries(10) } };
    const rp = {
      "fixture-service": {
        error_rate: makeRp({ peakValue: 14, resolvedValue: 1 }),
      },
    };
    const store = createMetricStore(series, rp);
    const spy = vi.spyOn(store, "applyReactiveOverlay");

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

    const engine = createStakeholderEngine(llm, scenario, store);
    await engine.tick(makeContext({ scenario }));
    expect(spy).toHaveBeenCalledOnce();
    const target = spy.mock.calls[0][0].targetValue;
    // Midpoint between currentValue (10) and resolvedValue (1) = 5.5
    expect(target).toBeCloseTo(5.5);
  });

  it("oscillating with no oscillation_mode → defaults to damping", async () => {
    const scenario = makeScenarioWithApplyMetric(getFixtureScenario());
    const series = { "fixture-service": { error_rate: makeSeries(10) } };
    const rp = { "fixture-service": { error_rate: makeRp() } };
    const store = createMetricStore(series, rp);
    const spy = vi.spyOn(store, "applyReactiveOverlay");

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
              // oscillation_mode intentionally absent
            },
          ],
        },
      },
    ]);

    const engine = createStakeholderEngine(llm, scenario, store);
    await engine.tick(makeContext({ scenario }));
    expect(spy.mock.calls[0][0].oscillationMode).toBe("damping");
  });

  it("cycle_seconds clamped to [30, 300]", async () => {
    const scenario = makeScenarioWithApplyMetric(getFixtureScenario());
    const series = { "fixture-service": { error_rate: makeSeries(10) } };
    const rp = { "fixture-service": { error_rate: makeRp() } };
    const store = createMetricStore(series, rp);
    const spy = vi.spyOn(store, "applyReactiveOverlay");

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
              cycle_seconds: 5, // below minimum of 30
            },
          ],
        },
      },
    ]);

    const engine = createStakeholderEngine(llm, scenario, store);
    await engine.tick(makeContext({ scenario }));
    expect(spy.mock.calls[0][0].cycleSeconds).toBe(30);
  });
});

// ── apply_metric_response — error paths ───────────────────────────────────────

describe("StakeholderEngine — apply_metric_response error paths", () => {
  it("unknown service → entry skipped, other entries still executed", async () => {
    const baseScenario = getFixtureScenario();
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
    const series = {
      "fixture-service": {
        error_rate: makeSeries(10),
        p99_latency_ms: makeSeries(500),
      },
    };
    const rp = {
      "fixture-service": {
        error_rate: makeRp({ metricId: "error_rate" }),
        p99_latency_ms: makeRp({ metricId: "p99_latency_ms", peakValue: 2000 }),
      },
    };
    const store = createMetricStore(series, rp);
    const spy = vi.spyOn(store, "applyReactiveOverlay");

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

    const engine = createStakeholderEngine(llm, scenario, store);
    await engine.tick(makeContext({ scenario }));

    // Second entry (valid) should still be executed
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].service).toBe("fixture-service");
  });

  it("unknown metric_id → entry skipped, does not crash", async () => {
    const scenario = makeScenarioWithApplyMetric(getFixtureScenario());
    const series = { "fixture-service": { error_rate: makeSeries(10) } };
    const rp = { "fixture-service": { error_rate: makeRp() } };
    const store = createMetricStore(series, rp);
    const spy = vi.spyOn(store, "applyReactiveOverlay");

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

    const engine = createStakeholderEngine(llm, scenario, store);
    const events = await engine.tick(makeContext({ scenario }));

    expect(spy).not.toHaveBeenCalled();
    expect(events).toBeDefined(); // does not throw
  });

  it("all entries invalid → no crash, empty result", async () => {
    const scenario = makeScenarioWithApplyMetric(getFixtureScenario());
    const series = { "fixture-service": { error_rate: makeSeries(10) } };
    const rp = { "fixture-service": { error_rate: makeRp() } };
    const store = createMetricStore(series, rp);

    const llm = makeMockLLM([
      {
        tool: "apply_metric_response",
        params: {
          affected_metrics: [
            {
              service: "bad-svc",
              metric_id: "bad_metric",
              direction: "recovery",
              pattern: "smooth_decay",
              speed: "5m",
              magnitude: "full",
            },
          ],
        },
      },
    ]);

    const engine = createStakeholderEngine(llm, scenario, store);
    const result = await engine.tick(makeContext({ scenario }));
    expect(result).toEqual([]);
  });

  it("apply_metric_response alongside send_message → both executed", async () => {
    const scenario = makeScenarioWithApplyMetric(getFixtureScenario());
    const series = { "fixture-service": { error_rate: makeSeries(10) } };
    const rp = { "fixture-service": { error_rate: makeRp() } };
    const store = createMetricStore(series, rp);
    const spy = vi.spyOn(store, "applyReactiveOverlay");

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
      {
        tool: "send_message",
        params: {
          persona: "fixture-persona",
          channel: "#incidents",
          message: "Recovering!",
        },
      },
    ]);

    const engine = createStakeholderEngine(llm, scenario, store);
    const events = await engine.tick(makeContext({ scenario }));

    expect(spy).toHaveBeenCalledOnce(); // metric response applied
    const chatEvents = events.filter((e) => e.type === "chat_message");
    expect(chatEvents).toHaveLength(1); // message also sent
  });
});
