# 0015 — 2026-04-09 — Client-side engine migration design

**Date:** 2026-04-09
**Status:** Design complete, implementation not started

---

## What Was Done

Produced the authoritative design document for migrating the oncall simulator from a
full-stack Node.js/Express architecture to a static client-side application with a
deployment-agnostic LLM backend. The document lives at
`docs/design-client-migration.md` and went through 8+ iterative review passes
before being declared implementation-ready.

---

## Motivation

The current architecture requires a persistent Node.js server to run the game loop,
manage session state over SSE, and proxy LLM calls. This blocks:

- **Harmony hosting** — Harmony is JAMStack-only; it cannot host an application server
- **Self-hosting simplicity** — a Docker/k8s deployment today requires coordinating a
  stateful server process, which adds ops complexity for a single-user training tool

All game engine logic (game loop, metric generation, event scheduling, conversation
state) is pure TypeScript with no I/O dependencies — it is well-suited for in-browser
execution.

---

## Design Summary

### Core architecture change

The simulation engine moves entirely into the browser. The only "backend" after
migration is a stateless LLM endpoint, which can be one of three modes depending on
the deployment context:

| Mode      | LLM endpoint                                        | Credentials in browser                |
| --------- | --------------------------------------------------- | ------------------------------------- |
| `local`   | `ai.thekao.cloud/v1` (LiteLLM) directly             | API key — acceptable for personal use |
| `k8s`     | Python FastAPI sidecar at `localhost:8000`          | Never — injected from k8s Secret      |
| `harmony` | Bedrock via `window.harmony.authorization.assume()` | Temporary STS only — acceptable       |

### What moves to the client

Every engine module that is pure TypeScript with no I/O is ported verbatim (with
mechanical substitutions) from `server/src/` to `client/src/`:

- All of `server/src/engine/` (game-loop, event-scheduler, sim-clock,
  conversation-store, audit-log, evaluator, stakeholder-engine)
- All of `server/src/metrics/` and `metrics/patterns/`
- `server/src/scenario/schema.ts`, `types.ts`, `log-profiles.ts`
- `server/src/llm/openai-provider.ts`, `tool-definitions.ts`

### What is rewritten for the browser

- `server/src/scenario/loader.ts` → `client/src/scenario/loader.ts`: same transform/
  validate pipeline, I/O replaced by a `resolveFile: (path) => Promise<string>`
  callback (bundled: Vite glob; remote: fetch from S3/URL)
- `server/src/llm/mock-provider.ts` → `client/src/llm/mock-provider.ts`: `fs.readFileSync`
  replaced by `import yaml from '...?raw'`; full trigger system preserved
- `server/src/scenario/validator.ts`: `fs.accessSync` existence check removed;
  path-traversal guard replaced with string prefix matching; Zod validation unchanged
- `server/src/scenario/types.ts`: `ScenarioSummary` added (moved from loader.ts)

### What is new

- `client/src/logger.ts` — browser shim matching pino child-logger interface
- `client/src/llm/llm-client.ts` — three-mode factory; interface types only in Phase A,
  factory implementation in Phase C; harmony branch dynamically imports AWS SDK to
  prevent bundling in non-harmony builds
- `client/src/llm/bedrock-browser-provider.ts` — harmony mode; STS via
  `window.harmony.authorization.assume()`; auto-refreshes credentials 5 min before expiry
- `proxy/main.py` — Python FastAPI + LiteLLM SDK; single `POST /llm/chat/completions`
  endpoint; substitutes credentials and model from its own env; structured error
  responses; 60 lines

### React layer changes

The `SessionProvider` props change significantly:

- `sessionId: string` removed (generated internally as `crypto.randomUUID()`)
- `scenario: LoadedScenario` added
- `sseConnection?: MockSSEConnection` removed (SSE gone)
- `onDebriefReady: () => void` → `(result: DebriefResult) => void`

Components that previously fetched from the server are rewired:

| Component             | Was                             | Now                                                          |
| --------------------- | ------------------------------- | ------------------------------------------------------------ |
| `SessionContext.tsx`  | SSE + HTTP                      | Direct `GameLoop` calls; `gameLoop.start()` in `useEffect`   |
| `ScenarioContext.tsx` | `GET /api/scenarios/:id`        | `LoadedScenario` prop from `SessionProvider`                 |
| `ScenarioPicker.tsx`  | `GET /api/scenarios`            | `ScenarioLoader` enumeration (bundled + remote)              |
| `DebriefScreen.tsx`   | `GET /api/sessions/:id/debrief` | `DebriefResult` prop from `App.tsx`                          |
| `App.tsx`             | `POST /api/sessions`            | Loads `LoadedScenario` directly, passes to `SessionProvider` |

