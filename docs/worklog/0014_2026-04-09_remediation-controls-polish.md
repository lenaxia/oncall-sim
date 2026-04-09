# 0013 — 2026-04-09 — Remediation controls polish

## What was done

Follow-up fixes to the remediation controls built in 0012.

### `sideEffect` removed from UI

`sideEffect` was leaking into the confirmation modal warning and as inline text in the section body (Throttle, Restart, Emergency Deploy sections). It is the consequence text authored by the scenario writer and is only meant to appear in the Logs tab *after* the action executes. Stripped from all modal and inline display. `ConfirmState.warning` field removed.

### Scale cluster — `scaleDirection` / `scaleCount` removed from schema

`scaleDirection` and `scaleCount` were per-action fields on `RemediationActionConfig` that pre-determined which direction was available. Removed from:
- `server/src/scenario/schema.ts`
- `server/src/scenario/types.ts`
- `server/src/scenario/loader.ts`
- `server/src/testutil/index.ts`
- `client/src/context/ScenarioContext.tsx`

Direction is now decided by the user at runtime. Count is entered via a numeric input in the UI. Both scale up and scale down buttons are always present for any service that has a `scale_cluster` action.

Game loop handler updated — `direction` and `count` now come entirely from dispatch params, not from the action config.

### Scale cluster — live instance count display

Instance counts shown in the Scale Cluster section now update optimistically when the user confirms a scale action. Initialised from `hostGroups[].instanceCount`, then adjusted by the confirmed delta on each scale up/down.

### Scale down button style

Scale down was `variant="ghost"`, scale up was `variant="secondary"`. Both now `secondary`.

### Layout fix

Remediation Controls section was inside a `flex-shrink-0` block outside the scrollable region — hidden when pipeline detail took full height. Moved into the `flex-1 overflow-auto` region so it's always reachable by scrolling.

### Payment scenario YAML

Removed `scale_direction: up` and `scale_count: 4` from `scale_up_payment` action. Renamed to `scale_cluster` (neutral). Updated `side_effect` to be scenario-accurate without giving away the answer.

## Test results

| Check | Result |
|---|---|
| `npm run typecheck` (both workspaces) | ✅ |
| `MOCK_LLM=true npm test --workspace=server` | 770/770 |

## Known issues

None introduced this session.
