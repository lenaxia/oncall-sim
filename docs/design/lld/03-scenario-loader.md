# LLD 03 — Scenario Loader and Validation

**Phase:** 3
**Depends on:** Phase 1 (shared types, scenario schema, scenario config types), Phase 2 (metric generator)
**HLD sections:** §8.1, §8.2, §8.3, §8.5, §8.6, §8.7, §21

---

## Purpose

Load scenario YAML files from disk, validate them against the Zod schema and cross-reference rules, resolve `ops_dashboard_file` references, run metric generation, and produce fully ready `LoadedScenario` objects that the game engine can use directly. Runs once at server startup. Errors in individual scenarios are logged and that scenario excluded — the server continues loading other scenarios.

---

## Scope

```
server/src/scenario/
  loader.ts       # orchestrates load, validate, generate
  schema.ts       # Zod schema (defined in Phase 1)
  types.ts        # parsed config types (defined in Phase 1)
  validator.ts    # cross-reference validation (second pass after Zod)
```

The metric generator (`server/src/metrics/`) is called by the loader but defined in Phase 2.

---

## 1. Module Interfaces

### `loader.ts`

```typescript
// Loads all scenarios from the scenarios directory.
// Returns a map of scenarioId → LoadedScenario for all valid scenarios.
// Invalid scenarios are logged and excluded — never throws.
export async function loadAllScenarios(
  scenariosDir: string
): Promise<Map<string, LoadedScenario>>

// Loads and validates a single scenario directory.
// Returns the LoadedScenario if valid, or a ScenarioLoadError describing why it failed.
export async function loadScenario(
  scenarioDir: string
): Promise<LoadedScenario | ScenarioLoadError>

// Returns a scenario summary suitable for the GET /api/scenarios list endpoint.
// Does not include full config — only picker-screen fields.
export function toScenarioSummary(scenario: LoadedScenario): ScenarioSummary
```

### `validator.ts`

```typescript
// Runs cross-reference validation on a parsed scenario config.
// Returns an array of validation errors. Empty array = valid.
// Never throws — all errors are returned for collection.
export function validateCrossReferences(
  scenario: z.infer<typeof ScenarioSchema>,   // output of Zod parse, pre-transform
  scenarioDir: string
): ValidationError[]

interface ValidationError {
  scenarioId: string
  field:      string   // dot-path to the offending field, e.g. 'alarms[0].metric_id'
  message:    string   // human-readable, actionable
}
```

---

## 2. Data Types

```typescript
// Returned by loadAllScenarios and the GET /api/scenarios list endpoint
export interface ScenarioSummary {
  id:          string
  title:       string
  description: string
  serviceType: ServiceType
  difficulty:  Difficulty
  tags:        string[]
}

// Returned when a scenario fails to load — never thrown, always returned
export interface ScenarioLoadError {
  scenarioId: string
  scenarioDir: string
  errors: ValidationError[]
}

export function isScenarioLoadError(
  result: LoadedScenario | ScenarioLoadError
): result is ScenarioLoadError
```

---

## 3. Load Sequence

