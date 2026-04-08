# LLD 01 — Shared Types and Scenario Schema

**Phase:** 1
**Depends on:** Nothing
**HLD sections:** §8.2, §8.3, §8.4, §8.5, §8.6, §8.7, §9, §16

---

## Purpose

Define all shared TypeScript types and the Zod schema for scenario config validation. This is the foundation every other phase builds on. No executable logic lives here — only type definitions and schemas.

---

## Scope

- `shared/types/events.ts` — canonical SSE event types and all core data shapes
- `server/src/scenario/schema.ts` — Zod schema for `scenario.yaml`
- `server/src/scenario/types.ts` — typed output interfaces for parsed scenario config
- `server/src/types/events.ts` — re-export shim
- `client/src/types/events.ts` — re-export shim
- `scenarios/_fixture/` — minimal test scenario
- `server/src/testutil/` — reusable server test infrastructure
- `client/src/testutil/` — reusable client test infrastructure
- tsconfig path alias configuration

---

## 1. Shared Types (`shared/types/events.ts`)

All interfaces are exported. Server and client import via the `@shared` path alias.

### Core data shapes

```typescript
export interface TimeSeriesPoint {
  t: number  // sim seconds relative to t=0; negative = pre-incident
  v: number  // metric value
}

export interface AuditEntry {
  simTime: number                        // sim seconds from scenario start
  action: ActionType                     // discriminated action type
  params: Record<string, unknown>        // action-specific parameters
}

export interface ChatMessage {
  id: string
  channel: string                        // '#incidents' | 'dm:<persona-id>' | etc.
  persona: string                        // persona id or 'trainee'
  text: string
  simTime: number
}

export interface EmailMessage {
  id: string
  threadId: string
  from: string
  to: string
  subject: string
  body: string                           // markdown
  simTime: number
}

export interface Ticket {
  id: string
  title: string
  severity: TicketSeverity
  status: TicketStatus
  description: string                    // markdown
  createdBy: string                      // persona id or 'pagerduty-bot'
  simTime: number
}

export interface TicketComment {
  id: string
  ticketId: string
  author: string                         // persona id or 'trainee'
  body: string
  simTime: number
}

export interface LogEntry {
  id: string
  simTime: number
  level: LogLevel
  service: string
  message: string
}

export interface Alarm {
  id: string
  service: string
  metricId: string
  condition: string                      // human-readable, shown in UI
  value: number                          // current value that triggered
  severity: AlarmSeverity
  status: AlarmStatus
  simTime: number
}

export interface Deployment {
  version: string
  deployedAtSec: number                  // sim seconds; negative = pre-scenario
  status: DeploymentStatus
  commitMessage: string
  author: string
}
```

### Enumerations

```typescript
export type TicketSeverity = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4'
export type TicketStatus   = 'open' | 'in_progress' | 'resolved'
export type LogLevel       = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
export type AlarmSeverity  = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4'
export type AlarmStatus    = 'firing' | 'acknowledged' | 'suppressed'
export type DeploymentStatus = 'active' | 'previous' | 'rolled_back'
```

### Action types

```typescript
export type ActionType =
  // Incident management
  | 'ack_page'
  | 'escalate_page'
  | 'update_ticket'
  | 'add_ticket_comment'
  | 'mark_resolved'
  // Communication
  | 'post_chat_message'
  | 'reply_email'
  | 'direct_message_persona'
  // Investigation
  | 'open_tab'
  | 'search_logs'
  | 'view_metric'
  | 'read_wiki_page'
  | 'view_deployment_history'
  // Remediation
  | 'trigger_rollback'
  | 'trigger_roll_forward'
  | 'restart_service'
  | 'scale_cluster'
  | 'throttle_traffic'
  | 'suppress_alarm'
  | 'emergency_deploy'
  | 'toggle_feature_flag'
  // Monitoring
  | 'monitor_recovery'
```

### Session snapshot

```typescript
export interface SessionSnapshot {
  sessionId: string
  scenarioId: string
  simTime: number                                            // current sim seconds
  speed: 1 | 2 | 5 | 10
  paused: boolean
  emails: EmailMessage[]
  chatChannels: Record<string, ChatMessage[]>               // channel → messages
  tickets: Ticket[]
  ticketComments: Record<string, TicketComment[]>           // ticketId → comments
  logs: LogEntry[]
  metrics: Record<string, Record<string, TimeSeriesPoint[]>> // service → metricId → series
  alarms: Alarm[]
  deployments: Record<string, Deployment[]>                 // service → deployments
  auditLog: AuditEntry[]
  coachMessages: CoachMessage[]
}

export interface CoachMessage {
  id: string
  text: string
  simTime: number
  proactive: boolean  // true = coach initiated; false = response to trainee question
}
```

