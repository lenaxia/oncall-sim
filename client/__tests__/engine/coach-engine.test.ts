import { describe, it, expect, vi } from "vitest";
import { createCoachEngine } from "../../src/engine/coach-engine";
import type { CoachContext } from "../../src/engine/coach-engine";
import type { LLMClient, LLMResponse } from "../../src/llm/llm-client";
import { LLMError } from "../../src/llm/llm-client";
import { buildLoadedScenario } from "../../src/testutil/index";
import type { SimStateStoreSnapshot } from "../../src/engine/sim-state-store";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildMockLLMClient(response: LLMResponse | Error): LLMClient {
  return {
    call: vi.fn().mockImplementation(() => {
      if (response instanceof Error) return Promise.reject(response);
      return Promise.resolve(response);
    }),
  };
}

const EMPTY_STORE: SimStateStoreSnapshot = {
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
};

function buildContext(overrides: Partial<CoachContext> = {}): CoachContext {
  return {
    sessionId: "test-session",
    scenario: buildLoadedScenario(),
    simTime: 300,
    auditLog: [],
    simState: EMPTY_STORE,
    ...overrides,
  };
}

// tool call response that sends a coach message
function coachToolResponse(text: string): LLMResponse {
  return {
    toolCalls: [{ tool: "send_coach_message", params: { message: text } }],
  };
}

// ── proactiveTick ─────────────────────────────────────────────────────────────

