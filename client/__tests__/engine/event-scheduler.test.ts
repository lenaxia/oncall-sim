import { describe, it, expect, beforeEach } from "vitest";
import { createEventScheduler } from "../../src/engine/event-scheduler";
import {
  getFixtureScenario,
  clearFixtureCache,
} from "../../src/testutil/index";
import type { LoadedScenario } from "../../src/scenario/types";

beforeEach(() => clearFixtureCache());

describe("createEventScheduler — basic scheduling", () => {
  it("events at t=0 are returned on first tick with simTime=0", async () => {
    const scenario = await getFixtureScenario();
    const sched = createEventScheduler(scenario);
    const events = sched.tick(0);
    expect(events.length).toBeGreaterThan(0);
  });

  it("events at t=0 are NOT returned again on subsequent tick", async () => {
    const scenario = await getFixtureScenario();
    const sched = createEventScheduler(scenario);
    const first = sched.tick(0);
    const second = sched.tick(0);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBe(0);
  });

  it("events at t=30 are not returned until simTime >= 30", async () => {
    const base = await getFixtureScenario();
    const scenario: LoadedScenario = {
      ...base,
      logs: [
        {
          id: "log-late",
          atSecond: 30,
          level: "INFO",
          service: "svc",
          message: "late log",
        },
      ],
      emails: [],
      chat: { channels: base.chat.channels, messages: [] },
      tickets: [],
      alarms: [],
      cicd: { pipelines: [], deployments: [] },
    };
    const sched = createEventScheduler(scenario);
    expect(sched.tick(0).length).toBe(0);
    expect(sched.tick(15).length).toBe(0);
    const at30 = sched.tick(30);
    expect(at30.length).toBe(1);
    expect(at30[0].kind).toBe("log_entry");
  });

  it("each event returned exactly once", async () => {
    const base = await getFixtureScenario();
    const scenario: LoadedScenario = {
      ...base,
      emails: [
        {
          id: "e1",
          atSecond: 0,
          threadId: "t1",
          from: "fixture-persona",
          to: "trainee",
          subject: "hi",
          body: "body",
        },
      ],
      chat: { channels: base.chat.channels, messages: [] },
      tickets: [],
      logs: [],
      alarms: [],
      cicd: { pipelines: [], deployments: [] },
    };
    const sched = createEventScheduler(scenario);
    const a = sched.tick(0);
    const b = sched.tick(0);
    const c = sched.tick(60);
    expect(a.length).toBe(1);
    expect(b.length).toBe(0);
    expect(c.length).toBe(0);
  });

  it("multiple events at same t all returned in same tick call", async () => {
    const base = await getFixtureScenario();
    const scenario: LoadedScenario = {
      ...base,
      emails: [
        {
          id: "e1",
          atSecond: 10,
          threadId: "t1",
          from: "fixture-persona",
          to: "trainee",
          subject: "s1",
          body: "b1",
        },
        {
          id: "e2",
          atSecond: 10,
          threadId: "t2",
          from: "fixture-persona",
          to: "trainee",
          subject: "s2",
          body: "b2",
        },
      ],
      chat: { channels: base.chat.channels, messages: [] },
      tickets: [],
      logs: [],
      alarms: [],
      cicd: { pipelines: [], deployments: [] },
    };
    const sched = createEventScheduler(scenario);
    const events = sched.tick(10);
    expect(events.filter((e) => e.kind === "email").length).toBe(2);
  });

  it("reset() causes events to fire again from the start", async () => {
    const base = await getFixtureScenario();
    const scenario: LoadedScenario = {
      ...base,
      emails: [
        {
          id: "e1",
          atSecond: 0,
          threadId: "t1",
          from: "fixture-persona",
          to: "trainee",
          subject: "s",
          body: "b",
        },
      ],
      chat: { channels: base.chat.channels, messages: [] },
      tickets: [],
      logs: [],
      alarms: [],
      cicd: { pipelines: [], deployments: [] },
    };
    const sched = createEventScheduler(scenario);
    const first = sched.tick(0);
    expect(first.length).toBe(1);
    sched.reset();
    const second = sched.tick(0);
    expect(second.length).toBe(1);
  });
});

describe("createEventScheduler — auto_page alarm expansion", () => {
  it("auto_page alarm fires alarm_fired + email + chat_message", async () => {
    const base = await getFixtureScenario();
    const sched = createEventScheduler(base);
    const events = sched.tick(0);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("alarm_fired");
    expect(kinds).toContain("email");
    expect(kinds).toContain("chat_message");
  });

  it("auto_page email is from pagerduty-bot", async () => {
    const base = await getFixtureScenario();
    const sched = createEventScheduler(base);
    const events = sched.tick(600);
    const pageEmail = events.find(
      (e) =>
        e.kind === "email" &&
        (e as { kind: "email"; email: { from: string } }).email?.from ===
          "pagerduty-bot",
    );
    expect(pageEmail).toBeDefined();
  });

  it("non-auto-page alarm fires only alarm_fired", async () => {
    const base = await getFixtureScenario();
    const scenario: LoadedScenario = {
      ...base,
      alarms: [{ ...base.alarms[0], autoPage: false, pageMessage: undefined }],
      emails: [],
      chat: { channels: base.chat.channels, messages: [] },
      tickets: [],
      logs: [],
      cicd: { pipelines: [], deployments: [] },
    };
    const sched = createEventScheduler(scenario);
    const events = sched.tick(0);
    expect(events.filter((e) => e.kind === "alarm_fired").length).toBe(1);
    expect(events.filter((e) => e.kind === "email").length).toBe(0);
  });
});