### SSE event discriminated union

```typescript
export type SimEvent =
  | { type: 'session_snapshot';  snapshot: SessionSnapshot }
  | { type: 'session_expired';   reason: string }
  | { type: 'sim_time';          simTime: number; speed: 1 | 2 | 5 | 10; paused: boolean }
  | { type: 'email_received';    email: EmailMessage }
  | { type: 'chat_message';      channel: string; message: ChatMessage }
  | { type: 'ticket_created';    ticket: Ticket }
  | { type: 'ticket_updated';    ticketId: string; changes: Partial<Ticket> }
  | { type: 'ticket_comment';    ticketId: string; comment: TicketComment }
  | { type: 'log_entry';         entry: LogEntry }
  | { type: 'metric_update';     service: string; metricId: string; point: TimeSeriesPoint }  // Phase 2
  | { type: 'alarm_fired';       alarm: Alarm }
  | { type: 'alarm_silenced';    alarmId: string }
  | { type: 'deployment_update'; service: string; deployment: Deployment }
  | { type: 'coach_message';     message: CoachMessage }
  | { type: 'debrief_ready';     sessionId: string }
  | { type: 'error';             code: string; message: string }
```

---

## 2. Scenario Config Schema (`server/src/scenario/schema.ts`)

Full Zod schema. Used at startup to validate every scenario. Validation errors are non-fatal — the scenario is excluded from the available list with a clear error log.

### Top-level structure

```typescript
const ScenarioSchema = z.object({
  id:           z.string().min(1),
  title:        z.string().min(1),
  description:  z.string(),
  service_type: z.enum(['api', 'workflow', 'serverless', 'database', 'console']),
  difficulty:   z.enum(['easy', 'medium', 'hard']),
  tags:         z.array(z.string()),

  timeline: z.object({
    default_speed:    z.union([z.literal(1), z.literal(2), z.literal(5), z.literal(10)]),
    duration_minutes: z.number().positive(),
  }),

  topology: z.object({
    focal_service: z.string(),
    upstream:      z.array(z.string()),
    downstream:    z.array(z.string()),
  }),

  engine: EngineSchema,
  email:   z.array(ScriptedEmailSchema),
  chat:    ChatSchema,
  ticketing: z.array(TicketSchema),
  ops_dashboard_file: z.string().optional(),  // reference to metrics.yaml
  ops_dashboard: OpsDashboardSchema.optional(),
  alarms:  z.array(AlarmConfigSchema),
  logs:    z.array(ScriptedLogSchema),
  wiki:    WikiSchema,
  cicd:    CICDSchema,
  personas: z.array(PersonaSchema),
  remediation_actions: z.array(RemediationActionSchema),
  evaluation: EvaluationSchema,
})
```

### Key sub-schemas