`ScenarioProvider` wrapper in `App.tsx` is eliminated — `SessionProvider` provides
the `ScenarioContext` value directly.

### Shared type changes

- `EvaluationState` moves from `server/src/engine/evaluator.ts` → `shared/types/events.ts`
- `DebriefResult` consolidates from server `session.ts` + client `testutil/index.tsx`
  (`DebriefPayload`) → `shared/types/events.ts`
- `ScenarioSummary` moves from `server/src/scenario/loader.ts` + `testutil` →
  `client/src/scenario/types.ts`

### Python proxy (k8s mode)

```python
# proxy/main.py — complete implementation
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import litellm, os

app = FastAPI()
app.add_middleware(CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","), ...)

LLM_MODEL = os.environ["LLM_MODEL"]
LLM_API_KEY = os.environ.get("LLM_API_KEY")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL")

@app.post("/llm/chat/completions")
async def proxy_llm(request: Request):
    body = await request.json()
    try:
        response = await litellm.acompletion(
            model=LLM_MODEL, messages=body["messages"],
            tools=body.get("tools"), api_key=LLM_API_KEY, api_base=LLM_BASE_URL)
        return JSONResponse(content=response.model_dump())
    except litellm.AuthenticationError as e:
        return JSONResponse(status_code=401, ...)
    # ... rate_limit, bad_request, generic 500
```

Supports any LiteLLM-compatible backend: LiteLLM proxy, OpenAI, Bedrock, Anthropic,
Azure. Model and credentials come from pod-level k8s Secrets — never the browser.

---

## Migration Phases

| Phase     | Work                                      | Estimate       |
| --------- | ----------------------------------------- | -------------- |
| A         | Logger shim + port engine/metrics modules | 3–4 days       |
| B         | Browser scenario loader                   | 2 days         |
| C         | LLM client layer (providers + factory)    | 1–2 days       |
| D         | Rewire React layer (5 components + tests) | 2–3 days       |
| E         | Python proxy                              | 1 day          |
| F         | k8s / Docker config                       | 0.5 days       |
| G         | Migrate server tests to client            | 2 days         |
| H         | Delete server, update root                | 0.5 days       |
| **Total** |                                           | **12–16 days** |

---

## Key Design Decisions Made

- **No nginx** — k8s sidecar containers share `localhost`; client calls proxy at
  `http://localhost:8000/llm`; no ingress path routing
- **No LiteLLM Node SDK** — Python-only; proxy is Python FastAPI
- **Vite glob syntax** — `{ query: '?raw', import: 'default', eager: true }` for raw
  string imports in Vite 8 (not the deprecated `{ as: 'raw' }`)
- **`useRef` not `useMemo`** for session creation — `createSession` is synchronous;
  `useMemo` can be discarded by React; `useRef` is stable for the component lifetime
- **`gameLoop.start()` in `useEffect`** — `start()` is a separate call from `createSession`;
  must be in `useEffect` alongside `onEvent(dispatch)` registration
- **`gameLoop.getEvaluationState()`** in debrief — not a separate `evaluator.evaluate()`
  call; the game loop maintains evaluation state internally
- **`@aws-sdk/client-bedrock-runtime` dynamically imported** in `harmony` branch — static
  top-level import would bundle ~2MB AWS SDK in all builds regardless of mode
- **`DebriefResult` / `EvaluationState` in shared** — both needed by `shared/types/events.ts`
  and both are pure data types with no external dependencies

---

## Files to be Created/Modified

See `docs/design-client-migration.md` §§ "File-by-File Migration Map" and "Migration
Phases" for the complete authoritative list. Notable:

**New files:**

- `client/src/logger.ts`
- `client/src/scenario/loader.ts`
- `client/src/llm/bedrock-browser-provider.ts`
- `client/src/llm/mock-provider.ts`
- `proxy/main.py`, `proxy/Dockerfile`, `proxy/requirements.txt`, `proxy/.env.example`
- `client/Dockerfile`
- `k8s/deployment.yaml`, `k8s/secret.yaml.example`
- `docker-compose.yml`

**Deleted:**

- `server/` (entire directory)
- `client/src/hooks/useSSE.ts`
- `client/src/testutil/mock-sse.ts`

---

## Test Results

No code was written this session — design only.

---

## Known Issues

None — all open questions resolved in the design document.

---

## What Comes Next

Implement Phase A: create `client/src/logger.ts`, create the interface-only portion of
`client/src/llm/llm-client.ts`, then port all engine and metrics modules from
`server/src/` to `client/src/` with the mechanical substitutions described in
`docs/design-client-migration.md`.

Starting point: `npm run typecheck` on both workspaces should be clean before beginning.
