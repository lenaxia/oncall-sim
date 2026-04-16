// mock-provider.ts — deterministic mock LLM for tests and VITE_MOCK_LLM=true dev mode.
// Browser port: fixture YAML imported as raw string via Vite ?raw query.
// fs.readFileSync and path calls removed; MockProvider class logic unchanged.

import yaml from "js-yaml";
import type { LLMClient, LLMRequest, LLMResponse } from "./llm-client";
import { AGENT_TOOL_RESULT_PREFIX } from "./tool-definitions";

// Fixture YAML imported at build time — works in Vitest (jsdom) and production builds.
// In production it is tree-shaken out when VITE_MOCK_LLM is not set.
import fixtureYaml from "../../../scenarios/_fixture/mock-llm-responses.yaml?raw";

// ── Public types ──────────────────────────────────────────────────────────────

export interface MockStakeholderResponse {
  trigger: string;
  tool_calls: Array<{ tool: string; params: Record<string, unknown> }>;
}

export interface MockCoachResponse {
  trigger: string;
  message: string;
}

export interface MockBuilderResponse {
  trigger: string;
  text?: string;
  tool_calls: Array<{ tool: string; params: Record<string, unknown> }>;
}

export interface MockLLMResponses {
  stakeholder_responses: MockStakeholderResponse[];
  coach_responses: MockCoachResponse[];
  debrief_response: { narrative: string };
  scenario_builder_responses?: MockBuilderResponse[];
}

export type MockLLMProvider = MockProvider;

// ── MockProvider ──────────────────────────────────────────────────────────────

export class MockProvider implements LLMClient {
  private _tickCount = 0;

  constructor(private responses: MockLLMResponses) {}

  call(request: LLMRequest): Promise<LLMResponse> {
    if (request.role === "debrief") {
      return Promise.resolve({
        toolCalls: [],
        text: this.responses.debrief_response?.narrative ?? "",
      });
    }
    if (request.role === "coach") {
      return Promise.resolve(this._matchCoach(request));
    }
    if (request.role === "scenario_builder") {
      return Promise.resolve(this._matchBuilder(request));
    }
    return Promise.resolve(this._matchStakeholder(request));
  }

  private _matchStakeholder(request: LLMRequest): LLMResponse {
    this._tickCount++;
    const tickTrigger = `tick_${this._tickCount}`;

    const tickMatch = this.responses.stakeholder_responses?.find(
      (r) => r.trigger === tickTrigger,
    );
    if (tickMatch) return this._toResponse(tickMatch.tool_calls);

    const allUserContent = (request.messages ?? [])
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");

    for (const sr of this.responses.stakeholder_responses ?? []) {
      if (!sr.trigger.startsWith("after_action:")) continue;
      const parts = sr.trigger.split(":");
      const actionType = parts[1];
      const actionParam = parts[2] ?? "";
      const actionFound = allUserContent.includes(actionType);
      const paramFound = !actionParam || allUserContent.includes(actionParam);
      if (actionFound && paramFound) return this._toResponse(sr.tool_calls);
    }

    return { toolCalls: [] };
  }

  private _matchCoach(request: LLMRequest): LLMResponse {
    const lastUserMsg = [...(request.messages ?? [])]
      .reverse()
      .find((m) => m.role === "user");
    const isOnDemand =
      lastUserMsg?.content.includes("trainee asks") ||
      lastUserMsg?.content.includes("on_demand");
    if (isOnDemand) {
      const match = this.responses.coach_responses?.find(
        (r) => r.trigger === "on_demand",
      );
      if (match) return { toolCalls: [], text: match.message };
    }

    this._tickCount++;
    const trigger = `proactive_tick_${this._tickCount}`;
    const match = this.responses.coach_responses?.find(
      (r) => r.trigger === trigger,
    );
    if (match) return { toolCalls: [], text: match.message };

    return { toolCalls: [] };
  }

  private _matchBuilder(request: LLMRequest): LLMResponse {
    const responses = this.responses.scenario_builder_responses ?? [];
    const lastUserMsg = [...(request.messages ?? [])]
      .reverse()
      .find((m) => m.role === "user");
    const content = lastUserMsg?.content ?? "";

    // Synthetic messages injected by the agentic loop all start with
    // AGENT_TOOL_RESULT_PREFIX. When the last user message is synthetic,
    // the loop is iterating — return empty so the loop terminates naturally
    // (no-tool-call stop condition).
    if (content.startsWith(AGENT_TOOL_RESULT_PREFIX)) {
      return { toolCalls: [] };
    }

    // "mark_complete" trigger fires when the user says they're done
    if (
      content.toLowerCase().includes("complete") ||
      content.toLowerCase().includes("done") ||
      content.toLowerCase().includes("finish")
    ) {
      const match = responses.find((r) => r.trigger === "mark_complete");
      if (match) return this._toBuilderResponse(match);
    }

    // "ask_question" trigger fires when the user says "difficulty" or "question"
    if (
      content.toLowerCase().includes("difficulty") ||
      content.toLowerCase().includes("question")
    ) {
      const match = responses.find((r) => r.trigger === "ask_question");
      if (match) return this._toBuilderResponse(match);
    }

    // "send_message" trigger fires when the user says "message" or "tell"
    if (
      content.toLowerCase().includes("tell me") ||
      content.toLowerCase().includes("send message")
    ) {
      const match = responses.find((r) => r.trigger === "send_message");
      if (match) return this._toBuilderResponse(match);
    }

    // "generic" trigger matches any first message
    const generic = responses.find((r) => r.trigger === "generic");
    if (generic) return this._toBuilderResponse(generic);

    return { toolCalls: [], text: "" };
  }

  private _toBuilderResponse(r: MockBuilderResponse): LLMResponse {
    return {
      toolCalls: (r.tool_calls ?? []).map((tc) => ({
        tool: tc.tool,
        params: tc.params ?? {},
      })),
      text: r.text,
    };
  }

  private _toResponse(
    toolCalls: Array<{ tool: string; params: Record<string, unknown> }>,
  ): LLMResponse {
    return {
      toolCalls: toolCalls.map((tc) => ({
        tool: tc.tool,
        params: tc.params ?? {},
      })),
    };
  }
}

// ── Fixture parsing ───────────────────────────────────────────────────────────

function parseMockResponses(yamlText: string): MockLLMResponses {
  const parsed = yaml.load(yamlText) as MockLLMResponses;
  return {
    stakeholder_responses: parsed.stakeholder_responses ?? [],
    coach_responses: parsed.coach_responses ?? [],
    debrief_response: parsed.debrief_response ?? { narrative: "" },
    scenario_builder_responses: parsed.scenario_builder_responses ?? [],
  };
}

// Default instance backed by bundled fixture YAML
export function createFixtureMockProvider(): MockProvider {
  return new MockProvider(parseMockResponses(fixtureYaml));
}

// For tests that need a custom fixture YAML string
export function createMockProviderFromYaml(yamlText: string): MockProvider {
  return new MockProvider(parseMockResponses(yamlText));
}