```typescript
const PersonaSchema = z.object({
  id:                    z.string(),
  display_name:          z.string(),
  avatar_color:          z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  initiates_contact:     z.boolean(),
  cooldown_seconds:      z.number().positive(),
  silent_until_contacted: z.boolean(),
  system_prompt:         z.string().min(1),
})

const AlarmConfigSchema = z.object({
  id:           z.string(),
  service:      z.string(),
  metric_id:    z.string(),
  condition:    z.string(),
  severity:     z.enum(['SEV1', 'SEV2', 'SEV3', 'SEV4']),
  onset_second: z.number(),
  auto_page:    z.boolean(),
  page_message: z.string().optional(),
})

const RemediationActionSchema = z.object({
  id:             z.string(),
  type:           z.enum(['rollback', 'roll_forward', 'restart_service', 'scale_cluster',
                          'throttle_traffic', 'emergency_deploy', 'toggle_feature_flag']),
  service:        z.string(),
  is_correct_fix: z.boolean(),
  side_effect:    z.string().optional(),
  // rollback/roll_forward only:
  target_version: z.string().optional(),
})

const EvaluationSchema = z.object({
  root_cause:   z.string(),
  relevant_actions: z.array(z.object({
    action: z.string(),   // ActionType value
    why:    z.string(),
    service: z.string().optional(),
  })),
  red_herrings: z.array(z.object({
    action: z.string(),
    why:    z.string(),
  })),
  debrief_context: z.string(),
})

const MetricConfigSchema = z.object({
  archetype:          z.string(),         // validated against archetype registry
  label:              z.string().optional(),
  unit:               z.string().optional(),
  baseline_value:     z.number().optional(),
  warning_threshold:  z.number().optional(),
  critical_threshold: z.number().optional(),
  noise:              z.enum(['low', 'medium', 'high', 'extreme']).optional(),
  incident_peak:      z.number().optional(),
  onset_second:       z.number().optional(),
  incident_response:  z.object({          // Tier 3
    overlay:              z.string(),
    onset_second:         z.number().optional(),
    peak_value:           z.number().optional(),
    drop_factor:          z.number().optional(),
    ramp_duration_seconds: z.number().optional(),
    saturation_duration_seconds: z.number().optional(),
  }).optional(),
  series_override: z.array(z.object({
    t: z.number(),
    v: z.number(),
  })).optional(),
})

const OpsDashboardSchema = z.object({
  pre_incident_seconds: z.number().positive(),
  resolution_seconds:   z.number().positive(),
  focal_service: z.object({
    name:           z.string(),
    scale: z.object({
      typical_rps:    z.number().positive(),
      instance_count: z.number().positive().optional(),
      max_connections: z.number().positive().optional(),
    }),
    traffic_profile: z.enum(['business_hours_web', 'business_hours_b2b',
                             'always_on_api', 'batch_nightly', 'batch_weekly', 'none']),
    health:         z.enum(['healthy', 'degraded', 'flaky']),
    incident_type:  z.string(),           // warning if not in registry, not error
    metrics:        z.array(MetricConfigSchema),
  }),
  correlated_services: z.array(z.object({
    name:          z.string(),
    correlation:   z.enum(['upstream_impact', 'exonerated', 'independent']),
    lag_seconds:   z.number().optional(),
    impact_factor: z.number().min(0).max(1).optional(),
    health:        z.enum(['healthy', 'degraded', 'flaky']),
    overrides:     z.array(MetricConfigSchema).optional(),
  })).optional(),
})
```

### Cross-reference validation

After schema parsing, a second validation pass performs cross-reference checks:
- All alarm `metric_id` values exist in `ops_dashboard` for the declared `service`
- All alarm `service` values exist in `ops_dashboard`
- All persona IDs referenced in chat/email/ticket configs exist in `personas`
- All remediation action IDs in `evaluation.relevant_actions` exist in `remediation_actions`
- All `correlated_services` names appear in `topology.upstream` or `topology.downstream`
- All metric `archetype` values exist in the archetype registry (hard error)
- `incident_type` on focal service: warn if not in incident type registry, do not error
- No duplicate IDs within: alarm IDs, persona IDs, metric IDs, event IDs, ticket IDs

Cross-reference errors are collected and reported together, not one at a time.

---

## 3. Path Alias Configuration

Both `server/tsconfig.json` and `client/tsconfig.json` define the `@shared` alias:

```json
{
  "compilerOptions": {
    "paths": {
      "@shared/*": ["../shared/*"]
    }
  }
}
```

`server/src/types/events.ts` and `client/src/types/events.ts` are thin re-export shims:

```typescript
export * from '@shared/types/events'
```

---

## 4. Test Fixture Scenario (`scenarios/_fixture/`)

A minimal but complete scenario used by all server tests. Must satisfy the full Zod schema. Contains:

- One persona
- One scripted email at `t=0`
- One scripted chat message at `t=0`
- One ticket
- One alarm (auto_page: true)
- One log entry at `t=0`
- One metric on the focal service (archetype: `error_rate`, Tier 2)
- One remediation action (`trigger_rollback`, `is_correct_fix: true`)
- One wiki page
- One CI/CD pipeline with two deployments
- Mock LLM responses for: `tick_1`, `after_action:trigger_rollback:fixture-service`, `proactive_tick_1`, `on_demand`

The fixture scenario must remain minimal — add only what is needed to exercise a new code path, not a realistic scenario.

---

## 5. Mock LLM Response Schema (`mock-llm-responses.yaml`)

