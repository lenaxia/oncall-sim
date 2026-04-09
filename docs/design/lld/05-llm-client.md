# LLD 05 — LLM Client and Stakeholder Engine

**Phase:** 5
**Depends on:** Phase 1 (shared types, scenario config types, testutil), Phase 3 (LoadedScenario), Phase 4 (game engine — StakeholderContext, GameLoop.onDirtyTick hook)
**HLD sections:** §7.1, §7.2, §7.3, §11

---

## Purpose

Provide a provider-agnostic LLM abstraction and implement the stakeholder engine that drives persona communication and dynamic sim events on each dirty tick. This phase also fulfills the `MockLLMProvider` / `MockLLMResponses` forward references declared in Phase 1 testutil.

---

## Scope

```
server/src/llm/
  llm-client.ts         # provider abstraction interface
  openai-provider.ts    # OpenAI-compatible implementation
  bedrock-provider.ts   # AWS Bedrock implementation
  mock-provider.ts      # deterministic mock (MOCK_LLM=true)
  tool-definitions.ts   # tool schemas for stakeholder and coach LLM roles

server/src/engine/
  stakeholder-engine.ts # tick-driven stakeholder LLM caller
```

The stakeholder engine receives a `MetricStore` reference (from LLD 02) so it can read current metric values when building the prompt context block and execute `apply_metric_response` calls.

---

## 1. LLM Client Abstraction (`llm-client.ts`)

```typescript
export interface LLMClient {
  // Call the LLM with the given messages and tools.
  // Returns tool calls and/or a text response.
  // Throws LLMError on unrecoverable failure (after retries).
  call(request: LLMRequest): Promise<LLMResponse>;
}

export interface LLMRequest {
  role: LLMRole; // which system prompt + tool set to use
  messages: LLMMessage[];
  tools: LLMToolDefinition[];
  sessionId: string; // for mock trigger matching
}

export interface LLMResponse {
  toolCalls: LLMToolCall[]; // may be empty
  text?: string; // present for debrief (no-tool) calls
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMToolCall {
  tool: string;
  params: Record<string, unknown>;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export type LLMRole = "stakeholder" | "coach" | "debrief";

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "timeout"
      | "rate_limit"
      | "invalid_response"
      | "provider_error",
  ) {
    super(message);
  }
}

// Factory — selects provider based on env config
export function createLLMClient(): LLMClient;
```

---

## 2. Provider Implementations

### `openai-provider.ts`

```typescript
export class OpenAIProvider implements LLMClient {
  constructor(private config: OpenAIConfig) {}
  async call(request: LLMRequest): Promise<LLMResponse>;
}

interface OpenAIConfig {
  apiKey: string;
  baseUrl: string; // defaults to https://api.openai.com/v1
  model: string; // defaults to gpt-4o
  timeoutMs: number;
  maxRetries: number;
}
```

Retry logic: retries up to `maxRetries` on network errors and 5xx responses. Does NOT retry on 4xx (bad request, invalid key). On 429 (rate limit): exponential backoff, does not count as a retry. On timeout: abandons and throws `LLMError('timeout')`.

### `bedrock-provider.ts`

```typescript
export class BedrockProvider implements LLMClient {
  constructor(private config: BedrockConfig) {}
  async call(request: LLMRequest): Promise<LLMResponse>;
}

interface BedrockConfig {
  region: string;
  modelId: string;
  timeoutMs: number;
  maxRetries: number;
}
```

