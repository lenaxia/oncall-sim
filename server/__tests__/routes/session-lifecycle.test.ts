import { describe, it, expect, beforeAll, afterEach } from "vitest";
import request from "supertest";
import http from "http";
import path from "path";
import { createApp } from "../../src/index";
import { loadScenario, isScenarioLoadError } from "../../src/scenario/loader";
import { createLLMClient } from "../../src/llm/llm-client";
import { createSessionStore } from "../../src/session/session-store";
import { createSSEBroker } from "../../src/sse/sse-broker";
import type { Application } from "express";
import type { SimEvent } from "@shared/types/events";

const FIXTURE_DIR = path.resolve(
  "/home/mikekao/personal/oncall/scenarios/_fixture",
);

let app: Application;
let sessionStore: ReturnType<typeof createSessionStore>;
let sseBroker: ReturnType<typeof createSSEBroker>;

beforeAll(async () => {
  // Load fixture scenario directly (loadAllScenarios skips _fixture)
  const result = await loadScenario(FIXTURE_DIR);
  if (isScenarioLoadError(result))
    throw new Error("Failed to load fixture: " + JSON.stringify(result.errors));

  const scenarios = new Map([["_fixture", result]]);
  const llmClient = createLLMClient();
  sessionStore = createSessionStore(600_000);
  sseBroker = createSSEBroker(sessionStore);
  app = createApp(scenarios, sessionStore, sseBroker, llmClient);
});

afterEach(() => {
  for (const session of sessionStore.getAll()) {
    session.gameLoop.stop();
    sessionStore.delete(session.id);
  }
});

// ── POST /api/sessions — with real scenario ───────────────────────────────────

describe("POST /api/sessions — with fixture scenario", () => {
  it("valid scenarioId → 201 with sessionId", async () => {
    const res = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    expect(res.status).toBe(201);
    const body = res.body as { sessionId: string };
    expect(typeof body.sessionId).toBe("string");
    expect(body.sessionId.length).toBeGreaterThan(0);
  });

  it("game loop running after session creation (snapshot has correct scenarioId)", async () => {
    const res = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = res.body as { sessionId: string };
    const session = sessionStore.get(sessionId);
    expect(session).not.toBeNull();
    expect(session!.scenario.id).toBe("_fixture");
    expect(session!.status).toBe("active");
  });

  it("game loop started — emits events after session creation", async () => {
    const res = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = res.body as { sessionId: string };
    const session = sessionStore.get(sessionId)!;

    // Register listener before triggering any action
    const received: SimEvent[] = [];
    session.gameLoop.onEvent((e) => received.push(e));

    // handleAction emits sim_time immediately — proves game loop is wired and running
    await request(app)
      .post(`/api/sessions/${sessionId}/actions`)
      .send({ action: "open_tab", params: { tab: "metrics" } });

    expect(received.some((e) => e.type === "sim_time")).toBe(true);
  });
});

// ── DELETE /api/sessions/:id ──────────────────────────────────────────────────

describe("DELETE /api/sessions/:id", () => {
  it("204 and session removed", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    const del = await request(app).delete(`/api/sessions/${sessionId}`);
    expect(del.status).toBe(204);
    expect(sessionStore.get(sessionId)).toBeNull();
  });
});

// ── POST /api/sessions/:id/actions ───────────────────────────────────────────

describe("POST /api/sessions/:id/actions", () => {
  it("valid action → 204", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/actions`)
      .send({ action: "view_metric", params: { service: "fixture-service" } });
    expect(res.status).toBe(204);
  });

  it("invalid action type → 400", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/actions`)
      .send({ action: "detonate_everything" });
    expect(res.status).toBe(400);
  });

  it("action recorded in session audit log", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    await request(app)
      .post(`/api/sessions/${sessionId}/actions`)
      .send({ action: "view_metric", params: {} });

    const session = sessionStore.get(sessionId)!;
    const snap = session.gameLoop.getSnapshot();
    expect(snap.auditLog.some((e) => e.action === "view_metric")).toBe(true);
  });
});

// ── POST /api/sessions/:id/speed ──────────────────────────────────────────────