```typescript
interface MockLLMResponses {
  stakeholder_responses: MockStakeholderResponse[]
  coach_responses: MockCoachResponse[]
  debrief_response: { narrative: string }
}

interface MockStakeholderResponse {
  trigger: string   // 'tick_N' | 'after_action:<type>:<param>'
  tool_calls: Array<{
    tool: string
    params: Record<string, unknown>
  }>
}

interface MockCoachResponse {
  trigger: string   // 'proactive_tick_N' | 'on_demand'
  message: string
}
```

---

## 6. Test Strategy

### What to test in this phase

**Schema validation (`schema.ts`):**
- Valid fixture scenario parses without errors
- Missing required fields produce field-path errors
- Invalid enum values produce clear errors
- Cross-reference violations (bad persona ID, bad alarm metric_id, etc.) produce clear errors
- `incident_type` not in registry: produces warning, not error
- Unrecognized metric archetype: produces error
- Duplicate IDs: produces error
- `ops_dashboard_file` and inline `ops_dashboard` are mutually exclusive

**Shared types:**
- No runtime tests — types are compile-time only
- Ensure `strict: true` TypeScript compiles clean with no errors
- Ensure both server and client can import from `@shared/types/events`

**Fixture scenario:**
- Loads without validation errors
- Contains all required sections

### Test files

```
server/__tests__/scenario/schema.test.ts
```

---

## 7. Scenario Config Types (`server/src/scenario/types.ts`)

The Zod schema parse produces typed output. These interfaces represent a fully parsed, validated scenario config as used by the rest of the server. They are distinct from the raw YAML shape.

```typescript
// Top-level loaded scenario — used everywhere in the server
export interface LoadedScenario {
  id:           string
  title:        string
  description:  string
  serviceType:  ServiceType
  difficulty:   Difficulty
  tags:         string[]
  timeline:     TimelineConfig
  topology:     TopologyConfig
  engine:       EngineConfig
  emails:       ScriptedEmail[]
  chat:         ChatConfig
  tickets:      ScriptedTicket[]
  opsDashboard: OpsDashboardConfig
  alarms:       AlarmConfig[]
  logs:         ScriptedLogEntry[]
  wiki:         WikiConfig
  cicd:         CICDConfig
  personas:     PersonaConfig[]
  remediationActions: RemediationActionConfig[]
  evaluation:   EvaluationConfig
}

export type ServiceType = 'api' | 'workflow' | 'serverless' | 'database' | 'console'
export type Difficulty  = 'easy' | 'medium' | 'hard'
export type NoiseLevel  = 'low' | 'medium' | 'high' | 'extreme'
export type HealthLevel = 'healthy' | 'degraded' | 'flaky'
export type CorrelationType = 'upstream_impact' | 'exonerated' | 'independent'
export type TrafficProfile = 'business_hours_web' | 'business_hours_b2b' | 'always_on_api'
                           | 'batch_nightly' | 'batch_weekly' | 'none'
export type RemediationActionType = 'rollback' | 'roll_forward' | 'restart_service'
                                  | 'scale_cluster' | 'throttle_traffic'
                                  | 'emergency_deploy' | 'toggle_feature_flag'

export interface PersonaConfig {
  id:                   string
  displayName:          string
  avatarColor?:         string
  initiatesContact:     boolean
  cooldownSeconds:      number
  silentUntilContacted: boolean
  systemPrompt:         string
}

export interface AlarmConfig {
  id:           string
  service:      string
  metricId:     string
  condition:    string
  severity:     AlarmSeverity
  onsetSecond:  number
  autoPage:     boolean
  pageMessage?: string
}

export interface RemediationActionConfig {
  id:             string
  type:           RemediationActionType
  service:        string
  isCorrectFix:   boolean
  sideEffect?:    string
  targetVersion?: string   // rollback / roll_forward only
}

export interface MetricConfig {
  archetype:           string
  label?:              string
  unit?:               string
  baselineValue?:      number
  warningThreshold?:   number
  criticalThreshold?:  number
  noise?:              NoiseLevel
  incidentPeak?:       number
  onsetSecond?:        number
  incidentResponse?: {   // Tier 3
    overlay:                     string
    onsetSecond?:                number
    peakValue?:                  number
    dropFactor?:                 number
    rampDurationSeconds?:        number
    saturationDurationSeconds?:  number
  }
  seriesOverride?: Array<{ t: number; v: number }>
}

export interface FocalServiceConfig {
  name:           string
  scale:          ServiceScale
  trafficProfile: TrafficProfile
  health:         HealthLevel
  incidentType:   string
  metrics:        MetricConfig[]
}

export interface CorrelatedServiceConfig {
  name:          string
  correlation:   CorrelationType
  lagSeconds?:   number
  impactFactor?: number
  health:        HealthLevel
  overrides?:    MetricConfig[]
}

export interface ServiceScale {
  typicalRps:     number
  instanceCount?: number
  maxConnections?: number
}

export interface OpsDashboardConfig {
  preIncidentSeconds: number
  resolutionSeconds:  number
  focalService:       FocalServiceConfig
  correlatedServices: CorrelatedServiceConfig[]
}

export interface EvaluationConfig {
  rootCause:        string
  relevantActions:  Array<{ action: string; why: string; service?: string }>
  redHerrings:      Array<{ action: string; why: string }>
  debriefContext:   string
}

export interface EngineConfig {
  tickIntervalSeconds: number
  llmEventTools:       LLMEventToolConfig[]
}

export interface LLMEventToolConfig {
  tool:             string
  enabled?:         boolean
  maxCalls?:        number
  requiresAction?:  string
  services?:        string[]
}

export interface TimelineConfig {
  defaultSpeed:    1 | 2 | 5 | 10
  durationMinutes: number
}

export interface TopologyConfig {
  focalService: string
  upstream:     string[]
  downstream:   string[]
}
```

