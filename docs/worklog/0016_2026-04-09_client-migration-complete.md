# 0016 — 2026-04-09 — Client-side engine migration complete

**Date:** 2026-04-09
**Phase:** Client Migration (design-client-migration.md)
**Status:** Complete
**Branch:** `feature/phase-client-migration`
**Commit:** `b998bef`

---

## What Was Done

Implemented the full client-side engine migration as designed in `docs/design-client-migration.md`. All eight phases shipped in a single branch.

### Phase A — Core engine + metrics + LLM modules ported to client

Ported 25 modules from `server/src/` to `client/src/` with browser-compatible replacements:

- `client/src/logger.ts` — browser console shim matching the pino child-logger interface
- `client/src/engine/` — audit-log, sim-clock, conversation-store, evaluator, event-scheduler, stakeholder-engine, game-loop
- `client/src/metrics/` — types, archetypes, incident-types, series, resolver, correlation, generator, metric-store, metric-summary, patterns/\*
- `client/src/llm/llm-client.ts` — interface + three-mode factory (`local` | `k8s` | `harmony`)
- `client/src/llm/tool-definitions.ts`

Key browser adaptations:

- `randomUUID()` via `globalThis.crypto.randomUUID()` (no `node:crypto`)
- `import.meta.env.VITE_*` replaces `process.env.*`
- Logger outputs to `console.*` with no pino dependency
- `EvaluationState` and `DebriefResult` promoted to `shared/types/events.ts` (canonical shared types)

### Phase B — Scenario modules

- `client/src/scenario/types.ts` — runtime camelCase types
- `client/src/scenario/schema.ts` — Zod schema (server-identical)
- `client/src/scenario/validator.ts` — cross-reference validator (browser port: `fs.accessSync` removed; path-traversal guard via string prefix matching)
- `client/src/scenario/log-profiles.ts` — ambient log profiles (identical)
- `client/src/scenario/loader.ts` — **new browser loader** using `resolveFile` callback abstraction

  `loadScenarioFromText(yamlText, resolveFile)` replaces the server's `loadScenario(dir)`. Two public entry points:
  - `loadBundledScenarios()` — backed by `import.meta.glob(..., { eager: true, query: '?raw' })`
  - `loadRemoteScenario(baseUrl)` — backed by `fetch()`

  Full pipeline preserved: YAML parse → Zod validate → `ops_dashboard_file` fetch → cross-reference validate → incident_type warn → transform to camelCase.

Dependencies added to `client/package.json`: `js-yaml`, `zod`, `@types/js-yaml`.

### Phase C — LLM provider layer

- `client/src/llm/openai-provider.ts` — OpenAI-compatible HTTP provider (unchanged from server; `fetch` is native in browsers)
- `client/src/llm/mock-provider.ts` — deterministic mock; `loadMockResponses(dir)` replaced by `?raw` import of fixture YAML
- `client/src/llm/bedrock-browser-provider.ts` — **new** Bedrock provider using `window.harmony.authorization.assume()` for STS credential vending; auto-refreshes credentials 5 min before expiry; dynamically imported to keep `@aws-sdk` out of non-harmony bundles
- `client/src/llm/llm-client.ts` — `createLLMClient()` factory: `VITE_MOCK_LLM=true` or `MODE=test` → MockProvider; `VITE_LLM_MODE=harmony` → BedrockBrowserProvider (dynamic import); `local`|`k8s` default → OpenAIProvider

`@aws-sdk/client-bedrock-runtime` added to `client/package.json`.

### Phase D — React layer rewire

All changes preserve the existing `SessionContextValue` interface; child tab components required no modification.

**`SessionContext.tsx`** — complete rewrite:

- Removed: `EventSource`, `sseConnection` prop, `sessionId` prop
- Added: `scenario: LoadedScenario` prop creates the full engine stack (SimClock, EventScheduler, AuditLog, ConversationStore, Evaluator, MetricStore, StakeholderEngine, GameLoop) on first render
- `_testGameLoop?: GameLoop` test-injection prop bypasses engine creation for unit tests
- LLM client initialised asynchronously; temp no-op LLM used until resolved
- `resolveSession()` stops the loop, evaluates, calls debrief LLM, delivers `DebriefResult` via `onDebriefReady` callback

**`ScenarioContext.tsx`** — complete rewrite:

- Removed: `scenarioId` prop + `GET /api/scenarios/:id` fetch
- Added: `scenario: LoadedScenario` prop; `toScenarioConfig()` transforms synchronously on mount
- `hostGroupCounts` and `adjustHostGroup` preserved

**`ScenarioPicker.tsx`** — rewritten to use `loadBundledScenarios()` + optional `loadRemoteScenario()` for `VITE_SCENARIO_URLS`; `onStart` now receives `LoadedScenario` instead of `string`

**`DebriefScreen.tsx`** — rewritten to accept `debriefResult: DebriefResult` prop directly; no fetch loop

**`App.tsx`** — rewritten: `ScenarioPicker.onStart(scenario)` → create session; `SessionProvider.onDebriefReady(result)` → show debrief screen with result in-hand

