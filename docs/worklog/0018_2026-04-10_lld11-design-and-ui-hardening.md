# 0018 — 2026-04-10 — Phase 11 LLD: Component Topology, Reaction Menu, and UI Hardening

**Date:** 2026-04-10
**Phase:** 11 — Design complete, implementation pending
**Status:** In Progress — LLD written, production code not yet changed

---

## What Was Done

### LLD 11 — Component Topology, Auto-Generated Metrics, and Reaction Menu

Design document written, reviewed, and revised four times against the actual
codebase. Filed at `docs/design/lld/11-component-topology-and-reaction-menu.md`.

The document specifies three changes:

1. **Component topology** — `topology.focal_service` becomes a typed
   `ServiceNode` object with a `components: ServiceComponent[]` array modelling
   the internal microservice architecture as a discriminated union. Each
   `ComponentType` has its own subtype with only the capacity fields applicable
   to it. `COMPONENT_METRICS` uses a mapped type `{ [K in ComponentType]: spec[] }`
   — compile error if any type is missing. `ops_dashboard` is removed from YAML
   entirely; the loader derives `LoadedScenario.opsDashboard` at runtime from the
   component graph.

2. **Auto-generated metrics** — `deriveOpsDashboard()` in the loader produces
   `FocalServiceConfig.metrics` from the component graph + `incidents[]` array.
   Authors declare architecture and intent; the metric pipeline is unchanged.
   `ResolvedMetricParams.overlay` (single field) is replaced by
   `overlayApplications: OverlayApplication[]` — supports multiple incidents on
   the same metric, compounding sequentially.

3. **Reaction menu** — `apply_metric_response` tool is replaced by
   `select_metric_reaction`. The engine pre-computes exactly 4 named outcomes
   (`full_recovery`, `partial_recovery`, `worsening`, `no_effect`) before each
   LLM call. The LLM selects one id. No magic-string metric names, no LLM
   arithmetic, no freeform pattern selection. Reaction ids are fixed constants
   in the tool schema — no dynamic enum reconstruction per call.

### Design decisions resolved during review

**ServiceComponent as discriminated union, not flat optional fields.**
Each subtype (`EcsClusterComponent`, `LambdaComponent`, `DynamoDbComponent`, etc.)
carries only the capacity fields that apply to it. TypeScript exhaustiveness
enforced via mapped type on `COMPONENT_METRICS`. Adding a new component type
requires: new interface + union member + schema branch + registry entry — nothing
else changes.

**ServiceCategory removed entirely.**
Audit showed `service_type` / `ServiceCategory` is not rendered in any UI
component, not read by the metric pipeline, not sent to the LLM prompt, and only
tested for its own schema presence. It was dead data carrying authoring burden.
Removed from types, schema, loader, ScenarioContext, testutil, and scenario YAML.
`trafficProfile` default (the one indirect dependency) is now derived from the
entrypoint component type: `load_balancer`/`api_gateway` → `always_on_api`,
`kinesis_stream`/`sqs_queue` → `none`, `scheduler` → `batch_nightly`.

**Reaction menu invariant: always exactly 4 reactions.**
TypeScript tuple type enforces this at the construction site. All four candidates
(`full_recovery`, `partial_recovery`, `worsening`, `no_effect`) are always
present. Communication actions produce candidates with `overlays: []` — the
engine skips the LLM call, but the menu structure is invariant.

**ops_dashboard eliminated from YAML — retained as runtime-derived type.**
`LoadedScenario.opsDashboard` remains as a derived field on the runtime type so
the metric pipeline (`resolver.ts`, `generator.ts`, `metric-summary.ts`, etc.)
is unchanged. Only the production path changes: the loader derives it from
components instead of parsing it from YAML.

**preIncidentSeconds and resolutionSeconds moved to TimelineConfig.**
They are scenario-timing parameters, not dashboard config.

**trafficProfile and health moved to ServiceNode.**
They are service properties, not dashboard properties.

**Correlated services replaced by topology.downstream[] with components.**
`correlation`, `lagSeconds`, `impactFactor` fields moved to `ServiceNode`.
The concept survives; the location becomes structurally correct.

### Other work in this session

**UI changes shipped and tested:**

- `RemediationsPanel` — Remediation controls default to open (`<details open>`).
  ThrottleSection replaced with per-target table UI supporting endpoint/global/
  consumer/concurrent scopes with inline limit inputs, and customer scope with
  always-visible freeform Customer ID input.
- `ScaleSection` — replaced delta-based +/- buttons with "Desired hosts" number
  input pre-populated from current count. Dispatches `scale_cluster` with
  `{ direction, count, desiredCount }`.
- `SimStateStore` — renamed from `ConversationStore` throughout. Added
  `ActiveThrottle` state with `applyThrottle()`, `removeThrottle()`,
  `getThrottle()`, `getAllThrottles()`.
- `throttle_targets` schema — added `ThrottleTargetConfig` (scope, label,
  description, llmHint, unit, baselineRate) to `throttle_traffic` remediation
  actions. Metric-reaction-engine prompt includes active throttles + `llmHint`.
  Customer scope renders freeform Customer ID input — trainee must find the
  customer via log diving.
- **Passive action filtering** — `PASSIVE_ACTIONS` set in metric-reaction-engine
  prevents LLM calls for observational actions.
- **LLM client getter fix** — `StakeholderEngine` and `MetricReactionEngine` now
  accept `() => LLMClient` instead of `LLMClient` so the real client is always
  used after async init (was using the temp no-op forever in production).
- **process.env fix** — `stakeholder-engine.ts` was crashing the browser bundle
  with `process.env.STAKEHOLDER_TOKEN_BUDGET`. Fixed to `import.meta.env.VITE_TOKEN_BUDGET`.
- `useSSE.ts` and its test deleted (replaced by engine-direct subscription).

---

## Test Results

- Pass rate: 912/912
- Known failures: none
- TypeScript: clean

---

## Known Issues

None — all production code in this session is tested and passing.

LLD 11 implementation is **not yet started**. The design is complete.

---

## What Comes Next

Implement LLD 11 in TDD order per §14 of the design document:

1. `component-topology.test.ts` (new) — write failing tests, implement
   `findEntrypoint`, `propagationPath`, `propagationLag`
2. `component-metrics.test.ts` (new) — write failing tests, implement
   `COMPONENT_METRICS` registry for all 12 component types
3. `scenario/loader.test.ts` (extend) — write failing tests, implement
   `deriveOpsDashboard()` + schema/type changes
4. `metrics/series.test.ts` + `metric-store.test.ts` (extend) — write failing
   tests, implement `overlayApplications[]` + `applyIncidentOverlay()` update +
   new MetricStore methods
5. `reaction-menu.test.ts` (new) — write failing tests, implement
   `buildReactionMenu()`
6. `metric-reaction-engine.test.ts` (extend) — write failing tests, implement
   `select_metric_reaction` tool + `_applySelectedReaction()`
7. `RemediationsPanel.test.tsx` (extend) — write failing tests, implement
   `ScaleConcurrencySection`, `ScaleCapacitySection`, `getComponentCapabilities()`
8. Migrate both scenarios to new YAML format, run full suite
