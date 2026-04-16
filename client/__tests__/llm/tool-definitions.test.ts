import { describe, it, expect, beforeAll } from "vitest";
import {
  getStakeholderTools,
  getMetricReactionTools,
  getCoachTools,
  validateToolCall,
  COMMUNICATION_TOOLS,
  COACH_TOOLS,
} from "../../src/llm/tool-definitions";
import {
  getFixtureScenario,
  clearFixtureCache,
} from "../../src/testutil/index";
import { beforeEach } from "vitest";
import type { LoadedScenario } from "../../src/scenario/types";

let _fixture: LoadedScenario;

beforeAll(async () => {
  _fixture = await getFixtureScenario();
});

beforeEach(() => clearFixtureCache());

// ── getStakeholderTools ───────────────────────────────────────────────────────

describe("getStakeholderTools", () => {
  it("includes all COMMUNICATION_TOOLS always", () => {
    const scenario = _fixture;
    const tools = getStakeholderTools(scenario);
    for (const commTool of COMMUNICATION_TOOLS) {
      expect(tools.find((t) => t.name === commTool.name)).toBeDefined();
    }
  });

  it("includes only EVENT_TOOLS enabled in llm_event_tools config", () => {
    const scenario = _fixture;
    const tools = getStakeholderTools(scenario);
    const names = tools.map((t) => t.name);
    expect(names).toContain("fire_alarm");
    expect(names).toContain("inject_log_entry");
  });

  it("apply_metric_response excluded from stakeholder tools even when enabled", () => {
    const scenario: LoadedScenario = {
      ..._fixture,
      engine: {
        defaultTab: "email" as const,
        llmEventTools: [{ tool: "apply_metric_response", enabled: true }],
      },
    };
    const tools = getStakeholderTools(scenario);
    expect(
      tools.find((t) => t.name === "apply_metric_response"),
    ).toBeUndefined();
  });

  it("select_metric_reaction excluded from stakeholder tools (handled by metric-reaction-engine)", () => {
    const scenario: LoadedScenario = {
      ..._fixture,
      engine: {
        defaultTab: "email" as const,
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
    };
    const tools = getStakeholderTools(scenario);
    expect(
      tools.find((t) => t.name === "select_metric_reaction"),
    ).toBeUndefined();
  });

  it("apply_metric_response excluded when not in llm_event_tools", () => {
    const scenario: LoadedScenario = {
      ..._fixture,
      engine: {
        defaultTab: "email" as const,
        llmEventTools: [],
      },
    };
    const tools = getStakeholderTools(scenario);
    expect(
      tools.find((t) => t.name === "apply_metric_response"),
    ).toBeUndefined();
  });

  it("EVENT_TOOL not in llm_event_tools config is excluded", () => {
    const scenario: LoadedScenario = {
      ..._fixture,
      engine: {
        defaultTab: "email" as const,
        llmEventTools: [],
      },
    };
    const tools = getStakeholderTools(scenario);
    // Only communication tools
    expect(tools.length).toBe(COMMUNICATION_TOOLS.length);
  });
});

describe("getCoachTools", () => {
  it("returns COACH_TOOLS", () => {
    const tools = getCoachTools();
    for (const ct of COACH_TOOLS) {
      expect(tools.find((t) => t.name === ct.name)).toBeDefined();
    }
  });
});

// ── validateToolCall ──────────────────────────────────────────────────────────

describe("validateToolCall", () => {
  it("valid send_message call → valid=true", () => {
    const scenario = _fixture;
    const result = validateToolCall(
      {
        tool: "send_message",
        params: { persona: "p1", channel: "#inc", message: "hi" },
      },
      scenario,
      {},
    );
    expect(result.valid).toBe(true);
  });

  it("send_message with missing params → valid=false with reason", () => {
    const scenario = _fixture;
    const result = validateToolCall(
      { tool: "send_message", params: { persona: "p1" } },
      scenario,
      {},
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("fire_alarm within max_calls → valid=true", () => {
    const scenario = _fixture;
    const activeTools = getStakeholderTools(scenario);
    const result = validateToolCall(
      {
        tool: "fire_alarm",
        params: {
          alarm_id: "a1",
          service: "svc",
          severity: "SEV2",
          message: "alert",
        },
      },
      scenario,
      { fire_alarm: 0 },
      activeTools,
    );
    expect(result.valid).toBe(true);
  });

  it("fire_alarm exceeding max_calls → valid=false", () => {
    const scenario = _fixture;
    const activeTools = getStakeholderTools(scenario);
    const result = validateToolCall(
      {
        tool: "fire_alarm",
        params: {
          alarm_id: "a1",
          service: "svc",
          severity: "SEV2",
          message: "alert",
        },
      },
      scenario,
      { fire_alarm: 1 },
      activeTools, // already called once
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("max_calls");
  });

  it("trigger_cascade for allowed service → valid=true", () => {
    const scenario: LoadedScenario = {
      ..._fixture,
      engine: {
        defaultTab: "email" as const,
        llmEventTools: [
          { tool: "trigger_cascade", services: ["downstream-svc"] },
        ],
      },
    };
    const activeTools = getStakeholderTools(scenario);
    const result = validateToolCall(
      {
        tool: "trigger_cascade",
        params: { service: "downstream-svc", reason: "cascade" },
      },
      scenario,
      {},
      activeTools,
    );
    expect(result.valid).toBe(true);
  });

  it("trigger_cascade for disallowed service → valid=false", () => {
    const scenario: LoadedScenario = {
      ..._fixture,
      engine: {
        defaultTab: "email" as const,
        llmEventTools: [{ tool: "trigger_cascade", services: ["allowed-svc"] }],
      },
    };
    const activeTools = getStakeholderTools(scenario);
    const result = validateToolCall(
      {
        tool: "trigger_cascade",
        params: { service: "not-allowed", reason: "cascade" },
      },
      scenario,
      {},
      activeTools,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not-allowed");
  });

  // apply_metric_response — structural validation only (topology check is in the engine)
  it("apply_metric_response with empty affected_metrics → valid=false", () => {
    const scenario: LoadedScenario = {
      ..._fixture,
      engine: {
        defaultTab: "email" as const,
        llmEventTools: [{ tool: "apply_metric_response", enabled: true }],
      },
    };
    const activeTools = getStakeholderTools(scenario);
    const result = validateToolCall(
      { tool: "apply_metric_response", params: { affected_metrics: [] } },
      scenario,
      {},
      activeTools,
    );
    expect(result.valid).toBe(false);
  });

  it("apply_metric_response with missing required entry fields → valid=false", () => {
    const scenario: LoadedScenario = {
      ..._fixture,
      engine: {
        defaultTab: "email" as const,
        llmEventTools: [{ tool: "apply_metric_response", enabled: true }],
      },
    };
    const activeTools = getStakeholderTools(scenario);
    const result = validateToolCall(
      {
        tool: "apply_metric_response",
        params: {
          affected_metrics: [{ service: "svc", metric_id: "error_rate" }],
        },
      },
      scenario,
      {},
      activeTools,
    );
    expect(result.valid).toBe(false);
  });

  it("select_metric_reaction with valid metric_reactions → valid=true", () => {
    const scenario: LoadedScenario = {
      ..._fixture,
      engine: {
        defaultTab: "email" as const,
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
    };
    const activeTools = getMetricReactionTools(scenario);
    expect(activeTools).toHaveLength(1);
    const result = validateToolCall(
      {
        tool: "select_metric_reaction",
        params: {
          metric_reactions: [
            {
              metric_id: "error_rate",
              outcome: "full_recovery",
              pattern: "smooth_decay",
            },
          ],
        },
      },
      scenario,
      {},
      activeTools,
    );
    expect(result.valid).toBe(true);
  });

  it("silence_alarm for non-existent alarm → valid=false", () => {
    const scenario = _fixture;
    const activeAlarms = new Set<string>(["existing-alarm"]);
    const activeToolsWithSilence = [
      ...getStakeholderTools(scenario),
      {
        name: "silence_alarm",
        description: "",
        parameters: {
          type: "object",
          properties: { alarm_id: { type: "string" } },
          required: ["alarm_id"],
        },
      },
    ];
    const result2 = validateToolCall(
      { tool: "silence_alarm", params: { alarm_id: "ghost-alarm" } },
      scenario,
      {},
      activeToolsWithSilence,
      activeAlarms,
    );
    expect(result2.valid).toBe(false);
    expect(result2.reason).toContain("ghost-alarm");
  });

  it("tool not in active tools → valid=false", () => {
    const scenario = _fixture;
    const result = validateToolCall(
      { tool: "nonexistent_tool", params: {} },
      scenario,
      {},
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("nonexistent_tool");
  });
});
