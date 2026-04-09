import { describe, it, expect } from "vitest";
import type { MockLLMResponses } from "../../src/testutil/index";
import {
  getMockLLMProvider,
  buildMockLLMProvider,
} from "../../src/testutil/index";

function makeResponses(
  overrides: Partial<MockLLMResponses> = {},
): MockLLMResponses {
  return {
    stakeholder_responses: [],
    coach_responses: [],
    debrief_response: { narrative: "test narrative" },
    ...overrides,
  };
}

// ── MockProvider — stakeholder role ──────────────────────────────────────────

describe("MockProvider.call — stakeholder role", () => {
  it("tick_1 trigger returns matching tool_calls", async () => {
    const provider = buildMockLLMProvider(
      makeResponses({
        stakeholder_responses: [
          {
            trigger: "tick_1",
            tool_calls: [
              {
                tool: "send_message",
                params: { persona: "p1", channel: "#inc", message: "hi" },
              },
            ],
          },
        ],
      }),
    );
    const resp = await provider.call({
      role: "stakeholder",
      messages: [],
      tools: [],
      sessionId: "sess",
    });
    expect(resp.toolCalls.length).toBe(1);
    expect(resp.toolCalls[0].tool).toBe("send_message");
  });

  it("tick_99 (no match) returns empty response", async () => {
    const provider = buildMockLLMProvider(makeResponses());
    for (let i = 0; i < 98; i++) {
      await provider.call({
        role: "stakeholder",
        messages: [],
        tools: [],
        sessionId: "sess",
      });
    }
    const resp = await provider.call({
      role: "stakeholder",
      messages: [],
      tools: [],
      sessionId: "sess",
    });
    expect(resp.toolCalls).toHaveLength(0);
    expect(resp.text).toBeUndefined();
  });

  it("after_action trigger matches when user message contains action", async () => {
    const provider = buildMockLLMProvider(
      makeResponses({
        stakeholder_responses: [
          {
            trigger: "after_action:trigger_rollback:fixture-service",
            tool_calls: [
              {
                tool: "inject_log_entry",
                params: {
                  service: "svc",
                  level: "INFO",
                  message: "recovering",
                },
              },
            ],
          },
        ],
      }),
    );
    const resp = await provider.call({
      role: "stakeholder",
      messages: [
        {
          role: "user",
          content: "action: trigger_rollback service: fixture-service",
        },
      ],
      tools: [],
      sessionId: "sess",
    });
    expect(resp.toolCalls.length).toBe(1);
    expect(resp.toolCalls[0].tool).toBe("inject_log_entry");
  });

  it("after_action with wrong param: no match → empty response", async () => {
    const provider = buildMockLLMProvider(
      makeResponses({
        stakeholder_responses: [
          {
            trigger: "after_action:trigger_rollback:service-A",
            tool_calls: [{ tool: "send_message", params: {} }],
          },
        ],
      }),
    );
    const resp = await provider.call({
      role: "stakeholder",
      messages: [
        {
          role: "user",
          content: "action: trigger_rollback service: service-B",
        },
      ],
      tools: [],
      sessionId: "sess",
    });
    expect(resp.toolCalls).toHaveLength(0);
  });

  it("empty responses file: all calls return empty response", async () => {
    const provider = buildMockLLMProvider(makeResponses());
    const resp = await provider.call({
      role: "stakeholder",
      messages: [],
      tools: [],
      sessionId: "s",
    });
    expect(resp.toolCalls).toHaveLength(0);
  });
});

// ── MockProvider — coach role ─────────────────────────────────────────────────

describe("MockProvider.call — coach role", () => {
  it("on_demand trigger returns matching message", async () => {
    const provider = buildMockLLMProvider(
      makeResponses({
        coach_responses: [
          { trigger: "on_demand", message: "Check deployments." },
        ],
      }),
    );
    const resp = await provider.call({
      role: "coach",
      messages: [{ role: "user", content: "trainee asks for help" }],
      tools: [],
      sessionId: "sess",
    });
    expect(resp.text).toBe("Check deployments.");
  });

  it("proactive_tick_2 returns matching message", async () => {
    const provider = buildMockLLMProvider(
      makeResponses({
        coach_responses: [
          { trigger: "proactive_tick_2", message: "Have you checked logs?" },
        ],
      }),
    );
    await provider.call({
      role: "coach",
      messages: [],
      tools: [],
      sessionId: "sess",
    });
    const resp = await provider.call({
      role: "coach",
      messages: [],
      tools: [],
      sessionId: "sess",
    });
    expect(resp.text).toBe("Have you checked logs?");
  });
});

// ── MockProvider — debrief role ───────────────────────────────────────────────

describe("MockProvider.call — debrief role", () => {
  it("debrief role returns narrative text", async () => {
    const provider = buildMockLLMProvider(
      makeResponses({
        debrief_response: {
          narrative: "You identified the bad deploy and rolled back.",
        },
      }),
    );
    const resp = await provider.call({
      role: "debrief",
      messages: [],
      tools: [],
      sessionId: "sess",
    });
    expect(resp.text).toBe("You identified the bad deploy and rolled back.");
    expect(resp.toolCalls).toHaveLength(0);
  });
});

// ── testutil helpers ──────────────────────────────────────────────────────────

describe("testutil — getMockLLMProvider / buildMockLLMProvider", () => {
  it("getMockLLMProvider returns a working MockProvider", async () => {
    const provider = getMockLLMProvider();
    expect(provider).toBeDefined();
    const resp = await provider.call({
      role: "stakeholder",
      messages: [],
      tools: [],
      sessionId: "test",
    });
    expect(Array.isArray(resp.toolCalls)).toBe(true);
  });

  it("buildMockLLMProvider builds provider with given responses", async () => {
    const responses: MockLLMResponses = makeResponses({
      debrief_response: { narrative: "custom" },
    });
    const provider = buildMockLLMProvider(responses);
    const resp = await provider.call({
      role: "debrief",
      messages: [],
      tools: [],
      sessionId: "s",
    });
    expect(resp.text).toBe("custom");
  });
});
