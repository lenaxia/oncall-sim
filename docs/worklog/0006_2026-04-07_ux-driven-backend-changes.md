# 0006 — Epic: UX-Driven Backend Changes

**Date:** 2026-04-07
**Status:** Complete
**Triggered by:** UI design review (ui-spec.md §0 usage modes analysis)

---

## Background

During the Phase 7 UI design review, four UX decisions were identified that require backend changes. These are not refactors — they are new capabilities that the client needs to provide a high-quality simulation experience. None break the existing Phase 1–6 architecture; all are additive.

---

## Changes

### 1. `defaultTab` in scenario engine config

**Problem:** The scenario drives which communication channel the incident is first reported through. A paged incident starts on Email. A Slack-reported "hey something's weird" incident starts on Chat. The client cannot infer this — it must be authored in the scenario YAML and surfaced through the API.

**Implementation:**
- `server/src/scenario/types.ts` — added `defaultTab: 'email' | 'chat' | 'tickets' | 'ops' | 'logs' | 'wiki' | 'cicd'` (optional, defaults to `'email'`) to `EngineConfig`
- `server/src/scenario/schema.ts` — added optional `default_tab` enum field to `EngineSchema`
- `server/src/scenario/loader.ts` — maps `raw.engine.default_tab ?? 'email'` → `defaultTab`
- `scenarios/_fixture/scenario.yaml` — added `default_tab: email`
- Client reads `scenario.engine.defaultTab` from `GET /api/scenarios/:id` response and uses it as the initial active tab in `SimShell`

### 2. `jobTitle` and `team` in `PersonaConfig`

**Problem:** DM channels show a persona name but the trainee needs to know who to actually contact. "Sarah Chen / Senior SRE / Platform Team" is actionable. "sarah-chen" is not.

**Implementation:**
- `server/src/scenario/types.ts` — added `jobTitle: string` and `team: string` to `PersonaConfig`
- `server/src/scenario/schema.ts` — added `job_title` and `team` required string fields to `PersonaSchema`
- `server/src/scenario/loader.ts` — maps `raw.job_title` → `jobTitle`, `raw.team` → `team`
- `scenarios/_fixture/scenario.yaml` — added `job_title: "Senior SRE"` and `team: "Platform"` to fixture persona
- `server/src/testutil/fixtures.ts` — updated `FIXTURE_PERSONA` constant
- Client displays job title and team in DM persona cards in the Chat sidebar

### 3. `page_user` replaces `escalate_page`

**Problem:** `escalate_page` implied a fixed escalation path. The real skill is knowing who to page and what to say. `page_user` with explicit `personaId` and `message` params captures both — and both are meaningful evaluation signals.

**Paging sends a page, not a chat message.** When a trainee pages a persona, the server generates a `PageAlert` event (a new `SimEvent` subtype) and emits it via SSE. The paged persona's PagerDuty bot response is modelled as an email (as in real PagerDuty: you page someone, they get an email + the alert appears in the Ops dashboard). The `page_user` action also marks the persona as engaged (same as DMing them for `silentUntilContacted` personas) and triggers the dirty tick so the persona can respond.

**Implementation:**
- `shared/types/events.ts` — renamed `'escalate_page'` → `'page_user'` in `ActionType`; added `PageAlert` interface; added `{ type: 'page_sent'; alert: PageAlert }` to `SimEvent` union
- `server/src/routes/actions.ts` — replaced `'escalate_page'` with `'page_user'` in `VALID_ACTIONS`
- `server/src/scenario/validator.ts` — updated valid action type list
- `server/src/engine/game-loop.ts` — added `'page_user'` case to `handleAction`: creates a `PageAlert`, adds it to the conversation store (new `addPage`/`getAllPages` methods), emits `page_sent` SSE event, marks persona as engaged, triggers dirty tick
- `server/src/engine/conversation-store.ts` — added `pages` collection with `addPage(page)` and `getAllPages()` methods; pages appear in `ConversationStoreSnapshot.pages`
- `server/__tests__/e2e/e2e.test.ts` — replaced `'escalate_page'` with `'page_user'` in ALL_ACTIONS list
- `scenarios/_fixture/scenario.yaml` — no evaluation config referenced `escalate_page`

### 4. Simulation event log in `DebriefResult`

**Problem:** The debrief screen needs to show a timeline of the entire incident: both what the trainee did AND what the simulation produced (alarms fired, LLM messages injected, scripted events). Without a server-side event log, the debrief can only show the audit log (trainee actions only) — half the picture.

**Implementation:**
- `shared/types/events.ts` — added `SimEventLogEntry` interface (a significant `SimEvent` with a `recordedAt: number` sim-time stamp) and exported it
- `server/src/engine/game-loop.ts` — added internal `_eventLog: SimEventLogEntry[]` array; `emit()` now records significant events (all types except `sim_time` and `session_snapshot` — too noisy); capped at 500 entries; new `getEventLog(): SimEventLogEntry[]` method on `GameLoop` interface
- `server/src/session/session.ts` — added `eventLog: SimEventLogEntry[]` to `DebriefResult`
- `server/src/routes/sessions.ts` — resolve handler includes `gameLoop.getEventLog()` in the debrief result
- Client debrief screen renders the event log as a unified incident timeline interleaved with audit log entries, sorted by `simTime`

---

## Files changed

| File | Change type |
|---|---|
| `shared/types/events.ts` | Added `PageAlert`, `SimEventLogEntry`; renamed `escalate_page` → `page_user`; added `page_sent` event |
| `server/src/scenario/types.ts` | Added `defaultTab` to `EngineConfig`; added `jobTitle`, `team` to `PersonaConfig` |
| `server/src/scenario/schema.ts` | Added `default_tab`, `job_title`, `team` fields |
| `server/src/scenario/loader.ts` | Maps new fields |
| `server/src/engine/game-loop.ts` | `page_user` handler; `_eventLog` accumulation; `getEventLog()` |
| `server/src/engine/conversation-store.ts` | `pages` collection |
| `server/src/session/session.ts` | `eventLog` in `DebriefResult` |
| `server/src/routes/actions.ts` | `VALID_ACTIONS` update |
| `server/src/routes/sessions.ts` | Include `eventLog` in debrief |
| `server/src/scenario/validator.ts` | Valid action type list update |
| `scenarios/_fixture/scenario.yaml` | `default_tab`, `job_title`, `team` added |
| `server/src/testutil/fixtures.ts` | `FIXTURE_PERSONA` updated |
| `server/__tests__/e2e/e2e.test.ts` | `escalate_page` → `page_user` |

---

## Test impact

- All existing tests continue to pass (no breakage)
- New `page_user` action tested in E2E suite
- `page_sent` SSE event tested
- `eventLog` in debrief tested
- `defaultTab` in scenario loader test
- `jobTitle`/`team` in persona loader test

---

## What comes next

Phase 7 UI implementation can proceed. The UI spec §0 UX decisions now have full backend support.