---

## 8. Reusable Test Infrastructure

All server tests share a common test infrastructure package at `server/src/testutil/`. It is the **only** place test helpers are defined. Never duplicate test helpers across test files. The same principle applies to `client/src/testutil/`.

### `server/src/testutil/index.ts` — public API

```typescript
// ── Fixture scenario ──────────────────────────────────────────────────

// Returns the parsed, validated fixture scenario. Cached after first load.
export function getFixtureScenario(): LoadedScenario

// Returns the path to the fixture scenario directory.
export function getFixtureScenarioDir(): string

// ── Session builder ───────────────────────────────────────────────────

// Builds a minimal in-memory Session for unit tests.
// Uses the fixture scenario by default.
// Session type is defined in LLD 06 (session/session.ts) — this function
// returns a partial session adequate for unit tests that don't need a full
// running game loop.
export function buildTestSession(overrides?: Partial<Session>): Session

// ── Sim clock ─────────────────────────────────────────────────────────

// Returns a controllable sim clock for testing time-dependent behavior.
// Implements the SimClock interface (defined in LLD 04) so it can be
// injected directly into game engine components.
export function buildTestClock(initialSimTime?: number): TestSimClock

export interface TestSimClock {
  advance(simSeconds: number): void
  getSimTime(): number
}

// ── Audit log ─────────────────────────────────────────────────────────

// Builds a pre-populated AuditEntry[] for tests that need prior action history.
// AuditEntry is defined in shared/types/events.ts.
export function buildAuditLog(entries: Partial<AuditEntry>[]): AuditEntry[]

// ── Assertion helpers ─────────────────────────────────────────────────

// Asserts that a SimEvent array contains an event of the given type.
// Returns the matched event for further assertions.
export function expectEvent<T extends SimEvent['type']>(
  events: SimEvent[],
  type: T
): Extract<SimEvent, { type: T }>

// Asserts that no event of the given type exists in the array.
export function expectNoEvent(events: SimEvent[], type: SimEvent['type']): void

// Asserts that an AuditEntry[] contains a specific action type.
// Returns the first matching entry.
export function expectAction(log: AuditEntry[], action: ActionType): AuditEntry

// ── Metric series helpers ─────────────────────────────────────────────

// Builds a flat time series for tests that need metric data without
// running the full generator.
export function buildFlatSeries(
  value: number,
  fromSecond: number,
  toSecond: number,
  resolutionSeconds: number
): TimeSeriesPoint[]

// ── Mock LLM (forward reference — fulfilled by LLD 05) ───────────────

// MockLLMProvider and MockLLMResponses are defined in LLD 05 (llm/mock-provider.ts).
// These functions are declared here so all phases can import them from testutil
// without creating circular dependencies. Their implementations delegate to
// the mock provider module once it exists.

// Returns a MockLLMProvider loaded from the fixture scenario's mock responses.
// All tests that touch LLM code paths use this.
export function getMockLLMProvider(): MockLLMProvider

// Returns a MockLLMProvider with custom inline responses for a single test.
export function buildMockLLMProvider(responses: MockLLMResponses): MockLLMProvider

// These types are re-exported from llm/mock-provider.ts once LLD 05 is complete.
// Declared as opaque until then so LLDs 02–04 can reference them in signatures.
export type MockLLMProvider = import('../llm/mock-provider').MockLLMProvider
export type MockLLMResponses = import('../llm/mock-provider').MockLLMResponses
```