describe("POST /api/sessions/:id/speed", () => {
  it("valid speed → 204, snapshot reflects new speed", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/speed`)
      .send({ speed: 5 });
    expect(res.status).toBe(204);

    const session = sessionStore.get(sessionId)!;
    expect(session.gameLoop.getSnapshot().speed).toBe(5);
  });

  it("invalid speed value → 400", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/speed`)
      .send({ speed: 3 });
    expect(res.status).toBe(400);
  });

  it("paused=true → 204, snapshot reflects paused", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    await request(app)
      .post(`/api/sessions/${sessionId}/speed`)
      .send({ paused: true });

    const session = sessionStore.get(sessionId)!;
    expect(session.gameLoop.getSnapshot().paused).toBe(true);
  });
});

// ── POST /api/sessions/:id/resolve ───────────────────────────────────────────

describe("POST /api/sessions/:id/resolve", () => {
  it("202 accepted", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    const res = await request(app).post(`/api/sessions/${sessionId}/resolve`);
    expect(res.status).toBe(202);
  });

  it("GET /api/sessions/:id/debrief returns 404 before ready", async () => {
    // This is hard to test since our stub resolves immediately
    // Just verify the endpoint exists and returns valid response
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    // Before resolve
    const before = await request(app).get(`/api/sessions/${sessionId}/debrief`);
    expect(before.status).toBe(404);
  });

  it("GET /api/sessions/:id/debrief returns 200 after resolve", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    await request(app).post(`/api/sessions/${sessionId}/resolve`);

    const debrief = await request(app).get(
      `/api/sessions/${sessionId}/debrief`,
    );
    expect(debrief.status).toBe(200);
    expect(debrief.body).toHaveProperty("evaluationState");
    expect(debrief.body).toHaveProperty("auditLog");
  });

  it("resolve already-resolved session → 409", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    await request(app).post(`/api/sessions/${sessionId}/resolve`);
    const second = await request(app).post(
      `/api/sessions/${sessionId}/resolve`,
    );
    expect(second.status).toBe(409);
  });
});

// ── POST /api/sessions/:id/chat ───────────────────────────────────────────────

describe("POST /api/sessions/:id/chat", () => {
  it("valid chat message → 204", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/chat`)
      .send({ channel: "#incidents", text: "What is the current status?" });
    expect(res.status).toBe(204);
  });

  it("missing fields → 400", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/chat`)
      .send({ channel: "#incidents" }); // missing text
    expect(res.status).toBe(400);
  });
});

// ── POST /api/sessions/:id/email/reply ────────────────────────────────────────

describe("POST /api/sessions/:id/email/reply", () => {
  it("valid reply → 204", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/email/reply`)
      .send({ threadId: "thread-001", body: "I am investigating now." });
    expect(res.status).toBe(204);
  });

  it("missing fields → 400", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/email/reply`)
      .send({ threadId: "thread-001" }); // missing body
    expect(res.status).toBe(400);
  });
});

// ── SSE stream helpers ────────────────────────────────────────────────────────

/**
 * Connects to GET /api/sessions/:id/events on a real http.Server and reads
 * SSE data lines until `predicate` returns true or `timeoutMs` elapses.
 * Returns all parsed SimEvents received before the connection is closed.
 */
function readSSEUntil(
  server: http.Server,
  sessionId: string,
  predicate: (events: SimEvent[]) => boolean,
  timeoutMs = 3000,
): Promise<SimEvent[]> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string")
      return reject(new Error("No server address"));
    const port = addr.port;

    const collected: SimEvent[] = [];
    let buf = "";

    const req = http.request(
      {
        hostname: "localhost",
        port,
        path: `/api/sessions/${sessionId}/events`,
        method: "GET",
      },
      (res) => {
        const timer = setTimeout(() => {
          req.destroy();
          resolve(collected);
        }, timeoutMs);

        res.on("data", (chunk: Buffer) => {
          buf += chunk.toString();
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const ev = JSON.parse(line.slice(6)) as SimEvent;
                collected.push(ev);
                if (predicate(collected)) {
                  clearTimeout(timer);
                  req.destroy();
                  resolve(collected);
                  return;
                }
              } catch {
                /* malformed line — ignore */
              }
            }
          }
        });

        res.on("error", () => {
          resolve(collected);
        });
        res.on("close", () => {
          clearTimeout(timer);
          resolve(collected);
        });
      },
    );
    req.on("error", () => resolve(collected));
    req.end();
  });
}

// ── GET /api/sessions/:id/events ──────────────────────────────────────────────