**`vite.config.ts`** — `/llm` proxy added for k8s mode; `optimizeDeps` for `js-yaml`/`zod`

**Testutil overhaul:**

- `buildMockSSE()` → `buildMockGameLoop()` — emits `SimEvent` directly into `onEvent` subscribers
- `MockSSEConnection` → `MockGameLoop` interface
- `renderWithProviders` passes `_testGameLoop` to `SessionProvider`
- Added: `getFixtureScenario()` (async, cached), `clearFixtureCache()`, `buildTestClock()`, `expectEvent()`, `expectNoEvent()`, `expectAction()`, `buildMockLLMProvider()`, `getMockLLMProvider()`, re-exported `createSeededPRNG`
- All 27 existing test files updated: SSE → game loop event pattern

### Phase E — Python proxy sidecar

`proxy/` directory:

- `main.py` — FastAPI app; single `POST /llm/chat/completions` route forwarding to any LiteLLM-supported backend; CORS middleware; structured error responses matching OpenAI error shape
- `requirements.txt` — `fastapi`, `uvicorn[standard]`, `litellm`
- `Dockerfile` — python:3.12-slim, no-cache pip install
- `.env.example` — `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL`, `CORS_ORIGINS`

### Phase F — Deployment configuration

- `client/Dockerfile` — multi-stage: build with `VITE_*` ARGs, serve with `npx serve`
- `k8s/deployment.yaml` — two-container pod (client + proxy sidecar); all proxy credentials via `oncall-secrets` Secret
- `k8s/secret.yaml.example` — template for `llm-model`, `llm-api-key`, `llm-base-url`
- `docker-compose.yml` — local docker testing with `network_mode: host`

### Phase G — Test migration

Server tests migrated to client; server-specific tests deleted.

**Migrated (53 test files total after migration):**

- `engine/` — audit-log, sim-clock, conversation-store, evaluator, event-scheduler, game-loop, stakeholder-engine, stakeholder-engine-reactive
- `metrics/` — archetypes, incident-types, resolver, correlation, generator, metric-store, metric-summary, patterns/{baseline, noise, rhythm, incident-overlay, reactive-overlay}
- `llm/` — mock-provider, tool-definitions
- `scenario/` — schema, validator, loader, log-expansion

**Deleted:** routes, sse, session, e2e, config tests

Key migration adaptations:

- `getFixtureScenario()` is now async; tests use `beforeAll` + module-level `_fixture` variable to keep helper functions synchronous
- `loadScenario(dir)` → `loadScenarioFromText(yaml, resolveFile)` with inline YAML and `makeResolve(files)` helpers
- `fs.readFileSync` → `fixtureYaml from '...?raw'` (Vitest resolves `?raw` imports)
- `validateCrossReferences(raw, dir)` → `validateCrossReferences(raw)` (no dir arg in browser port)
- Validator "missing file" test updated: browser validator defers existence check to `resolveFile` rejection (documented in test)

### Phase H — Server deletion

- `server/` directory deleted entirely
- `package.json` workspaces: `["server", "client"]` → `["client"]`
- Root `scripts.dev/test/typecheck/lint` updated to client-only; `concurrently` removed
- `@types/pino` removed from root devDependencies

---

## Test Results

```
Test Files  53 passed (53)
Tests       846 passed (846)
Duration    ~30s
```

Pre-existing test count (before migration): 360 tests across 27 files.
Net new tests from server migration: 486 tests across 26 new files.

TypeScript: `tsc --noEmit` exits 0, no errors.

---

## Known Issues / Design Decisions

**Validator file-existence check removed.** The server validator used `fs.accessSync` to verify referenced files exist before loading. The browser validator omits this — existence is verified when `resolveFile()` rejects during `loadScenarioFromText()`. The error surface is identical from the caller's perspective; only the timing differs (cross-ref phase vs. transform phase). One validator test updated to document this.

**SessionProvider `_testGameLoop` prop.** Using a leading underscore naming convention signals test-only intent to reviewers. The prop is fully typed and the bypass path is well-isolated; the production path is unchanged.

**`getFixtureScenario()` caching.** The helper caches the fixture after first load to avoid repeated YAML parse + Zod validate across 100+ test cases. `clearFixtureCache()` is called in `beforeEach` for tests that mutate the fixture object.

**BedrockBrowserProvider dynamic import.** `@aws-sdk/client-bedrock-runtime` is only tree-shaken into the bundle in harmony mode. Non-harmony builds do not include AWS SDK code. This was verified by inspecting the factory conditional before submitting.

---

## What Comes Next

The migration is complete. The server no longer exists. Remaining product work:

1. **Scenario authoring** — write additional training scenarios beyond `_fixture`
2. **Harmony deployment** — deploy to the team's Harmony environment with Bedrock credentials
3. **k8s staging** — validate the two-container pod manifest on a real cluster
4. **Debrief narrative** — wire the debrief LLM call to produce structured, actionable feedback (currently returns raw LLM text)
5. **Scenario difficulty tuning** — calibrate metric overlays and stakeholder response timing
