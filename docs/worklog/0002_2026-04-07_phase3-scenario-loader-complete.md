# 0002 — Phase 3: Scenario Loader and Validation

**Date:** 2026-04-07
**Phase:** 3 — Scenario Loader and Validation
**Status:** Complete

---

## What Was Done

Implemented the scenario loading pipeline that runs at server startup. Loads YAML files from disk, validates them against the Zod schema and cross-reference rules, resolves file references into memory, and produces fully ready `LoadedScenario` objects. Errors in individual scenarios are logged and that scenario is excluded — the server never crashes on a bad scenario file.

### `server/src/scenario/loader.ts`

#### `loadAllScenarios(scenariosDir)`

- Reads the scenarios directory and lists all subdirectories
- Skips `_fixture/` — test-only, never served to clients
- Calls `loadScenario()` for each subdirectory
- Collects results: valid scenarios added to the returned `Map<string, LoadedScenario>`, errors logged with field paths and excluded
- Returns the map even if all scenarios fail — server continues starting

#### `loadScenario(scenarioDir)`

Eight-step pipeline:

1. Read `scenario.yaml` from the scenario directory (returns `ScenarioLoadError` with clear message if not found)
2. Parse YAML to raw object
3. Run Zod schema parse — maps Zod issues to `ValidationError[]` with dot-path field references
4. Check `ops_dashboard_file` / `ops_dashboard` mutual exclusivity — returns error if both present
5. If `ops_dashboard_file` present: read `metrics.yaml`, parse, merge into raw config
6. Run `validateCrossReferences()` (validator.ts) — returns `ScenarioLoadError` if any errors
7. Check `incident_type` against registry — logs warning if not found, does not error
8. Transform raw config → `LoadedScenario`: camelCase fields, resolve `body_file`/`content_file` references to string content, load wiki pages from markdown files

#### `toScenarioSummary(scenario)`

Returns a `ScenarioSummary` with only picker-screen fields (`id`, `title`, `description`, `serviceType`, `difficulty`, `tags`). Used by `GET /api/scenarios`.

#### `isScenarioLoadError(result)`

Type guard distinguishing `LoadedScenario` from `ScenarioLoadError`.

**Important:** Metric generation is NOT called in the loader. Metrics are session-scoped and generated at session creation time by the Phase 6 session factory. The `LoadedScenario` type has no `metrics` field.

### `server/src/scenario/validator.ts`

#### `validateCrossReferences(scenario, scenarioDir)`

Second validation pass (after Zod) checking referential integrity. All 10 rules implemented:

1. Alarm `metric_id` must match a metric id in `ops_dashboard` for the alarm's service
2. Alarm `service` must match `focal_service.name` or a `correlated_service.name` in `ops_dashboard`
3. Persona IDs referenced in chat messages, email from/to, and ticket `createdBy` must exist in `personas[]`
4. `evaluation.relevant_actions[].action` must be a valid `ActionType`
5. `evaluation.relevant_actions[].remediation_action_id` (if present) must exist in `remediation_actions[]`
6. `correlated_services[].name` must appear in `topology.upstream` or `topology.downstream`
7. Metric archetype values must exist in `getValidArchetypes()`
8. `ops_dashboard` and `ops_dashboard_file` are mutually exclusive
9. No duplicate IDs within: `alarms[]`, `personas[]`, `remediation_actions[]`, `tickets[]`, `wiki.pages[]`
10. All file references resolve to existing, readable files within the scenario directory

Errors are collected before returning — all violations reported together, not fail-fast.

#### Path traversal protection

`ops_dashboard_file` references and all `body_file`/`content_file` references are resolved relative to the scenario directory. Any path that resolves outside the scenario directory is rejected with a clear error.

---

## Test Results

| File | Tests |
|---|---|
| `schema.test.ts` | 55 |
| `validator.test.ts` | 22 |
| `loader.test.ts` | 25 |
| **Total** | **102** |

- **Pass rate:** 102/102
- **Known failures:** None
- **Typecheck:** Clean
- **Lint:** Clean

---

## Known Issues

None.

---

## What Comes Next

Phase 4 — Core Game Engine: implement `sim-clock.ts`, `event-scheduler.ts`, `audit-log.ts`, `conversation-store.ts`, `evaluator.ts`, and `game-loop.ts`.
