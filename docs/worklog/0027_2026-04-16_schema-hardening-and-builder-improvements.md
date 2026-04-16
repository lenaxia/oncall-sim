# 0027 — Schema Hardening, Dead Field Removal, Builder Prompt Improvements

**Date:** 2026-04-16
**Tests:** 1511 passing (81 test files)
**Status:** ✅ Complete — v1.0.43 released

---

## What Was Done

### Schema validation hardening

Four issues identified through a full audit of `schema.ts` against the live
codebase were fixed.

**`LLMEventToolSchema.tool` — enum instead of free string**

`tool` was typed `z.string().min(1)`, meaning a typo like `"fire_alerm"` would
pass schema validation and silently produce a no-op at runtime. Replaced with
`z.enum([...])` over the six valid tool names (`select_metric_reaction`,
`apply_metric_response`, `fire_alarm`, `silence_alarm`, `inject_log_entry`,
`trigger_cascade`). A `LLMEventToolNameEnum` constant is exported so the type
can be derived from it.

**`BackgroundLogsSchema.profile` — validated against `LOG_PROFILES` keys**

`profile` was `z.string().min(1)`. An unknown profile name would pass schema
validation and silently produce no background logs at runtime (the loader
warned and skipped). Now uses `z.enum(Object.keys(LOG_PROFILES) as
[string, ...string[]])` so an invalid profile name fails at parse time with a
clear error listing valid options.

**`LLMEventToolConfig.requiresAction` — removed dead field**

`requires_action` was present in `LLMEventToolSchema`, `LLMEventToolConfig`,
and the loader transform, but was never read anywhere in the engine. Removed
from all three locations.

**`resolution_seconds` and `tick_interval_seconds` — removed dead scenario
config fields**

Both fields were authored in scenario YAML and accepted by the schema, but
neither was actually used:

- `resolution_seconds` was stored in `TimelineConfig` and passed into
  `OpsDashboardConfig`, but `resolver.ts` hardcoded `60` and ignored the
  config value.
- `tick_interval_seconds` was stored in `EngineConfig` but the game loop
  hardcodes a 1000ms real-time tick interval regardless.

These are sim engine constants, not scenario config. Both fields were removed
from `TimelineSchema`, `EngineSchema`, `TimelineConfig`, `EngineConfig`,
`OpsDashboardConfig`, the loader transform, `deriveOpsDashboard()`, and all
seven scenario YAMLs. A named constant `SIM_RESOLUTION_SECONDS = 60` is now
exported from `loader.ts` and imported by `resolver.ts`, replacing the
anonymous magic number.

### Type narrowing: `LLMEventToolName`

`LLMEventToolConfig.tool` was typed `string`. Added `LLMEventToolName` as a
proper union type in `types.ts` (consistent with all other enum-like types
there) and narrowed `tool` to it. `schema.ts` exports `LLMEventToolNameEnum`
(the Zod object used for parsing); the TypeScript compiler enforces sync
between the two at the loader transform assignment point. `enabledTools` in
`tool-definitions.ts` is explicitly typed `Set<string>` since it's a lookup
set over runtime tool names, not just event tool names.

### `buildSchemaReference()` — schema section generated from Zod

The `EXACT SCHEMA` block in the scenario builder system prompt was a ~150-line
hand-written string. It would silently go stale whenever component types,
enum values, or field names changed in `schema.ts`.

Replaced with `buildSchemaReference()` exported from `schema.ts`, which
derives the schema reference text at runtime directly from the Zod objects:

- Component types and their extra required fields: read from
  `ComponentSchema.options` (discriminated union variants)
- Enum values (overlays, severities, statuses, log levels, profiles, traffic
  profiles, etc.): read from `.options` on each `z.enum`
- `default_speed` valid values: read from `TimelineSchema`
- Background log profiles: read from `BackgroundLogsSchema.shape.profile`

