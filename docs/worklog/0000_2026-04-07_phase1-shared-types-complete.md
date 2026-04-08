# 0000 — Phase 1: Shared Types, Scenario Schema, and Test Infrastructure

**Date:** 2026-04-07
**Phase:** 1 — Shared Types and Scenario Schema
**Status:** Complete

---

## What Was Done

Implemented the complete foundation that all subsequent phases depend on. No previous phases existed; this was the starting point.

### `shared/types/events.ts`

Defined the canonical discriminated-union SSE event type and all core data shapes:

- `SimEvent` — 16-member discriminated union covering every event the server can emit
- `SessionSnapshot` — full point-in-time state sent to clients on SSE connect/reconnect
- Core data shapes: `TimeSeriesPoint`, `AuditEntry`, `ChatMessage`, `EmailMessage`, `Ticket`, `TicketComment`, `LogEntry`, `Alarm`, `Deployment`, `CoachMessage`
- Enumeration types: `TicketSeverity`, `TicketStatus`, `LogLevel`, `AlarmSeverity`, `AlarmStatus`, `DeploymentStatus`
- `ActionType` — 22-member union covering all trainee action categories (incident management, communication, investigation, remediation, monitoring)

### `server/src/scenario/schema.ts`

Full Zod schema for `scenario.yaml` validation:

- Top-level structure with all required and optional sections
- Sub-schemas for: `PersonaSchema`, `AlarmConfigSchema`, `RemediationActionSchema`, `EvaluationSchema`, `MetricConfigSchema`, `OpsDashboardSchema`, `EngineSchema`, `CICDSchema`, `WikiSchema`, `ChatSchema`, and more
- Inline `ops_dashboard` and referenced `ops_dashboard_file` both handled

### `server/src/scenario/types.ts`

Typed output interfaces representing fully parsed scenario config as used by all server modules:

- `LoadedScenario` — top-level type used everywhere in the server
- Supporting types: `ServiceType`, `Difficulty`, `NoiseLevel`, `HealthLevel`, `CorrelationType`, `TrafficProfile`, `RemediationActionType`
- All config sub-types: `PersonaConfig`, `AlarmConfig`, `RemediationActionConfig`, `MetricConfig`, `FocalServiceConfig`, `CorrelatedServiceConfig`, `ServiceScale`, `OpsDashboardConfig`, `EvaluationConfig`, `EngineConfig`, `LLMEventToolConfig`, `TimelineConfig`, `TopologyConfig`

### Re-export shims

- `server/src/types/events.ts` — re-exports all from `@shared/types/events`
- `client/src/types/events.ts` — re-exports all from `@shared/types/events`

### `@shared` path alias

Configured in both `server/tsconfig.json` and `client/tsconfig.json` so server and client import from `@shared/types/events` without relative path gymnastics.

### `scenarios/_fixture/`

Minimal but complete test scenario satisfying the full Zod schema:

- `scenario.yaml` — one persona, one alarm (auto_page), one email, one chat message, one ticket, one log entry, two CI/CD deployments (t=-300 and t=-86400), one wiki page, one remediation action, one metric (error_rate Tier 2)
- `mock-llm-responses.yaml` — four triggers: `tick_1` (stakeholder chat), `after_action:trigger_rollback:fixture-service` (recovery message + log injection), `proactive_tick_1` (coach nudge), `on_demand` (coach response)

### `server/src/testutil/index.ts`

Full reusable server test infrastructure:

- `getFixtureScenario()` — loads and caches the fixture scenario; all tests share one parse
- `getFixtureScenarioDir()` — returns fixture directory path
- `buildTestSession(overrides?)` — constructs a fully wired in-memory session with all engine components; id override correctly propagates to game loop's sessionId
- `buildTestClock(initialSimTime?)` — controllable clock implementing the full `SimClock` interface
- `buildAuditLog(entries)` — constructs pre-populated `AuditEntry[]`
- `expectEvent(events, type)` — asserts presence and returns typed event
- `expectNoEvent(events, type)` — asserts absence
- `expectAction(log, action)` — asserts audit log entry and returns it
- `buildFlatSeries(value, from, to, resolution)` — flat time series for metric tests
- `getMockLLMProvider()` — loads `MockProvider` from fixture responses
- `buildMockLLMProvider(responses)` — builds `MockProvider` with custom inline responses
- `clearFixtureCache()` — resets the cached fixture between tests

### `server/src/testutil/fixtures.ts`

Typed fixture constants reused across multiple test files:

- `FIXTURE_SCENARIO_ID`, `FIXTURE_SESSION_ID`
- `FIXTURE_PERSONA`, `FIXTURE_ALARM`, `FIXTURE_REMEDIATION_ACTION`

### `server/src/testutil/testutil.test.ts`

Tests for the testutil module itself (56 tests).

### `client/src/testutil/index.ts`

Client-side test infrastructure:

- `buildMockSSE()` — mock SSE connection for testing `useSSE` hook without a real server
- `renderWithProviders(ui, options?)` — wraps components with all required React contexts
- `buildTestSnapshot(overrides?)` — builds a minimal valid `SessionSnapshot`
- Additional builders: `buildAuditEntry`, `buildChatMessage`, `buildEmail`, `buildTicket`, `buildTicketComment`, `buildLogEntry`, `buildAlarm`, `buildDeployment`, `buildCoachMessage`

### `client/src/testutil/testutil.test.ts`

Tests for client testutil module.

### ESLint configuration

Created `.eslintrc.json` for both server and client workspaces:

- `@typescript-eslint/recommended-requiring-type-checking` strict rule set
- `no-explicit-any` as error
- `no-misused-promises` configured with `checksVoidReturn: { arguments: false }` to allow async Express handlers
- Client config adds `react-hooks/rules-of-hooks` and `react-hooks/exhaustive-deps`

---

## Test Results

- **Pass rate:** 56/56 (testutil.test.ts)
- **Known failures:** None
- **Typecheck:** Clean
- **Lint:** Clean

---

## Known Issues

None.

---

## What Comes Next

Phase 2 — Metric Generator: implement `generator.ts`, `resolver.ts`, `incident-types.ts`, `archetypes.ts`, `correlation.ts`, and all four pattern modules.
