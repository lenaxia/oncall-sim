# Design: Client-Side Engine Migration

## Overview

This document describes the migration of the oncall simulator from a full-stack
Node.js/Express architecture to a static client-side application with a
deployment-agnostic LLM backend. The result is a React SPA that runs the entire
simulation engine in the browser, calls an LLM provider through one of three
configurable modes, and can be hosted on Harmony, Kubernetes, or locally with no
architectural differences between them.

## Motivation

The current architecture requires a persistent Node.js server to run the game
loop, manage session state over SSE, and proxy LLM calls. This prevents hosting
on Harmony (JAMStack-only) and adds operational complexity for self-hosted
deployments. All game engine logic (the game loop, metric generation, event
scheduling, conversation state) is pure TypeScript with no I/O dependencies,
making it well-suited for in-browser execution.

## Goals

- Run the complete simulation engine in the browser (no application server)
- Support three LLM backend modes, each producing a deployable build from the same codebase
- Never expose long-lived credentials in the browser in production deployments
- Remain deployable on Harmony, Kubernetes, or as a local dev setup
- Preserve all existing functionality: game loop, reactive metrics, debrief, mock LLM tests

## Non-Goals

- Multi-user / multi-session server-side state (this is a single-user tool)
- Streaming LLM responses (tool-call completions are not streamed today)
- Real-time collaboration

---

## Architecture

### Before

```
Browser (React)
    │  EventSource (SSE)
    │  fetch POST /api/sessions/:id/actions
    ▼
Node.js / Express
    ├── GameLoop (setInterval, in-memory)
    ├── StakeholderEngine → LLMClient
    │       └── BedrockProvider / OpenAIProvider
    ├── MetricStore (in-memory)
    ├── ConversationStore (in-memory)
    ├── SSEBroker
    └── SessionStore
```

### After

```
Browser (React)
    ├── GameEngine (setInterval, in-memory)
    │   ├── SimClock
    │   ├── EventScheduler
    │   ├── ConversationStore
    │   ├── MetricStore + MetricGenerator
    │   ├── AuditLog + Evaluator
    │   └── StakeholderEngine → LLMClient
    │           └── [see LLM Modes below]
    └── ScenarioLoader
            ├── Bundled (Vite import.meta.glob)
            └── Remote (fetch from S3 / URL)

LLM backend (one of three modes — see below)
```

No persistent server. No SSE. No HTTP session management.

---

## LLM Modes

The client supports three mutually exclusive LLM modes, selected at build time
via `VITE_LLM_MODE`. The `OpenAIProvider` and `BedrockBrowserProvider` both
implement the same `LLMClient` interface used throughout the engine today.

### Mode 1: `local`

**Use case:** Personal development, running LiteLLM locally or against a
publicly accessible LiteLLM instance.

```
Browser → OpenAIProvider
    └── fetch(VITE_LLM_BASE_URL + '/chat/completions')
        Authorization: Bearer VITE_LLM_API_KEY
```

The LiteLLM API key is in the browser environment. Acceptable because this mode
is intended for personal use on a trusted network. `ai.thekao.cloud/v1` is the
default target.

**Config (`.env.local`, gitignored):**

`.env.local` is already listed in the root `.gitignore`.

```
VITE_LLM_MODE=local
VITE_LLM_BASE_URL=https://ai.thekao.cloud/v1
VITE_LLM_API_KEY=<litellm key>
VITE_LLM_MODEL=gpt-4o
```

### Mode 2: `k8s`

**Use case:** Self-hosted Kubernetes or Docker deployment where LLM credentials
must not reach the browser.

```
Browser → OpenAIProvider
    └── fetch(http://localhost:8000/llm/chat/completions)
                ↓  (same pod, sidecar container)
        Python FastAPI proxy (litellm SDK)
            LLM_MODEL / LLM_API_KEY / LLM_BASE_URL from env / k8s Secret
                ↓
        Any LiteLLM-supported backend
        (ai.thekao.cloud, Bedrock, Anthropic, Azure, etc.)
```

The proxy sidecar is a Python FastAPI application using the LiteLLM Python SDK.
It accepts requests from the client, substitutes credentials and model identity
from its own environment, and forwards to the configured backend. The
`LLM_API_KEY` is injected from a Kubernetes Secret and never appears in the
browser bundle or network traffic from the client.

The client uses `VITE_LLM_BASE_URL=http://localhost:8000/llm` — within a pod,
sidecar containers share `localhost`. The proxy endpoint is at `/llm/chat/completions`,
so the `OpenAIProvider` (which appends `/chat/completions` to the base URL) must
use `/llm` as the base. No ingress path routing is required.

The proxy ignores any `model` field sent by the client and always substitutes
`LLM_MODEL` from its own environment. `VITE_LLM_MODEL` is therefore unused in
`k8s` mode but may be set to any non-empty value for type safety.

**Client config (baked at build time):**

```
VITE_LLM_MODE=k8s
VITE_LLM_BASE_URL=http://localhost:8000/llm
VITE_LLM_API_KEY=  (empty — proxy injects the real key)
VITE_LLM_MODEL=    (unused — proxy substitutes LLM_MODEL from its env)
```

**Proxy sidecar env (k8s Secret):**

```
LLM_MODEL=openai/gpt-4o
LLM_API_KEY=<secret>
LLM_BASE_URL=https://ai.thekao.cloud/v1
```

### Mode 3: `harmony`

