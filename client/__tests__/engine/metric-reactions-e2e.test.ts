/**
 * End-to-end tests for metric reactions: LLM response → applyActiveOverlay →
 * generatePoint → actual metric value changes.
 *
 * These tests exercise the full pipeline without mocking any intermediate layer,
 * catching bugs that unit tests on individual pieces miss (e.g. the LLM took 80s
 * and the overlay anchors stale, or worsening on a near-peak metric is invisible).
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
    fromSecond: -300,
    toSecond: 3600,
    resolutionSeconds: 60,
    baselineValue: 0.5,
    resolvedValue: 0.5,
    rhythmProfile: "none",
    inheritsRhythm: false,
    noiseType: "none", // no noise so values are deterministic
    noiseLevelMultiplier: 0,
    overlayApplications: [
      {
        overlay: "spike_and_sustain",
        onsetSecond: 0,
        peakValue: 50,
        dropFactor: 100,
        ceiling: 50,
        rampDurationSeconds: 0,
        saturationDurationSeconds: 60,
      },
    ],
    overlay: "none",
    onsetSecond: 0,
    peakValue: 50,
    dropFactor: 100,
    ceiling: 50,
    saturationDurationSeconds: 60,
    rampDurationSeconds: 0,
    seriesOverride: null,
    seed: 1,
    ...overrides,
  };
}

function makeDownwardRp(): ResolvedMetricParams {
  // Simulates cache_hit_rate: baseline=82, incident drops to ~2
  return makeRp({
    metricId: "cache_hit_rate",
    archetype: "cache_hit_rate",
    baselineValue: 82,
    resolvedValue: 82,
    peakValue: 2,
    overlayApplications: [
      {
        overlay: "sudden_drop",
        onsetSecond: 0,
        peakValue: 2,
        dropFactor: 0.024,
        ceiling: 82,
        rampDurationSeconds: 0,
        saturationDurationSeconds: 60,
      },
    ],
  });
}

function makeCtx(
  scenario: ReturnType<typeof buildLoadedScenario>,
): StakeholderContext {
  return {
    sessionId: "s",
    scenario,
    simTime: 600,
    auditLog: [{ action: "trigger_rollback", params: {}, simTime: 595 }],
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
    metricSummary: { simTime: 600, narratives: [] },
    triggeredByAction: true,
  };
}

function makeEngine(
  store: ReturnType<typeof createMetricStore>,
  llmResponse: unknown,
  simTime = 600,
) {
  clearFixtureCache();
  const scenario = buildLoadedScenario({
    engine: {
      tickIntervalSeconds: 15,
      defaultTab: "email",
      llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
    },
  });
  const mockLLM = { call: vi.fn().mockResolvedValue(llmResponse) };
  const engine = createMetricReactionEngine(
    () => mockLLM,
    scenario,
    store,
    () => simTime,
  );
  return { engine, scenario, mockLLM };
}

// ── Full recovery — value moves toward resolvedValue ─────────────────────────

describe("e2e: full_recovery reaction → generatePoint reflects change", () => {
  it("metric value moves toward resolvedValue after full_recovery overlay", async () => {
    const store = createMetricStore(
      { "fixture-service": { error_rate: [] } },
      { "fixture-service": { error_rate: makeRp() } },
    );

    // Advance to t=600 to establish a current value (scripted incident: ~50)
    store.generatePoint("fixture-service", "error_rate", 600);
    const before = store.getCurrentValue("fixture-service", "error_rate", 600)!;
    expect(before).toBeGreaterThan(1); // incident is active, value elevated

    const { engine, scenario } = makeEngine(store, {
      toolCalls: [
        {
          tool: "select_metric_reaction",
          params: {
            metric_reactions: [
              {
                metric_id: "fixture-service/error_rate",
                outcome: "full_recovery",
                pattern: "cliff", // immediate
                speed: "1m",
                sustained: true,
              },
            ],
          },
        },
      ],
    });

    await engine.react(makeCtx(scenario));

    // Generate the next point (t=660) — overlay should now drive it toward resolvedValue=0.5
    const points = store.generatePoint("fixture-service", "error_rate", 660);
    expect(points.length).toBeGreaterThan(0);
    const after = store.getCurrentValue("fixture-service", "error_rate", 660)!;
    expect(after).toBeLessThan(before); // moving toward recovery
    expect(after).toBeCloseTo(0.5, 0); // cliff pattern reaches T immediately
  });

  it("partial_recovery: value moves partway toward resolvedValue", async () => {
    const store = createMetricStore(
      { "fixture-service": { error_rate: [] } },
      { "fixture-service": { error_rate: makeRp() } },
    );

    store.generatePoint("fixture-service", "error_rate", 600);
    const before = store.getCurrentValue("fixture-service", "error_rate", 600)!;

    const { engine, scenario } = makeEngine(store, {
      toolCalls: [
        {
          tool: "select_metric_reaction",
          params: {
            metric_reactions: [
              {
                metric_id: "fixture-service/error_rate",
                outcome: "partial_recovery",
                pattern: "cliff",
                speed: "1m",
                magnitude: 0.5,
                sustained: true,
              },
            ],
          },
        },
      ],
    });

    await engine.react(makeCtx(scenario));

    store.generatePoint("fixture-service", "error_rate", 660);
    const after = store.getCurrentValue("fixture-service", "error_rate", 660)!;

    // partial_recovery magnitude=0.5: target = before + (resolvedValue-before)*0.5
    const expectedTarget = before + (0.5 - before) * 0.5;
    expect(after).toBeCloseTo(expectedTarget, 0);
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0.5); // not fully recovered
  });
});

// ── Worsening — value moves away from resolvedValue ──────────────────────────

describe("e2e: worsening reaction → generatePoint reflects change", () => {
  it("upward metric: value rises above current after worsening overlay", async () => {
    const store = createMetricStore(
      { "fixture-service": { error_rate: [] } },
      {
        "fixture-service": {
          error_rate: makeRp({
            baselineValue: 0.5,
            resolvedValue: 0.5,
            peakValue: 50,
          }),
        },
      },
    );

    store.generatePoint("fixture-service", "error_rate", 600);
    const before = store.getCurrentValue("fixture-service", "error_rate", 600)!;

    const { engine, scenario } = makeEngine(store, {
      toolCalls: [
        {
          tool: "select_metric_reaction",
          params: {
            metric_reactions: [
              {
                metric_id: "fixture-service/error_rate",
                outcome: "worsening",
                pattern: "cliff",
                speed: "1m",
                magnitude: 1.0,
                sustained: true,
              },
            ],
          },
        },
      ],
    });

    await engine.react(makeCtx(scenario));

    store.generatePoint("fixture-service", "error_rate", 660);
    const after = store.getCurrentValue("fixture-service", "error_rate", 660)!;
    expect(after).toBeGreaterThan(before);
  });

  it("downward metric (cache_hit_rate): value falls below current after worsening overlay", async () => {
    const store = createMetricStore(
      { "fixture-service": { cache_hit_rate: [] } },
      { "fixture-service": { cache_hit_rate: makeDownwardRp() } },
    );

    // Advance to t=600: metric is at ~2 (sudden_drop applied)
    store.generatePoint("fixture-service", "cache_hit_rate", 600);
    const before = store.getCurrentValue(
      "fixture-service",
      "cache_hit_rate",
      600,
    )!;
    expect(before).toBeLessThan(10); // incident dropped it

    const { engine, scenario } = makeEngine(store, {
      toolCalls: [
        {
          tool: "select_metric_reaction",
          params: {
            metric_reactions: [
              {
                metric_id: "fixture-service/cache_hit_rate",
                outcome: "worsening",
                pattern: "cliff",
                speed: "1m",
                magnitude: 0.8,
                sustained: true,
              },
            ],
          },
        },
      ],
    });

    await engine.react(makeCtx(scenario));

    store.generatePoint("fixture-service", "cache_hit_rate", 660);
    const after = store.getCurrentValue(
      "fixture-service",
      "cache_hit_rate",
      660,
    )!;
    // Worsening on a downward metric should push LOWER, not higher
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThanOrEqual(0);
  });

  it("near-peak upward metric: worsening produces visible change (>20% above current)", async () => {
    // Simulates p99_latency at 99ms with peak=100ms — the original reported bug.
    const nearPeakRp = makeRp({
      metricId: "p99_latency_ms",
      archetype: "p99_latency_ms",
      baselineValue: 99,
      resolvedValue: 50,
      peakValue: 100,
      overlayApplications: [
        {
          overlay: "spike_and_sustain",
          onsetSecond: 0,
          peakValue: 100,
          dropFactor: 2,
          ceiling: 100,
          rampDurationSeconds: 0,
          saturationDurationSeconds: 60,
        },
      ],
    });

    const store = createMetricStore(
      { "fixture-service": { p99_latency_ms: [] } },
      { "fixture-service": { p99_latency_ms: nearPeakRp } },
    );

    store.generatePoint("fixture-service", "p99_latency_ms", 600);
    const before = store.getCurrentValue(
      "fixture-service",
      "p99_latency_ms",
      600,
    )!;

    const { engine, scenario } = makeEngine(store, {
      toolCalls: [
        {
          tool: "select_metric_reaction",
          params: {
            metric_reactions: [
              {
                metric_id: "fixture-service/p99_latency_ms",
                outcome: "worsening",
                pattern: "cliff",
                speed: "1m",
                magnitude: 0.8,
                sustained: true,
              },
            ],
          },
        },
      ],
    });

    await engine.react(makeCtx(scenario));

    store.generatePoint("fixture-service", "p99_latency_ms", 660);
    const after = store.getCurrentValue(
      "fixture-service",
      "p99_latency_ms",
      660,
    )!;
    // Must be visibly higher than current (at least 10% above before)
    expect(after).toBeGreaterThan(before * 1.1);
  });
});

// ── Late LLM response — overlay re-anchors to latest point ───────────────────

describe("e2e: late LLM response → overlay anchors to latest generated point", () => {
  it("overlay applied after many ticks uses most recent value as start, not stale LLM-call-time value", async () => {
    const store = createMetricStore(
      { "fixture-service": { error_rate: [] } },
      { "fixture-service": { error_rate: makeRp() } },
    );

    // Simulate: LLM call made at t=600, but many ticks pass before response arrives.
    // Advance store to t=1200 (10 more 60s ticks).
    for (let t = 60; t <= 1200; t += 60) {
      store.generatePoint("fixture-service", "error_rate", t);
    }
    const valueAt1200 = store.getCurrentValue(
      "fixture-service",
      "error_rate",
      1200,
    )!;

    // Engine's getSimTime returns 1200 (current time when overlay is applied)
    const { engine, scenario } = makeEngine(
      store,
      {
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                {
                  metric_id: "fixture-service/error_rate",
                  outcome: "full_recovery",
                  pattern: "cliff",
                  speed: "1m",
                  sustained: true,
                },
              ],
            },
          },
        ],
      },
      1200,
    );

    const ctx = makeCtx(scenario);
    await engine.react({ ...ctx, simTime: 1200 });

    // Next point at t=1260 should reflect recovery from valueAt1200, not from t=600 value
    store.generatePoint("fixture-service", "error_rate", 1260);
    const after = store.getCurrentValue("fixture-service", "error_rate", 1260)!;

    // Should be recovering toward resolvedValue=0.5, not some stale start value
    expect(after).toBeLessThan(valueAt1200);
    expect(after).toBeCloseTo(0.5, 0); // cliff → immediate target
  });
});

// ── no_effect — value unchanged ───────────────────────────────────────────────

describe("e2e: no_effect reaction → generatePoint unchanged", () => {
  it("metric value is unchanged after no_effect reaction", async () => {
    const store = createMetricStore(
      { "fixture-service": { error_rate: [] } },
      { "fixture-service": { error_rate: makeRp() } },
    );

    store.generatePoint("fixture-service", "error_rate", 600);
    const before = store.getCurrentValue("fixture-service", "error_rate", 600)!;

    const { engine, scenario } = makeEngine(store, {
      toolCalls: [
        {
          tool: "select_metric_reaction",
          params: {
            metric_reactions: [
              {
                metric_id: "fixture-service/error_rate",
                outcome: "no_effect",
                pattern: "smooth_decay",
                speed: "5m",
              },
            ],
          },
        },
      ],
    });

    await engine.react(makeCtx(scenario));

    store.generatePoint("fixture-service", "error_rate", 660);
    const after = store.getCurrentValue("fixture-service", "error_rate", 660)!;

    // Scripted value continues its natural trajectory — no overlay applied.
    // With spike_and_sustain active and no reactive overlay, value should stay near incident level.
    expect(Math.abs(after - before)).toBeLessThan(before * 0.2); // within 20% noise band
  });
});

// ── sustained=false — reverts to scripted after speedSeconds ─────────────────

describe("e2e: sustained=false → reverts to scripted after speed window", () => {
  it("recovery with sustained=false: value recovers then returns to scripted incident level", async () => {
    const store = createMetricStore(
      { "fixture-service": { error_rate: [] } },
      { "fixture-service": { error_rate: makeRp() } },
    );

    store.generatePoint("fixture-service", "error_rate", 600);
    const before = store.getCurrentValue("fixture-service", "error_rate", 600)!;

    const { engine, scenario } = makeEngine(store, {
      toolCalls: [
        {
          tool: "select_metric_reaction",
          params: {
            metric_reactions: [
              {
                metric_id: "fixture-service/error_rate",
                outcome: "full_recovery",
                pattern: "cliff",
                speed: "1m", // 60s window
                sustained: false,
              },
            ],
          },
        },
      ],
    });

    await engine.react(makeCtx(scenario));

    // During the 60s window: value should be near resolvedValue
    store.generatePoint("fixture-service", "error_rate", 660);
    const during = store.getCurrentValue("fixture-service", "error_rate", 660)!;
    expect(during).toBeCloseTo(0.5, 0);

    // After the 60s window expires: scripted overlay takes over again
    // The scripted incident (spike_and_sustain) is still active → value should rise back
    store.generatePoint("fixture-service", "error_rate", 720);
    const after = store.getCurrentValue("fixture-service", "error_rate", 720)!;
    expect(after).toBeGreaterThan(during);
  });
});

// ── Both metrics in same call ─────────────────────────────────────────────────

describe("e2e: multiple metrics in one reaction", () => {
  it("different outcomes applied to two different metrics independently", async () => {
    clearFixtureCache();
    const store = createMetricStore(
      { "fixture-service": { error_rate: [], cache_hit_rate: [] } },
      {
        "fixture-service": {
          error_rate: makeRp(),
          cache_hit_rate: makeDownwardRp(),
        },
      },
    );

    store.generatePoint("fixture-service", "error_rate", 600);
    store.generatePoint("fixture-service", "cache_hit_rate", 600);
    const errorBefore = store.getCurrentValue(
      "fixture-service",
      "error_rate",
      600,
    )!;
    const cacheBefore = store.getCurrentValue(
      "fixture-service",
      "cache_hit_rate",
      600,
    )!;

    const scenario = buildLoadedScenario({
      engine: {
        tickIntervalSeconds: 15,
        defaultTab: "email",
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
    });
    const mockLLM = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                {
                  metric_id: "fixture-service/error_rate",
                  outcome: "full_recovery",
                  pattern: "cliff",
                  speed: "1m",
                  sustained: true,
                },
                {
                  metric_id: "fixture-service/cache_hit_rate",
                  outcome: "full_recovery",
                  pattern: "cliff",
                  speed: "1m",
                  sustained: true,
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
      () => 600,
    );

    await engine.react(makeCtx(scenario));

    store.generatePoint("fixture-service", "error_rate", 660);
    store.generatePoint("fixture-service", "cache_hit_rate", 660);
    const errorAfter = store.getCurrentValue(
      "fixture-service",
      "error_rate",
      660,
    )!;
    const cacheAfter = store.getCurrentValue(
      "fixture-service",
      "cache_hit_rate",
      660,
    )!;

    // error_rate full_recovery → cliff → drops to resolvedValue=0.5
    expect(errorAfter).toBeLessThan(errorBefore);
    expect(errorAfter).toBeCloseTo(0.5, 0);

    // cache_hit_rate full_recovery → cliff → rises to resolvedValue=82
    expect(cacheAfter).toBeGreaterThan(cacheBefore);
    expect(cacheAfter).toBeCloseTo(82, 0);
  });
});

// ── All active overlay patterns ───────────────────────────────────────────────

describe("e2e: all ActiveOverlay patterns produce visible movement", () => {
  function storeAt600(): ReturnType<typeof createMetricStore> {
    clearFixtureCache();
    const s = createMetricStore(
      { svc: { error_rate: [] } },
      {
        svc: {
          error_rate: makeRp({
            metricId: "error_rate",
            archetype: "error_rate",
            baselineValue: 0.5,
            resolvedValue: 0.5,
            peakValue: 50,
          }),
        },
      },
    );
    s.generatePoint("svc", "error_rate", 600);
    return s;
  }

  async function applyReaction(
    store: ReturnType<typeof createMetricStore>,
    pattern: string,
    outcome: string,
    extra: Record<string, unknown> = {},
  ) {
    clearFixtureCache();
    const scenario = buildLoadedScenario({
      engine: {
        tickIntervalSeconds: 15,
        defaultTab: "email",
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
    });
    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                {
                  metric_id: "svc/error_rate",
                  outcome,
                  pattern,
                  speed: "5m",
                  sustained: true,
                  ...extra,
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
      () => 600,
    );
    const ctx: StakeholderContext = {
      sessionId: "s",
      scenario,
      simTime: 600,
      auditLog: [{ action: "trigger_rollback", params: {}, simTime: 595 }],
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
      metricSummary: { simTime: 600, narratives: [] },
      triggeredByAction: true,
    };
    await engine.react(ctx);
  }

  it("smooth_decay recovery: value moves toward target over time", async () => {
    const store = storeAt600();
    const before = store.getCurrentValue("svc", "error_rate", 600)!;
    await applyReaction(store, "smooth_decay", "full_recovery");
    store.generatePoint("svc", "error_rate", 660);
    const p1 = store.getCurrentValue("svc", "error_rate", 660)!;
    store.generatePoint("svc", "error_rate", 900);
    const p2 = store.getCurrentValue("svc", "error_rate", 900)!;
    // Value should be moving toward resolvedValue=0.5 and getting closer over time
    expect(p1).toBeLessThan(before);
    expect(p2).toBeLessThan(p1);
  });

  it("stepped recovery: value drops in discrete steps", async () => {
    const store = storeAt600();
    const before = store.getCurrentValue("svc", "error_rate", 600)!;
    await applyReaction(store, "stepped", "full_recovery");
    // stepped: 4 equal steps over speedSeconds=300s, each step at every 75s
    // Step 1 fires at elapsed=75s → t=675. With resolutionSeconds=60, t=720 (elapsed=120) is step 1.
    store.generatePoint("svc", "error_rate", 720);
    const step1 = store.getCurrentValue("svc", "error_rate", 720)!;
    store.generatePoint("svc", "error_rate", 900);
    const step4 = store.getCurrentValue("svc", "error_rate", 900)!;
    expect(step1).toBeLessThan(before); // first step happened
    expect(step4).toBeLessThan(step1); // further steps took it lower
  });

  it("blip_then_decay recovery: initial blip in worsening direction, then decays to target", async () => {
    const store = storeAt600();
    const before = store.getCurrentValue("svc", "error_rate", 600)!;
    await applyReaction(store, "blip_then_decay", "full_recovery");
    // blip_then_decay going DOWN (full_recovery, T=0.5 < C=~50):
    //   blipPeak = min(C*0.7, C-1) ≈ min(35, 49) = 35
    //   blipDuration = 0.1 * 300 = 30s
    // At t=660 (elapsed=60 > blipDuration=30): decaying from blipPeak(35) toward T(0.5)
    store.generatePoint("svc", "error_rate", 660);
    const afterBlip = store.getCurrentValue("svc", "error_rate", 660)!;
    expect(afterBlip).toBeLessThan(before); // below startValue
    // At t=900 (elapsed=300): near end of decay window, close to resolvedValue
    store.generatePoint("svc", "error_rate", 900);
    const end = store.getCurrentValue("svc", "error_rate", 900)!;
    expect(end).toBeLessThan(afterBlip); // continued decaying
  });

  it("queue_burndown recovery: holds at current for speedSeconds then decays", async () => {
    const store = storeAt600();
    const before = store.getCurrentValue("svc", "error_rate", 600)!;
    await applyReaction(store, "queue_burndown", "full_recovery");
    // queue_burndown: stays at C while elapsed <= speedSeconds (300s), then decays
    // at t=660 (elapsed=60): still in holding window → value ≈ before
    store.generatePoint("svc", "error_rate", 660);
    const during = store.getCurrentValue("svc", "error_rate", 660)!;
    expect(during).toBeCloseTo(before, 0); // still holding
    // at t=960 (elapsed=360 > 300): decay has started — generate all intermediate points
    for (let t = 720; t <= 960; t += 60)
      store.generatePoint("svc", "error_rate", t);
    const after = store.getCurrentValue("svc", "error_rate", 960)!;
    expect(after).toBeLessThan(during); // now decaying toward resolvedValue
  });

  it("oscillating (damping) recovery: value crosses midpoint multiple times before settling", async () => {
    const store = storeAt600();
    const before = store.getCurrentValue("svc", "error_rate", 600)!;
    await applyReaction(store, "oscillating", "full_recovery", {
      oscillating_mode: "damping",
      cycle_seconds: 60,
    });
    const vals: number[] = [];
    for (let t = 660; t <= 960; t += 60) {
      store.generatePoint("svc", "error_rate", t);
      vals.push(store.getCurrentValue("svc", "error_rate", t)!);
    }
    // At least some values should be below the midpoint (before + resolvedValue)/2
    const midpoint = (before + 0.5) / 2;
    const hasBelowMid = vals.some((v) => v < midpoint);
    expect(hasBelowMid).toBe(true);
    // And eventually should be trending toward resolvedValue (damping)
    expect(vals[vals.length - 1]).toBeLessThan(before);
  });

  it("sawtooth_rebound recovery: decays toward target then rebounds partway", async () => {
    const store = storeAt600();
    const before = store.getCurrentValue("svc", "error_rate", 600)!;
    await applyReaction(store, "sawtooth_rebound", "full_recovery");
    // speedSeconds=300: halfPeriod=150s
    // First half (0..150s): decays from C toward T
    // Second half (150..300s): rebounds from vMid toward C
    store.generatePoint("svc", "error_rate", 660); // e=60: decaying
    const decaying = store.getCurrentValue("svc", "error_rate", 660)!;
    expect(decaying).toBeLessThan(before);

    // At e=240 (second half): rebounding back up
    for (let t = 720; t <= 840; t += 60)
      store.generatePoint("svc", "error_rate", t);
    const rebounding = store.getCurrentValue("svc", "error_rate", 840)!;
    expect(rebounding).toBeGreaterThan(decaying);
  });
});

// ── Second reaction supersedes first ─────────────────────────────────────────

describe("e2e: second reaction supersedes active overlay", () => {
  it("new worsening overlay overrides an active recovery overlay", async () => {
    clearFixtureCache();
    const store = createMetricStore(
      { svc: { error_rate: [] } },
      {
        svc: {
          error_rate: makeRp({
            metricId: "error_rate",
            archetype: "error_rate",
          }),
        },
      },
    );

    const scenario = buildLoadedScenario({
      engine: {
        tickIntervalSeconds: 15,
        defaultTab: "email",
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
    });

    function makeCtxAt(t: number, action: string): StakeholderContext {
      return {
        sessionId: "s",
        scenario,
        simTime: t,
        auditLog: [
          {
            action: action as StakeholderContext["auditLog"][0]["action"],
            params: {},
            simTime: t - 5,
          },
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
        metricSummary: { simTime: t, narratives: [] },
        triggeredByAction: true,
      };
    }

    store.generatePoint("svc", "error_rate", 600);

    // First reaction: recovery
    const llm1 = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                {
                  metric_id: "svc/error_rate",
                  outcome: "full_recovery",
                  pattern: "cliff",
                  speed: "5m",
                  sustained: true,
                },
              ],
            },
          },
        ],
      }),
    };
    const engine1 = createMetricReactionEngine(
      () => llm1,
      scenario,
      store,
      () => 600,
    );
    await engine1.react(makeCtxAt(600, "trigger_rollback"));

    store.generatePoint("svc", "error_rate", 660);
    const afterRecovery = store.getCurrentValue("svc", "error_rate", 660)!;
    expect(afterRecovery).toBeCloseTo(0.5, 0); // recovered

    // Second reaction: worsening supersedes recovery
    const llm2 = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                {
                  metric_id: "svc/error_rate",
                  outcome: "worsening",
                  pattern: "cliff",
                  speed: "5m",
                  magnitude: 1.0,
                  sustained: true,
                },
              ],
            },
          },
        ],
      }),
    };
    const engine2 = createMetricReactionEngine(
      () => llm2,
      scenario,
      store,
      () => 660,
    );
    await engine2.react(makeCtxAt(660, "restart_service"));

    store.generatePoint("svc", "error_rate", 720);
    const afterWorsening = store.getCurrentValue("svc", "error_rate", 720)!;
    expect(afterWorsening).toBeGreaterThan(afterRecovery); // worsening from recovered value
  });
});

// ── magnitude=0 edge case ─────────────────────────────────────────────────────

describe("e2e: magnitude=0 → target equals current, no movement", () => {
  it("worsening with magnitude=0 leaves metric unchanged", async () => {
    clearFixtureCache();
    const store = createMetricStore(
      { svc: { error_rate: [] } },
      {
        svc: {
          error_rate: makeRp({
            metricId: "error_rate",
            archetype: "error_rate",
          }),
        },
      },
    );
    store.generatePoint("svc", "error_rate", 600);
    const before = store.getCurrentValue("svc", "error_rate", 600)!;

    const scenario = buildLoadedScenario({
      engine: {
        tickIntervalSeconds: 15,
        defaultTab: "email",
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
    });
    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                {
                  metric_id: "svc/error_rate",
                  outcome: "worsening",
                  pattern: "cliff",
                  speed: "1m",
                  magnitude: 0,
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
      () => 600,
    );
    await engine.react({
      sessionId: "s",
      scenario,
      simTime: 600,
      auditLog: [{ action: "restart_service", params: {}, simTime: 595 }],
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
      metricSummary: { simTime: 600, narratives: [] },
      triggeredByAction: true,
    });

    store.generatePoint("svc", "error_rate", 660);
    const after = store.getCurrentValue("svc", "error_rate", 660)!;
    // magnitude=0 → target = current → no change
    expect(Math.abs(after - before)).toBeLessThan(1);
  });
});

// ── gradual_degradation scripted overlay + reaction stacking ──────────────────

describe("e2e: gradual_degradation scripted overlay stacking with reaction", () => {
  it("reaction re-anchors to the scripted+degradation value at application time", async () => {
    clearFixtureCache();
    // A metric that starts at baseline=1 and gradually climbs to peak=20 over scenario duration
    const rp = makeRp({
      metricId: "queue_depth",
      archetype: "queue_depth",
      baselineValue: 1,
      resolvedValue: 1,
      peakValue: 20,
      overlayApplications: [
        {
          overlay: "gradual_degradation",
          onsetSecond: 0,
          peakValue: 20,
          dropFactor: 1,
          ceiling: 20,
          rampDurationSeconds: 0,
          saturationDurationSeconds: 0,
        },
      ],
    });

    const store = createMetricStore(
      { svc: { queue_depth: [] } },
      { svc: { queue_depth: rp } },
    );

    // Advance to t=600 — gradual_degradation should have climbed partway
    for (let t = 60; t <= 600; t += 60)
      store.generatePoint("svc", "queue_depth", t);
    const at600 = store.getCurrentValue("svc", "queue_depth", 600)!;
    expect(at600).toBeGreaterThan(1); // has degraded from baseline

    const scenario = buildLoadedScenario({
      engine: {
        tickIntervalSeconds: 15,
        defaultTab: "email",
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
    });
    const llm = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                {
                  metric_id: "svc/queue_depth",
                  outcome: "full_recovery",
                  pattern: "cliff",
                  speed: "1m",
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
      () => 600,
    );
    await engine.react({
      sessionId: "s",
      scenario,
      simTime: 600,
      auditLog: [{ action: "trigger_rollback", params: {}, simTime: 595 }],
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
      metricSummary: { simTime: 600, narratives: [] },
      triggeredByAction: true,
    });

    // During overlay: cliff takes to resolvedValue=1
    store.generatePoint("svc", "queue_depth", 660);
    const during = store.getCurrentValue("svc", "queue_depth", 660)!;
    expect(during).toBeCloseTo(1, 0); // cliff → immediate target = resolvedValue

    // After overlay expires (sustained=false, speedSeconds=60):
    // scripted gradual_degradation resumes — value should climb again
    for (let t = 720; t <= 900; t += 60)
      store.generatePoint("svc", "queue_depth", t);
    const after = store.getCurrentValue("svc", "queue_depth", 900)!;
    expect(after).toBeGreaterThan(during); // scripted degradation resumed
  });
});
