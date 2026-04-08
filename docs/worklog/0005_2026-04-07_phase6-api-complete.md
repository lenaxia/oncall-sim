# 0005 — Phase 6: Session Management, REST API, and SSE

**Date:** 2026-04-07
**Phase:** 6 — Session Management, REST API, and SSE
**Status:** Complete

---

## What Was Done

Implemented the complete HTTP/SSE API surface: Express app wiring, environment config validation, session lifecycle management, SSE event broker, and all twelve route handlers. This phase integrates every Phase 1–5 component into a running server.

### `server/src/config.ts`

Reads and validates environment variables at startup. Throws with a clear, actionable message on missing required vars — the server never starts in a misconfigured state.

- `loadConfig()` — validates and returns typed `ServerConfig`
- Defaults: `PORT=3001`, `SCENARIOS_DIR=../scenarios`, `SESSION_EXPIRY_MS=600000`, `LLM_TIMEOUT_MS=30000`, `LLM_MAX_RETRIES=2`
- `MOCK_LLM=true` bypasses all LLM provider env var checks
- `LLM_PROVIDER=openai` requires `OPENAI_API_KEY`; throws with key name in message
- `LLM_PROVIDER=bedrock` requires `BEDROCK_MODEL_ID`; throws with key name in message
- Unknown `LLM_PROVIDER` throws with the bad value in the message

### `server/src/index.ts`

Express app factory and server entry point:

- `createApp(scenarios, sessionStore, sseBroker, llmClient)` — exported for testing
- Mounts all routers: `scenariosRouter`, `sessionsRouter`, `actionsRouter`, `chatRouter`, `emailRouter`, `coachRouter`
- Global error handler preserves `err.status`/`err.statusCode` from middleware (body-parser returns 400 for malformed JSON — previously swallowed as 500, now forwarded correctly)
- Session expiry interval: `evictExpired()` called every 60 real seconds
- `main()` — loads config, loads all scenarios, starts the HTTP server

### `server/src/session/session.ts`

Session factory — wires all Phase 1–5 components:

- `createSession(scenarioId, scenario, llmClient)` — returns `Promise<Session>`
- Wires: `generateAllMetrics`, `createSimClock` (initialised from `scenario.timeline.defaultSpeed`), `createEventScheduler`, `createAuditLog`, `createConversationStore`, `createEvaluator`, `createStakeholderEngine`, `createGameLoop` with `onDirtyTick` bound to the stakeholder engine
- `populateInitialState` — seeds the conversation store before the first tick:
  - All tickets (regardless of `at_second`)
  - All deployments (regardless of `deployed_at_sec`)
  - Emails, chat messages, and log entries at `t < 0` (pre-incident history the trainee arrives to)

### `server/src/session/session-store.ts`

In-memory session registry:

- `createSessionStore(expiryMs?)` — factory; default 600,000ms (10 minutes)
- `create(session)`, `get(id)`, `getAll()`, `delete(id)`
- `evictExpired()` — iterates all sessions; for each where `Date.now() - session.lastSseAt > expiryMs`: calls `gameLoop.stop()`, sets `session.status = 'expired'`, deletes from map; logs eviction

### `server/src/sse/sse-broker.ts`

SSE connection manager. One broker per server; handles all sessions.

#### `connect(sessionId, res)`