describe("CoachEngine.proactiveTick", () => {
  it("returns CoachMessage with proactive:true when LLM calls send_coach_message", async () => {
    const llm = buildMockLLMClient(coachToolResponse("Check the error rate."));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    const msg = await engine.proactiveTick(buildContext());
    expect(msg).not.toBeNull();
    expect(msg!.proactive).toBe(true);
    expect(msg!.text).toBe("Check the error rate.");
    expect(msg!.id).toBeTruthy();
  });

  it("returns null when LLM returns no tool calls", async () => {
    const llm = buildMockLLMClient({ toolCalls: [] });
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    const msg = await engine.proactiveTick(buildContext());
    expect(msg).toBeNull();
  });

  it("returns null on LLMError after retries — proactive tick never throws", async () => {
    const llm = buildMockLLMClient(new LLMError("timeout", "timeout"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    await expect(engine.proactiveTick(buildContext())).resolves.toBeNull();
  });

  it("returns null when called before minimum proactive interval has elapsed", async () => {
    const llm = buildMockLLMClient(coachToolResponse("Something proactive."));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    const ctx = buildContext({ simTime: 100 });
    // First call — should return a message
    const first = await engine.proactiveTick(ctx);
    expect(first).not.toBeNull();
    // Second call at same simTime — minimum interval (180s) not elapsed
    const second = await engine.proactiveTick(ctx);
    expect(second).toBeNull();
  });

  it("returns a message once minimum interval has elapsed after previous proactive", async () => {
    const llm = buildMockLLMClient(coachToolResponse("Another nudge."));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    await engine.proactiveTick(buildContext({ simTime: 0 }));
    const msg = await engine.proactiveTick(buildContext({ simTime: 200 }));
    expect(msg).not.toBeNull();
  });

  it("never fires proactive messages on expert level — returns null without calling LLM", async () => {
    const llm = buildMockLLMClient(coachToolResponse("Proactive nudge."));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "expert",
    );
    // Even with a large simTime gap, expert never proactively reaches out
    const msg = await engine.proactiveTick(buildContext({ simTime: 9999 }));
    expect(msg).toBeNull();
    // LLM should not even be called
    expect((llm.call as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("fires proactive messages on intermediate level", async () => {
    const llm = buildMockLLMClient(coachToolResponse("Intermediate hint."));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "intermediate",
    );
    const msg = await engine.proactiveTick(buildContext({ simTime: 300 }));
    expect(msg).not.toBeNull();
  });

  it("message id is unique per call", async () => {
    const llm = buildMockLLMClient(coachToolResponse("nudge"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    const first = await engine.proactiveTick(buildContext({ simTime: 0 }));
    const second = await engine.proactiveTick(buildContext({ simTime: 200 }));
    expect(first!.id).not.toBe(second!.id);
  });

  it("passes send_coach_message tool definition to LLM", async () => {
    const llm = buildMockLLMClient({ toolCalls: [] });
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    await engine.proactiveTick(buildContext());
    const callArgs = (llm.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.tools).toSatisfy((tools: Array<{ name: string }>) =>
      tools.some((t) => t.name === "send_coach_message"),
    );
  });

  it("accepts response.text when LLM writes prose instead of using the tool", async () => {
    const llm = buildMockLLMClient({
      toolCalls: [],
      text: "Look at cache_hit_rate.",
    });
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    const msg = await engine.proactiveTick(buildContext());
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe("Look at cache_hit_rate.");
    expect(msg!.proactive).toBe(true);
  });

  it("filters passive actions from the audit log sent to the LLM", async () => {
    const llm = buildMockLLMClient(coachToolResponse("nudge"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    await engine.proactiveTick(
      buildContext({
        auditLog: [
          { simTime: 10, action: "open_tab", params: { tab: "email" } },
          { simTime: 20, action: "ack_page", params: {} },
          { simTime: 30, action: "view_metric", params: {} },
        ],
      }),
    );
    const callArgs = (llm.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userMsg = callArgs.messages.find(
      (m: { role: string }) => m.role === "user",
    );
    expect(userMsg.content).toContain("ack_page");
    expect(userMsg.content).not.toContain("open_tab");
    expect(userMsg.content).not.toContain("view_metric");
  });
});

// ── respondToTrainee ──────────────────────────────────────────────────────────

describe("CoachEngine.respondToTrainee", () => {
  it("returns CoachMessage with proactive:false when LLM calls send_coach_message", async () => {
    const llm = buildMockLLMClient(coachToolResponse("Look at the logs."));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    const msg = await engine.respondToTrainee(
      "What should I check?",
      buildContext(),
    );
    expect(msg.proactive).toBe(false);
    expect(msg.text).toBe("Look at the logs.");
  });

  it("throws after all retries on persistent LLMError — never silently swallows", async () => {
    const llm = buildMockLLMClient(
      new LLMError("provider_error", "provider_error"),
    );
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    await expect(
      engine.respondToTrainee("Help!", buildContext()),
    ).rejects.toBeInstanceOf(LLMError);
  });

  it("accepts response.text when LLM returns no tool calls (model wrote prose)", async () => {
    const llm = buildMockLLMClient({ toolCalls: [], text: "Check the logs." });
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    const msg = await engine.respondToTrainee("Help!", buildContext());
    expect(msg.proactive).toBe(false);
    expect(msg.text).toBe("Check the logs.");
  });

  it("throws when LLM returns neither tool call nor text", async () => {
    const llm = buildMockLLMClient({ toolCalls: [] });
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    await expect(
      engine.respondToTrainee("Help!", buildContext()),
    ).rejects.toBeInstanceOf(LLMError);
  });

  it("includes trainee message in user prompt", async () => {
    const llm = buildMockLLMClient(coachToolResponse("Sure thing."));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    await engine.respondToTrainee("How do I fix this?", buildContext());
    const callArgs = (llm.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.messages).toSatisfy(
      (msgs: Array<{ role: string; content: string }>) =>
        msgs.some((m) => m.content.includes("How do I fix this?")),
    );
  });

  it("works on expert level — always responds when asked", async () => {
    const llm = buildMockLLMClient(coachToolResponse("Root cause hint."));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "expert",
    );
    const msg = await engine.respondToTrainee(
      "What is the root cause?",
      buildContext(),
    );
    expect(msg.text).toBe("Root cause hint.");
  });

  it("returns non-empty id on response", async () => {
    const llm = buildMockLLMClient(coachToolResponse("ok"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    const msg = await engine.respondToTrainee("help", buildContext());
    expect(msg.id).toBeTruthy();
  });

  it("passes send_coach_message tool definition to LLM", async () => {
    const llm = buildMockLLMClient(coachToolResponse("yes"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    await engine.respondToTrainee("help", buildContext());
    const callArgs = (llm.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.tools).toSatisfy((tools: Array<{ name: string }>) =>
      tools.some((t) => t.name === "send_coach_message"),
    );
  });
});

// ── System prompt differs by level ────────────────────────────────────────────

describe("CoachEngine system prompt by level", () => {
  it("system message contains 'novice' context cues for novice level", async () => {
    const llm = buildMockLLMClient(coachToolResponse("tip"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    await engine.respondToTrainee("help", buildContext());
    const callArgs = (llm.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const systemMsg = callArgs.messages.find(
      (m: { role: string }) => m.role === "system",
    );
    expect(systemMsg).toBeDefined();
    expect(systemMsg.content.toLowerCase()).toContain("novice");
  });

  it("system message contains 'expert' context cues for expert level", async () => {
    const llm = buildMockLLMClient(coachToolResponse("tip"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "expert",
    );
    await engine.respondToTrainee("help", buildContext());
    const callArgs = (llm.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const systemMsg = callArgs.messages.find(
      (m: { role: string }) => m.role === "system",
    );
    expect(systemMsg).toBeDefined();
    expect(systemMsg.content.toLowerCase()).toContain("expert");
  });

  it("uses role:'coach' when calling the LLM", async () => {
    const llm = buildMockLLMClient(coachToolResponse("tip"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    await engine.respondToTrainee("help", buildContext());
    const callArgs = (llm.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.role).toBe("coach");
  });
});