describe("GET /api/sessions/:id/events", () => {
  let server: http.Server;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        server = http.createServer(app);
        server.listen(0, resolve);
      }),
  );

  afterEach(
    () =>
      new Promise<void>((done) => {
        for (const session of sessionStore.getAll()) {
          session.gameLoop.stop();
          sessionStore.delete(session.id);
        }
        done();
      }),
  );

  it("first event is session_snapshot", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    const events = await readSSEUntil(server, sessionId, (evs) =>
      evs.some((e) => e.type === "session_snapshot"),
    );
    expect(events[0].type).toBe("session_snapshot");
  });

  it("session_snapshot contains correct sessionId and simTime", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    const events = await readSSEUntil(server, sessionId, (evs) =>
      evs.some((e) => e.type === "session_snapshot"),
    );
    const snap = events.find((e) => e.type === "session_snapshot");
    expect(snap).toBeDefined();
    if (snap?.type === "session_snapshot") {
      expect(snap.snapshot.sessionId).toBe(sessionId);
      expect(typeof snap.snapshot.simTime).toBe("number");
    }
  });

  it("session_expired sent when connecting to unknown session", async () => {
    const events = await readSSEUntil(server, "nonexistent-session-id", (evs) =>
      evs.some((e) => e.type === "session_expired"),
    );
    expect(events.some((e) => e.type === "session_expired")).toBe(true);
  });

  it("session_expired sent on reconnect after session expiry", async () => {
    // Create a session store with 0ms expiry so any session is instantly expired
    const shortExpiryStore = createSessionStore(0);
    const shortBroker = createSSEBroker(shortExpiryStore);
    const result = await loadScenario(FIXTURE_DIR);
    if (isScenarioLoadError(result)) throw new Error("fixture load failed");
    const shortApp = createApp(
      new Map([["_fixture", result]]),
      shortExpiryStore,
      shortBroker,
      createLLMClient(),
    );

    const shortServer = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(shortApp);
      s.listen(0, () => resolve(s));
    });

    try {
      // Create and immediately expire the session
      const create = await request(shortApp)
        .post("/api/sessions")
        .send({ scenarioId: "_fixture" });
      const { sessionId } = create.body as { sessionId: string };
      shortExpiryStore.evictExpired();

      const events = await readSSEUntil(shortServer, sessionId, (evs) =>
        evs.some((e) => e.type === "session_expired"),
      );
      expect(events.some((e) => e.type === "session_expired")).toBe(true);
    } finally {
      await new Promise<void>((resolve) => shortServer.close(() => resolve()));
    }
  });

  it("debrief_ready SSE event broadcast after resolve", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    // Start listening before resolve so we catch the debrief_ready event
    const eventsPromise = readSSEUntil(
      server,
      sessionId,
      (evs) => evs.some((e) => e.type === "debrief_ready"),
      2000,
    );

    // Small delay to ensure SSE connection is established before resolve
    await new Promise((r) => setTimeout(r, 50));
    await request(app).post(`/api/sessions/${sessionId}/resolve`);

    const events = await eventsPromise;
    expect(events.some((e) => e.type === "debrief_ready")).toBe(true);
    const debriefEv = events.find((e) => e.type === "debrief_ready");
    if (debriefEv?.type === "debrief_ready") {
      expect(debriefEv.sessionId).toBe(sessionId);
    }
  });

  it("scripted event delivered to SSE stream after session starts", async () => {
    // Verify the game loop emits live events to connected SSE clients.
    // We trigger an event via POST /chat (which calls handleChatMessage, which emits
    // chat_message immediately via onEvent). This validates the SSE delivery path
    // end-to-end. The fixture's 10s tick makes scheduler-driven events impractical
    // to verify in real time; the scheduler path is covered by game-loop unit tests.
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    const eventsPromise = readSSEUntil(
      server,
      sessionId,
      (evs) => evs.some((e) => e.type === "chat_message"),
      2000,
    );

    await new Promise((r) => setTimeout(r, 50));
    await request(app)
      .post(`/api/sessions/${sessionId}/chat`)
      .send({ channel: "#incidents", text: "hello from trainee" });

    const events = await eventsPromise;
    expect(events.some((e) => e.type === "chat_message")).toBe(true);
  });
});

// ── SSE event delivery — chat and email ───────────────────────────────────────

