# 0026 — CICD Approval Workflow Improvements & Game Loop Unification

**Date:** 2026-04-15
**Tests:** 1384 passing (76 test files)
**Status:** ✅ Complete — v1.0.37 released

---

## What Was Done

### Game loop tick unification (60s → 1s)

The game loop previously ticked every 60 sim-seconds (`60000 / speed` ms
real). This caused visible freezes at stage boundaries, delayed deployment
start after user actions, and forced manual `tickPendingDeployments()` calls
after every action handler. Changed to tick every **1 real second** regardless
of sim speed. The `sim_time` event now emits every second, keeping
`useSimClock` anchored tightly.

### Coach throttle: tick-count modulo → wall-clock

Removed `_coachTickCount` and `COACH_TICK_INTERVAL = 3`. Coach now fires at
most once every **30 real seconds** (`COACH_MIN_INTERVAL_MS`) via wall-clock,
only on meaningful dirty ticks. This is speed-independent and easier to reason
about.

### Approval workflow phases derived from stage type

`ApprovalWorkflow` previously hardcoded three phases (Deploying → Integration
tests → Bake time) for all stages. Now phases are derived from
`stage.type` and `stage.tests`:

- `type: "build"` → **Building** + Tests (if any) — no bake phase
- `type: "deploy"` → **Deploying** + Tests (if any) + **Bake time**
- Test phase omitted entirely when `stage.tests.length === 0`

### Progress bar clock anchor fix (startRef)

Replaced `stage.stageStartedAtSim` (set by game loop tick, could be up to 1s
stale) with a `startRef` that captures the RAF-interpolated `simTime` on the
**first render** after the stage becomes `in_progress`. This ensures `elapsed`
starts at 0 on the first frame regardless of tick timing. The `key={stage.status}`
wrapper on the parent resets the ref correctly on every status change.

### Completed stage progress bars hidden

Once a stage reaches `succeeded`/`failed`, all progress bars are hidden. Only
the phase label with `✓`/`✗` icons remains, keeping the UI clean.

### Blocked promotion: stage marked succeeded immediately

When promotion into the next stage is blocked (alarm, time_window,
manual_approval), the current stage was freezing at 0s remaining in
`in_progress`. Fixed: the stage is now marked `succeeded` immediately when its
duration elapses, and `currentStageIndex` is advanced to the blocked next
stage so `rebasePendingDeployment` targets it correctly on unblock.

### Unblock resumes deployment immediately

`approve_gate` and `override_blocker` now resume the pending deployment on the
next 1s tick (previously waited up to 60s). No more manual
`tickPendingDeployments()` calls needed — the unified tick handles it.

### Deployment queue per pipeline

`_pendingDeployments` changed from `Map<string, PendingDeployment>` to
`Map<string, PendingDeployment[]>` — a FIFO queue per pipeline. A new
deployment no longer silently overwrites an in-flight one. The new deployment
is appended to the tail and starts automatically when the head completes,
rebased to `nowSim` so it starts fresh.

### Rollback disabled while in_progress

The Rollback button in `StageCard` is now disabled when
`stage.status === "in_progress"`.

### Deployment clock starts on Confirm, not Deploy

Previously both `trigger_rollback` and `emergency_deploy` emitted an immediate
`in_progress` stage update (with `stageStartedAtSim: now`) synchronously in
`handleAction` — before the confirm modal was dismissed. Removed both
immediate emits. The game loop tick now owns all stage transitions. Combined
with the `startRef` approach in `ApprovalWorkflow`, the clock visually starts
at 0s on the first render after confirm.

### trigger_deploy: dedicated ActionType for forward deploys

`RemediationsPanel` normal mode was dispatching `trigger_rollback` for forward
deploys — semantically wrong. Added a dedicated `trigger_deploy` ActionType
and handler. `trigger_rollback` now exclusively handles actual rollbacks
(deploys `previousVersion` by default). `trigger_deploy` requires an explicit
`targetVersion`.

`emergency_deploy` remains a separate action with distinct semantics: build
then jump directly to a target stage, skipping intermediates.

### Stage transition epsilon

Added `STAGE_START_EPSILON = 0.5` sim-seconds to the stage start check in
`tickPendingDeployments`. Without it, floating-point overshoot at stage
boundaries caused the next stage to miss its `startAtSim` check and wait a
full 1-second tick before starting.

### Type fixes

Made the following fields optional (all have runtime defaults in the loader):

- `OverlayApplication.incidentId` — defaults to `"unknown"` in dedup key
- `AlarmConfig.thresholdDirection` — defaults to `"high"` in loader
- `IncidentConfigSchema.propagation_direction` — defaults to `"upstream"` in loader

Fixed `ScenarioContext.test.tsx` `require()` calls — replaced with proper ESM
`import { act } from "@testing-library/react"`.

### Coach: remediation_taken trigger removed

A `remediation_taken` proactive coach trigger was briefly added but removed.
The coach is now fully reactive except for safety-net triggers
(`resolve_with_alarms_firing`, `red_herring`, `sev1_unacknowledged`,
`inactivity`, `passive_browse_stall`). Trainees should observe consequences
of their own actions without being second-guessed on every deploy.

---

## Test Count

- Before: 1384 (76 files)
- After: 1384 (76 files)
- 0 type errors

---

## Files Changed

- `client/src/engine/game-loop.ts` — tick interval, trigger_deploy handler, stage epsilon, blocked promotion fix, queue rebase
- `client/src/engine/sim-state-store.ts` — pending deployment queue (Map → Map of arrays)
- `client/src/engine/coach-engine.ts` — wall-clock throttle, remediation_taken removed
- `client/src/engine/metric-reaction-engine.ts` — trigger_deploy added to DEFERRED set
- `client/src/components/tabs/CICDTab.tsx` — startRef, phase derivation, completed bars hidden, rollback disabled
- `client/src/components/tabs/RemediationsPanel.tsx` — trigger_deploy dispatch
- `client/src/metrics/types.ts` — incidentId optional
- `client/src/scenario/types.ts` — thresholdDirection optional
- `client/src/scenario/schema.ts` — propagation_direction optional
- `client/src/scenario/loader.ts` — incidentId fallback
- `shared/types/events.ts` — trigger_deploy ActionType added
- `client/__tests__/tabs/ApprovalWorkflow.test.tsx` — new test file, renderAtElapsed helper
- `client/__tests__/engine/deployment-progression.test.ts` — updated for 1s tick
- `client/__tests__/context/ScenarioContext.test.tsx` — ESM import fix
