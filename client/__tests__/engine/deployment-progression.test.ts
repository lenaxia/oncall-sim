/**
 * Deployment progression tests.
 *
 * When the trainee triggers a rollback or emergency deploy, the pipeline stages
 * should advance one at a time (in_progress → succeeded) with realistic sim-time
 * delays between each stage, rather than snapping to the final state instantly.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { createGameLoop } from "../../src/engine/game-loop";
import { createEventScheduler } from "../../src/engine/event-scheduler";
import { createAuditLog } from "../../src/engine/audit-log";
import { createSimStateStore } from "../../src/engine/sim-state-store";
import { createEvaluator } from "../../src/engine/evaluator";
import { generateAllMetrics } from "../../src/metrics/generator";
import {
  getFixtureScenario,
  clearFixtureCache,
  buildTestClock,
} from "../../src/testutil/index";
import type { Pipeline, SimEvent } from "@shared/types/events";
import type { GameLoopDependencies } from "../../src/engine/game-loop";
import type { PipelineConfig } from "../../src/scenario/types";

let _fixture: import("../../src/scenario/types").LoadedScenario;

beforeAll(async () => {
  _fixture = await getFixtureScenario();
});
beforeEach(() => clearFixtureCache());

/** Convert a scenario PipelineConfig to a runtime Pipeline (mirrors SessionContext wiring). */
function toPipeline(cfg: PipelineConfig): Pipeline {
  return {
    id: cfg.id,
    name: cfg.name,
    service: cfg.service,
    stages: cfg.stages.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      currentVersion: s.currentVersion,
      previousVersion: s.previousVersion,
      status: s.status,
      deployedAtSec: s.deployedAtSec,
      commitMessage: s.commitMessage,
      author: s.author,
      blockers: s.blockers.map((b) => ({
        type: b.type,
        alarmId: b.alarmId,
        message: b.message ?? "",
      })),
      alarmWatches: s.alarmWatches,
      tests: s.tests,
      promotionEvents: s.promotionEvents.map((e) => ({
        version: e.version,
        simTime: e.simTime,
        status: e.status,
        note: e.note,
      })),
    })),
  };
}

function makeDeps(
  overrides: Partial<GameLoopDependencies> = {},
): GameLoopDependencies {
  const scenario = _fixture;
  const clock = buildTestClock(0);
  return {
    scenario,
    sessionId: "test-session",
    clock,
    scheduler: createEventScheduler(scenario),
    auditLog: createAuditLog(),
    store: createSimStateStore(),
    evaluator: createEvaluator(),
    metrics: generateAllMetrics(scenario, "test-session").series,
    clockAnchorMs: 0,
    onDirtyTick: () => Promise.resolve([]),
    ...overrides,
  };
}

// ── trigger_rollback progression ──────────────────────────────────────────────