`useScenarioBuilder.ts` calls `buildSystemPrompt()` on each LLM request, which
concatenates the static instruction section with `buildSchemaReference()`. Six
new tests in `schema.test.ts` verify that the generated reference contains
every component type, onset overlay, remediation type, alarm severity, and
background log profile defined in the schemas.

### Scenario builder: current YAML injected into every request

The builder LLM had no reliable way to know the current state of the draft
across a multi-turn conversation — it had to reconstruct it from memory, which
caused repeated regeneration of already-authored sections.

`buildMessages()` now injects two fixed messages immediately after the system
prompt on every LLM request:

1. `user` — current YAML state (`yaml.dump(currentDraft)`) or `"(no draft
yet)"` on first message
2. `assistant` — `"Understood. I have the current YAML state."` (noop to
   avoid back-to-back user messages which some providers reject)

These are ephemeral — built fresh from `currentDraft` on each call, never
stored in `state.messages`, never shown in the UI.

### Builder build process: Phase 5 auto-generates logs

Previously `log_patterns` and `background_logs` were defaulted to empty arrays
and the LLM was instructed to never generate them unless the user explicitly
asked. This left scenarios with no log coverage.

A new **Phase 5** (Log generation) is added to the build process:

- **`background_logs`**: one entry per service in the topology using the most
  appropriate profile for the service's role and component types. Covers from
  pre-incident through end of scenario.
- **`log_patterns`**: 3–6 entries that tell the incident story — normal
  traffic before onset, early warning signals around `onset_second`, error/warn
  patterns during the incident. Based on the actual service names, component
  types, and incident description from the topology.

The LLM generates these without asking the user, then calls `send_message` to
briefly summarise what log coverage was added and offer to adjust it.

### Builder personas: default to passive/silent

Persona guidance was updated to establish a clear default: personas should be
passive and silent until the trainee contacts them. This is a skill-building
simulator — the trainee should drive the scenario.

Both the instruction section and the generated schema reference now state:

```
silent_until_contacted: true   ← default for all personas
initiates_contact: false       ← default for all personas
cooldown_seconds: 120
```

With explicit carve-outs: only set `initiates_contact: true` for personas with
a clear, realistic reason to reach out unprompted (e.g. an on-call manager
paging at incident start, an automated alert bot).

---

## Files Changed

**Source**

- `client/src/scenario/schema.ts` — enum validation for `tool` and `profile`,
  remove dead fields, add `buildSchemaReference()`
- `client/src/scenario/types.ts` — add `LLMEventToolName` union, remove dead
  fields from `TimelineConfig`, `EngineConfig`, `OpsDashboardConfig`
- `client/src/scenario/loader.ts` — export `SIM_RESOLUTION_SECONDS`, remove
  dead fields from transform and `deriveOpsDashboard()`
- `client/src/scenario/validator.ts` — remove `tick_interval_seconds` from
  stub
- `client/src/metrics/resolver.ts` — use `SIM_RESOLUTION_SECONDS` instead of
  magic `60`
- `client/src/llm/tool-definitions.ts` — explicit `Set<string>` type
- `client/src/hooks/useScenarioBuilder.ts` — `buildSystemPrompt()`, YAML state
  injection, Phase 5 log generation, persona defaults
- `client/src/components/ScenarioCanvas.tsx` — remove tick interval display
- `client/src/testutil/index.tsx` — remove dead fields from fixture

**Tests**

- `client/__tests__/scenario/schema.test.ts` — 6 new `buildSchemaReference`
  tests, update resolution_seconds test
- All other test files — remove dead `tickIntervalSeconds`,
  `resolutionSeconds` (scenario config), `requiresAction` fixture fields;
  restore correct `resolutionSeconds: 60` on `ResolvedMetricParams` helpers

**Scenarios**

- All 6 scenario YAMLs + `_fixture/scenario.yaml` +
  `_fixture/mock-llm-responses.yaml` — remove `tick_interval_seconds` and
  `resolution_seconds`
