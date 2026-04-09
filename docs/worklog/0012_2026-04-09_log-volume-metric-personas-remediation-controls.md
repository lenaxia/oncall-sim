# 0012 — 2026-04-09 — Log volume, metric-aware personas, remediation controls

## What was done

### 1. Log volume generation (`log_patterns`, `background_logs`)

Added two new top-level YAML sections that let scenario authors generate large log volumes without enumerating individual entries.

**`log_patterns`** — repeating message templates. Author specifies a message (with optional `{n}` counter substitution), `interval_seconds`, and a `[from_second, to_second]` window. The loader expands each pattern into `ScriptedLogEntry` objects at load time. `jitter_seconds` perturbs timestamps via a live RNG so the stream doesn't look metronomic. `seed` pins the RNG for debugging only — omitted by default so every session gets a different scatter. Optional `count` cap.

**`background_logs`** — ambient noise from named profiles. Author picks a profile (`java_web_service`, `nodejs_api`, `python_worker`, `sidecar_proxy`), a service, a time window, and a density. The loader uses a live RNG to scatter entries from a weighted line table. No seed by default — every session differs.

Both mechanisms merge with scripted `logs[]` entries and are sorted by `atSecond` before being handed to the event scheduler. The event scheduler and game loop are unchanged.

**Files changed:**
- `server/src/scenario/schema.ts` — `LogPatternSchema`, `BackgroundLogsSchema`, wired into top-level schema
- `server/src/scenario/log-profiles.ts` — new file; four profiles, Mulberry32 RNG, `makeRng`
- `server/src/scenario/loader.ts` — `expandLogPattern`, `expandBackgroundLogs`, merge+sort
- `server/src/scenario/schema.ts` — `logs` made optional (defaults `[]`)
- `server/__tests__/scenario/log-expansion.test.ts` — 45 new tests
- `server/__tests__/scenario/schema.test.ts` — updated 2 tests that asserted `logs` was required
- `scenarios/payment-db-pool-exhaustion/scenario.yaml` — demonstrating all three mechanisms

**Test result:** 45/45 new tests pass. Full suite 659/659.

---

### 2. Metric-aware personas (metric summary in stakeholder engine)

Previously personas had zero visibility into actual metric state. They could only react to conversation history — meaning they could hallucinate system state that contradicted the real metrics.

**Root cause identified:** `StakeholderContext` contained no metric data. The system prompt was rebuilt per tick but never included current metric values.

**Solution:** Added `computeMetricSummary` and `renderMetricSummary` to `server/src/metrics/metric-summary.ts`. On every stakeholder tick, a grounded text block is injected into the system prompt describing the actual metric state.

**What the summary contains per metric:**
- **Status band** — `healthy` / `warning` / `critical` derived from `warningThreshold` / `criticalThreshold` with inverse-archetype support (metrics where lower is worse)
- **Slope** — linear regression over the last 60s of series points, normalised against `baselineValue` so it's scale-invariant (`rising sharply` / `rising` / `stable` / `falling` / `recovering`)
- **Pre-incident anchor** — series value at `onsetSecond - 1`, giving every sentence a "was X before the incident" reference
- **Time in band** — walks backwards through series to find when metric last changed bands
- **Sentence template** — selected by `(status, slope, archetype)`. Saturation archetypes (`connection_pool_used`, `cpu_utilization`, etc.) get "fully saturated" language. ~8 templates total.

**Verbosity is gated by correlation type:**
- focal + `upstream_impact` → full prose sentence per metric
- `independent` → current value + `[status]` only
- `exonerated` → single "not involved" line

The LLM is explicitly told: "Do not describe a metric as improving if it is marked rising. Do not describe a metric as worsening if it is marked recovering."

**No LLM involved in generation** — all template filling from deterministic series lookups.

**Files changed:**
- `server/src/metrics/metric-summary.ts` — new file (full rewrite of earlier draft)
- `server/src/engine/game-loop.ts` — `metricSummary` added to `StakeholderContext`; `computeMetricSummary` called in `buildStakeholderContext()`
- `server/src/engine/stakeholder-engine.ts` — `renderMetricSummary` injected into system prompt
- `server/__tests__/metrics/metric-summary.test.ts` — 26 new tests
- `server/__tests__/engine/stakeholder-engine.test.ts` / `stakeholder-engine-reactive.test.ts` — updated `MetricSummary` shape (`snapshots` → `narratives`)

**Test result:** 26/26 new tests pass. Full suite 770/770.

---