**Use case:** Deployed on Amazon Harmony console platform, calling Bedrock
directly from the browser.

```
Browser → BedrockBrowserProvider
    ├── window.harmony.authorization.assume(roleArn)
    │       → temporary STS credentials (~1hr, auto-refreshed)
    └── @aws-sdk/client-bedrock-runtime (browser bundle)
            → Bedrock Converse API
```

Harmony's `authorization.assume()` performs the STS role assumption on behalf
of the user. The resulting credentials are short-lived (≈1 hour), scoped to a
single IAM role that has only `bedrock:InvokeModel` permissions on the specific
model ARN. Credentials are stored in memory and refreshed automatically 5
minutes before expiry by calling `assume()` again.

The role ARN, region, and model ID are injected at runtime via
`window.__ONCALL_CONFIG__`, which Harmony populates from its deployment config.
This is the only code path that depends on Harmony-specific APIs, and it is
fully isolated in `bedrock-browser-provider.ts`.

**Runtime config (injected by Harmony):**

```js
window.__ONCALL_CONFIG__ = {
  bedrockRoleArn: "arn:aws:iam::123456789:role/OnCallSimBedrockRole",
  bedrockRegion: "us-east-1",
  bedrockModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
};
```

**IAM role policy (minimal):**

```json
{
  "Effect": "Allow",
  "Action": ["bedrock:InvokeModel"],
  "Resource": "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0"
}
```

---

## Scenario Loading

Scenarios are loaded from two sources, unified behind a single async interface:

```ts
loadScenarioFromText(
  yamlText: string,
  resolveFile: (relativePath: string) => Promise<string>
): Promise<LoadedScenario | ScenarioLoadError>
```

`resolveFile` abstracts the file reference resolution so the same transform and
validation pipeline works in both loading modes.

### Bundled scenarios

Vite's `import.meta.glob` resolves scenario YAML files and all referenced
content files (email bodies, wiki pages, ticket descriptions, ops dashboard
files) at build time as raw strings. Zero runtime network requests for bundled
scenarios.

```ts
// Eagerly resolved at build time — values are strings, not promises
const rawYamls = import.meta.glob("../../../scenarios/*/scenario.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const rawFiles = import.meta.glob("../../../scenarios/**/*", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
```

`eager: true` makes values synchronously available as strings rather than lazy
`() => Promise<string>` functions, which is required for the synchronous
`resolveFile` lookup path. `query: '?raw', import: 'default'` is the
non-deprecated Vite 8 form of raw string imports (the `as: 'raw'` shorthand
still works but is deprecated as of Vite 5).

Any number of scenario YAML files can be bundled without meaningful impact on
load time — they are plain text and compress well.

### Remote scenarios (S3 / any URL)

Remote scenario sources are configured via `VITE_SCENARIO_URLS` (comma-separated
base URLs) or `window.__ONCALL_CONFIG__.scenarioUrls`. Each base URL is expected
to contain a `scenario.yaml` at its root, with any `*_file` references resolved
as relative paths from that same base URL.

```ts
const yamlText = await fetch(`${baseUrl}/scenario.yaml`).then((r) => r.text());
const resolveFile = (rel: string) =>
  fetch(`${baseUrl}/${rel}`).then((r) => r.text());
```

The `ScenarioPicker` component merges bundled and remote scenario lists.

---

## File-by-File Migration Map

### Files ported from `server/src/` to `client/src/` (logic unchanged)

The following files contain pure TypeScript logic with no I/O. They are copied
to the indicated destination paths and modified only for the mechanical changes
listed in the section below.

| Source                                     | Destination                                    |
| ------------------------------------------ | ---------------------------------------------- |
| `server/src/engine/game-loop.ts`           | `client/src/engine/game-loop.ts`               |
| `server/src/engine/event-scheduler.ts`     | `client/src/engine/event-scheduler.ts`         |
| `server/src/engine/sim-clock.ts`           | `client/src/engine/sim-clock.ts`               |
| `server/src/engine/conversation-store.ts`  | `client/src/engine/conversation-store.ts`      |
| `server/src/engine/audit-log.ts`           | `client/src/engine/audit-log.ts`               |
| `server/src/engine/evaluator.ts`           | `client/src/engine/evaluator.ts`               |
| `server/src/engine/stakeholder-engine.ts`  | `client/src/engine/stakeholder-engine.ts`      |
| `server/src/metrics/generator.ts`          | `client/src/metrics/generator.ts`              |
| `server/src/metrics/resolver.ts`           | `client/src/metrics/resolver.ts`               |
| `server/src/metrics/series.ts`             | `client/src/metrics/series.ts`                 |
| `server/src/metrics/correlation.ts`        | `client/src/metrics/correlation.ts`            |
| `server/src/metrics/archetypes.ts`         | `client/src/metrics/archetypes.ts`             |
| `server/src/metrics/incident-types.ts`     | `client/src/metrics/incident-types.ts`         |
| `server/src/metrics/metric-store.ts`       | `client/src/metrics/metric-store.ts`           |
| `server/src/metrics/metric-summary.ts`     | `client/src/metrics/metric-summary.ts`         |
| `server/src/metrics/types.ts`              | `client/src/metrics/types.ts`                  |
| `server/src/metrics/patterns/` (all files) | `client/src/metrics/patterns/`                 |
| `server/src/scenario/schema.ts`            | `client/src/scenario/schema.ts`                |
| `server/src/scenario/types.ts`             | `client/src/scenario/types.ts` ⚠️ see note     |
| `server/src/scenario/validator.ts`         | `client/src/scenario/validator.ts` ⚠️ see note |
| `server/src/scenario/log-profiles.ts`      | `client/src/scenario/log-profiles.ts`          |
| `server/src/llm/openai-provider.ts`        | `client/src/llm/openai-provider.ts`            |
| `server/src/llm/tool-definitions.ts`       | `client/src/llm/tool-definitions.ts`           |

