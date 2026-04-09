import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LoadedScenario } from "../../src/scenario/types";
import { createGameLoop } from "../../src/engine/game-loop";
import { createEventScheduler } from "../../src/engine/event-scheduler";
import { createAuditLog } from "../../src/engine/audit-log";
import { createConversationStore } from "../../src/engine/conversation-store";
import { createEvaluator } from "../../src/engine/evaluator";
import { generateAllMetrics } from "../../src/metrics/generator";
import { createMetricStore } from "../../src/metrics/metric-store";
import {
  getFixtureScenario,
  clearFixtureCache,
  buildTestClock,
  expectEvent,
  expectNoEvent,
  expectAction,
} from "../../src/testutil/index";
import type { SimEvent } from "@shared/types/events";
import type { GameLoopDependencies } from "../../src/engine/game-loop";

beforeEach(() => clearFixtureCache());


function makeDeps(
  overrides: Partial<GameLoopDependencies> = {},
): GameLoopDependencies {
  const scenario = _fixture
  const clock = buildTestClock(0);
  return {
    scenario,
    sessionId: "test-session",
    clock,
    scheduler: createEventScheduler(scenario),
    auditLog: createAuditLog(),
    store: createConversationStore(),
    evaluator: createEvaluator(),
    metrics: generateAllMetrics(scenario, "test-session").series,
    clockAnchorMs: 0,
    onDirtyTick: () => Promise.resolve([]),
    ...overrides,
  };
}

// ── tick sequence ─────────────────────────────────────────────────────────────

// ── Fixture loaded once via beforeAll ────────────────────────────────────────
let _fixture: import("../../src/scenario/types").LoadedScenario

beforeAll(async () => {
  _fixture = await getFixtureScenario()
})


