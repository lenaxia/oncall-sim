# 0025 — Pipeline Deployment Progression & CICD UX Overhaul

**Date:** 2026-04-13
**Tests:** 1347 passing (75 test files)
**Status:** ✅ Complete

---

## What Was Done

### Staged pipeline deployment progression

Previously `trigger_rollback` and `emergency_deploy` applied their effects
instantly — all stages snapped to the final state with no progression. Now
both actions enqueue a `PendingDeployment` that the game-loop advances
stage-by-stage each tick based on sim-time elapsed.

**Stage durations (sim-seconds):**

- `build` type: 120s
- `deploy` type: 180s

**Tick processing (`tickPendingDeployments`):**

- Each tick reads live stage state from the store (not a cached snapshot) so
  blockers added mid-deployment are always respected
- When a stage's duration elapses, the next stage's blockers are checked at
  promotion time before marking the current stage succeeded
- `in_progress` stages animate tests to `running`; `succeeded` stages flip
  them to `passed` and append a promotion history entry
- When the final (prod) stage completes, `triggerMetricReact()` fires with
  current context — metrics react only after the fix actually lands in prod

**`trigger_rollback`** — builds a schedule from the triggered stage through
all remaining stages. Halts at any blocker (alarm, time_window, manual_approval).

**`emergency_deploy`** — builds a schedule of `build → targetStage → remaining
stages`, skipping intermediate stages. Respects all blockers including manual
gates; `isEmergency` now only means "skip intermediates", not "bypass blockers".

**`tickPendingDeployments` wired into tick step 3c** — was implemented but
never called; this was the root cause of the initial "nothing progresses" bug.

### Metric reaction gating

`trigger_rollback` and `emergency_deploy` are now in `DEFERRED_METRIC_REACT_ACTIONS`
— they do NOT fire `triggerMetricReact()` at dispatch. The call fires when
the prod stage completes in `tickPendingDeployments`. This prevents metrics
from recovering before the fix is live.

`block_promotion` and `approve_gate` added to `PASSIVE_ACTIONS` — pipeline
gating actions produce no environmental change and should not trigger LLM calls.

### `block_promotion` no longer forces `status: "blocked"`

Previously `block_promotion` set `status: "blocked"` on the stage, making it
appear red even though the deployed version was healthy. Now it only adds the
blocker to `blockers[]`, leaving the stage's existing status intact. The
connector between stages carries the blocker signal visually.

### `approve_gate` restores prior status

Previously `approve_gate` forced `status: "in_progress"` regardless of what
was deployed there. Now it restores `succeeded` (or keeps current status if
other blockers remain).

### CICD tab layout improvements

**Stage flow centered** — `justify-center` on the flex container.

**Focal service defaults open** — `selectedPipelineId` initialises to the
pipeline matching `scenario.topology.focalService.name`, falling back to the
first pipeline.

**Stage connectors replace the plain line** — each connector between stages
is now an interactive `StageConnector`:

- No blocker → green dot (16px); hover shows portal tooltip; click dispatches
  `block_promotion` on the next stage
- Manual gate → yellow `⊘`; click dispatches `approve_gate`
- Hard blocker (alarm/time_window) → red `⊘`; non-clickable; tooltip directs
  to Override Blocker in stage detail

Tooltips use `ReactDOM.createPortal` into `document.body` at fixed screen
coordinates, bypassing all `overflow` clipping.

**"Block Promotion" removed from `StageDetail`** — it lives on the connector
exclusively so context is visually obvious.

### Deploy section in RemediationsPanel

Replaced the single "Emergency Deploy" button with a full `DeploySection`:

- **Normal mode** — deploys through all pipeline stages via `trigger_rollback`
  semantics (respects every blocker)
- **Emergency mode** — stage selector appears for deploy-type stages; trainee
  picks the target stage (e.g. Pre-Prod, Prod); build → target → remaining
  stages are scheduled. No auto block-promotion checkbox — trainee must gate
  the prod connector manually to build that operational muscle.

### `target_stage` YAML field

Added `target_stage` (optional) to `RemediationActionConfig` / schema /
loader. Emergency deploy defaults to the last stage if absent. Payment scenario
`emergency_deploy_config_fix` now has `target_stage: prod`.

### `GameLoop._testTick(simTimeSec)` test helper

Added to the `GameLoop` interface and implementation. Sets sim time directly
via `clock.setSimTime()` and calls `tickPendingDeployments` in isolation,
bypassing `setInterval` fake-timer quirks that caused multi-stage progression
tests to fail intermittently.

---

## Bugs Fixed During Session

| Bug                                             | Root Cause                                                                                      | Fix                                                                                           |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Deployment never progressed                     | `tickPendingDeployments` wired but never called in `tick()`                                     | Added step 3c to `tick()`                                                                     |
| Manual blocker overridden                       | Stale pipeline snapshot cached before `while` loop; `isEmergency` skipped blocker check         | Re-fetch live stage on every iteration; check blockers at promotion time for all deploy types |
| Stage stuck in_progress                         | Duration check inside `if (status !== in_progress)` guard — once set, duration never re-checked | Restructured: duration check runs unconditionally; `in_progress` set only if not already set  |
| Emergency deploy fired metric react immediately | General `handleAction` footer calls `triggerMetricReact()` for all non-passive actions          | Added `DEFERRED_METRIC_REACT_ACTIONS` set; skip immediate react for rollback/deploy           |
| `approve_gate` left stage in_progress           | Hardcoded `status: "in_progress"`                                                               | Restore `succeeded` when no remaining blockers                                                |

---

## Test Changes

- `deployment-progression.test.ts` — new test file covering:
  - `trigger_rollback`: in_progress on dispatch, correct version, no instant
    succeed, succeeds after duration, sequential stage order, all stages
    complete, promotion history entry
  - `emergency_deploy`: in_progress on dispatch, build→target→remaining
    completes, manual blocker respected
  - `SimStateStore` pending deployment queue: enqueue, mutation-safe copy,
    progress update, complete/remove
- `metric-reaction-engine.test.ts` — removed `trigger_rollback`,
  `emergency_deploy`, `approve_gate` from `ACTIVE_ACTIONS` (now
  passive/deferred)
- `CICDTab.test.tsx` — updated "Block Promotion" test to click
  `connector-block-prod` instead of stage detail button
- `_fixture/scenario.yaml` — added `emergency_deploy_fixture` remediation
  action with `target_stage: prod`

---

## Test Pass Rate

- **1347 / 1347** tests passing across 75 test files
- `tsc --noEmit` clean

## Known Issues

None introduced in this session.

## What Comes Next

- Debrief narrative generation (Phase 9 stub → full implementation)
- Metric realism improvements (`error_rate` noise, `cert_expiry` threshold)
- Pipeline promotion history visible in stage detail panel
