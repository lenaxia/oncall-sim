# On-Call Training Simulator — LLM Implementation Guide

**Version:** 1.2
**Last Updated:** 2026-04-09
**Project Status:** Phases 1–8 Complete, Phase 9 (debrief narrative) stub only

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Critical Guidelines & Hard Rules](#critical-guidelines--hard-rules)
3. [Repository Structure](#repository-structure)
4. [Architecture Overview](#architecture-overview)
5. [Technology Stack](#technology-stack)
6. [Development Order](#development-order)
7. [Common Commands](#common-commands)
8. [Branch Management](#branch-management)
9. [Documentation Standards](#documentation-standards)
10. [Testing Requirements](#testing-requirements)

---

## Project Overview

A browser-based on-call incident simulation platform for training software engineers on AWS services. The trainee works inside a realistic single-tab incident environment — email, chat, ticketing, dashboards, logs, runbooks, and CI/CD — and must diagnose and resolve a high-severity event driven by LLM-powered stakeholders.

**Core Principles:**

- Scenarios are fully config-driven — new scenarios require only YAML and Markdown files, zero code changes
- LLMs drive stakeholder communication and dynamic sim events; the server controls all mechanics
- Track trainee actions honestly without gamification
- Mock mode required from day one — all tests run without a live LLM API key
- Architecture supports future persistence, multi-user, and reactive metrics without redesign

**Primary Source Documents:**

- [`docs/design/hld.md`](docs/design/hld.md) — ⭐ AUTHORITATIVE specification
- [`docs/design/lld/`](docs/design/lld/) — Low-level designs (one per phase)
- [`docs/backlog/`](docs/backlog/) — Epics and user stories
- [`docs/worklog/`](docs/worklog/) — Session progress entries

---

## Critical Guidelines & Hard Rules

### 0. Test-Driven Development (TDD)

**MANDATORY:** Write tests BEFORE writing functional code. Always.

```
Correct workflow:
1. Write the test
2. Run the test — it must fail
3. Write minimal code to make it pass
4. Run the test — it must pass
5. Refactor if needed
```

**Test requirements:**

- Multiple happy path tests
- Multiple unhappy path tests
- Edge case coverage
- All tests must pass before marking work complete

### 1. TypeScript Strictness

**ALWAYS DO:**

- Enable `strict: true` in all `tsconfig.json` files
- Define explicit interfaces and types for ALL data structures
- Use discriminated unions for event types and state variants
- Prefer `unknown` over `any` — narrow types explicitly

**NEVER DO:**

- Never use `any` unless interfacing with a library that forces it (document why)
- Never use type assertions (`as Foo`) without a guard or comment explaining the invariant
- Never leave implicit `any` from untyped function parameters
- Never use `object` or `{}` as a type — define the shape

### 2. Type Safety for Shared Contracts

The `shared/types/events.ts` file is the single source of truth for all SSE event shapes and core data interfaces. Both server and client import from it via tsconfig path aliases.

**Rules:**

- Never duplicate a type definition in server or client — always import from `shared/`
- When adding a new SSE event type, update `SimEvent` discriminated union in `shared/types/events.ts` first, then implement
- Zod schemas in `server/src/scenario/schema.ts` must stay in sync with `shared/types/events.ts` data shapes

### 3. Explicit Over Implicit

- No magic behavior — if a function has a side effect, name it clearly
- No hidden defaults — if a config field has a default, declare it explicitly in the resolver
- Error messages must be actionable — tell the author/developer what to fix, not just that something is wrong

### 4. Mock Mode is Not Optional

`MOCK_LLM=true` must work from day one of any LLM-touching code. Tests never make real LLM API calls.

- Every new LLM call path must have a corresponding mock fixture entry
- Mock responses must be deterministic — no randomness in mock mode
- If a feature cannot be tested in mock mode, it is not done

### 5. Scenario Config is the User Interface

Scenario authors are experienced SREs, not developers. The config must be:

- Authoring errors caught at startup with clear messages (scenario ID, field path, fix instruction)
- No runtime surprises from misconfigured scenarios
- New `incident_type` values that aren't in the registry log a warning, not an error

### 6. The Game Loop Must Never Crash

LLM failures, malformed tool call responses, and invalid scenario data must never crash the game loop or corrupt session state. All error paths must be logged and handled gracefully.

### 7. Communication Tone

**MANDATORY:**

- Be neutral, factual, and objective
- Never agree with something just because the user stated it
- Validate before claiming — if uncertain, say so and ask
- Provide honest feedback — a critical collaborator, not a cheerleader

### 8. Code Quality

- No comments unless they explain WHY, not WHAT
- Code is self-documenting through clear naming
- If a comment is wrong or outdated, fix or remove it — do not leave it
- No TODO comments in committed code — open a backlog story instead

### 9. Zero Technical Debt Tolerance

- No adapters for backwards compatibility
- Always implement the full final design
- No hacks to make tests pass — fix the code or the test properly
- No dead code — if it is not used, remove it

### 10. Uncertainty Protocol

**If uncertain about correct behavior: ASK THE USER.**

Do not guess, assume, or implement workarounds. A wrong implementation is worse than a paused one.

### 11. Understand the Architecture Before Touching Code

Before writing any code, read:

- [`docs/design/hld.md`](docs/design/hld.md) — the full system design
- The relevant LLD in [`docs/design/lld/`](docs/design/lld/)

Understand how your change fits into the whole. Changes that seem local often have cross-cutting implications (e.g. adding a field to a shared type, adding a new SSE event, changing a session lifecycle step).

### 12. Status Documentation

When completing a story or phase:

- Run all tests
- Document test pass rate
- Document known issues
- Document confidence level

**Status levels:**

- ✅ Complete — all tests pass, ready for next phase
- ⚠️ Complete with issues — tests mostly pass, known issues documented
- ⚠️ Broken — tests failing, functionality broken
- ❌ Not Started

---

## Repository Structure

```
oncall-sim/
├── README.md                          # User-facing README
├── README-LLM.md                      # This file
├── package.json                       # Root workspace (npm workspaces)
├── .env.example                       # Environment variable reference
│
├── docs/
│   ├── design/
│   │   ├── hld.md                     # ⭐ AUTHORITATIVE high-level design
│   │   └── lld/                       # Low-level designs (one per phase)
│   │       ├── 01-shared-types.md
│   │       ├── 02-metric-generator.md
│   │       ├── 03-scenario-loader.md
│   │       ├── 04-game-engine.md
│   │       ├── 05-llm-client.md
│   │       ├── 06-api.md
│   │       ├── 07-ui-components.md
│   │       ├── 08-sim-tabs.md
│   │       └── 09-coach-debrief.md
│   ├── backlog/                       # Epics and user stories
│   │   ├── README.md
│   │   ├── 01-shared-types/
│   │   ├── 02-metric-generator/
│   │   ├── 03-scenario-loader/
│   │   ├── 04-game-engine/
│   │   ├── 05-llm-client/
│   │   ├── 06-api/
│   │   ├── 07-ui-components/
│   │   ├── 08-sim-tabs/
│   │   └── 09-coach-debrief/
│   └── worklog/                       # Session progress (0000-NNNN)
│       └── README.md
│
├── shared/
│   └── types/
│       └── events.ts                  # Canonical SSE event + data types
│
├── scenarios/
│   ├── _fixture/                      # Minimal scenario for all tests
│   │   ├── scenario.yaml
│   │   └── mock-llm-responses.yaml
│   └── api-error-rate-spike/          # Launch scenario
│       ├── scenario.yaml
│       ├── email/
│       ├── tickets/
│       ├── wiki/
│       └── mock-llm-responses.yaml
│
├── server/
│   ├── src/
│   │   ├── index.ts                   # Express app entry point
│   │   ├── config.ts                  # Env var loading + validation
│   │   ├── routes/
│   │   │   ├── scenarios.ts
│   │   │   ├── sessions.ts
│   │   │   ├── actions.ts
│   │   │   └── llm.ts
│   │   ├── engine/
│   │   │   ├── game-loop.ts
│   │   │   ├── event-scheduler.ts
│   │   │   ├── stakeholder-engine.ts
│   │   │   ├── audit-log.ts
│   │   │   ├── conversation-store.ts
│   │   │   ├── sim-clock.ts
│   │   │   └── evaluator.ts
│   │   ├── metrics/
│   │   │   ├── generator.ts
│   │   │   ├── resolver.ts
│   │   │   ├── incident-types.ts
│   │   │   ├── archetypes.ts
│   │   │   ├── correlation.ts
│   │   │   └── patterns/
│   │   │       ├── baseline.ts
│   │   │       ├── rhythm.ts
│   │   │       ├── noise.ts
│   │   │       └── incident-overlay.ts
│   │   ├── llm/
│   │   │   ├── llm-client.ts
│   │   │   ├── openai-provider.ts
│   │   │   ├── bedrock-provider.ts
│   │   │   ├── mock-provider.ts
│   │   │   └── tool-definitions.ts
│   │   ├── scenario/
│   │   │   ├── loader.ts
│   │   │   └── schema.ts
│   │   ├── session/
│   │   │   ├── session-store.ts
│   │   │   └── session.ts
│   │   ├── sse/
│   │   │   └── sse-broker.ts
│   │   └── types/
│   │       └── events.ts              # Re-exports from shared/ via path alias
│   ├── __tests__/
│   │   ├── engine/
│   │   ├── metrics/
│   │   │   └── patterns/
│   │   └── routes/
│   ├── package.json
│   └── tsconfig.json
│
└── client/
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx
    │   ├── context/
    │   │   ├── ScenarioContext.tsx
    │   │   ├── SessionContext.tsx
    │   │   └── AuditContext.tsx
    │   ├── hooks/
    │   │   ├── useSSE.ts
    │   │   └── useSimClock.ts
    │   ├── components/
    │   │   ├── TabBar.tsx
    │   │   ├── SpeedControl.tsx
    │   │   ├── CoachPanel.tsx
    │   │   ├── ScenarioPicker.tsx
    │   │   ├── DebriefScreen.tsx
    │   │   └── tabs/
    │   │       ├── EmailTab.tsx
    │   │       ├── ChatTab.tsx
    │   │       ├── TicketingTab.tsx
    │   │       ├── OpsDashboardTab.tsx
    │   │       ├── LogsTab.tsx
    │   │       ├── WikiTab.tsx
    │   │       └── CICDTab.tsx
    │   └── types/
    │       └── events.ts              # Re-exports from shared/ via path alias
    ├── __tests__/
    │   ├── tabs/
    │   └── components/
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    └── vite.config.ts
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser                                                            │
│                                                                     │
│  ┌─────────────────────────────────────┐   ┌─────────────────────┐ │
│  │  Sim Shell                          │   │  Coach Panel        │ │
│  │  [ Email ][ Chat ][ Tickets ]       │   │  (slide-out)        │ │
│  │  [ Ops   ][ Logs ][ Wiki   ][ CICD ]│   │  Proactive nudges   │ │
│  │  Speed: [1x][2x][5x][10x]  [Pause] │   │  + on-demand help   │ │
│  └─────────────────────────────────────┘   └─────────────────────┘ │
│                        │  SSE + REST                               │
└────────────────────────┼────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────────┐
│  Node.js / Express Server                                           │
│                                                                     │
│  REST API          SSE Stream         Game Engine                   │
│  /scenarios        /events            game-loop                     │
│  /sessions         (per session)      event-scheduler               │
│  /actions                             stakeholder-engine            │
│                                       audit-log + evaluator         │
│                                                                     │
│  LLM Client (OpenAI-compat | Bedrock | Mock)                        │
│  Metrics Generator (baseline + rhythm + noise + overlay)            │
│  Scenario Loader + Zod Validator                                     │
└─────────────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────────┐
│  File System                                                        │
│  scenarios/<id>/scenario.yaml                                       │
│  scenarios/<id>/mock-llm-responses.yaml                             │
│  scenarios/<id>/email/ tickets/ wiki/                               │
└─────────────────────────────────────────────────────────────────────┘
```

**Key data flows:**

1. Scenario loaded + validated at session start → metrics generated → stored in session
2. Game loop ticks → event-scheduler fires scripted events → stakeholder-engine calls LLM → tool calls executed → SSE broadcast to client
3. Trainee action → audit-log → stakeholder-engine triggered immediately → SSE broadcast
4. Mark resolved → game loop stops → debrief LLM called → `debrief_ready` SSE → client polls debrief endpoint

**Responsibility boundaries:**

- LLM controls communication and dynamic events (via tool calls, server-validated)
- Server controls mechanics (session state, metric generation, action execution)
- Trainee controls remediation (rollback, restart, scale, etc.)

---

## Technology Stack

### Server

- **Runtime:** Node.js 20+
- **Framework:** Express + TypeScript (`strict: true`)
- **Schema validation:** Zod (scenario config validation at startup)
- **YAML parsing:** js-yaml
- **LLM providers:** OpenAI-compatible API, AWS Bedrock SDK
- **Transport:** Server-Sent Events (SSE) for real-time delivery
- **Testing:** Vitest

### Client

- **Framework:** React 18 + TypeScript (`strict: true`)
- **Styling:** Tailwind CSS
- **Charts:** Recharts (time-series metric graphs)
- **Build:** Vite
- **Testing:** Vitest + React Testing Library

### Shared

- **Types:** `shared/types/events.ts` — imported by both server and client via tsconfig path aliases (`@shared/types/events`)
- **No runtime shared code** — shared directory contains types only, no executable modules

### Environment

- **Package manager:** npm workspaces (root + server + client)
- **Node version:** 20 LTS

---

## Development Order

Phases must be completed in order. Each phase has an LLD in `docs/design/lld/` and a backlog folder in `docs/backlog/`.

| Phase | Name                                | Depends on                   | LLD                      |
| ----- | ----------------------------------- | ---------------------------- | ------------------------ |
| 1     | Shared types + scenario schema      | Nothing                      | `01-shared-types.md`     |
| 2     | Metric generator                    | Phase 1                      | `02-metric-generator.md` |
| 3     | Scenario loader + validation        | Phases 1, 2                  | `03-scenario-loader.md`  |
| 4     | Core game engine                    | Phase 3                      | `04-game-engine.md`      |
| 5     | LLM client + stakeholder engine     | Phase 4                      | `05-llm-client.md`       |
| 6     | Session management + REST API + SSE | Phases 3, 4, 5               | `06-api.md`              |
| 7     | UI component library                | Phase 1                      | `07-ui-components.md`    |
| 8     | Sim shell + all tabs                | Phases 6, 7                  | `08-sim-tabs.md`         |
| 9     | Coach + debrief                     | Phases 5, 6, 8               | `09-coach-debrief.md`    |
| 10    | Reactive metrics                    | Phases 1–6 (all implemented) | `10-reactive-metrics.md` |

Phase 7 can run in parallel with Phases 4–6.

**Before starting any phase:**

1. Read the HLD sections relevant to that phase
2. Read the phase LLD
3. Read the backlog stories for that phase
4. Ensure all previous phases are ✅ Complete

---

## Common Commands

### Setup

```bash
# Install all dependencies (root + server + client)
npm install

# Copy env template
cp .env.example .env
```

### Development

```bash
# Run server in dev mode (watch)
npm run dev --workspace=server

# Run client in dev mode (Vite HMR)
npm run dev --workspace=client

# Run both concurrently
npm run dev
```

### Testing

```bash
# Run all tests (server + client)
npm test

# Run server tests only
npm test --workspace=server

# Run client tests only
npm test --workspace=client

# Run with coverage
npm run test:coverage --workspace=server
npm run test:coverage --workspace=client

# Run a specific test file
npx vitest run server/src/__tests__/engine/game-loop.test.ts

# Run in watch mode
npx vitest --workspace=server
```

**ALWAYS run tests with mock LLM:**

```bash
MOCK_LLM=true npm test --workspace=server
```

### Code Quality

```bash
# Type check (no emit)
npm run typecheck --workspace=server
npm run typecheck --workspace=client

# Lint
npm run lint --workspace=server
npm run lint --workspace=client

# Format
npm run format
```

### Build

```bash
# Build server
npm run build --workspace=server

# Build client
npm run build --workspace=client
```

---

## Branch Management

**Active Branches:**

| Branch | Purpose     | Status | Created    |
| ------ | ----------- | ------ | ---------- |
| `main` | Stable code | Active | 2026-04-07 |

**Merged Branches:**

| Branch       | Purpose | Merged | Commit |
| ------------ | ------- | ------ | ------ |
| _(none yet)_ | —       | —      | —      |

**Branch naming:**

- Feature: `feature/phase-N-description`
- Bugfix: `bugfix/description`
- Docs: `docs/description`

**Workflow:**

1. Create branch from `main`
2. Add to table above
3. Work in branch with regular commits
4. All tests passing before merge
5. Merge to `main`, update table

---

## Documentation Standards

### Design Documents

**Location:** `docs/design/`

- `hld.md` — ⭐ authoritative, do not modify without explicit user instruction
- `lld/` — one file per development phase, named `NN-phase-name.md`

**LLD format:**

- Purpose and scope
- Module interfaces (TypeScript signatures)
- Key algorithms or data flows
- Error handling decisions
- Test strategy for this phase

### Worklog Documents

**Location:** `docs/worklog/`

**Naming:** `NNNN_YYYY-MM-DD_description.md` (continuous numbering from 0000)

**When to create:**

- After completing a phase or significant story
- Before ending a session with unfinished work
- When documenting a blocker or architectural decision

**Contents:**

- What was done
- Test pass rate
- Known issues
- What comes next

**Next entry:** `0000_YYYY-MM-DD_description.md`

### Backlog Stories

**Location:** `docs/backlog/`

One folder per development phase, matching the phase numbering.

**Story format:**

```markdown
# Story: [title]

## As a [role], I want [goal] so that [benefit]

### Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

### Tasks

- [ ] Task 1
- [ ] Task 2

### Status

- Status: Not Started | In Progress | Complete
- Started: YYYY-MM-DD
- Completed: YYYY-MM-DD
```

### README Files

Every major folder must have a `README.md` that explains:

- What the folder contains
- Rules for reading/editing files in it
- Key files and their purpose

---

## Testing Requirements

### TDD Workflow

1. Write the test first
2. Run it — must fail
3. Write minimal code to pass
4. Run it — must pass
5. Refactor

### Test Structure

Tests live in `__tests__/` adjacent to source, mirroring the source tree.

```
server/src/engine/game-loop.ts
server/__tests__/engine/game-loop.test.ts

client/src/components/SpeedControl.tsx
client/__tests__/components/SpeedControl.test.tsx
```

### Test Coverage Requirements

Every module must have:

- Happy path tests (valid inputs, expected outputs)
- Unhappy path tests (invalid inputs, error conditions)
- Edge cases specific to the module's domain

**Metric generator specific:** noise tests must verify statistical properties within tolerance (mean, std dev) over a sufficient sample, not exact values.

**Game engine specific:** all tests use `MOCK_LLM=true` and the `_fixture` scenario.

**SSE/reconnection specific:** test that `session_snapshot` is the first event on reconnect and that state is correctly restored.

### Mock LLM

All server tests that touch the LLM must run with `MOCK_LLM=true`. The mock provider reads from `scenarios/_fixture/mock-llm-responses.yaml`.

Mock response triggers:

- `tick_N` — fires on the Nth stakeholder engine tick
- `after_action:<action_type>:<optional_param>` — fires after a specific trainee action
- `proactive_tick_N` — fires on the Nth coach tick
- `on_demand` — fires when trainee sends a message to the coach

If no matching trigger exists, the mock returns an empty response. This is valid.

### Running Tests Before Marking Complete

```bash
# Must all pass before ✅
MOCK_LLM=true npm test
npm run typecheck --workspace=server
npm run typecheck --workspace=client
npm run lint
```

---

## Quick Reference

### Before Starting a Phase

- [ ] HLD sections relevant to this phase reviewed?
- [ ] LLD for this phase read and understood?
- [ ] Backlog stories for this phase reviewed?
- [ ] All previous phases ✅ Complete?

### During Implementation

- [ ] Tests written before code?
- [ ] `strict: true` TypeScript — no `any`?
- [ ] Shared types imported from `@shared/types/events`, not duplicated?
- [ ] All LLM paths work with `MOCK_LLM=true`?
- [ ] Error messages actionable (not just "invalid config")?
- [ ] Game loop error paths logged and swallowed, not thrown?

### Before Marking Complete

- [ ] All tests passing with `MOCK_LLM=true`?
- [ ] Type check clean (`npm run typecheck`)?
- [ ] Lint clean?
- [ ] Backlog story checklists updated?
- [ ] Worklog entry created?
- [ ] README.md updated in affected folders?

### Common Questions

**Q: Should I use `any` here?**
A: No. Define the type. If it's truly dynamic, use `unknown` and narrow it.

**Q: Can I make a real LLM call in a test?**
A: No. Set `MOCK_LLM=true` and add a fixture entry.

**Q: The game loop is crashing on a bad LLM response — should I let it throw?**
A: No. Log the error, skip the tool call, keep the loop running.

**Q: I need to add a new SSE event type — where do I start?**
A: Update `shared/types/events.ts` first. Then implement server emission, then client handling.

**Q: Should I add a comment explaining this code?**
A: Only if it explains WHY, not WHAT. If the code is clear, skip the comment.

**Q: I found a bug in a previous phase while working on the current one.**
A: Fix it. Do not work around it. Update the relevant test if needed.

**Q: A scenario config is malformed — should the server crash?**
A: No. Log the error with scenario ID and field path, exclude that scenario from the list, continue loading other scenarios.

---

## Scenario Log Authoring

Three complementary mechanisms fill the Logs tab. They are merged and sorted by `atSecond` at load time; the event-scheduler and game loop are unaffected.

### 1. `logs` — scripted entries (precision signals)

Use for the specific lines that carry diagnostic information the trainee must find.

```yaml
logs:
  - id: log-001
    at_second: 5
    level: WARN
    service: payment-service
    message: "HikariPool-1 - Pool stats (total=5, active=5, idle=0, waiting=47)"
```

`logs` is optional (defaults to `[]`). All three mechanisms can be combined freely.

### 2. `log_patterns` — repeated message templates (incident noise)

Use for messages that repeat throughout the incident window — connection timeouts, retry attempts, HTTP 500s, pool stats. The loader generates one entry per `interval_seconds` step across `[from_second, to_second]`.

**`{n}` substitution** replaces `{n}` in the message with the 1-based occurrence count — useful for `waiting={n}` pool stats, `attempt {n} failed`, etc.

**`jitter_seconds`** perturbs each entry's timestamp by ±`jitter_seconds` using a live RNG (different every session). Omit it for exact-interval placement.

**`seed`** fixes the RNG for that pattern. Use only when debugging a specific timestamp layout — omit in real scenarios so the stream varies per session.

```yaml
log_patterns:
  - id: pool-timeout
    level: ERROR
    service: payment-service
    message: "HikariCP - Connection is not available, request timed out after 30000ms"
    interval_seconds: 15
    from_second: 0
    to_second: 840
    jitter_seconds: 4          # timestamps vary ±4s — looks real, not metronomic

  - id: pool-stats
    level: WARN
    service: payment-service
    message: "HikariPool-1 - Pool stats (total=5, active=5, idle=0, waiting={n})"
    interval_seconds: 30
    from_second: 0
    to_second: 840
    jitter_seconds: 6

  - id: retry-burst
    level: ERROR
    service: payment-service
    message: "Retry attempt {n}/3 — circuit open"
    interval_seconds: 5
    from_second: 10
    to_second: 40
    count: 5                   # cap at 5 entries regardless of window size
```

### 3. `background_logs` — ambient profile noise (realism padding)

Use to populate the log stream with realistic routine lines (health checks, GC events, successful requests) that existed before and during the incident. No message authoring required — pick a profile and a window.

The profile's lines are sampled using a live RNG (different every session) so the stream never looks identical between runs. Use `seed` only when debugging.

**Available profiles** (defined in `server/src/scenario/log-profiles.ts`):

| Profile | Typical for |
|---|---|
| `java_web_service` | Spring Boot / Dropwizard API with HikariCP |
| `nodejs_api` | Express / Fastify API with Redis and a DB pool |
| `python_worker` | Celery worker processing a task queue |
| `sidecar_proxy` | Envoy / Istio sidecar next to any service |

**`density`** controls entries per minute: `low` (×0.4), `medium` (×1.0, default), `high` (×2.2).

```yaml
background_logs:
  - profile: java_web_service
    service: payment-service
    from_second: -300          # start 5 sim-minutes before the incident
    to_second: 840
    density: medium            # omit seed — every session gets its own stream

  - profile: sidecar_proxy
    service: payment-service
    from_second: -300
    to_second: 840
    density: low
```

### Adding a new profile

Add an entry to `LOG_PROFILES` in `server/src/scenario/log-profiles.ts`. No other code changes needed.

```typescript
my_service: {
  baseRate: 8,    // entries per 60 real seconds at density=medium
  lines: [
    { level: 'INFO',  message: 'GET /health 200 - 1ms', weight: 4 },
    { level: 'DEBUG', message: 'cache hit: session (ttl 1200s)',  weight: 2 },
    // ...
  ],
},
```

`weight` is relative — higher weight means the line appears more often. Omit for weight=1.

---



| Version | Date       | Changes                                                                      |
| ------- | ---------- | ---------------------------------------------------------------------------- |
| 1.2     | 2026-04-09 | Metric-aware personas; remediation controls (scale/bounce/deploy/flags)      |
| 1.1     | 2026-04-08 | Log volume: `log_patterns` and `background_logs`                             |
| 1.0     | 2026-04-07 | Initial creation                                                             |

---

**This is a living document. Update it as the project evolves.**