describe("GameLoop — tick sequence (timer-driven)", () => {
  it("scripted event at t=0 fires on first tick via game loop", async () => {
    vi.useFakeTimers();
    try {
      const dirtyTick = vi.fn().mockResolvedValue([]);
      const deps = makeDeps({ onDirtyTick: dirtyTick });
      const loop = createGameLoop(deps);
      const events: SimEvent[] = [];
      loop.onEvent((e) => events.push(e));

      loop.start();
      // Advance fake timers by one tick interval (10s × 1000 = 10000ms)
      vi.advanceTimersByTime(_fixture.engine.tickIntervalSeconds * 1000);
      loop.stop();

      // t=0 scripted events should have fired (email, chat, log, alarm, ticket)
      const kinds = events.map((e) => e.type);
      expect(kinds).toContain("email_received");
      expect(kinds).toContain("chat_message");
      expect(kinds).toContain("log_entry");
      expect(kinds).toContain("alarm_fired");
      expect(kinds).toContain("ticket_created");
      // sim_time always emitted
      expect(kinds).toContain("sim_time");
    } finally {
      vi.useRealTimers();
    }
  });

  it("scripted event at t=30 does not fire until simTime >= 30", async () => {
    // Directly test scheduler since the game loop uses it internally
    const deps = makeDeps();
    const sched = deps.scheduler;
    const at0 = sched.tick(0);
    const at15 = sched.tick(15);
    expect(at0.length).toBeGreaterThan(0);
    expect(at15.length).toBe(0);
  });

  it("onDirtyTick called after scripted event fires (via timer tick)", async () => {
    vi.useFakeTimers();
    try {
      const dirtyTick = vi.fn().mockResolvedValue([]);
      const deps = makeDeps({ onDirtyTick: dirtyTick });
      const loop = createGameLoop(deps);
      loop.start();
      vi.advanceTimersByTime(_fixture.engine.tickIntervalSeconds * 1000);
      loop.stop();
      // Fixture has t=0 events → dirty → onDirtyTick called
      expect(dirtyTick).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("onDirtyTick NOT called on clean tick (no scripted events, no actions)", () => {
    vi.useFakeTimers();
    try {
      // Build a scenario with no events and advance past t=0 first
      const deps = makeDeps();
      const dirtyTick = vi.fn().mockResolvedValue([]);
      // Pre-fire all t=0 events by calling scheduler directly
      deps.scheduler.tick(1000); // fire everything at t<=1000
      const loop = createGameLoop({ ...deps, onDirtyTick: dirtyTick });
      loop.start();
      // Advance one tick — no new events, no actions → clean tick
      (deps.clock as ReturnType<typeof buildTestClock>).advance(100);
      vi.advanceTimersByTime(_fixture.engine.tickIntervalSeconds * 1000);
      loop.stop();
      expect(dirtyTick).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("inFlight=true prevents second concurrent onDirtyTick call", async () => {
    let resolveTick!: (v: SimEvent[]) => void;
    const inflightPromise = new Promise<SimEvent[]>((res) => {
      resolveTick = res;
    });
    let callCount = 0;
    const dirtyTick = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return inflightPromise;
      return Promise.resolve([]);
    });
    const deps = makeDeps({ onDirtyTick: dirtyTick });
    const loop = createGameLoop(deps);

    // First action: starts in-flight
    loop.handleAction("view_metric", {});
    expect(dirtyTick).toHaveBeenCalledTimes(1);

    // Second action while in-flight: blocked (sets _dirty but doesn't call)
    loop.handleAction("open_tab", {});
    expect(dirtyTick).toHaveBeenCalledTimes(1);

    // Resolve in-flight — finally block sees _dirty=true and auto-retriggers
    resolveTick([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dirtyTick).toHaveBeenCalledTimes(2);

    // Third action: in-flight is now clear (second call resolved synchronously) → triggers again
    loop.handleAction("search_logs", {});
    expect(dirtyTick).toHaveBeenCalledTimes(3);
  });

  it("inFlight clears after onDirtyTick resolves", async () => {
    let resolveTick!: (v: SimEvent[]) => void;
    const inflightPromise = new Promise<SimEvent[]>((res) => {
      resolveTick = res;
    });
    const dirtyTick = vi
      .fn()
      .mockReturnValueOnce(inflightPromise)
      .mockResolvedValue([]);
    const deps = makeDeps({ onDirtyTick: dirtyTick });
    const loop = createGameLoop(deps);

    loop.handleAction("view_metric", {});
    expect(dirtyTick).toHaveBeenCalledTimes(1);

    // While in-flight, another call is blocked
    loop.handleAction("open_tab", {});
    expect(dirtyTick).toHaveBeenCalledTimes(1);

    // Resolve — inFlight clears and _dirty=true causes auto-retrigger
    resolveTick([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dirtyTick).toHaveBeenCalledTimes(2);

    // After auto-retrigger resolves, new action triggers again
    await new Promise((resolve) => setTimeout(resolve, 0));
    loop.handleAction("search_logs", {});
    expect(dirtyTick).toHaveBeenCalledTimes(3);
  });
});

// ── handleAction ──────────────────────────────────────────────────────────────

describe("GameLoop — handleAction", () => {
  it("action recorded in auditLog", async () => {
    const deps = makeDeps();
    const loop = createGameLoop(deps);
    loop.handleAction("view_metric", { service: "svc" });
    const entries = deps.auditLog.getAll();
    expect(entries.length).toBe(1);
    expectAction(entries, "view_metric");
  });

  it("correct SimEvent emitted via onEvent after handleAction", async () => {
    const deps = makeDeps();
    const loop = createGameLoop(deps);
    const events: SimEvent[] = [];
    loop.onEvent((e) => events.push(e));
    deps.store.addTicket({
      id: "t1",
      title: "T",
      severity: "SEV2",
      status: "open",
      description: "",
      createdBy: "p",
      assignee: "trainee",
      simTime: 0,
    });
    loop.handleAction("update_ticket", {
      ticketId: "t1",
      changes: { status: "resolved" },
    });
    expectEvent(events, "ticket_updated");
  });

  it("session marked dirty after action — onDirtyTick is called", async () => {
    const dirtyTick = vi.fn().mockResolvedValue([]);
    const loop = createGameLoop(makeDeps({ onDirtyTick: dirtyTick }));
    loop.handleAction("open_tab", {});
    // dirty=true causes triggerDirtyTick to call onDirtyTick
    expect(dirtyTick).toHaveBeenCalledTimes(1);
  });

  it("onDirtyTick called immediately if not in-flight", async () => {
    const dirtyTick = vi.fn().mockResolvedValue([]);
    const loop = createGameLoop(makeDeps({ onDirtyTick: dirtyTick }));
    loop.handleAction("open_tab", {});
    expect(dirtyTick).toHaveBeenCalledTimes(1);
  });

  it("update_ticket action emits ticket_updated event", async () => {
    const deps = makeDeps();
    const loop = createGameLoop(deps);
    const events: SimEvent[] = [];
    loop.onEvent((e) => events.push(e));
    deps.store.addTicket({
      id: "t1",
      title: "T",
      severity: "SEV2",
      status: "open",
      description: "",
      createdBy: "persona",
      assignee: "trainee",
      simTime: 0,
    });
    loop.handleAction("update_ticket", {
      ticketId: "t1",
      changes: { status: "in_progress" },
    });
    expectEvent(events, "ticket_updated");
  });

  it("suppress_alarm action emits alarm_silenced event", async () => {
    const deps = makeDeps();
    const loop = createGameLoop(deps);
    const events: SimEvent[] = [];
    loop.onEvent((e) => events.push(e));
    deps.store.addAlarm({
      id: "a1",
      service: "svc",
      metricId: "error_rate",
      condition: ">5",
      value: 10,
      severity: "SEV2",
      status: "firing",
      simTime: 0,
    });
    loop.handleAction("suppress_alarm", { alarmId: "a1" });
    expectEvent(events, "alarm_silenced");
  });
});

// ── getSnapshot ───────────────────────────────────────────────────────────────

describe("GameLoop — getSnapshot", () => {
  it("returns SessionSnapshot with correct sessionId and scenarioId", async () => {
    const deps = makeDeps();
    const loop = createGameLoop(deps);
    const snap = loop.getSnapshot();
    expect(snap.sessionId).toBe("test-session");
    expect(snap.scenarioId).toBe("_fixture");
  });

  it("metrics field matches pre-generated metrics", async () => {
    const deps = makeDeps();
    const loop = createGameLoop(deps);
    const snap = loop.getSnapshot();
    expect(snap.metrics).toStrictEqual(deps.metrics);
  });

  it("simTime reflects clock state", async () => {
    const deps = makeDeps();
    const clock = deps.clock as ReturnType<typeof buildTestClock>;
    const loop = createGameLoop(deps);
    clock.advance(45);
    expect(loop.getSnapshot().simTime).toBe(45);
  });

  it("chatChannels, emails, tickets reflect current conversation store state", () => {
    const deps = makeDeps();
    const loop = createGameLoop(deps);
    // Add directly to store (simulating scheduler-fired events)
    deps.store.addChatMessage("#incidents", {
      id: "c1",
      channel: "#incidents",
      persona: "p",
      text: "hi",
      simTime: 0,
    });
    deps.store.addEmail({
      id: "e1",
      threadId: "t1",
      from: "p",
      to: "trainee",
      subject: "s",
      body: "b",
      simTime: 0,
    });
    deps.store.addTicket({
      id: "tk1",
      title: "T",
      severity: "SEV2",
      status: "open",
      description: "",
      createdBy: "p",
      assignee: "trainee",
      simTime: 0,
    });
    const snap = loop.getSnapshot();
    expect(snap.chatChannels["#incidents"]?.length).toBeGreaterThan(0);
    expect(snap.emails.length).toBe(1);
    expect(snap.tickets.length).toBe(1);
  });

  it("coachMessages starts empty in Phase 4", async () => {
    const loop = createGameLoop(makeDeps());
    expect(loop.getSnapshot().coachMessages).toEqual([]);
  });

  it("handleCoachMessage appends to coachMessages in snapshot", async () => {
    const loop = createGameLoop(makeDeps());
    loop.handleCoachMessage({
      id: "c1",
      text: "Check deployments",
      simTime: 30,
      proactive: true,
    });
    expect(loop.getSnapshot().coachMessages.length).toBe(1);
    expect(loop.getSnapshot().coachMessages[0].text).toBe("Check deployments");
  });
});

// ── pause / resume / setSpeed ─────────────────────────────────────────────────

describe("GameLoop — pause/resume/setSpeed", () => {
  it("pause() stops sim time advancing", async () => {
    const deps = makeDeps();
    const clock = deps.clock as ReturnType<typeof buildTestClock>;
    const loop = createGameLoop(deps);
    loop.pause();
    clock.tick(5000); // 5 real seconds
    expect(loop.getSnapshot().paused).toBe(true);
    expect(loop.getSnapshot().simTime).toBe(0);
  });

  it("resume() resumes sim time advancing", async () => {
    const deps = makeDeps();
    const clock = deps.clock as ReturnType<typeof buildTestClock>;
    const loop = createGameLoop(deps);
    loop.pause();
    clock.tick(1000);
    loop.resume();
    clock.tick(1000);
    expect(loop.getSnapshot().simTime).toBe(1); // only the post-resume tick
  });

  it("setSpeed changes speed reflected in snapshot", async () => {
    const loop = createGameLoop(makeDeps());
    loop.setSpeed(10);
    expect(loop.getSnapshot().speed).toBe(10);
  });

  it("setSpeed changes tick rate — clock advances faster with higher speed", async () => {
    const deps = makeDeps();
    const clock = deps.clock as ReturnType<typeof buildTestClock>;
    const loop = createGameLoop(deps);
    loop.setSpeed(5);
    clock.tick(1000); // 1 real second × speed 5 = 5 sim seconds
    expect(loop.getSnapshot().simTime).toBeCloseTo(5);
  });
});

// ── getEvaluationState ────────────────────────────────────────────────────────

describe("GameLoop — getEvaluationState", () => {
  it("returns empty state initially", async () => {
    const state = createGameLoop(makeDeps()).getEvaluationState();
    expect(state.relevantActionsTaken).toEqual([]);
    expect(state.resolved).toBe(false);
  });

  it("reflects actions taken via handleAction", async () => {
    const deps = makeDeps();
    const loop = createGameLoop(deps);
    loop.handleAction("trigger_rollback", { service: "fixture-service" });
    const state = loop.getEvaluationState();
    expect(state.relevantActionsTaken.length).toBeGreaterThan(0);
  });
});

// ── onEvent ───────────────────────────────────────────────────────────────────

describe("GameLoop — onEvent", () => {
  it("multiple handlers all called", async () => {
    const deps = makeDeps();
    const loop = createGameLoop(deps);
    const a: SimEvent[] = [];
    const b: SimEvent[] = [];
    loop.onEvent((e) => a.push(e));
    loop.onEvent((e) => b.push(e));
    loop.handleAction("view_metric", {});
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
  });

  it("no events emitted before any action", async () => {
    const events: SimEvent[] = [];
    const loop = createGameLoop(makeDeps());
    loop.onEvent((e) => events.push(e));
    expectNoEvent(events, "chat_message");
  });
});

// ── Integration: stakeholder events update conversation store ─────────────────

describe("GameLoop — stakeholder events update conversation store", () => {
  it("chat_message from onDirtyTick appears in getSnapshot().chatChannels", async () => {
    const chatEvent: SimEvent = {
      type: "chat_message",
      channel: "#incidents",
      message: {
        id: "msg-1",
        channel: "#incidents",
        persona: "fixture-persona",
        text: "Investigating",
        simTime: 10,
      },
    };
    const dirtyTick = vi
      .fn()
      .mockResolvedValueOnce([chatEvent])
      .mockResolvedValue([]);
    const deps = makeDeps({ onDirtyTick: dirtyTick });
    const loop = createGameLoop(deps);

    loop.handleAction("view_metric", {});
    // Wait for the async onDirtyTick to resolve
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snap = loop.getSnapshot();
    const msgs = snap.chatChannels["#incidents"] ?? [];
    expect(msgs.some((m) => m.id === "msg-1")).toBe(true);
  });

  it("alarm_fired from onDirtyTick appears in getSnapshot().alarms", async () => {
    const alarmEvent: SimEvent = {
      type: "alarm_fired",
      alarm: {
        id: "dyn-alarm",
        service: "svc",
        metricId: "error_rate",
        condition: ">5",
        value: 10,
        severity: "SEV2",
        status: "firing",
        simTime: 10,
      },
    };
    const dirtyTick = vi
      .fn()
      .mockResolvedValueOnce([alarmEvent])
      .mockResolvedValue([]);
    const deps = makeDeps({ onDirtyTick: dirtyTick });
    const loop = createGameLoop(deps);

    loop.handleAction("view_metric", {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snap = loop.getSnapshot();
    expect(snap.alarms.some((a) => a.id === "dyn-alarm")).toBe(true);
  });
});

// ── metric_update streaming ───────────────────────────────────────────────────

describe("GameLoop — metric_update SSE streaming", () => {
  it("emits metric_update events when MetricStore has reactive overlay points in window", async () => {
    vi.useFakeTimers();
    try {
      const s = _fixture;
      const { series, resolvedParams } = generateAllMetrics(
        s,
        "session-reactive",
      );
      const store = createMetricStore(series, resolvedParams);

      // Apply an active overlay — metric_update events are now emitted every tick
      store.applyActiveOverlay("fixture-service", "error_rate", {
        startSimTime: 0,
        startValue: 10,
        targetValue: 1,
        pattern: "smooth_decay",
        speedSeconds: 300,
        sustained: true,
      });

      const clock = buildTestClock(0);
      const emitted: SimEvent[] = [];
      const loop = createGameLoop({
        ...makeDeps({ clock }),
        metricStore: store,
      });
      loop.onEvent((e) => emitted.push(e));
      loop.start();

      // Advance clock to cover the reactive window
      vi.advanceTimersByTime(s.engine.tickIntervalSeconds * 1000 * 3);

      const metricUpdates = emitted.filter((e) => e.type === "metric_update");
      expect(metricUpdates.length).toBeGreaterThan(0);
      expect(
        (metricUpdates[0] as { type: "metric_update"; service: string })
          .service,
      ).toBe("fixture-service");

      loop.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("getSnapshot returns MetricStore series when metricStore is provided", async () => {
    const s = _fixture;
    const { series, resolvedParams } = generateAllMetrics(s, "session-snap");
    const store = createMetricStore(series, resolvedParams);
    const clock = buildTestClock(0);
    const loop = createGameLoop({ ...makeDeps({ clock }), metricStore: store });
    const snap = loop.getSnapshot();
    // MetricStore getAllSeries should be reflected
    expect(snap.metrics["fixture-service"]).toBeDefined();
    expect(snap.metrics["fixture-service"]["error_rate"]).toBeDefined();
  });
});