1. Sets SSE headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`
2. Calls `res.flushHeaders()`
3. Looks up session; if not found or `status === 'expired'`: sends `session_expired` event, calls `res.end()`, returns no-op cleanup
4. Sets `session.lastSseAt = Date.now()`
5. Sends `session_snapshot` as first event (full state for reconnecting clients)
6. Registers write function in `_writers` map (keyed by `sessionId → connId → writeFn`)
7. Calls `session.gameLoop.onEvent(writeFn)` — receives cleanup function `removeHandler`
8. Starts heartbeat: `setInterval` every 15 real seconds writes `': heartbeat\n\n'` and **refreshes `session.lastSseAt`** (prevents eviction of actively connected sessions)
9. Returns cleanup function that: calls `clearInterval`, calls `removeHandler()` (removes handler from game loop's `_eventHandlers` array — prevents resource leak), removes from `_writers` map

#### `broadcast(sessionId, event)`

Iterates `_writers.get(sessionId)` and writes `'data: ' + JSON.stringify(event) + '\n\n'` to each connected response. Errors are caught silently (connection may have closed).

#### `connectionCount(sessionId)`

Returns number of active connections for a session.

### Route files

All six route files use `Router({ mergeParams: true })` mounted at `/api/sessions/:id/<sub>` paths so the `:id` param propagates correctly.

#### `server/src/routes/scenarios.ts`

- `GET /api/scenarios` — returns `toScenarioSummary(scenario)` for all loaded scenarios
- `GET /api/scenarios/:id` — returns full `LoadedScenario`; 404 if not found

#### `server/src/routes/sessions.ts`

- `POST /api/sessions` — validates `scenarioId`, calls `createSession`, stores it, calls `gameLoop.start()`, responds 201 with `{ sessionId }`
- `DELETE /api/sessions/:id` — calls `gameLoop.stop()`, deletes from store, responds 204; 404 if not found
- `GET /api/sessions/:id/events` — delegates to `sseBroker.connect(id, res)`; registers `res.on('close', cleanup)`
- `POST /api/sessions/:id/speed` — validates speed (must be 1|2|5|10) and/or paused; calls `gameLoop.setSpeed()`/`pause()`/`resume()`; 204; 409 if not active
- `POST /api/sessions/:id/resolve` — stops game loop, sets `status = 'resolved'`, builds debrief stub, responds 202; uses `setImmediate` to broadcast `debrief_ready` after response; 409 if already resolved
- `GET /api/sessions/:id/debrief` — returns debrief object; 404 if `session.debrief === null`

#### `server/src/routes/actions.ts`

- `POST /api/sessions/:id/actions` — validates `action` is a member of `VALID_ACTIONS` (22-member set matching `ActionType`); calls `gameLoop.handleAction(action, params)`; 204; 400 for invalid action; 409 if not active

#### `server/src/routes/chat.ts`

- `POST /api/sessions/:id/chat` — validates `channel` and `text`; calls `gameLoop.handleChatMessage(channel, text)`; broadcasts `chat_message` via broker; 204; 409 if not active

#### `server/src/routes/email.ts`

- `POST /api/sessions/:id/email/reply` — validates `threadId` and `body`; calls `gameLoop.handleEmailReply(threadId, body)`; broadcasts `email_received` via broker; 204; 409 if not active; reply `to` falls back to `'unknown'` when thread not found

#### `server/src/routes/coach.ts`

- `POST /api/sessions/:id/coach` — returns 501 with `{ error: 'Coach not implemented until Phase 9' }`; Phase 9 stub

---

## Bugs found and fixed during validation

The following bugs were identified across multiple validation passes and fixed:

1. **`sse-broker.test.ts` `makeSession` used 9 undefined identifiers** — replaced with `buildTestSession` from testutil
2. **`buildTestSession` hardcoded `sessionId: 'test-session-id'`** — id override now correctly propagates to game loop
3. **`GameLoop.onEvent` had no removal mechanism** — changed to return `() => void` cleanup; broker now calls it on disconnect, preventing resource leak
4. **`session.lastSseAt` not refreshed during active connections** — heartbeat now updates `lastSseAt` every 15s, preventing eviction of live sessions after 10 minutes
5. **Global error handler discarded `err.status`/`err.statusCode`** — now preserved; malformed JSON body returns 400 not 500
6. **`server/src/types/events.ts` re-export shim deleted** — recreated (LLD 01 §9 requires it)
7. **Missing `config.test.ts`** — created; covers all DoD items (missing vars throw with clear messages, defaults, overrides)
8. **Three missing LLD §10 test cases** — added: `chat_message` SSE broadcast, `email_received` SSE broadcast, scripted event delivered to SSE stream
9. **`simTime` assertion too weak** — strengthened to assert `=== 0` not just `typeof === 'number'`
10. **Misleading test name** — `'invalid action type → 400'` in routes.test.ts actually tested 404; renamed accurately
11. **`routes.test.ts` "game loop started" test too weak** — added test proving events flow via `onEvent` after session creation

---

## Test Results

| File | Tests |
|---|---|
| `config.test.ts` | 15 |
| `session-store.test.ts` | 7 |
| `sse-broker.test.ts` | 8 |
| `routes.test.ts` | 11 |
| `session-lifecycle.test.ts` | 26 |
| `e2e/e2e.test.ts` | 150 |
| **Total (Phase 6 specific)** | **217** |
| **Total (all phases combined)** | **615** |

- **Pass rate:** 615/615
- **Known failures:** None
- **Typecheck:** Clean (server + client)
- **Lint:** Clean (server + client)

---

## E2E Test Coverage (`e2e.test.ts` — 150 tests across 25 suites)

The E2E suite tests the full system end-to-end against a real Express app with `MOCK_LLM=true`:

1. Scenario catalogue (list + fetch + error paths)
2. Session lifecycle (create, inspect, delete + all error paths)
3. Initial state seeded by `populateInitialState` (deployments, tickets, metrics, snapshot fields)
4. Trainee actions (audit log recording, ordering, all error paths)
5. Speed control and pause/resume (all valid speeds, invalid speed, 409 on resolved)
6. Chat and email (store persistence, reply threading, `Re:` subject, audit log, all error paths)
7. SSE stream integrity (event ordering, snapshot fields, multi-client fan-out, cleanup, reconnect state)
8. Session expiry (eviction, `status=expired`, SSE `session_expired`, recently-connected not evicted)
9. Resolve flow (202, status, debrief 404/200, debrief shape, audit log in debrief, `debrief_ready` SSE, 409 on double-resolve)
10. Coach stub (501 with "Phase 9" message)
11. Concurrent session isolation (audit logs, chat, SSE, speed, resolve all isolated)
12. Full incident-response journey (investigate → communicate → rollback → monitor → resolve → debrief)
13. `GET /api/scenarios/:id` full config shape
14. Ticket operations (`update_ticket` store + SSE, `add_ticket_comment` store + SSE, snapshot persistence)
15. Alarm operations (`ack_page`, `suppress_alarm` SSE + audit log)
16. Evaluator integration (`relevantActionsTaken`, `redHerringsTaken`, `resolved`, deduplication, empty audit log)
17. SSE event shapes (all field types verified for every event type; HTTP headers: `Content-Type`, `Cache-Control`, `X-Accel-Buffering`)
18. All 22 `ActionType` values accepted (guards against `VALID_ACTIONS` drift)
19. DM chat channel (`dm:persona-id` stored and delivered via SSE)
20. Multiple email threads (thread routing, nonexistent thread fallback, multiple replies)
21. Audit log ordering and deduplication
22. Global error handler (malformed JSON → 400, unknown route → 404)
23. Session store `getAll` (multiple sessions, post-delete state)
24. Snapshot consistency (post-update, post-chat, post-email, idempotency)
25. DELETE stops game loop (no events after delete, 404 on action, SSE `session_expired`)

---

## Known Issues

None.

---

## What Comes Next

Phase 7 — UI Component Library: can run in parallel with Phases 4–6 (depends only on Phase 1 shared types). Implement React components: `TabBar`, `SpeedControl`, `CoachPanel`, `ScenarioPicker`, `DebriefScreen`, and all seven sim tabs.