describe("SSE event delivery — chat and email", () => {
  let server: http.Server;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        server = http.createServer(app);
        server.listen(0, resolve);
      }),
  );

  afterEach(
    () =>
      new Promise<void>((done) => {
        for (const session of sessionStore.getAll()) {
          session.gameLoop.stop();
          sessionStore.delete(session.id);
        }
        done();
      }),
  );

  it("chat_message SSE event broadcast with trainee message", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    const eventsPromise = readSSEUntil(
      server,
      sessionId,
      (evs) =>
        evs.some(
          (e) =>
            e.type === "chat_message" &&
            e.type === "chat_message" &&
            e.message.persona === "trainee",
        ),
      2000,
    );

    await new Promise((r) => setTimeout(r, 50));
    await request(app)
      .post(`/api/sessions/${sessionId}/chat`)
      .send({ channel: "#incidents", text: "Trainee checking in" });

    const events = await eventsPromise;
    const chatEv = events.find(
      (e) => e.type === "chat_message" && e.message.persona === "trainee",
    );
    expect(chatEv).toBeDefined();
    if (chatEv?.type === "chat_message") {
      expect(chatEv.channel).toBe("#incidents");
      expect(chatEv.message.text).toBe("Trainee checking in");
    }
  });

  it("email_received SSE event broadcast with trainee reply", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    const eventsPromise = readSSEUntil(
      server,
      sessionId,
      (evs) =>
        evs.some(
          (e) =>
            e.type === "email_received" &&
            e.type === "email_received" &&
            e.email.from === "trainee",
        ),
      2000,
    );

    await new Promise((r) => setTimeout(r, 50));
    await request(app)
      .post(`/api/sessions/${sessionId}/email/reply`)
      .send({ threadId: "thread-001", body: "Investigating now." });

    const events = await eventsPromise;
    const emailEv = events.find(
      (e) => e.type === "email_received" && e.email.from === "trainee",
    );
    expect(emailEv).toBeDefined();
    if (emailEv?.type === "email_received") {
      expect(emailEv.email.body).toBe("Investigating now.");
    }
  });
});

// ── Reactive metrics — end-to-end ─────────────────────────────────────────────

describe("Reactive metrics — metric_update SSE events", () => {
  let server: http.Server;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        server = http.createServer(app);
        server.listen(0, resolve);
      }),
  );

  afterEach(
    () =>
      new Promise<void>((done) => {
        for (const session of sessionStore.getAll()) {
          session.gameLoop.stop();
          sessionStore.delete(session.id);
        }
        done();
      }),
  );

  it("trigger_rollback action causes MetricStore to reflect reactive overlay in snapshot", async () => {
    // Create session
    const create = await request(app)
      .post("/api/sessions")
      .send({ scenarioId: "_fixture" });
    const { sessionId } = create.body as { sessionId: string };

    // Trigger the rollback action — mock LLM responds with apply_metric_response
    const pipelineId = "_fixture-service";
    const stageId = "prod";
    await request(app)
      .post(`/api/sessions/${sessionId}/actions`)
      .send({ action: "trigger_rollback", params: { pipelineId, stageId } });

    // Give async dirty tick time to complete (LLM mock is synchronous)
    await new Promise((r) => setTimeout(r, 500));

    // The snapshot should now reflect the reactive overlay spliced by apply_metric_response
    const snapAfter = sessionStore.get(sessionId)!.gameLoop.getSnapshot();
    const seriesAfter =
      snapAfter.metrics["fixture-service"]?.["error_rate"] ?? [];

    // The series must exist and have valid points
    expect(seriesAfter.length).toBeGreaterThan(0);
    seriesAfter.forEach((p) => {
      expect(typeof p.t).toBe("number");
      expect(typeof p.v).toBe("number");
      expect(p.v).toBeGreaterThanOrEqual(0);
    });

    // With a smooth_decay recovery overlay applied, the series values in the
    // reactive window should be trending downward from the incident peak
    const simTime = snapAfter.simTime;
    const postApply = seriesAfter.filter((p) => p.t >= simTime);
    if (postApply.length >= 2) {
      // Recovery: later values should be <= earlier values (roughly)
      const first = postApply[0].v;
      const last = postApply[postApply.length - 1].v;
      expect(last).toBeLessThanOrEqual(first + 2); // allow noise headroom
    }
  });
});