### Mechanical changes applied to all ported files

**Note on `validator.ts`:** The server version contains a `checkFileRef` helper
that calls `fs.accessSync` and `path.resolve` to verify that `*_file` references
exist on disk. This is not possible in the browser. In the browser port, the
`checkFileRef` function is simplified: the path-traversal guard is kept (using
string prefix matching instead of `path.resolve`) and the `fs.accessSync`
existence check is removed. File existence for bundled scenarios is guaranteed at
build time by `import.meta.glob`; for remote scenarios, a failed `fetch` returns
an error that is surfaced to the user.

**Note on `types.ts`:** In addition to the verbatim port, add `ScenarioSummary`
to this file. It is currently defined in `server/src/scenario/loader.ts` and
mirrored in `client/src/testutil/index.tsx`. Moving it into `types.ts` gives it
a stable, importable home for `ScenarioPicker` and the browser loader's
`toScenarioSummary` helper.

**Note on `mock-provider.ts`:** Uses `path.join` and `fs.readFileSync` only in
the `loadMockResponses` and `createMockClientFromEnv` functions, which are
server-only helpers. These functions are removed from the browser port. The
`MockProvider` class itself has no I/O and ports unchanged.

| Original                                                       | Replacement                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `import { randomUUID } from 'crypto'`                          | `const randomUUID = () => globalThis.crypto.randomUUID()`                |
| `import { logger } from '../logger'`                           | `import { logger } from '../logger'` (new browser shim, see below)       |
| `process.env.STAKEHOLDER_TOKEN_BUDGET`                         | `parseInt(import.meta.env.VITE_TOKEN_BUDGET ?? '80000', 10)`             |
| `process.env.*` (all others)                                   | removed or replaced with `import.meta.env.*` equivalents                 |
| `import path from 'path'`                                      | removed — present in `loader.ts`, `validator.ts`, and `mock-provider.ts` |
| `import fs from 'fs'` / `import fsPromises from 'fs/promises'` | removed — present in `loader.ts`, `validator.ts`, and `mock-provider.ts` |

**Additional change for `evaluator.ts`:** The local `EvaluationState` interface
definition is removed and replaced with a re-export from `@shared/types/events`:
`export type { EvaluationState } from '@shared/types/events'`. The `evaluate()`
function return type annotation is updated to use the imported type. No logic
changes.

### New files

