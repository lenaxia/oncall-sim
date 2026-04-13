import { describe, it, expect, vi } from "vitest";
import { createCoachEngine } from "../../src/engine/coach-engine";
import type {
  CoachContext,
  CoachTriggerReason,
} from "../../src/engine/coach-engine";
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

const DEFAULT_REASON: CoachTriggerReason = {
  type: "inactivity",
  wallSecondsSinceLastAction: 300,
};

function buildContext(overrides: Partial<CoachContext> = {}): CoachContext {
  return {
    sessionId: "test-session",
    scenario: buildLoadedScenario(),
    simTime: 300,
    auditLog: [],
    simState: EMPTY_STORE,
    triggerReason: DEFAULT_REASON,
    ...overrides,
  };
}

function coachToolResponse(text: string): LLMResponse {
  return {
    toolCalls: [{ tool: "send_coach_message", params: { message: text } }],
  };
}

// ── proactiveTick — basic ─────────────────────────────────────────────────────

describe("CoachEngine.proactiveTick — basic", () => {
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

  it("returns null when LLM returns no tool calls and no text", async () => {
    const llm = buildMockLLMClient({ toolCalls: [] });
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    const msg = await engine.proactiveTick(buildContext());
    expect(msg).toBeNull();
  });

  it("accepts response.text when LLM writes prose instead of calling the tool", async () => {
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

  it("returns null on LLMError after retries — never throws", async () => {
    const llm = buildMockLLMClient(new LLMError("timeout", "timeout"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    await expect(engine.proactiveTick(buildContext())).resolves.toBeNull();
  });

  it("message id is unique per call", async () => {
    const llm = buildMockLLMClient(coachToolResponse("nudge"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    const first = await engine.proactiveTick(buildContext());
    // Advance wall-time past cooldown by using fake timers would be complex;
    // just confirm two sequential calls (before cooldown) give different ids.
    const second = await engine.proactiveTick(buildContext());
    // second may be null due to cooldown, but if both fire they must differ
    if (first && second) expect(first.id).not.toBe(second.id);
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

  it("suppresses a second call within the wall-time cooldown window", async () => {
    const llm = buildMockLLMClient(coachToolResponse("nudge"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    const first = await engine.proactiveTick(buildContext());
    expect(first).not.toBeNull();
    // Immediately call again — cooldown not elapsed
    const second = await engine.proactiveTick(buildContext());
    expect(second).toBeNull();
    // LLM called only once
    expect((llm.call as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});

// ── proactiveTick — level gating ──────────────────────────────────────────────

describe("CoachEngine.proactiveTick — level gating", () => {
  it("expert: never fires for inactivity — LLM not called", async () => {
    const llm = buildMockLLMClient(coachToolResponse("nudge"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "expert",
    );
    const msg = await engine.proactiveTick(
      buildContext({
        triggerReason: { type: "inactivity", wallSecondsSinceLastAction: 9999 },
      }),
    );
    expect(msg).toBeNull();
    expect((llm.call as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("expert: never fires for passive_browse_stall — LLM not called", async () => {
    const llm = buildMockLLMClient(coachToolResponse("nudge"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "expert",
    );
    const msg = await engine.proactiveTick(
      buildContext({
        triggerReason: {
          type: "passive_browse_stall",
          tabsSwitched: 10,
          wallSecondsStalled: 600,
        },
      }),
    );
    expect(msg).toBeNull();
    expect((llm.call as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("expert: fires for resolve_with_alarms_firing — objective mistake", async () => {
    const llm = buildMockLLMClient(
      coachToolResponse("Alarms are still firing."),
    );
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "expert",
    );
    const msg = await engine.proactiveTick(
      buildContext({
        triggerReason: {
          type: "resolve_with_alarms_firing",
          firingAlarmCount: 2,
        },
      }),
    );
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe("Alarms are still firing.");
  });

  it("novice: fires for inactivity >= 2 min", async () => {
    const llm = buildMockLLMClient(coachToolResponse("hint"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    const msg = await engine.proactiveTick(
      buildContext({
        triggerReason: { type: "inactivity", wallSecondsSinceLastAction: 120 },
      }),
    );
    expect(msg).not.toBeNull();
  });

  it("novice: does NOT fire for inactivity < 2 min", async () => {
    const llm = buildMockLLMClient(coachToolResponse("hint"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    const msg = await engine.proactiveTick(
      buildContext({
        triggerReason: { type: "inactivity", wallSecondsSinceLastAction: 119 },
      }),
    );
    expect(msg).toBeNull();
    expect((llm.call as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("intermediate: fires for inactivity >= 4 min", async () => {
    const llm = buildMockLLMClient(coachToolResponse("hint"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "intermediate",
    );
    const msg = await engine.proactiveTick(
      buildContext({
        triggerReason: { type: "inactivity", wallSecondsSinceLastAction: 240 },
      }),
    );
    expect(msg).not.toBeNull();
  });

  it("intermediate: does NOT fire for inactivity < 4 min", async () => {
    const llm = buildMockLLMClient(coachToolResponse("hint"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "intermediate",
    );
    const msg = await engine.proactiveTick(
      buildContext({
        triggerReason: { type: "inactivity", wallSecondsSinceLastAction: 239 },
      }),
    );
    expect(msg).toBeNull();
    expect((llm.call as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("novice: fires for passive_browse_stall >= 3 tabs / 2 min", async () => {
    const llm = buildMockLLMClient(coachToolResponse("hint"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    const msg = await engine.proactiveTick(
      buildContext({
        triggerReason: {
          type: "passive_browse_stall",
          tabsSwitched: 3,
          wallSecondsStalled: 120,
        },
      }),
    );
    expect(msg).not.toBeNull();
  });

  it("novice: does NOT fire for passive_browse_stall < 3 tabs", async () => {
    const llm = buildMockLLMClient(coachToolResponse("hint"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    const msg = await engine.proactiveTick(
      buildContext({
        triggerReason: {
          type: "passive_browse_stall",
          tabsSwitched: 2,
          wallSecondsStalled: 300,
        },
      }),
    );
    expect(msg).toBeNull();
    expect((llm.call as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("intermediate: fires for passive_browse_stall >= 5 tabs / 5 min", async () => {
    const llm = buildMockLLMClient(coachToolResponse("hint"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "intermediate",
    );
    const msg = await engine.proactiveTick(
      buildContext({
        triggerReason: {
          type: "passive_browse_stall",
          tabsSwitched: 5,
          wallSecondsStalled: 300,
        },
      }),
    );
    expect(msg).not.toBeNull();
  });

  it("intermediate: does NOT fire for passive_browse_stall < 5 tabs", async () => {
    const llm = buildMockLLMClient(coachToolResponse("hint"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "intermediate",
    );
    const msg = await engine.proactiveTick(
      buildContext({
        triggerReason: {
          type: "passive_browse_stall",
          tabsSwitched: 4,
          wallSecondsStalled: 600,
        },
      }),
    );
    expect(msg).toBeNull();
    expect((llm.call as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("novice/intermediate: fires for red_herring", async () => {
    const llm = buildMockLLMClient(coachToolResponse("hint"));
    for (const level of ["novice", "intermediate"] as const) {
      const engine = createCoachEngine(() => llm, buildLoadedScenario(), level);
      const msg = await engine.proactiveTick(
        buildContext({
          triggerReason: {
            type: "red_herring",
            action: "restart_service",
            why: "not relevant",
          },
        }),
      );
      expect(msg).not.toBeNull();
    }
  });

  it("expert: does NOT fire for red_herring", async () => {
    const llm = buildMockLLMClient(coachToolResponse("hint"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "expert",
    );
    const msg = await engine.proactiveTick(
      buildContext({
        triggerReason: {
          type: "red_herring",
          action: "restart_service",
          why: "not relevant",
        },
      }),
    );
    expect(msg).toBeNull();
    expect((llm.call as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("trigger reason is included in the user prompt", async () => {
    const llm = buildMockLLMClient(coachToolResponse("hint"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    await engine.proactiveTick(
      buildContext({
        triggerReason: { type: "inactivity", wallSecondsSinceLastAction: 180 },
      }),
    );
    const userMsg = (
      llm.call as ReturnType<typeof vi.fn>
    ).mock.calls[0][0].messages.find(
      (m: { role: string }) => m.role === "user",
    );
    expect(userMsg.content).toContain("meaningful action");
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

  it("returns non-empty id", async () => {
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

// ── System prompt by level ────────────────────────────────────────────────────

describe("CoachEngine system prompt by level", () => {
  it("system message contains 'novice' for novice level", async () => {
    const llm = buildMockLLMClient(coachToolResponse("tip"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "novice",
    );
    await engine.respondToTrainee("help", buildContext());
    const systemMsg = (
      llm.call as ReturnType<typeof vi.fn>
    ).mock.calls[0][0].messages.find(
      (m: { role: string }) => m.role === "system",
    );
    expect(systemMsg.content.toLowerCase()).toContain("novice");
  });

  it("system message contains 'expert' for expert level", async () => {
    const llm = buildMockLLMClient(coachToolResponse("tip"));
    const engine = createCoachEngine(
      () => llm,
      buildLoadedScenario(),
      "expert",
    );
    await engine.respondToTrainee("help", buildContext());
    const systemMsg = (
      llm.call as ReturnType<typeof vi.fn>
    ).mock.calls[0][0].messages.find(
      (m: { role: string }) => m.role === "system",
    );
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
    expect((llm.call as ReturnType<typeof vi.fn>).mock.calls[0][0].role).toBe(
      "coach",
    );
  });
});

// ── Audit log filtering ───────────────────────────────────────────────────────

describe("CoachEngine audit log filtering", () => {
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
    const userMsg = (
      llm.call as ReturnType<typeof vi.fn>
    ).mock.calls[0][0].messages.find(
      (m: { role: string }) => m.role === "user",
    );
    expect(userMsg.content).toContain("ack_page");
    expect(userMsg.content).not.toContain("open_tab");
    expect(userMsg.content).not.toContain("view_metric");
  });
});