```
loadAllScenarios(scenariosDir):
  1. Read scenariosDir — list all subdirectories
  2. Skip _fixture/ (test only — not served to clients)
  3. For each subdirectory: call loadScenario(dir)
  4. Collect results: valid → add to map, error → log with field paths and skip
  5. Return map (may be empty if all scenarios fail — server still starts)

loadScenario(scenarioDir):
  1. Read scenario.yaml (or fail with clear file-not-found error)
  2. Parse YAML → raw object
  3. Run Zod schema parse
     - On failure: return ScenarioLoadError with Zod issues mapped to ValidationError[]
  4. Check for ops_dashboard_file reference
     - If present: read metrics.yaml from scenarioDir, parse, merge into raw config
     - If both ops_dashboard and ops_dashboard_file present: return error (mutually exclusive)
  5. Run cross-reference validation (validator.ts)
     - If errors: return ScenarioLoadError
  6. Check incident_type against registry (metrics/incident-types.ts)
     - If not found: log warning, continue (not an error)
  7. Transform raw config → LoadedScenario (camelCase fields, resolve file references)
     - Resolve all body_file / content_file references to string content
     - Read wiki markdown files into memory
  8. Return LoadedScenario
```
1. alarm.metric_id must match a metric id in ops_dashboard for alarm.service
2. alarm.service must match focal_service.name or a correlated_service.name in ops_dashboard
3. persona IDs referenced in chat messages, email from/to, and ticket createdBy must exist in personas[]
4. evaluation.relevant_actions[].action must be a valid ActionType (from shared/types/events.ts)
5. evaluation.relevant_actions[].remediation_action_id (if present) must exist in remediation_actions[]
6. correlated_services[].name must appear in topology.upstream or topology.downstream
7. metric archetype values must exist in getValidArchetypes() from metrics/archetypes.ts
8. ops_dashboard and ops_dashboard_file are mutually exclusive
9. No duplicate IDs within: alarms[], personas[], remediation_actions[], tickets[], wiki.pages[]
10. All file references resolve to existing readable files within the scenario directory
```

---

## 6. Logging

All log output uses structured logging with scenario ID and field paths.

```typescript
// Startup: scenario loaded successfully
logger.info({ scenarioId, metrics: metricCount }, 'Scenario loaded')

// Startup: scenario excluded due to errors
logger.error({ scenarioId, errors }, 'Scenario failed validation — excluded')

// Startup: unrecognized incident_type (warning, not error)
logger.warn({ scenarioId, incidentType }, 'incident_type not in registry — Tier 1 metrics will have no incident overlay')

// Startup: file reference could not be resolved
logger.error({ scenarioId, field, filePath }, 'File reference not found')
```

---

## 7. Test Strategy

All tests use `getFixtureScenarioDir()` and fixture constants from `testutil`. No tests depend on real LLM calls.

### `loader.test.ts`

```
loadScenario — happy paths:
  - fixture scenario loads without errors
  - returns LoadedScenario with correct id, title, personas, alarms
  - wiki page content is loaded into memory (not just a file path)
  - email body_file content is loaded into memory
  - ops_dashboard_file reference is resolved and merged correctly
  - LoadedScenario has no metrics field (metrics are session-scoped, generated at session start)

loadScenario — error paths:
  - missing scenario.yaml returns ScenarioLoadError
  - Zod schema failure returns ScenarioLoadError with field paths
  - cross-reference failure returns ScenarioLoadError with field paths
  - ops_dashboard + ops_dashboard_file both present returns error
  - path traversal in file reference returns error
  - missing referenced file returns error

loadAllScenarios:
  - skips _fixture directory
  - valid scenarios added to map
  - invalid scenario excluded, others still loaded
  - empty directory returns empty map (no throw)
  - returns only ScenarioSummary fields in toScenarioSummary output

isScenarioLoadError:
  - correctly identifies ScenarioLoadError vs LoadedScenario
```

### `validator.test.ts`

```
validateCrossReferences:
  - valid fixture config returns empty error array
  - alarm with bad metric_id returns error with correct field path
  - alarm with bad service returns error with correct field path
  - referenced persona ID missing returns error
  - invalid ActionType in relevant_actions returns error
  - correlated_service not in topology returns error
  - invalid archetype returns error
  - both ops_dashboard and ops_dashboard_file returns error
  - duplicate alarm IDs returns error
  - duplicate persona IDs returns error
  - all errors collected before returning (not fail-fast)
```

---

## 8. Definition of Done

- [ ] `loadAllScenarios` and `loadScenario` implemented
- [ ] `validator.ts` implements all 10 cross-reference rules
- [ ] File reference resolution rejects path traversal
- [ ] `ops_dashboard_file` merging implemented
- [ ] `incident_type` warning logged for unrecognized values
- [ ] Metric generation is NOT called at load time — deferred to session start in LLD 06
- [ ] `LoadedScenario` has no `metrics` field — confirmed consistent with Phase 1 type definition
- [ ] `toScenarioSummary` returns only picker-screen fields
- [ ] All tests in §7 pass
- [ ] Uses `testutil` helpers — no duplicated setup
- [ ] No `any` types