Uses AWS SDK `@aws-sdk/client-bedrock-runtime`. Credentials from environment (IAM role or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`). Translates the `LLMRequest` to Bedrock's converse API format. Tool calls are mapped from Bedrock's response format back to `LLMToolCall[]`.

### `mock-provider.ts`

```typescript
export class MockProvider implements LLMClient {
  constructor(private responses: MockLLMResponses) {}
  async call(request: LLMRequest): Promise<LLMResponse>;
}

// Loads mock responses from a scenario directory's mock-llm-responses.yaml file.
// Used by testutil.getMockLLMProvider() to build a MockProvider from the fixture scenario.
export function loadMockResponses(scenarioDir: string): MockLLMResponses;

// Public types — fulfills the forward reference in Phase 1 testutil
export interface MockLLMResponses {
  stakeholder_responses: MockStakeholderResponse[];
  coach_responses: MockCoachResponse[];
  debrief_response: { narrative: string };
}

export interface MockStakeholderResponse {
  trigger: string; // 'tick_N' | 'after_action:<type>:<optional_param>'
  tool_calls: Array<{ tool: string; params: Record<string, unknown> }>;
}

export interface MockCoachResponse {
  trigger: string; // 'proactive_tick_N' | 'on_demand'
  message: string;
}

export type MockLLMProvider = MockProvider;
```

The mock provider matches against `request.sessionId` to find the right mock file via the trigger convention. If no trigger matches, returns an empty response (no tool calls, no text). This is valid — it means the persona or coach had nothing to say.

---

## 3. Tool Definitions (`tool-definitions.ts`)

```typescript
// Returns the tool definitions for the stakeholder LLM role.
// Only tools enabled in the scenario's llm_event_tools config are included.
export function getStakeholderTools(
  scenario: LoadedScenario,
): LLMToolDefinition[];

// Returns the tool definitions for the coach LLM role.
// These are read-only observation tools — always the same set.
export function getCoachTools(): LLMToolDefinition[];

// All stakeholder communication tools (always enabled)
export const COMMUNICATION_TOOLS: LLMToolDefinition[];

// All stakeholder event tools (filtered by scenario config)
export const EVENT_TOOLS: LLMToolDefinition[];

// Coach read-only observation tools
export const COACH_TOOLS: LLMToolDefinition[];
```

Tool definitions use JSON Schema for parameter validation. The server validates every LLM tool call response against these schemas before executing — invalid params are logged and skipped.

---

## 4. Stakeholder Engine (`engine/stakeholder-engine.ts`)

The stakeholder engine is the `onDirtyTick` implementation from Phase 4. It is wired into the game loop by the session factory in Phase 6.

```typescript
export interface StakeholderEngine {
  // Called by the game loop on each dirty tick.
  // Builds context, calls LLM, executes validated tool calls.
  // Returns the SimEvents produced so the game loop can broadcast them.
  // Never throws — all errors are caught and logged.
  tick(context: StakeholderContext): Promise<SimEvent[]>;
}

export function createStakeholderEngine(
  llmClient: LLMClient,
  scenario: LoadedScenario,
  metricStore: MetricStore, // from LLD 02 — read current values, splice reactive overlays
): StakeholderEngine;
```

### Tick sequence

```
tick(context):
  1. Check persona cooldowns — build list of personas eligible to speak
     (persona.last_spoke_at + cooldown_seconds <= context.simTime)
     silent_until_contacted personas only eligible if they have been engaged

  2. Build LLM prompt:
     SYSTEM: stakeholder engine instructions (persona behavior rules, output format)
     CONTEXT block:
       - scenario description and topology
       - each eligible persona's system_prompt
       - persona last-spoke times
       - current sim time
     METRIC RESPONSE CONTEXT:
       - available services and metric IDs (from scenario topology)
       - reactive pattern reference (smooth_decay | stepped | queue_burndown | oscillating |
         blip_then_decay | cascade_clear | sawtooth_rebound | cliff)
       - speed tiers: 1m | 5m | 15m | 30m | 60m
       - usage rules (direction, magnitude, asymmetric per-metric specification)
     CONVERSATION HISTORY:
       - all chat messages, emails, ticket comments (from context.conversations)
       - in chronological order by simTime
     AUDIT LOG:
       - all trainee actions (from context.auditLog)
     TOOL DEFINITIONS: getStakeholderTools(scenario) — filtered by llm_event_tools config

  3. Call llmClient.call(request) with timeout guard
     - On LLMError: log, return [] (empty — loop continues)

  4. For each tool call in response:
     a. Validate params against tool schema (tool-definitions.ts)
     b. Validate against scenario llm_event_tools constraints:
        - fire_alarm: check max_calls not exceeded
        - trigger_cascade: check service in allowed list
        - apply_metric_response: validate each affected_metrics entry — service and
          metric_id must exist in scenario topology; rejects unknown references with log
     c. Execute valid tool calls:
        - send_message → conversation store + chat_message SimEvent
        - send_email → conversation store + email_received SimEvent
        - add_ticket_comment → conversation store + ticket_comment SimEvent
        - fire_alarm → conversation store + alarm_fired SimEvent
        - silence_alarm → conversation store + alarm_silenced SimEvent
        - inject_log_entry → conversation store + log_entry SimEvent
        - trigger_cascade → fires alarm_fired + inject_log_entry for the cascading service
        - apply_metric_response:
            for each valid affected_metrics entry:
              1. read currentValue from metricStore.getCurrentValue(service, metricId, simTime)
              2. read resolvedParams from metricStore.getResolvedParams(service, metricId)
              3. build ResolvedReactiveParams (direction, pattern, speed, magnitude, targets)
              4. call metricStore.applyReactiveOverlay(resolvedReactiveParams, simTime, prng)
              5. the game loop streams metric_update SSE events as sim time advances past
                 the new points — no SSE emitted here, the store splice is sufficient
     d. Invalid tool calls: log with tool name and reason, skip

  5. Update persona last-spoke times for any persona that sent a message

  6. Return all SimEvents produced
```

### Context window management

The full conversation history and audit log are injected into the prompt. For long scenarios this can grow large. The stakeholder engine applies a simple truncation strategy: if the combined history exceeds a token budget estimate (configurable, default 80k tokens), older chat messages and log entries are summarized as a single truncated prefix rather than dropped silently. This is a best-effort strategy — not a hard guarantee.

---

## 5. Tool Call Validation

Before executing any LLM tool call, the server validates:

```typescript
interface ToolCallValidationResult {
  valid: boolean;
  reason?: string; // human-readable rejection reason for logging
}

// callCounts is managed internally by the stakeholder engine tick,
// tracking how many times each tool has been called within the current tick.
// It is passed to validateToolCall to enforce max_calls constraints.
export function validateToolCall(
  toolCall: LLMToolCall,
  scenario: LoadedScenario,
  callCounts: Record<string, number>, // tool name → times called this tick (internal)
): ToolCallValidationResult;
```

Validation rules:

- Tool name must be in the active tool definitions for this scenario
- Params must match the tool's JSON Schema
- `fire_alarm`: call count must be below `max_calls` in `llm_event_tools` config
- `trigger_cascade`: service must be in the `services` allow-list
- `apply_metric_response`: each entry's `service` must exist in scenario topology; each `metric_id` must exist on that service; `cycle_seconds` (oscillating only) clamped to [30, 300]
- `silence_alarm`: alarmId must exist in the conversation store

---

## 6. Fulfilling Phase 1 Testutil Forward References

Phase 5 completes the `MockLLMProvider` / `MockLLMResponses` types that Phase 1 declared as forward references. The testutil functions now have their full implementations:

```typescript
// server/src/testutil/index.ts (updated in Phase 5)
import { MockProvider, MockLLMResponses } from "../llm/mock-provider";
import { loadMockResponses } from "../llm/mock-provider";

export function getMockLLMProvider(): MockProvider {
  const responses = loadMockResponses(getFixtureScenarioDir());
  return new MockProvider(responses);
}

export function buildMockLLMProvider(
  responses: MockLLMResponses,
): MockProvider {
  return new MockProvider(responses);
}
```

---

## 7. Test Strategy

All tests use `getMockLLMProvider()` or `buildMockLLMProvider()` from testutil. No real LLM API calls are ever made in tests.

### `llm-client.test.ts`

```
createLLMClient:
  - MOCK_LLM=true → returns MockProvider
  - LLM_PROVIDER=openai → returns OpenAIProvider
  - LLM_PROVIDER=bedrock → returns BedrockProvider
  - missing required env vars → throws at startup with clear message
```

### `mock-provider.test.ts`

```
MockProvider.call:
  - tick_1 trigger: returns matching tool_calls
  - tick_99 (no match): returns empty response
  - after_action:trigger_rollback:payment-service trigger: returns matching response
  - after_action with wrong param: no match → empty response
  - on_demand (coach role): returns matching message
  - proactive_tick_2 (coach role): returns matching message
  - debrief role: returns narrative text
  - empty responses file: all calls return empty response
```

### `tool-definitions.test.ts`

```
getStakeholderTools:
  - includes COMMUNICATION_TOOLS always
  - includes only EVENT_TOOLS that are enabled in scenario llm_event_tools
  - apply_metric_response included when enabled in llm_event_tools

validateToolCall:
  - valid send_message call → valid=true
  - send_message with missing params → valid=false with reason
  - fire_alarm within max_calls → valid=true
  - fire_alarm exceeding max_calls → valid=false
  - trigger_cascade for allowed service → valid=true
  - trigger_cascade for disallowed service → valid=false
  - apply_metric_response with valid service/metric_id → valid=true
  - apply_metric_response with unknown service → valid=false with reason
  - apply_metric_response with unknown metric_id on valid service → valid=false with reason
  - apply_metric_response with cycle_seconds=10 → valid=true, cycle_seconds clamped to 30
  - apply_metric_response with cycle_seconds=600 → valid=true, cycle_seconds clamped to 300
  - silence_alarm for non-existent alarm → valid=false
```

### `stakeholder-engine.test.ts`

```
tick — happy paths:
  - sends message via send_message → returns chat_message SimEvent
  - fires alarm via fire_alarm → returns alarm_fired SimEvent
  - injects log entry → returns log_entry SimEvent
  - silent_until_contacted persona not in eligible list before engagement
  - silent_until_contacted persona IS eligible after being engaged (via handleChatMessage)
  - persona cooldown respected — persona not eligible until cooldown elapsed
  - no eligible personas → empty response → no SimEvents returned
  - apply_metric_response with valid params → metricStore.applyReactiveOverlay called with
    correct ResolvedReactiveParams; no SimEvent emitted (game loop streams metric_update)
  - apply_metric_response with multiple affected_metrics → applyReactiveOverlay called once
    per entry
  - apply_metric_response direction=worsening → target resolves toward incident_peak

tick — error paths:
  - LLMError thrown → returns [] (never throws)
  - invalid tool call params → skipped, other valid calls still executed
  - apply_metric_response with unknown service → entry skipped with log, other entries executed
  - apply_metric_response with unknown metric_id → entry skipped with log

context building:
  - metric response context block present in prompt (service/metric list, pattern reference)
  - conversation history included in correct order
  - audit log included in prompt context
  - persona cooldowns included
```

---

## 8. Definition of Done

- [ ] `LLMClient` interface and `LLMError` class implemented
- [ ] `OpenAIProvider` with retry and backoff logic implemented
- [ ] `BedrockProvider` using AWS SDK converse API implemented
- [ ] `MockProvider` with trigger matching implemented
- [ ] `MockLLMProvider` and `MockLLMResponses` types exported — fulfills Phase 1 forward references
- [ ] `tool-definitions.ts` defines all stakeholder and coach tools including `apply_metric_response`
- [ ] `validateToolCall` rejects unknown service/metric_id in `apply_metric_response`, clamps `cycle_seconds`
- [ ] `StakeholderEngine` accepts `MetricStore` dependency
- [ ] `StakeholderEngine.tick` calls `metricStore.applyReactiveOverlay` for valid `apply_metric_response` calls
- [ ] `StakeholderEngine.tick` never throws — all errors logged and swallowed
- [ ] Metric response context block injected into every stakeholder prompt
- [ ] `onDirtyTick` hook wired into game loop (via Phase 6 session factory)
- [ ] All tests in §7 pass using `testutil` helpers
- [ ] No `any` types