describe("Deployment progression — trigger_rollback", () => {
  it("first stage immediately transitions to in_progress on action dispatch", () => {
    const deps = makeDeps();
    const pipelineCfg = _fixture.cicd.pipelines[0];
    const pipeline = toPipeline(pipelineCfg);
    deps.store.addPipeline(pipeline);
    const loop = createGameLoop(deps);
    const events: SimEvent[] = [];
    loop.onEvent((e) => events.push(e));

    const firstStage = pipeline.stages[0];

    vi.useFakeTimers();
    try {
      loop.start();
      loop.handleAction("trigger_rollback", {
        pipelineId: pipeline.id,
        stageId: firstStage.id,
      });
      vi.advanceTimersByTime(1_000);
      loop.stop();
    } finally {
      vi.useRealTimers();
    }

    const stageUpdates = events.filter(
      (e): e is Extract<SimEvent, { type: "pipeline_stage_updated" }> =>
        e.type === "pipeline_stage_updated" && e.stage.id === firstStage.id,
    );
    expect(stageUpdates.length).toBeGreaterThanOrEqual(1);
    expect(stageUpdates[0].stage.status).toBe("in_progress");
  });

  it("first stage shows the rollback version while in_progress", () => {
    const deps = makeDeps();
    const pipeline = toPipeline(_fixture.cicd.pipelines[0]);
    deps.store.addPipeline(pipeline);
    const loop = createGameLoop(deps);
    const events: SimEvent[] = [];
    loop.onEvent((e) => events.push(e));

    const firstStage = pipeline.stages[0];
    const previousVersion = firstStage.previousVersion ?? "v1.0.0";

    vi.useFakeTimers();
    try {
      loop.start();
      loop.handleAction("trigger_rollback", {
        pipelineId: pipeline.id,
        stageId: firstStage.id,
      });
      vi.advanceTimersByTime(1_000);
      loop.stop();
    } finally {
      vi.useRealTimers();
    }

    const stageUpdate = events
      .filter(
        (e): e is Extract<SimEvent, { type: "pipeline_stage_updated" }> =>
          e.type === "pipeline_stage_updated" && e.stage.id === firstStage.id,
      )
      .find((e) => e.stage.status === "in_progress");

    expect(stageUpdate).toBeDefined();
    expect(stageUpdate!.stage.currentVersion).toBe(previousVersion);
  });

  it("stage remains in_progress until enough sim-time elapses (does not instantly succeed)", () => {
    vi.useFakeTimers();
    try {
      const deps = makeDeps();
      const pipeline = toPipeline(_fixture.cicd.pipelines[0]);
      deps.store.addPipeline(pipeline);
      const loop = createGameLoop(deps);
      const events: SimEvent[] = [];
      loop.onEvent((e) => events.push(e));

      const firstStage = pipeline.stages[0];

      loop.handleAction("trigger_rollback", {
        pipelineId: pipeline.id,
        stageId: firstStage.id,
      });

      // Capture the count right after action dispatch
      const countAtDispatch = events.filter(
        (e): e is Extract<SimEvent, { type: "pipeline_stage_updated" }> =>
          e.type === "pipeline_stage_updated" &&
          e.stage.id === firstStage.id &&
          e.stage.status === "succeeded",
      ).length;

      // No timer advance — zero additional sim-time
      expect(countAtDispatch).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("first stage transitions to succeeded after its duration elapses", () => {
    vi.useFakeTimers();
    try {
      const deps = makeDeps();
      const pipeline = toPipeline(_fixture.cicd.pipelines[0]);
      deps.store.addPipeline(pipeline);
      const loop = createGameLoop(deps);
      const events: SimEvent[] = [];
      loop.onEvent((e) => events.push(e));

      const firstStage = pipeline.stages[0];

      loop.handleAction("trigger_rollback", {
        pipelineId: pipeline.id,
        stageId: firstStage.id,
      });

      loop.start();
      // Build stage duration: 120s sim. At 1x: tick = 60s real → 60s sim per tick.
      // Need ≥ 2 ticks (120s sim). Advance 3 real minutes to be safe.
      vi.advanceTimersByTime(60_000 * 3);
      loop.stop();

      const succeededUpdates = events.filter(
        (e): e is Extract<SimEvent, { type: "pipeline_stage_updated" }> =>
          e.type === "pipeline_stage_updated" &&
          e.stage.id === firstStage.id &&
          e.stage.status === "succeeded",
      );
      expect(succeededUpdates.length).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stages progress sequentially — second stage starts only after first succeeds", () => {
    vi.useFakeTimers();
    try {
      const deps = makeDeps();
      const pipeline = toPipeline(_fixture.cicd.pipelines[0]);
      deps.store.addPipeline(pipeline);

      if (pipeline.stages.length < 2) return;

      const loop = createGameLoop(deps);
      const events: SimEvent[] = [];
      loop.onEvent((e) => events.push(e));

      const firstStage = pipeline.stages[0];
      const secondStage = pipeline.stages[1];

      loop.handleAction("trigger_rollback", {
        pipelineId: pipeline.id,
        stageId: firstStage.id,
      });

      loop.start();
      // First stage: 120s sim (build). Second stage starts at 120s, finishes at 300s.
      // Advance 5 real minutes (300s sim) to cover first stage completion + second start.
      vi.advanceTimersByTime(60_000 * 5);
      loop.stop();

      const secondInProgress = events.filter(
        (e): e is Extract<SimEvent, { type: "pipeline_stage_updated" }> =>
          e.type === "pipeline_stage_updated" &&
          e.stage.id === secondStage.id &&
          e.stage.status === "in_progress",
      );
      expect(secondInProgress.length).toBeGreaterThanOrEqual(1);

      // Ordering: first stage succeeded must come before second stage in_progress
      const firstSucceededIdx = events.findIndex(
        (e) =>
          e.type === "pipeline_stage_updated" &&
          (e as Extract<SimEvent, { type: "pipeline_stage_updated" }>).stage
            .id === firstStage.id &&
          (e as Extract<SimEvent, { type: "pipeline_stage_updated" }>).stage
            .status === "succeeded",
      );
      const secondInProgressIdx = events.findIndex(
        (e) =>
          e.type === "pipeline_stage_updated" &&
          (e as Extract<SimEvent, { type: "pipeline_stage_updated" }>).stage
            .id === secondStage.id &&
          (e as Extract<SimEvent, { type: "pipeline_stage_updated" }>).stage
            .status === "in_progress",
      );

      expect(firstSucceededIdx).toBeGreaterThanOrEqual(0);
      expect(secondInProgressIdx).toBeGreaterThan(firstSucceededIdx);
    } finally {
      vi.useRealTimers();
    }
  });

  it("all stages eventually complete — final stage reaches succeeded", () => {
    const deps = makeDeps();
    const pipeline = toPipeline(_fixture.cicd.pipelines[0]);
    deps.store.addPipeline(pipeline);
    const loop = createGameLoop(deps);
    const events: SimEvent[] = [];
    loop.onEvent((e) => events.push(e));

    const firstStage = pipeline.stages[0];
    const lastStage = pipeline.stages[pipeline.stages.length - 1];

    loop.handleAction("trigger_rollback", {
      pipelineId: pipeline.id,
      stageId: firstStage.id,
    });

    // Directly tick at each sim minute — 4 stages totaling 660s sim.
    // Tick at 60s intervals up to 900s to cover build+staging+preprod+prod.
    for (let t = 60; t <= 900; t += 60) {
      loop._testTick(t);
    }

    const lastStageSucceeded = events.filter(
      (e): e is Extract<SimEvent, { type: "pipeline_stage_updated" }> =>
        e.type === "pipeline_stage_updated" &&
        e.stage.id === lastStage.id &&
        e.stage.status === "succeeded",
    );
    expect(lastStageSucceeded.length).toBeGreaterThanOrEqual(1);
  });

  it("promotion history entry added when stage completes", () => {
    vi.useFakeTimers();
    try {
      const deps = makeDeps();
      const pipeline = toPipeline(_fixture.cicd.pipelines[0]);
      deps.store.addPipeline(pipeline);
      const loop = createGameLoop(deps);
      const events: SimEvent[] = [];
      loop.onEvent((e) => events.push(e));

      const firstStage = pipeline.stages[0];

      loop.handleAction("trigger_rollback", {
        pipelineId: pipeline.id,
        stageId: firstStage.id,
      });

      loop.start();
      vi.advanceTimersByTime(60_000 * 3);
      loop.stop();

      const succeededUpdate = events.find(
        (e): e is Extract<SimEvent, { type: "pipeline_stage_updated" }> =>
          e.type === "pipeline_stage_updated" &&
          e.stage.id === firstStage.id &&
          e.stage.status === "succeeded",
      );
      expect(succeededUpdate).toBeDefined();
      expect(succeededUpdate!.stage.promotionEvents.length).toBeGreaterThan(0);
      expect(succeededUpdate!.stage.promotionEvents[0].status).toBe(
        "succeeded",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── emergency_deploy progression ─────────────────────────────────────────────

describe("Deployment progression — emergency_deploy", () => {
  it("first pipeline stage transitions to in_progress when emergency deploy is dispatched", () => {
    const deps = makeDeps();
    const pipeline = toPipeline(_fixture.cicd.pipelines[0]);
    deps.store.addPipeline(pipeline);
    const loop = createGameLoop(deps);
    const events: SimEvent[] = [];
    loop.onEvent((e) => events.push(e));

    const firstStage = pipeline.stages[0];

    // Use the fixture's emergency_deploy remediation action
    vi.useFakeTimers();
    try {
      loop.start();
      loop.handleAction("emergency_deploy", {
        remediationActionId: "emergency_deploy_fixture",
        service: pipeline.service,
      });
      vi.advanceTimersByTime(1_000);
      loop.stop();
    } finally {
      vi.useRealTimers();
    }

    const stageUpdates = events.filter(
      (e): e is Extract<SimEvent, { type: "pipeline_stage_updated" }> =>
        e.type === "pipeline_stage_updated" && e.stage.id === firstStage.id,
    );
    expect(stageUpdates.length).toBeGreaterThanOrEqual(1);
    expect(stageUpdates[0].stage.status).toBe("in_progress");
  });

  it("emergency deploy goes build → target stage → remaining stages", () => {
    const deps = makeDeps();
    const pipeline = toPipeline(_fixture.cicd.pipelines[0]);
    deps.store.addPipeline(pipeline);
    const loop = createGameLoop(deps);
    const events: SimEvent[] = [];
    loop.onEvent((e) => events.push(e));

    // target_stage: prod — schedule is build(120s) + prod(180s) = 300s sim
    loop.handleAction("emergency_deploy", {
      remediationActionId: "emergency_deploy_fixture",
      service: pipeline.service,
    });

    // Tick at 60s intervals — build(120s) + prod(180s) = 300s sim.
    for (let t = 60; t <= 600; t += 60) {
      loop._testTick(t);
    }

    const lastStage = pipeline.stages[pipeline.stages.length - 1];
    const lastSucceeded = events.find(
      (e): e is Extract<SimEvent, { type: "pipeline_stage_updated" }> =>
        e.type === "pipeline_stage_updated" &&
        e.stage.id === lastStage.id &&
        e.stage.status === "succeeded",
    );
    expect(lastSucceeded).toBeDefined();
  });

  it("emergency deploy respects manual promotion blocker on target stage", () => {
    vi.useFakeTimers();
    try {
      const deps = makeDeps();
      const pipeline = toPipeline(_fixture.cicd.pipelines[0]);
      // Add a manual_approval blocker to prod
      const blockedPipeline: Pipeline = {
        ...pipeline,
        stages: pipeline.stages.map((s) =>
          s.id === "prod"
            ? {
                ...s,
                blockers: [
                  { type: "manual_approval" as const, message: "Gated" },
                ],
              }
            : s,
        ),
      };
      deps.store.addPipeline(blockedPipeline);
      const loop = createGameLoop(deps);
      const events: SimEvent[] = [];
      loop.onEvent((e) => events.push(e));

      loop.handleAction("emergency_deploy", {
        remediationActionId: "emergency_deploy_fixture",
        service: pipeline.service,
      });

      loop.start();
      vi.advanceTimersByTime(60_000 * 10);
      loop.stop();

      // Prod should NOT have succeeded — blocked by manual gate
      const lastStage = pipeline.stages[pipeline.stages.length - 1];
      const prodSucceeded = events.find(
        (e): e is Extract<SimEvent, { type: "pipeline_stage_updated" }> =>
          e.type === "pipeline_stage_updated" &&
          e.stage.id === lastStage.id &&
          e.stage.status === "succeeded",
      );
      expect(prodSucceeded).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── PendingDeployment queue — SimStateStore ───────────────────────────────────

describe("SimStateStore — pending deployment queue", () => {
  const base = {
    pipelineId: "p1",
    stageSchedule: [{ stageId: "build", startAtSim: 0, durationSecs: 120 }],
    initiatedAtSim: 0,
    version: "v1.0.0",
    previousVersion: "v0.9.0",
    commitMessage: "fix: test",
    author: "trainee",
    isEmergency: false as const,
  };

  it("enqueuePendingDeployment adds to the queue", () => {
    const store = createSimStateStore();
    store.enqueuePendingDeployment(base);
    expect(store.getPendingDeployments().length).toBe(1);
  });

  it("getPendingDeployments returns a copy (mutation-safe)", () => {
    const store = createSimStateStore();
    store.enqueuePendingDeployment(base);
    const list = store.getPendingDeployments();
    list.length = 0;
    expect(store.getPendingDeployments().length).toBe(1);
  });

  it("updatePendingDeploymentProgress advances currentStageIndex", () => {
    const store = createSimStateStore();
    store.enqueuePendingDeployment({
      ...base,
      stageSchedule: [
        { stageId: "build", startAtSim: 0, durationSecs: 120 },
        { stageId: "prod", startAtSim: 120, durationSecs: 180 },
      ],
    });
    store.updatePendingDeploymentProgress("p1", 1);
    expect(store.getPendingDeployments()[0].currentStageIndex).toBe(1);
  });

  it("completePendingDeployment removes the entry", () => {
    const store = createSimStateStore();
    store.enqueuePendingDeployment(base);
    store.completePendingDeployment("p1");
    expect(store.getPendingDeployments().length).toBe(0);
  });
});
