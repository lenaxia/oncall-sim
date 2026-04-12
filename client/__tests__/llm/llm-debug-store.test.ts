import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  recordRequest,
  recordResponse,
  getEntries,
  clearEntries,
  subscribe,
  formatEntryForClipboard,
  _resetForTesting,
} from "../../src/llm/llm-debug-store";
import type { LLMRequest, LLMResponse } from "../../src/llm/llm-client";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    role: "stakeholder",
    sessionId: "test-session",
    messages: [
      { role: "system", content: "You are a simulator." },
      { role: "user", content: "## Trainee Action\nt=60 trigger_rollback {}" },
    ],
    tools: [],
    ...overrides,
  };
}

function makeMetricsRequest(): LLMRequest {
  return makeRequest({
    tools: [
      {
        name: "select_metric_reaction",
        description: "Select a metric reaction",
        parameters: {},
      },
    ],
  });
}

function makeResponse(overrides: Partial<LLMResponse> = {}): LLMResponse {
  return {
    toolCalls: [],
    ...overrides,
  };
}

beforeEach(() => {
  _resetForTesting();
});

// ── recordRequest ─────────────────────────────────────────────────────────────

describe("recordRequest", () => {
  it("adds an entry to the store", () => {
    recordRequest(makeRequest());
    expect(getEntries()).toHaveLength(1);
  });

  it("returns a unique id for each call", () => {
    const id1 = recordRequest(makeRequest());
    const id2 = recordRequest(makeRequest());
    expect(id1).not.toBe(id2);
  });

  it("sets response to null and durationMs to null initially", () => {
    recordRequest(makeRequest());
    const [entry] = getEntries();
    expect(entry.response).toBeNull();
    expect(entry.durationMs).toBeNull();
  });

  it("stores the full request", () => {
    const req = makeRequest();
    recordRequest(req);
    expect(getEntries()[0].request).toEqual(req);
  });

  it("classifies a stakeholder request as 'stakeholder'", () => {
    recordRequest(makeRequest({ role: "stakeholder", tools: [] }));
    expect(getEntries()[0].role).toBe("stakeholder");
  });

  it("classifies a request with select_metric_reaction tool as 'metrics'", () => {
    recordRequest(makeMetricsRequest());
    expect(getEntries()[0].role).toBe("metrics");
  });

  it("classifies a coach request as 'coach'", () => {
    recordRequest(makeRequest({ role: "coach" }));
    expect(getEntries()[0].role).toBe("coach");
  });

  it("classifies a debrief request as 'debrief'", () => {
    recordRequest(makeRequest({ role: "debrief" }));
    expect(getEntries()[0].role).toBe("debrief");
  });

  it("extracts label from '## Trainee Action' line in user message", () => {
    recordRequest(makeRequest());
    expect(getEntries()[0].label).toBe("trigger_rollback");
  });

  it("extracts label from '## Trainee Actions' (plural) line", () => {
    recordRequest(
      makeRequest({
        messages: [
          { role: "system", content: "sys" },
          {
            role: "user",
            content:
              "## Trainee Actions (2 since last reaction)\n  t=60 scale_cluster {}\n  t=60 restart_service {} [PRIMARY]",
          },
        ],
      }),
    );
    // [PRIMARY] tag takes priority — should return restart_service
    expect(getEntries()[0].label).toBe("restart_service");
  });

  it("extracts label from [PRIMARY] tag for multi-action windows", () => {
    recordRequest(
      makeRequest({
        messages: [
          { role: "system", content: "sys" },
          {
            role: "user",
            content:
              "## Trainee Actions (3 since last reaction)\n  t=120.009 restart_service {}\n  t=120.009 restart_service {}\n  t=120.009 scale_cluster {} [PRIMARY]",
          },
        ],
      }),
    );
    expect(getEntries()[0].label).toBe("scale_cluster");
  });

  it("handles decimal sim times in [PRIMARY] tag extraction", () => {
    recordRequest(
      makeRequest({
        messages: [
          { role: "system", content: "sys" },
          {
            role: "user",
            content:
              "## Trainee Actions (2 since last reaction)\n  t=120.00999999999999 restart_service {}\n  t=120.00999999999999 scale_cluster {} [PRIMARY]",
          },
        ],
      }),
    );
    expect(getEntries()[0].label).toBe("scale_cluster");
  });

  it("falls back to first tool name when no trainee action found", () => {
    recordRequest(
      makeRequest({
        messages: [{ role: "system", content: "sys" }],
        tools: [{ name: "fire_alarm", description: "", parameters: {} }],
      }),
    );
    expect(getEntries()[0].label).toBe("fire_alarm");
  });

  it("falls back to role when no tools and no action match", () => {
    recordRequest(
      makeRequest({
        role: "coach",
        messages: [{ role: "system", content: "sys" }],
        tools: [],
      }),
    );
    expect(getEntries()[0].label).toBe("coach");
  });

  it("notifies subscribers when a request is recorded", () => {
    const fn = vi.fn();
    subscribe(fn);
    recordRequest(makeRequest());
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("caps entries at 200 by dropping the oldest", () => {
    for (let i = 0; i < 205; i++) recordRequest(makeRequest());
    expect(getEntries()).toHaveLength(200);
    // The first entry should have been dropped — its seq id starts at 1
    const ids = getEntries().map((e) => e.id);
    expect(ids.every((id) => !id.startsWith("llm-1-"))).toBe(true);
  });
});

// ── recordResponse ────────────────────────────────────────────────────────────

describe("recordResponse", () => {
  it("fills in response and durationMs on the matching entry", () => {
    const startMs = Date.now() - 100;
    const id = recordRequest(makeRequest());
    const resp = makeResponse({
      toolCalls: [{ tool: "send_chat", params: {} }],
    });
    recordResponse(id, resp, startMs);

    const entry = getEntries().find((e) => e.id === id)!;
    expect(entry.response).toEqual(resp);
    expect(entry.durationMs).toBeGreaterThanOrEqual(100);
  });

  it("records 'error' sentinel on failure", () => {
    const id = recordRequest(makeRequest());
    recordResponse(id, "error", Date.now());
    expect(getEntries().find((e) => e.id === id)!.response).toBe("error");
  });

  it("is a no-op for an unknown id", () => {
    recordRequest(makeRequest());
    expect(() =>
      recordResponse("does-not-exist", "error", Date.now()),
    ).not.toThrow();
    expect(getEntries()[0].response).toBeNull();
  });

  it("notifies subscribers when response arrives", () => {
    const fn = vi.fn();
    const id = recordRequest(makeRequest());
    subscribe(fn);
    fn.mockClear();
    recordResponse(id, makeResponse(), Date.now());
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ── clearEntries ──────────────────────────────────────────────────────────────

describe("clearEntries", () => {
  it("removes all entries", () => {
    recordRequest(makeRequest());
    recordRequest(makeRequest());
    clearEntries();
    expect(getEntries()).toHaveLength(0);
  });

  it("notifies subscribers", () => {
    const fn = vi.fn();
    recordRequest(makeRequest());
    subscribe(fn);
    fn.mockClear();
    clearEntries();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ── subscribe ─────────────────────────────────────────────────────────────────

describe("subscribe", () => {
  it("returns an unsubscribe function that stops notifications", () => {
    const fn = vi.fn();
    const unsub = subscribe(fn);
    unsub();
    recordRequest(makeRequest());
    expect(fn).not.toHaveBeenCalled();
  });

  it("supports multiple concurrent subscribers", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribe(a);
    subscribe(b);
    recordRequest(makeRequest());
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

// ── formatEntryForClipboard ───────────────────────────────────────────────────

describe("formatEntryForClipboard", () => {
  it("includes role and label in the header", () => {
    const id = recordRequest(makeMetricsRequest());
    recordResponse(id, makeResponse(), Date.now());
    const entry = getEntries().find((e) => e.id === id)!;
    const text = formatEntryForClipboard(entry);
    expect(text).toContain("Metrics");
    expect(text).toContain("select_metric_reaction");
  });

  it("includes REQUEST and RESPONSE section headers", () => {
    const id = recordRequest(makeRequest());
    recordResponse(id, makeResponse(), Date.now());
    const text = formatEntryForClipboard(getEntries()[0]);
    expect(text).toContain("--- REQUEST ---");
    expect(text).toContain("--- RESPONSE ---");
  });

  it("includes [SYSTEM] and [USER] message blocks", () => {
    const id = recordRequest(makeRequest());
    recordResponse(id, makeResponse(), Date.now());
    const text = formatEntryForClipboard(getEntries()[0]);
    expect(text).toContain("[SYSTEM]");
    expect(text).toContain("You are a simulator.");
    expect(text).toContain("[USER]");
    expect(text).toContain("trigger_rollback");
  });

  it("lists available tool names", () => {
    const id = recordRequest(makeMetricsRequest());
    recordResponse(id, makeResponse(), Date.now());
    const text = formatEntryForClipboard(getEntries()[0]);
    expect(text).toContain("Tools available: select_metric_reaction");
  });

  it("omits tools line when no tools", () => {
    const id = recordRequest(makeRequest({ tools: [] }));
    recordResponse(id, makeResponse(), Date.now());
    const text = formatEntryForClipboard(getEntries()[0]);
    expect(text).not.toContain("Tools available");
  });

  it("formats tool call response with TOOL CALL header and JSON params", () => {
    const id = recordRequest(makeMetricsRequest());
    recordResponse(
      id,
      makeResponse({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: {
              metric_reactions: [
                { metric_id: "error_rate", outcome: "full_recovery" },
              ],
            },
          },
        ],
      }),
      Date.now(),
    );
    const text = formatEntryForClipboard(getEntries()[0]);
    expect(text).toContain("TOOL CALL: select_metric_reaction");
    expect(text).toContain('"outcome": "full_recovery"');
  });

  it("formats plain text response with TEXT header", () => {
    const id = recordRequest(makeRequest({ role: "debrief", tools: [] }));
    recordResponse(
      id,
      { toolCalls: [], text: "Great job diagnosing the issue." },
      Date.now(),
    );
    const text = formatEntryForClipboard(getEntries()[0]);
    expect(text).toContain("TEXT:");
    expect(text).toContain("Great job diagnosing the issue.");
  });

  it("shows '(in flight)' when response is still null", () => {
    recordRequest(makeRequest());
    const text = formatEntryForClipboard(getEntries()[0]);
    expect(text).toContain("in flight");
  });

  it("shows ERROR when response is 'error'", () => {
    const id = recordRequest(makeRequest());
    recordResponse(id, "error", Date.now());
    const text = formatEntryForClipboard(getEntries()[0]);
    expect(text).toContain("ERROR");
  });

  it("includes duration when available", () => {
    const id = recordRequest(makeRequest());
    recordResponse(id, makeResponse(), Date.now() - 250);
    const text = formatEntryForClipboard(getEntries()[0]);
    expect(text).toMatch(/Duration: \d+ms/);
  });

  it("omits duration line when still in flight", () => {
    recordRequest(makeRequest());
    const text = formatEntryForClipboard(getEntries()[0]);
    expect(text).not.toContain("Duration:");
  });

  it("produces a single string with no undefined or [object Object]", () => {
    const id = recordRequest(makeMetricsRequest());
    recordResponse(
      id,
      makeResponse({
        toolCalls: [{ tool: "select_metric_reaction", params: { x: 1 } }],
      }),
      Date.now(),
    );
    const text = formatEntryForClipboard(getEntries()[0]);
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("[object Object]");
  });
});
