# 0017 — 2026-04-09 — Rebase on reactive-metrics redesign + metric reaction engine fixes

**Date:** 2026-04-09
**Phase:** Client Migration — post-rebase stabilisation
**Status:** Complete

---

## What Was Done

### Rebase onto `528a62e` (reactive-metrics redesign)

Rebased `feature/phase-client-migration` onto the new main commit which
introduced the reactive metrics redesign:

- `MetricStore` rewritten — on-demand `generatePoint` per tick replaces
  pre-spliced finite windows; `ActiveOverlay` persists until overwritten
  (`sustained=true` default)
- `generator.ts` — now generates t≤0 only; t>0 generated on-demand each tick
- `MetricReactionEngine` — new engine decoupled from stakeholder personas;
  handles `apply_metric_response` exclusively
- `triggeredByAction` flag on `StakeholderContext` — gates metric reaction
  to trainee inputs only
- `stakeholder-engine.ts` — `apply_metric_response` removed from tool list;
  now logs a warning if called directly
- `tool-definitions.ts` — `getMetricReactionTools()` added; `getStakeholderTools()`
  excludes `apply_metric_response`; `sustained` field added to schema

All 6 conflicted source files resolved by copying the new server versions and
applying the same browser adaptations (randomUUID → globalThis.crypto,
process.env → import.meta.env). `stakeholder-engine-reactive.test.ts` correctly
deleted (its coverage absorbed into `metric-reaction-engine.test.ts`).

`SessionContext.tsx` resolved by taking the migration branch version and applying
main's ordered-insert `metric_update` reducer (replace-at-same-t, insert-in-order).

---

### Bug: `metric-reaction-engine.ts` — `llmClient` rename mismatch

**Root cause:** During the rebase conflict resolution, the parameter was renamed
from `llmClient` to `getLLMClient` in the function signature — but the one call
site at line 58 (`llmClient.call(...)`) was not updated. At runtime this called
`Function.prototype.call()` (native JS) instead of the LLM client's `.call()`
method, silently returning `undefined` and never reaching the proxy.

**Evidence:** Proxy logs showed only `[stakeholder]` calls — zero `[metric_react]`
calls — after performing remediations.

**Fix:** `getLLMClient().call(...)` at line 58.

---

### Bug: `_buildPrompt` — missing environmental context

**Root cause:** The user message only contained scenario title, sim time, and
audit log. The LLM had no current metric values, alarm state, or host group
counts — insufficient to decide whether an action warranted a metric change.

**Evidence:** When manually tested, the LLM responded with "no tool calls" even
for active remediations because it had no way to assess the current state.

**Fix:** User message now includes:

- `## Trainee Action` — last audit entry with full params
- `## Current Metric Values` — current value, baseline, and incident_peak for
  every tracked metric across all services
- `## Active Alarms` — id, service, condition, status, severity
- `## Host Groups` — label, service, instance count (environmental state)

---

### Bug: `process.env` in `stakeholder-engine.ts`

Server-copied verbatim; `process.env.STAKEHOLDER_TOKEN_BUDGET` crashes the
browser bundle. Fixed to `import.meta.env.VITE_TOKEN_BUDGET`.

---

### Feature: passive action filtering in `MetricReactionEngine`

Observational actions (`open_tab`, `view_metric`, `search_logs`,
`read_wiki_page`, `view_deployment_history`, `view_pipeline`,
`monitor_recovery`) cannot change system state. Firing the LLM for them wastes
latency and cost — the proxy logs confirmed the LLM always responded "no tool
calls" for these.

`PASSIVE_ACTIONS` set added as a module-level constant in
`metric-reaction-engine.ts`. The `react()` entry point returns early before any
LLM call when the last audit entry is a passive action.

Active remediations (scale_cluster, throttle_traffic, trigger_rollback,
restart_service, suppress_alarm, emergency_deploy, toggle_feature_flag,
override_blocker, approve_gate, block_promotion) proceed to the LLM as before.

---

### Infrastructure: proxy + client startup

- Python proxy (`proxy/main.py`) started with `AWS_PROFILE=mikekao-personal`
  and `LLM_MODEL=bedrock/us.anthropic.claude-sonnet-4-6`
- `client/.env.local` written: `VITE_LLM_MODE=k8s`,
  `VITE_LLM_BASE_URL=http://localhost:8000/llm`
- Both services running: proxy on `localhost:8000`, Vite on `localhost:3001`
- End-to-end verified: throttle_traffic action → LLM calls `apply_metric_response`
  → `applyActiveOverlay` → metrics update in chart

---

## Test Results

- Pass rate: 855/855
- Test files: 52/52
- New tests added: 21
  - 2 getter-based LLM client tests
  - 3 prompt context tests (metric values, alarms, action details)
  - 16 passive/active action filter tests (7 passive × assert no call,
    9 active × assert call)

## Known Issues

None.

## What Comes Next

- Scenario authoring — additional training scenarios beyond `_fixture` and
  `payment-db-pool-exhaustion`
- Debrief narrative — wire debrief LLM call to produce structured feedback
- Difficulty tuning — calibrate metric overlays and stakeholder response timing
- `view_pipeline` and `trigger_rollback` interaction — rollback currently shows
  in the pipeline UI but `applyActiveOverlay` for the recovery pattern is not
  tied to the deploy completing; may need a scripted event or a second reaction
  after the deploy succeeds