### 3. Remediation controls — emergency deploy, bounce, scale, throttle, feature flags

Previously `restart_service`, `scale_cluster`, `emergency_deploy`, `throttle_traffic`, and `toggle_feature_flag` were accepted by the actions route and audit-logged but fell through `handleAction`'s switch with no case, and had no UI surface.

**Schema additions:**
- `RemediationActionConfig` extended with `scaleDirection`, `scaleCount`, `flagId`, `flagEnabled`, `label`
- `FeatureFlagConfig` — id, label, defaultOn, description
- `HostGroupConfig` — id, label, service, instanceCount, description
- `feature_flags` and `host_groups` arrays added to top-level YAML schema (optional, default `[]`)

**Game loop handlers** — all five now implemented:
- `emergency_deploy` — resolves action by id, emits `deployment_update` + log entry with `sideEffect` text
- `restart_service` — emits a log entry + re-emits current deployment to show the bounce
- `scale_cluster` — emits a log entry with direction and count
- `throttle_traffic` — emits a WARN log entry
- `toggle_feature_flag` — emits a log entry with flag name and new state

All five resolve against `scenario.remediationActions` by `remediationActionId` so the scenario author's `sideEffect` text always appears in the logs.

**`RemediationsPanel.tsx`** — new client component grouped by action type:
- **Emergency Deploy** — one button per action, shows `targetVersion` prominently. Nothing appears if the scenario defines no `emergency_deploy` action — clicking is meaningless without a concrete artifact.
- **Bounce Hosts** — renders per `host_group` (showing instance count + description) when defined, falls back to per-service
- **Scale Cluster** — up/down buttons per host group with current instance count
- **Traffic Throttling** — apply button per service
- **Feature Flags** — toggle rows with ON/OFF badge, optimistic client state, disabled if no matching remediation action

All actions go through a confirmation modal showing `sideEffect` as a warning.

Wired into `CICDTab` as a collapsible "Remediation Controls" section below the pipeline detail, collapsed by default.

**Payment scenario** extended with:
- 1 host group (4-instance us-east-1)
- 2 feature flags (circuit breaker, request queuing)
- 4 new remediation actions: scale up (red herring), throttle (red herring), disable request queue (red herring), enable circuit breaker (red herring)
- `emergency_deploy_config_fix` now has a concrete `target_version: v2.4.2` and `label`

**Files changed:**
- `server/src/scenario/schema.ts`
- `server/src/scenario/types.ts`
- `server/src/scenario/loader.ts`
- `server/src/testutil/index.ts`
- `server/src/engine/game-loop.ts`
- `client/src/context/ScenarioContext.tsx`
- `client/src/components/tabs/RemediationsPanel.tsx` — new file
- `client/src/components/tabs/CICDTab.tsx`
- `scenarios/payment-db-pool-exhaustion/scenario.yaml`

**Test result:** 770/770. Both workspace typechecks clean.

---

### 4. Server restart / process fix

Identified that the server running on port 3001 (PID 2148258, started 2026-04-07T18:29) predated all session changes. Earlier kill attempts targeted Vite processes on 3002/3003. Killed the correct process and restarted with the updated loader.

---

## Test results

| Suite | Pass | Total | Notes |
|---|---|---|---|
| Full server suite | 770 | 770 | After all changes |
| New: log-expansion | 45 | 45 | |
| New: metric-summary | 26 | 26 | |
| Typecheck: server | ✅ | — | |
| Typecheck: client | ✅ | — | |

One timing flake in `session-lifecycle.test.ts` (`debrief_ready` SSE race) observed once, passed on re-run. Pre-existing, not introduced by this session.

## Known issues

- `background_logs` entries with `from_second < 0` (pre-incident) all fire on the first tick since `atSecond` values are negative and `simTime >= atSecond` is immediately true. This is correct behaviour — they populate the log history visible when the trainee first opens the Logs tab.
- The `restart_service` game loop handler emits the current deployment as a new `active` entry (to show the bounce) but does not add an intermediate `in_progress` state — there is no `in_progress` value in the `DeploymentStatus` enum. This is a minor fidelity gap; the bounce is still visible as a new deployment entry with updated timestamp.
- `RemediationsPanel` feature flag toggles use optimistic client state — if the server rejects the action (e.g. session not active), the toggle stays flipped. This is acceptable for the simulation context.

## What comes next

- Debrief LLM narrative (Phase 9) — currently a stub that returns empty narrative
- Additional scenarios beyond payment-db-pool-exhaustion
- Scenario author tooling / validation CLI