| Path                                         | Description                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/src/logger.ts`                       | Browser logger shim matching the pino child-logger interface used across the engine. Outputs to `console.*`. Created in Phase A before porting engine files.                                                                                                                                                                                                           |
| `client/src/scenario/loader.ts`              | Browser-compatible scenario loader. Replaces `server/src/scenario/loader.ts`. Contains the same transform/validate pipeline; I/O layer replaced with `resolveFile` callback.                                                                                                                                                                                           |
| `client/src/llm/bedrock-browser-provider.ts` | Harmony-mode Bedrock provider. Uses `window.harmony.authorization.assume()` for STS credentials. Auto-refreshes credentials. Only instantiated when `VITE_LLM_MODE=harmony`. Imported dynamically in the factory to prevent bundling `@aws-sdk/client-bedrock-runtime` into non-harmony builds.                                                                        |
| `client/src/llm/llm-client.ts`               | Rewritten (not a straight port). Contains the same `LLMClient`, `LLMRequest`, `LLMResponse`, `LLMMessage`, `LLMToolDefinition`, `LLMToolCall`, `LLMRole`, and `LLMError` types from the server version, plus a new three-mode factory replacing the old provider-selection logic. Created in two steps: interface types in Phase A, factory implementation in Phase C. |
| `client/src/llm/mock-provider.ts`            | Ported from server. `fs.readFileSync` and `path` calls replaced with `import fixtureYaml from '...?raw'` direct import. Full trigger system preserved (`tick_N`, `after_action:*`, `proactive_tick_N`, `on_demand`).                                                                                                                                                   |
| `client/src/declarations.d.ts`               | Updated to add `window.harmony` type declaration for the Harmony authorization API used by `BedrockBrowserProvider` in harmony mode.                                                                                                                                                                                                                                   |
| `proxy/main.py`                              | Python FastAPI + LiteLLM proxy sidecar for k8s mode.                                                                                                                                                                                                                                                                                                                   |
| `proxy/requirements.txt`                     | `fastapi`, `uvicorn[standard]`, `litellm`                                                                                                                                                                                                                                                                                                                              |
| `proxy/Dockerfile`                           | Python 3.12-slim image.                                                                                                                                                                                                                                                                                                                                                |
| `proxy/.env.example`                         | Example environment variables for k8s mode.                                                                                                                                                                                                                                                                                                                            |
| `client/Dockerfile`                          | Static asset server image. Runs `npm run build` with k8s build args, then serves `dist/` via `npx serve`.                                                                                                                                                                                                                                                              |
| `k8s/deployment.yaml`                        | Two-container pod: client (static file server) + proxy sidecar.                                                                                                                                                                                                                                                                                                        |
| `k8s/secret.yaml.example`                    | Example Secret manifest for LLM credentials.                                                                                                                                                                                                                                                                                                                           |
| `docker-compose.yml`                         | Root-level compose file for local testing of k8s mode. Starts client container + proxy container.                                                                                                                                                                                                                                                                      |

### Modified files

| Path                                       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/src/context/SessionContext.tsx`    | Rewired to own a `GameEngine` instance. SSE/EventSource removed. All action/chat/email/speed/resolve methods call engine directly. `metric_update` reducer case implemented. `SessionProvider` props change: `sessionId: string` → `scenario: LoadedScenario`; `sseConnection` removed; `onDebriefReady` kept (called by `resolveSession` after the debrief LLM call completes); `onExpired` kept (called when the engine emits `session_expired`).            |
| `client/src/hooks/useSimClock.ts`          | No logic changes. The hook reads from `SimClockContext`, which is still fed `sim_time` events — now emitted by the local engine's `onEvent` handler rather than the SSE stream. The internal comment referencing "server" should be updated to "engine".                                                                                                                                                                                                       |
| `client/src/context/ScenarioContext.tsx`   | Rewired to accept `scenario: LoadedScenario` as a prop instead of fetching from `/api/scenarios/:id`. The separate `<ScenarioProvider scenarioId={...}>` wrapper in `App.tsx` is eliminated — `SessionProvider` provides the `ScenarioContext` value directly from the `LoadedScenario` it already holds. All child components that call `useScenario()` continue to work unchanged.                                                                           |
| `client/src/components/ScenarioPicker.tsx` | Rewired to enumerate scenarios from the local `ScenarioLoader` (bundled + remote) instead of fetching from `/api/scenarios`.                                                                                                                                                                                                                                                                                                                                   |
| `client/src/components/DebriefScreen.tsx`  | Rewired to accept `debriefResult: DebriefResult` as a prop (passed from `App.tsx` after `resolveSession` completes) instead of fetching from `/api/sessions/:id/debrief`.                                                                                                                                                                                                                                                                                      |
| `client/src/App.tsx`                       | Rewired: `<ScenarioProvider>` wrapper removed (absorbed into `SessionProvider`). `handleStart` now loads the `LoadedScenario` from `ScenarioLoader` and passes it directly to `SessionProvider` instead of POSTing to `/api/sessions`. `handleDebriefReady` receives the `DebriefResult` and passes it to `DebriefScreen`. The `ActiveSession` type changes from `{ sessionId, scenarioId }` to `{ scenario: LoadedScenario, debriefResult?: DebriefResult }`. |
| `client/vite.config.ts`                    | Add a dev proxy: requests to `/llm/*` are forwarded to `http://localhost:8000/llm/*` (path preserved) for testing k8s mode locally. Add `js-yaml` and `zod` to `optimizeDeps` if needed. Preserve the existing `@shared` alias pointing to `../shared`.                                                                                                                                                                                                        |
| `client/tsconfig.json`                     | Add `paths` entries for any aliases used by ported engine files. The existing `@shared/*` → `../shared/*` alias must be present. Verify no server-side `tsconfig.json` path aliases were relied upon by the ported files.                                                                                                                                                                                                                                      |
| `client/package.json`                      | Add `js-yaml`, `zod`, `@aws-sdk/client-bedrock-runtime` (harmony mode). Add `@types/js-yaml` to devDependencies.                                                                                                                                                                                                                                                                                                                                               |
| `package.json` (root)                      | Workspaces updated to `["client"]`. Server removed. Dev/test/lint scripts updated.                                                                                                                                                                                                                                                                                                                                                                             |
| `shared/types/events.ts`                   | Add `EvaluationState` (moved from `server/src/engine/evaluator.ts`) and `DebriefResult` (consolidated from server `DebriefResult` + client `DebriefPayload`). `evaluator.ts` re-exports `EvaluationState` from shared.                                                                                                                                                                                                                                         |

### Deleted

| Path                              | Reason                                                    |
| --------------------------------- | --------------------------------------------------------- |
| `server/` (entire directory)      | All logic moved to client or Python proxy                 |
| `client/src/hooks/useSSE.ts`      | Replaced by direct engine event subscription              |
| `client/src/testutil/mock-sse.ts` | SSE no longer exists; replaced by direct engine injection |

---

## `SessionContext` Rewire

This is the largest single change in the React layer.

### Current flow

```
SessionProvider({ sessionId, sseConnection?, onExpired, onDebriefReady, onError })
    ├── useEffect → new EventSource('/api/sessions/:id/events')
    │       → dispatch({ type: 'SSE_EVENT', event })
    ├── dispatchAction → fetch POST /api/sessions/:id/actions
    ├── postChatMessage → fetch POST /api/sessions/:id/chat
    ├── replyEmail → fetch POST /api/sessions/:id/email/reply
    ├── setSpeed → fetch POST /api/sessions/:id/speed
    └── resolveSession → fetch POST /api/sessions/:id/resolve
                       → server later broadcasts debrief_ready via SSE
                       → onDebriefReady() called from SSE handler
```

### New flow