### `server/src/testutil/fixtures.ts`

Typed fixture constants used by multiple tests. Avoids file I/O in unit tests.

```typescript
export const FIXTURE_SCENARIO_ID = '_fixture'
export const FIXTURE_SESSION_ID  = 'test-session-id'

export const FIXTURE_PERSONA: PersonaConfig = {
  id:                   'fixture-persona',
  displayName:          'Test Persona',
  initiatesContact:     true,
  cooldownSeconds:      60,
  silentUntilContacted: false,
  systemPrompt:         'You are a test persona.',
}

export const FIXTURE_ALARM: AlarmConfig = {
  id:          'fixture-alarm',
  service:     'fixture-service',
  metricId:    'error_rate',
  condition:   'error_rate > 5%',
  severity:    'SEV2',
  onsetSecond: 0,
  autoPage:    true,
  pageMessage: 'fixture-service error rate elevated',
}

export const FIXTURE_REMEDIATION_ACTION: RemediationActionConfig = {
  id:            'rollback_fixture_service',
  type:          'rollback',
  service:       'fixture-service',
  isCorrectFix:  true,
  targetVersion: 'v1.0.0',
}
```

### `client/src/testutil/index.ts` — public API

```typescript
// ── SSE simulation ────────────────────────────────────────────────────

// Creates a mock SSE connection that lets tests push SimEvents directly
// into the client's useSSE hook without a running server.
export function buildMockSSE(): MockSSEConnection

export interface MockSSEConnection {
  emit(event: SimEvent): void
  disconnect(): void
  reconnect(): void
}

// ── Context providers ─────────────────────────────────────────────────

// Wraps a component with all required React contexts pre-populated.
// Always use this instead of manually wrapping with individual providers.
export function renderWithProviders(
  ui: React.ReactElement,
  options?: {
    snapshot?: Partial<SessionSnapshot>
    sessionId?: string
  }
): ReturnType<typeof import('@testing-library/react').render>

// ── Snapshot builder ──────────────────────────────────────────────────

// Builds a minimal valid SessionSnapshot for client tests.
export function buildTestSnapshot(overrides?: Partial<SessionSnapshot>): SessionSnapshot
```

### Rules for test infrastructure usage

1. **All test helpers live in `testutil/`** — never define a helper in a test file if it could be shared
2. **`buildTestSession` is for unit tests only** — integration tests start real sessions via the API
3. **`getMockLLMProvider` / `buildMockLLMProvider` are the only ways to get a mock LLM** — never instantiate `MockLLMProvider` directly
4. **`renderWithProviders` is the only way to render components in client tests** — never manually wrap with individual context providers
5. **`testutil/` itself has tests** — `server/src/testutil/testutil.test.ts` and `client/src/testutil/testutil.test.ts` must pass

---

## 9. Definition of Done

- [ ] `shared/types/events.ts` compiles clean under `strict: true`
- [ ] `server/src/types/events.ts` and `client/src/types/events.ts` re-export correctly
- [ ] `@shared` path alias resolves in both server and client `tsconfig.json`
- [ ] Full Zod schema written and exported from `server/src/scenario/schema.ts`
- [ ] Cross-reference validation implemented as a second pass after Zod parse
- [ ] `scenarios/_fixture/` scenario validates without errors
- [ ] `scenarios/_fixture/mock-llm-responses.yaml` covers required triggers
- [ ] `server/src/testutil/` implemented with all helpers defined in §8
- [ ] `client/src/testutil/` implemented with all helpers defined in §8
- [ ] `server/src/testutil/testutil.test.ts` passes
- [ ] `client/src/testutil/testutil.test.ts` passes
- [ ] All schema tests pass
- [ ] No `any` types
