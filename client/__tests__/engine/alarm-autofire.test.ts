/**
 * Tests that autoFire alarms trigger against live metric values (t > 0),
 * not just historical data (t <= 0).
 *
 * This was the root bug: game-loop checked `metrics[service][metricId]` which
 * is the static historical series (t <= 0 only) — thresholds were never crossed
 * pre-incident so alarms never fired. Fix: use metricStore.getCurrentValue().
 */

import { describe, it, expect, vi } from "vitest";
import { createGameLoop } from "../../src/engine/game-loop";
import { createMetricStore } from "../../src/metrics/metric-store";
import { createAuditLog } from "../../src/engine/audit-log";
import { createSimStateStore } from "../../src/engine/sim-state-store";
import { createEvaluator } from "../../src/engine/evaluator";
import { createEventScheduler } from "../../src/engine/event-scheduler";
import { generateAllMetrics } from "../../src/metrics/generator";
import {
  buildLoadedScenario,
  clearFixtureCache,
  buildTestClock,
} from "../../src/testutil/index";
import type { ResolvedMetricParams } from "../../src/metrics/types";
import type { SimEvent } from "@shared/types/events";
import type { GameLoopDependencies } from "../../src/engine/game-loop";

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
    resolutionSeconds: 15,
    baselineValue: 0.5,
    resolvedValue: 0.5,
    rhythmProfile: "none",
    inheritsRhythm: false,
    noiseType: "none",
    noiseLevelMultiplier: 1.0,
    overlayApplications: [],
    overlay: "none",
    onsetSecond: 0,
    peakValue: 10,
    dropFactor: 1,
    ceiling: 10,
    saturationDurationSeconds: 60,
    rampDurationSeconds: 30,
    seriesOverride: null,
    seed: 42,
    ...overrides,
  };
}

function makeDeps(opts: {
  clock: ReturnType<typeof buildTestClock>;
  metricStore: ReturnType<typeof createMetricStore>;
  scenario: ReturnType<typeof buildLoadedScenario>;
}): GameLoopDependencies {
  const { scenario, clock, metricStore } = opts;
  const { series } = generateAllMetrics(scenario, "test-session");
  return {
    sessionId: "test-session",
    scenario,
    scheduler: createEventScheduler(scenario),
    auditLog: createAuditLog(),
    store: createSimStateStore(),
    evaluator: createEvaluator(),
    metrics: series,
    metricStore,
    clock,
    clockAnchorMs: 0,
    onDirtyTick: () => Promise.resolve([]),
  };
}

describe("alarm autoFire — uses live MetricStore values (not static historical series)", () => {
  it("alarm fires when metricStore current value crosses threshold at t > 0", async () => {
    vi.useFakeTimers();
    try {
      clearFixtureCache();
      const scenario = buildLoadedScenario({
        alarms: [
          {
            id: "test-alarm",
            service: "fixture-service",
            metricId: "error_rate",
            condition: "error_rate > 5%",
            severity: "SEV2",
            threshold: 5,
            autoFire: true,
            autoPage: false,
          },
        ],
      });

      // Historical series: all values = 0.5 (below threshold of 5)
      const historical = Array.from({ length: 20 }, (_, i) => ({
        t: -300 + i * 15,
        v: 0.5,
      }));

      // Create a MetricStore where the live value will spike above threshold
      const rp = makeRp({
        overlayApplications: [
          {
            overlay: "spike_and_sustain" as const,
            onsetSecond: 0,
            peakValue: 15, // well above threshold of 5
            dropFactor: 30,
            ceiling: 15,
            rampDurationSeconds: 0,
            saturationDurationSeconds: 60,
          },
        ],
      });

      const store = createMetricStore(
        { "fixture-service": { error_rate: historical } },
        { "fixture-service": { error_rate: rp } },
      );

      const clock = buildTestClock(0);
      const emitted: SimEvent[] = [];

      const loop = createGameLoop(
        makeDeps({ clock, metricStore: store, scenario }),
      );
      loop.onEvent((e) => emitted.push(e));
      loop.start();

      // Advance 2 ticks — metric should spike to ~15 at t=15 and t=30
      vi.advanceTimersByTime(15 * 1000 * 2);

      const alarmFiredEvents = emitted.filter((e) => e.type === "alarm_fired");
      expect(
        alarmFiredEvents.length,
        "alarm should have fired when metric crossed threshold at t>0",
      ).toBeGreaterThan(0);

      const fired = alarmFiredEvents[0] as {
        type: "alarm_fired";
        alarm: { id: string; value: number };
      };
      expect(fired.alarm.id).toBe("test-alarm");
      expect(fired.alarm.value).toBeGreaterThanOrEqual(5);

      loop.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("alarm does NOT fire when metric stays below threshold", async () => {
    vi.useFakeTimers();
    try {
      clearFixtureCache();
      const scenario = buildLoadedScenario({
        alarms: [
          {
            id: "test-alarm-2",
            service: "fixture-service",
            metricId: "error_rate",
            condition: "error_rate > 5%",
            severity: "SEV2",
            threshold: 5,
            autoFire: true,
            autoPage: false,
          },
        ],
      });

      // No overlays — metric stays at baseline 0.5
      const rp = makeRp({ overlayApplications: [] });
      const historical = Array.from({ length: 20 }, (_, i) => ({
        t: -300 + i * 15,
        v: 0.5,
      }));
      const store = createMetricStore(
        { "fixture-service": { error_rate: historical } },
        { "fixture-service": { error_rate: rp } },
      );

      const clock = buildTestClock(0);
      const emitted: SimEvent[] = [];
      const loop = createGameLoop(
        makeDeps({ clock, metricStore: store, scenario }),
      );
      loop.onEvent((e) => emitted.push(e));
      loop.start();

      vi.advanceTimersByTime(15 * 1000 * 5);

      const alarmFiredEvents = emitted.filter((e) => e.type === "alarm_fired");
      expect(alarmFiredEvents.length).toBe(0);

      loop.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("alarm fires at most once (not on every tick after crossing)", async () => {
    vi.useFakeTimers();
    try {
      clearFixtureCache();
      const scenario = buildLoadedScenario({
        alarms: [
          {
            id: "test-alarm-3",
            service: "fixture-service",
            metricId: "error_rate",
            condition: "error_rate > 5%",
            severity: "SEV2",
            threshold: 5,
            autoFire: true,
            autoPage: false,
          },
        ],
      });

      const rp = makeRp({
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
      });
      const historical = Array.from({ length: 20 }, (_, i) => ({
        t: -300 + i * 15,
        v: 0.5,
      }));
      const store = createMetricStore(
        { "fixture-service": { error_rate: historical } },
        { "fixture-service": { error_rate: rp } },
      );

      const clock = buildTestClock(0);
      const emitted: SimEvent[] = [];
      const loop = createGameLoop(
        makeDeps({ clock, metricStore: store, scenario }),
      );
      loop.onEvent((e) => emitted.push(e));
      loop.start();

      // Advance many ticks — alarm should only fire once
      vi.advanceTimersByTime(15 * 1000 * 10);

      const alarmFiredEvents = emitted.filter((e) => e.type === "alarm_fired");
      expect(alarmFiredEvents.length).toBe(1);

      loop.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