```
SessionProvider({ scenario: LoadedScenario, onExpired, onDebriefReady, onError })
    ├── useRef (initialized once) → createSession(scenario, llmClient)
    │       (runs generateAllMetrics, wires all engine deps)
    ├── useEffect → gameLoop.start()
    │       ├── gameLoop.onEvent(dispatch)
    │       └── returns cleanup: gameLoop.stop() on unmount
    ├── dispatchAction → gameLoop.handleAction(type, params)
    ├── postChatMessage → gameLoop.handleChatMessage(channel, text)
    ├── replyEmail → gameLoop.handleEmailReply(threadId, body)
    ├── setSpeed → gameLoop.setSpeed(speed) / gameLoop.pause() / gameLoop.resume()
    └── resolveSession → gameLoop.stop()
                       → gameLoop.getEvaluationState() + getSnapshot() + getEventLog()
                       → LLM debrief call (role: 'debrief')
                       → onDebriefReady(debriefResult) called with result
```

**Props that change:**

- `sessionId: string` removed — session ID is now generated internally
- `scenario: LoadedScenario` added — the full parsed scenario object
- `sseConnection?: MockSSEConnection` removed — SSE no longer exists
- `onDebriefReady` signature changes: `() => void` → `(result: DebriefResult) => void` to pass the debrief result to `App.tsx` for rendering by `DebriefScreen`
- `onExpired` and `onError` remain — `onExpired` is called when the engine emits a `session_expired` event

**`DebriefResult` type:** Currently defined as `DebriefResult` in `server/src/session/session.ts`
(which is deleted) and mirrored as `DebriefPayload` in `client/src/testutil/index.tsx`.
`DebriefResult` references `EvaluationState`, which is currently defined in
`server/src/engine/evaluator.ts`. Since `EvaluationState` is a plain data type with
no dependencies, both types move to `shared/types/events.ts` together:

- `EvaluationState` promoted from `server/src/engine/evaluator.ts` to `shared/types/events.ts`
- `DebriefResult` promoted from `server/src/session/session.ts` to `shared/types/events.ts`,
  consolidating with the structurally similar `DebriefPayload` from `client/src/testutil/index.tsx`
  (the client variant `DebriefEvaluationState` omits `takenAt` — the canonical shared type
  includes it from the server definition)

`DebriefScreen`, `testutil/index.tsx`, and all usages update their imports accordingly.
`server/src/engine/evaluator.ts` updates its `EvaluationState` to re-export from shared.

Session creation uses `useRef` (not `useMemo`) because `createSession` runs
`generateAllMetrics` (CPU work) and creates a mutable game loop that must be
stable for the lifetime of the component. `useMemo` is not appropriate here
because React may discard and recompute memoized values at any time.

In the client port, `createSession` is synchronous (the server's `async`/
`Promise.resolve` wrapper is removed since there is no actual async work).
`useRef` is therefore initialized directly: `useRef(createSession(scenario, llmClient))`.

The session ID is a client-generated `crypto.randomUUID()` value. It is used
only for tracing purposes in LLM requests (`LLMRequest.sessionId`) — there is no
server-side session store that requires it.

The `SessionContextValue` interface (the value consumed by child components via
`useSession()`) is **unchanged**. All child components inside `SessionProvider`
require no modification. The changes are confined to `SessionProvider`'s props
and the `App.tsx` caller.

### Debrief flow

`resolveSession()` in the new `SessionProvider`:

1. Calls `gameLoop.stop()`
2. Calls `gameLoop.getEvaluationState()` → `EvaluationState` (computed by the game loop's internal evaluator during the session)
3. Calls `gameLoop.getSnapshot()` and `gameLoop.getEventLog()`
4. Makes a `role: 'debrief'` LLM call via `llmClient.call(...)` with the full
   event log, audit log, evaluation state, and scenario context as the prompt
5. Calls `onDebriefReady(debriefResult)` — `App.tsx` stores the result and
   transitions to the debrief screen, passing `debriefResult` directly to
   `DebriefScreen` as a prop (no fetch needed)

The debrief LLM call goes through the same `LLMClient` instance used by the
stakeholder engine — whichever mode is active (local/k8s/harmony).

---

## Python Proxy Sidecar

### Interface

The proxy exposes a single endpoint that is a pass-through to any
LiteLLM-supported backend:

```
POST /llm/chat/completions
  Request body:  OpenAI chat completions format
                 { model?, messages, tools?, tool_choice? }
  Response body: OpenAI chat completions format
                 { choices: [{ message: { tool_calls?, content } }] }

GET /health
  Response: { "ok": true }
```

The client's `OpenAIProvider` calls `${VITE_LLM_BASE_URL}/chat/completions`.
In k8s mode `VITE_LLM_BASE_URL=http://localhost:8000/llm`, so the full URL
becomes `http://localhost:8000/llm/chat/completions`, which matches the proxy
endpoint above. The proxy always substitutes its own `LLM_MODEL` env var for
the model field, ignoring whatever the client sends.

### Implementation

```python
# proxy/main.py
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import litellm
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

LLM_MODEL    = os.environ["LLM_MODEL"]
LLM_API_KEY  = os.environ.get("LLM_API_KEY")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL")

@app.post("/llm/chat/completions")
async def proxy_llm(request: Request):
    body = await request.json()
    try:
        response = await litellm.acompletion(
            model=LLM_MODEL,
            messages=body["messages"],
            tools=body.get("tools"),
            tool_choice="auto" if body.get("tools") else None,
            api_key=LLM_API_KEY,
            api_base=LLM_BASE_URL,
        )
        return JSONResponse(content=response.model_dump())
    except litellm.AuthenticationError as e:
        return JSONResponse(status_code=401, content={"error": {"message": str(e), "type": "authentication_error"}})
    except litellm.RateLimitError as e:
        return JSONResponse(status_code=429, content={"error": {"message": str(e), "type": "rate_limit_error"}})
    except litellm.BadRequestError as e:
        return JSONResponse(status_code=400, content={"error": {"message": str(e), "type": "bad_request_error"}})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": {"message": str(e), "type": "provider_error"}})

@app.get("/health")
async def health():
    return {"ok": True}
```

### LiteLLM model string examples

The `LLM_MODEL` env var uses LiteLLM's provider-prefixed model string format:

| Backend             | `LLM_MODEL`                                         | Additional env                                     |
| ------------------- | --------------------------------------------------- | -------------------------------------------------- |
| Your LiteLLM server | `openai/gpt-4o`                                     | `LLM_BASE_URL=https://ai.thekao.cloud/v1`          |
| OpenAI direct       | `openai/gpt-4o`                                     | `LLM_API_KEY=sk-...`                               |
| Bedrock (Claude)    | `bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0` | AWS credentials via IAM role or env                |
| Anthropic direct    | `anthropic/claude-3-5-sonnet-20241022`              | `LLM_API_KEY=sk-ant-...`                           |
| Azure OpenAI        | `azure/gpt-4o`                                      | `LLM_BASE_URL`, `LLM_API_KEY`, `AZURE_API_VERSION` |

---

## Kubernetes Deployment

### Pod structure

Both containers share a pod so they communicate over `localhost`:

```yaml
# k8s/deployment.yaml (abbreviated)
spec:
  containers:
    - name: client
      image: oncall-client:latest
      ports:
        - containerPort: 3000
      # serves dist/ via `npx serve -s dist -l 3000`

    - name: proxy
      image: oncall-proxy:latest
      ports:
        - containerPort: 8000
      env:
        - name: LLM_MODEL
          valueFrom:
            secretKeyRef: { name: oncall-secrets, key: llm-model }
        - name: LLM_API_KEY
          valueFrom:
            secretKeyRef: { name: oncall-secrets, key: llm-api-key }
        - name: LLM_BASE_URL
          valueFrom:
            secretKeyRef: { name: oncall-secrets, key: llm-base-url }
        - name: CORS_ORIGINS
          value: "http://localhost:3000"
```

### Client build for k8s

```
VITE_LLM_MODE=k8s
VITE_LLM_BASE_URL=http://localhost:8000/llm
VITE_LLM_API_KEY=
VITE_LLM_MODEL=
```

The client Dockerfile accepts `VITE_LLM_BASE_URL`, `VITE_LLM_API_KEY`, and
`VITE_LLM_MODE` as Docker build args (not runtime env vars — Vite bakes them
into the JS bundle at build time). The `docker-compose.yml` passes these via
`build.args`. Kubernetes builds use the same Dockerfile with `--build-arg` flags
in CI.

### Docker files location

```
proxy/
    Dockerfile          # Python proxy image
    main.py
    requirements.txt
    .env.example

client/
    Dockerfile          # Static asset server image (npm run build → serve dist/)
```

---

## Mock LLM in Tests

The `MockProvider` is ported from the server with one change: the YAML fixture
is imported as a raw string via Vite's `?raw` query rather than read from disk.

```ts
// client/src/llm/mock-provider.ts
import fixtureYaml from "../../../scenarios/_fixture/mock-llm-responses.yaml?raw";

export class MockProvider implements LLMClient {
  constructor(private responses = parseMockResponses(fixtureYaml)) {}
  // Full trigger system preserved:
  // - stakeholder: tick_N, after_action:<type>:<optional_param>
  // - coach: proactive_tick_N, on_demand
  // - debrief: debrief_response.narrative
}
```

Test files that previously instantiated the server's `MockProvider` continue to
work without change. Tests that need a custom fixture can pass a YAML string to
the constructor.

The `?raw` import works in both Vitest (jsdom environment) and production builds.
In production builds, the mock provider is excluded by tree-shaking since
`VITE_MOCK_LLM` is not set.

---

## Migration Phases

### Phase A — Create browser logger shim + port engine modules (3–4 days)

First, create `client/src/logger.ts` (the browser logger shim) and the
interface-only portion of `client/src/llm/llm-client.ts` (containing the
`LLMClient`, `LLMRequest`, `LLMResponse`, `LLMMessage`, `LLMToolDefinition`,
`LLMToolCall`, `LLMRole`, and `LLMError` types, with no factory function yet).
These must exist before any ported engine file is typechecked — engine modules
import `logger` and `LLMClient`.

Then port all engine and metrics files listed in the migration map to
`client/src/engine/` and `client/src/metrics/`. Apply mechanical changes. Run
`npm run typecheck` after each module group to catch import issues early.

Also port `server/src/llm/tool-definitions.ts` to `client/src/llm/tool-definitions.ts`
at this stage — `stakeholder-engine.ts` imports it and the client build will fail
without it.

The server TypeScript build passes clean (`tsc --noEmit` exits 0). There are no
pre-existing type errors to fix during the port.

### Phase B — Browser scenario loader (2 days)

Write `client/src/scenario/loader.ts` with the `resolveFile` abstraction. Wire
up Vite `import.meta.glob` (with `eager: true`) for bundled scenarios. Add
`js-yaml` and `zod` to client deps. Port scenario `schema.ts`, `types.ts`,
and `log-profiles.ts` unchanged. Port `validator.ts` with the `checkFileRef`
modification described above (drop `fs.accessSync`, replace `path.resolve`
path-traversal guard with string prefix matching).

### Phase C — LLM client layer (1–2 days)

Port `openai-provider.ts` and `mock-provider.ts`. Write
`bedrock-browser-provider.ts`. Complete `llm-client.ts` by adding the three-mode
factory function to the interface-only stub created in Phase A:
`VITE_MOCK_LLM=true` or `MODE=test` → MockProvider; `VITE_LLM_MODE=harmony` →
BedrockBrowserProvider (imported dynamically to keep it out of non-harmony
builds); `VITE_LLM_MODE=local` or `k8s` → OpenAIProvider.

`BedrockBrowserProvider` and `@aws-sdk/client-bedrock-runtime` (~2MB) must be
imported dynamically (via `await import(...)`) inside the `harmony` branch of
the factory. Static top-level import would include the AWS SDK in all builds
regardless of mode, eliminating the tree-shaking benefit. Dynamic import ensures
non-harmony builds never bundle the AWS SDK.

### Phase D — Rewire React layer (2–3 days)

This phase covers all React components that currently talk to the Express server:

1. **`SessionContext.tsx`** — Replace SSE + HTTP with direct engine calls.
   Implement `metric_update` reducer case. Move session creation into `SessionProvider`
   using `useRef`. Call `gameLoop.start()` inside the `useEffect` alongside
   `gameLoop.onEvent(dispatch)`. Update `onDebriefReady` signature to pass
   `DebriefResult`. Wire debrief via `gameLoop.getEvaluationState()`.

2. **`ScenarioContext.tsx`** — Replace `fetch('/api/scenarios/:id')` with a prop
   accepting `LoadedScenario` directly. Eliminate the separate `<ScenarioProvider>`
   wrapper in `App.tsx` — `SessionProvider` provides the `ScenarioContext` value
   from the `LoadedScenario` it already holds. All `useScenario()` consumers
   are unaffected.

3. **`ScenarioPicker.tsx`** — Replace `fetch('/api/scenarios')` with enumeration
   from `ScenarioLoader` (bundled + remote). The `onStart` callback changes from
   `(scenarioId: string) => void` to `(scenario: LoadedScenario) => void`.

4. **`DebriefScreen.tsx`** — Replace `fetch('/api/sessions/:id/debrief')` with a
   `debriefResult: DebriefResult` prop passed directly from `App.tsx`.

5. **`App.tsx`** — Remove `POST /api/sessions` and `GET /api/scenarios/:id` fetches.
   Remove the `<ScenarioProvider>` wrapper (its role is absorbed into `SessionProvider`).
   `handleStart` receives a `LoadedScenario` from `ScenarioPicker` and passes it
   to `SessionProvider`. `handleDebriefReady` receives `DebriefResult` from
   `SessionProvider` and passes it to `DebriefScreen`.

6. **`client/__tests__/context/SessionContext.test.tsx` and `client/src/testutil/index.tsx`** —
   The existing client component tests use `MockSSEConnection` and pass `sseConnection`
   to `SessionProvider`. After step 1, `sseConnection` no longer exists. These must
   be updated as part of this phase (not Phase G):
   - `renderWithProviders` in `client/src/testutil/index.tsx` is updated to pass
     `scenario: LoadedScenario` instead of `sessionId` + `sseConnection`, and to
     remove the `<ScenarioProvider>` wrapper.
   - `client/__tests__/context/SessionContext.test.tsx` is updated to use the new
     props and to drive the engine directly rather than pushing SSE events.
   - `client/src/testutil/mock-sse.ts` is deleted (no longer needed).

### Phase E — Python proxy (1 day)

Write `proxy/main.py`, `proxy/Dockerfile`, `proxy/requirements.txt`. Smoke-test
against `ai.thekao.cloud`. Write root `docker-compose.yml` for local k8s-mode
testing.

### Phase F — k8s / Docker config (0.5 days)

Write `k8s/deployment.yaml`, `k8s/secret.yaml.example`,
`client/Dockerfile`.

### Phase G — Migrate tests (2 days)

The client already has existing tests in `client/__tests__/` (component tests).
Run `npm test --workspace=client` before beginning migration to confirm a clean
baseline — fix any existing failures before proceeding.

**Test utility migration:** The server tests import from `server/src/testutil/index.ts`,
which uses `path`, `fs`, and `loadMockResponses` to load fixture scenarios from
disk. These must be replaced with browser-compatible equivalents in the client
test utility (`client/src/testutil/`). Specifically:

- `getFixtureScenarioDir()` → replaced by direct `?raw` imports of fixture files
- `getLoadedFixtureScenario()` → loads via the client `loadScenarioFromText()` with a static `resolveFile` built from `import.meta.glob` of fixture files
- `buildMockLLMProvider()` → uses the client `MockProvider` with the bundled fixture YAML

Move the following server test directories to the client, updating import paths:

| Source                            | Destination                     | Disposition                                                                                           |
| --------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `server/src/testutil/index.ts`    | `client/src/testutil/` (extend) | Migrate + rewrite: replace `fs`/`path` fixture loading with `?raw` imports and `loadScenarioFromText` |
| `server/__tests__/engine/`        | `client/__tests__/engine/`      | Migrate — tests ported engine code                                                                    |
| `server/__tests__/metrics/`       | `client/__tests__/metrics/`     | Migrate — tests ported metric code                                                                    |
| `server/__tests__/llm/`           | `client/__tests__/llm/`         | Migrate — tests ported LLM code                                                                       |
| `server/__tests__/scenario/`      | `client/__tests__/scenario/`    | Migrate — tests ported scenario code                                                                  |
| `server/__tests__/routes/`        | (deleted)                       | Delete — routes no longer exist                                                                       |
| `server/__tests__/sse/`           | (deleted)                       | Delete — SSE broker no longer exists                                                                  |
| `server/__tests__/session/`       | (deleted)                       | Delete — session store no longer exists                                                               |
| `server/__tests__/e2e/`           | (deleted)                       | Delete — server-side e2e no longer applicable                                                         |
| `server/__tests__/config.test.ts` | (deleted)                       | Delete — server config no longer exists                                                               |

Verify `npm test --workspace=client` passes.

### Phase H — Delete server, update root (0.5 days)

Delete `server/`. Update root `package.json` workspaces to `["client"]` and
update dev/test/lint scripts. Verify full typecheck and test pass.

**Total estimate: 12–16 days**

---

## Environment Variable Reference

### Client (`VITE_*` — baked into the build)

| Variable             | Values                        | Description                                                                                                                                                                                                                                                  |
| -------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_LLM_MODE`      | `local` \| `k8s` \| `harmony` | Selects LLM backend mode. Default: `local`.                                                                                                                                                                                                                  |
| `VITE_LLM_BASE_URL`  | URL                           | Base URL for OpenAI-compatible endpoint. Used in `local` and `k8s` modes. See mode sections for correct values.                                                                                                                                              |
| `VITE_LLM_API_KEY`   | string                        | LiteLLM API key. Used in `local` mode. Empty in `k8s` mode.                                                                                                                                                                                                  |
| `VITE_LLM_MODEL`     | string                        | Model name passed to the LLM endpoint. Ignored in `k8s` mode (proxy overrides it) and `harmony` mode (model comes from `window.__ONCALL_CONFIG__.bedrockModelId`).                                                                                           |
| `VITE_MOCK_LLM`      | `true`                        | When set to `true`, uses MockProvider regardless of `VITE_LLM_MODE`. For manual development/testing. In Vitest, `import.meta.env.MODE` is automatically `'test'`, which the factory also uses to activate MockProvider without needing to set this variable. |
| `VITE_TOKEN_BUDGET`  | number                        | Max token budget for stakeholder context window. Default: `80000`.                                                                                                                                                                                           |
| `VITE_SCENARIO_URLS` | comma-separated URLs          | Remote scenario base URLs to load in addition to bundled ones.                                                                                                                                                                                               |

### Proxy sidecar (server-side, never reaches browser)

| Variable       | Description                                                         |
| -------------- | ------------------------------------------------------------------- |
| `LLM_MODEL`    | LiteLLM model string (e.g. `openai/gpt-4o`, `bedrock/...`)          |
| `LLM_API_KEY`  | API key for the LLM backend. Optional if using IAM roles (Bedrock). |
| `LLM_BASE_URL` | Optional custom base URL (e.g. `https://ai.thekao.cloud/v1`).       |
| `CORS_ORIGINS` | Comma-separated allowed origins. Default: `*`.                      |

### Runtime config (injected at load time, not baked into build)

`window.__ONCALL_CONFIG__` is an optional object that can override or supplement
build-time config. Used by Harmony to inject deployment-specific values without
requiring a per-environment build.

| Key              | Description                                   |
| ---------------- | --------------------------------------------- |
| `bedrockRoleArn` | IAM role ARN for Harmony mode STS assumption. |
| `bedrockRegion`  | AWS region for Bedrock. Default: `us-east-1`. |
| `bedrockModelId` | Bedrock model ID.                             |
| `scenarioUrls`   | Array of remote scenario base URLs.           |

---

## Open Questions

None. All decisions have been made:

- **Debrief:** LLM-generated narrative via the same `LLMClient` used by the engine.
- **`DebriefResult` and `EvaluationState`:** Both move to `shared/types/events.ts`. `EvaluationState` promotes from `server/src/engine/evaluator.ts`; `DebriefResult` consolidates from server type and client `DebriefPayload`.
- **`ScenarioSummary`:** Added to `client/src/scenario/types.ts` during the port (currently split between server loader and client testutil).
- **`js-yaml` and `zod`:** Added to `client/package.json` dependencies.
- **Proxy language:** Python (FastAPI + LiteLLM SDK).
- **Nginx:** Not used. k8s sidecar communication uses `localhost` within the pod.
- **LiteLLM Node SDK:** Not used (Python-only). Proxy is Python.
- **BedrockProvider in client:** Not ported. Harmony mode uses `BedrockBrowserProvider`
  with Harmony's `authorization.assume()`. All other modes use `OpenAIProvider`.
- **`server/` fate:** Deleted entirely after migration.
- **Session initialization:** Uses `useRef` (not `useMemo`) to guarantee stable,
  once-only creation of the game engine instance.
- **`ScenarioContext`:** Rewired to accept `LoadedScenario` as a prop rather than
  fetching from the server. `useScenario()` consumers are unchanged.
- **`DebriefScreen`:** Accepts `DebriefResult` as a prop from `App.tsx` rather than
  fetching from the server.
