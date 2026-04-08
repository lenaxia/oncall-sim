# 0004 — Phase 5: LLM Client and Stakeholder Engine

**Date:** 2026-04-07
**Phase:** 5 — LLM Client and Stakeholder Engine
**Status:** Complete

---

## What Was Done

Implemented the provider-agnostic LLM abstraction, three provider implementations, tool definitions with server-side validation, and the stakeholder engine that drives persona communication on each dirty tick. Also fulfilled the `MockLLMProvider` / `MockLLMResponses` forward references declared in Phase 1 testutil.

### `server/src/llm/llm-client.ts`

Core interface and factory:

- `LLMClient` interface — single `call(request): Promise<LLMResponse>` method
- `LLMRequest` — `role` (stakeholder | coach | debrief), `messages`, `tools`, `sessionId`
- `LLMResponse` — `toolCalls[]`, optional `text`
- `LLMMessage`, `LLMToolCall`, `LLMToolDefinition`, `LLMRole` types
- `LLMError` class — typed error codes: `timeout`, `rate_limit`, `invalid_response`, `provider_error`
- `createLLMClient()` — reads env vars, returns appropriate provider; `MOCK_LLM=true` → MockProvider; `LLM_PROVIDER=openai` → OpenAIProvider (requires `OPENAI_API_KEY`); `LLM_PROVIDER=bedrock` → BedrockProvider (requires `BEDROCK_MODEL_ID`); throws synchronously with clear message on missing required vars

### `server/src/llm/openai-provider.ts`

OpenAI-compatible HTTP provider:

- Retry up to `maxRetries` on network errors and 5xx responses
- 429 rate limit: exponential backoff using `Retry-After` header, does not count against retry budget
- 4xx (except 429): no retry, throws `LLMError('provider_error')`
- Timeout: throws `LLMError('timeout')`
- Translates `LLMRequest` to OpenAI chat completions format; maps tool call responses back to `LLMToolCall[]`
- Configurable `baseUrl` for OpenAI-compatible endpoints

### `server/src/llm/bedrock-provider.ts`

AWS Bedrock Converse API implementation:

- Uses `@aws-sdk/client-bedrock-runtime` (lazy-loaded to avoid SDK overhead at startup)
- Translates `LLMRequest` to Bedrock's `ConverseCommand` format
- Maps Bedrock `toolUse` blocks back to `LLMToolCall[]`
- Credentials from environment (IAM role or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`)
- Same retry/timeout behaviour as OpenAI provider

### `server/src/llm/mock-provider.ts`

Deterministic mock for `MOCK_LLM=true` mode and all tests:

- `MockProvider` — loads `MockLLMResponses` and matches against triggers:
  - `tick_N` — matches on internal tick counter for stakeholder role
  - `after_action:<type>:<optional_param>` — matches when user message content contains the action type and optional param
  - `proactive_tick_N` — matches on internal tick counter for coach role
  - `on_demand` — matches when user message content contains `'trainee asks'` or `'on_demand'`
  - No match → returns empty response (valid — persona had nothing to say)
- `loadMockResponses(scenarioDir)` — reads and parses `mock-llm-responses.yaml`
- `createMockClientFromEnv()` — factory used by `createLLMClient()` when `MOCK_LLM=true`; reads `SCENARIOS_DIR` env var to locate `_fixture/mock-llm-responses.yaml`

Fulfills Phase 1 forward references: `MockLLMProvider` and `MockLLMResponses` types are exported. `testutil` functions `getMockLLMProvider()` and `buildMockLLMProvider()` are implemented here and re-exported from `testutil/index.ts`.

### `server/src/llm/tool-definitions.ts`

Tool schemas and server-side validation:

#### `COMMUNICATION_TOOLS` (always enabled)

- `send_message` — sends a chat message as a persona
- `send_email` — sends an email as a persona to the trainee
- `add_ticket_comment` — adds a comment to a ticket as a persona

#### `EVENT_TOOLS` (filtered by `scenario.engine.llmEventTools` config)

- `fire_alarm` — fires a new alarm event
- `silence_alarm` — silences an existing alarm
- `inject_log_entry` — injects a log entry for a service
- `trigger_cascade` — triggers cascading failure to a dependent service
- `trigger_metric_recovery` — Phase 2 only, never included
- `trigger_metric_spike` — Phase 2 only, never included

#### `COACH_TOOLS` (always enabled for coach role)

- `send_coach_message` — sends a coaching message to the trainee

#### `getStakeholderTools(scenario)`

Returns `COMMUNICATION_TOOLS` + enabled `EVENT_TOOLS` (filtered by `llmEventTools` config, never Phase 2 tools).

#### `validateToolCall(toolCall, scenario, callCounts, activeTools?, activeAlarmIds?)`

Server-side validation before executing any LLM tool call:

- Tool name must be in active tools for this scenario
- Required params must be present and non-empty
- `fire_alarm`: call count must be below `max_calls`
- `trigger_cascade`: target service must be in the `services` allow-list
- `trigger_metric_recovery` / `trigger_metric_spike`: always rejected with Phase 2 message
- `silence_alarm`: `alarmId` must exist in the active alarm set (if provided)

### `server/src/engine/stakeholder-engine.ts`

The `onDirtyTick` implementation wired into the game loop by the Phase 6 session factory:

#### `createStakeholderEngine(llmClient, scenario)`

Returns a `StakeholderEngine` with a single `tick(context)` method that:

1. Determines eligible personas (respects `silentUntilContacted`, persona cooldowns)
2. Builds the LLM prompt (system: persona instructions + scenario context; user: conversation history, audit log, cooldown status, current sim time)
3. Calls `llmClient.call()` — on `LLMError`: logs and returns `[]`, never throws
4. For each tool call: validates via `validateToolCall()`, skips invalid calls with a log warn, executes valid calls
5. Executes tool calls: `send_message` → `chat_message` SimEvent; `send_email` → `email_received`; `add_ticket_comment` → `ticket_comment`; `fire_alarm` → `alarm_fired`; `silence_alarm` → `alarm_silenced`; `inject_log_entry` → `log_entry`; `trigger_cascade` → `log_entry` + `alarm_fired`
6. Updates `_lastSpoke` times for personas that sent messages
7. Returns all produced `SimEvent[]`

The outer `tick()` wraps `_tick()` in a try/catch — any unexpected error is logged and swallowed; the game loop always gets `[]` back.

#### Context window truncation (LLD §4)

When the conversation history grows large enough to approach the 80k token budget (1 token ≈ 4 chars):

- Fixed sections always preserved: system prompt, audit log, persona cooldowns, instruction footer
- Conversation history (chat + email) is truncated from the oldest end
- A summary prefix replaces dropped messages: `[N older message(s) omitted — context window limit reached at t=T]`
- Most-recent messages always kept
- `STAKEHOLDER_TOKEN_BUDGET` env var allows override; default 80,000 tokens
- Warning logged when truncation fires

---

## Test Results

| File | Tests |
|---|---|
| `llm-client.test.ts` | 6 |
| `mock-provider.test.ts` | 12 |
| `tool-definitions.test.ts` | 16 |
| `stakeholder-engine.test.ts` | 16 |
| **Total** | **50** |

- **Pass rate:** 50/50
- **Known failures:** None
- **Typecheck:** Clean
- **Lint:** Clean

---

## Known Issues

None.

---

## What Comes Next

Phase 6 — Session Management, REST API, and SSE: implement `config.ts`, `index.ts`, `session.ts`, `session-store.ts`, `sse-broker.ts`, and all six route files.
