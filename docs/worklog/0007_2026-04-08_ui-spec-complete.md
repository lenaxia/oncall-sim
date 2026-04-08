# 0007 — UI Specification Complete (Phase 7 + 8 Design)

**Date:** 2026-04-08
**Phase:** 7/8 — React UI
**Status:** Complete — ready to implement

---

## What Was Done

Produced and iterated the authoritative UI design specification for Phase 7 (component
library) and Phase 8 (sim shell + all tabs). The document lives at
`docs/design/ui-spec.md` and went through nine revision passes before being declared
implementation-ready.

### Passes and what each one resolved

**Pass 1 — structural foundation**
- Discovered `lld-07-react-ui.md` did not exist; `ui-spec.md` was already the primary
  document (~2543 lines at that point)
- Added §9 (Context and Hook Specifications): full `SessionContext`, `ScenarioContext`,
  `useSSE`, `useSimClock` contracts — none had been formally specified
- Eliminated `AuditContext` (it was listed as a file but had no spec; the audit log
  belongs in `SessionState.auditLog` via SSE)
- Fixed `PageUserModal` props interface — two conflicting versions reconciled to flat
  `alarmId?`/`alarmLabel?`
- Added `eventLog` to `buildDebriefPayload` (missing from testutil builder)
- Added all missing `dispatchAction` payload shapes: `open_tab`, `direct_message_persona`,
  `view_metric`, `view_deployment_history`, `update_ticket`
- Clarified `mark_resolved` dual-dispatch semantics
- Added §19 error handling: API failure toast, page refresh behaviour, session expiry overlay
- Added `FeatureFlagModal` full spec to CICDTab
- Clarified OpsDashboard content ordering and alarm/page scope (global not per-service)
- Added `sim_time` SSE event payload shape
- Renumbered all sections (§9 inserted, §§10–19 shifted)

**Pass 2 — consistency and missing behaviour**
- Fixed `§13.2` auto-select rule — replaced blanket "except Email" with explicit per-tab
  table (Chat auto-selects first channel, CI/CD auto-selects first service, others don't)
- Resolved `investigate_alert` — dispatched by [Ack] alongside `ack_page`; `ack_page`
  naming inconsistency documented
- Specced `ThrottleTrafficModal` (percentage input, 0–100 validation)
- Specced `emergency_deploy` confirmation modal with optional notes textarea
- Rewrote `§8.15` DebriefScreen loaded state — was a broken code block; now a clean
  fenced diagram with right column (evaluation + stats panels) fully specified
- Removed "type a question below" from coach intro (no input in Phase 7)
- Fixed Ops content order: charts first, alarms second, sent pages last
- Fixed `buildFullScenario` testutil: added `engine` block, `jobTitle`/`team` on persona
- Added `featureFlags: Array<{id,label}>` to `ScenarioConfig`
- Added estimated duration to scenario picker card metadata line
- Specced log filter persistence (hoisted to SimShell)
- Added `ErrorToast` component spec (§8.17) and wired `onError` into `SessionProviderProps`

**Pass 3 — blocking implementation issues**
- Restored missing `## 9.` heading (was lost during pass 1 insertion)
- Fixed stale `§13.1` cross-reference (`§10` → `§11`)
- Removed stale §9.3 AuditContext cleanup prose; replaced with one-line statement of fact
- Added `SessionProviderProps` interface with `onError` callback
- Fixed `PageUserModal` test wording (`alarmContext` → `alarmId`)
- Added test cases for `ErrorToast`, `ThrottleTrafficModal`, `FeatureFlagModal`
- Fixed toast z-index: `z-50` → `z-[60]` (must be above modals)
- Clarified auto-select does NOT dispatch audit actions
- Added CICDTab button grouping: RECOVERY (danger) / OPERATIONAL (secondary) with divider
- Specced alarm row inner DOM structure (two-column: badge left, content right flex-col)
- Added ChatTab empty channel state

**Pass 4 — UX quality and semantic gaps**
- Added `§13.7` action dispatch semantics section — full payload shapes for all 20 action
  types in one place
- Fixed `§0.2` principle 6 — removed stale "type a question below" phrasing
- Specced SENT PAGES row layout (three-column DOM: timestamp / name+title / message)
- Fixed Ticketing badge to count `ticket_created` + `ticket_comment` + `ticket_updated`

**Pass 5 — behavioral contracts**
- Post-action banner in CICDTab: specced per-action text
  (`trigger_rollback` / `trigger_roll_forward` / `emergency_deploy`)
- Added `alarm_acknowledged` SSE event to §9.1 event table
- Added optimistic update rules for [Ack] and [Suppress] (no wait for SSE confirmation)
- Added session creation failure spec in §10 Picker→Sim flow
- Fixed `@mention` dropdown to show `displayName · jobTitle` (not internal persona ID)
- Specced email reply as optimistic (immediate append, dedup in SessionContext)
- Added `ACTION_LABELS` map and key param summary spec for debrief timeline
- Fixed Ticketing badge to also count `ticket_created`

**Pass 6 — debrief layout repair and Enter-to-send**
- Moved `ACTION_LABELS` map outside the fenced layout block in §8.15 (it was embedded
  mid-block, splitting `[left column]` from `[right column]`)
- Added `alarm_acknowledged` test to §15.5 SessionContext
- Added optimistic reply + dedup tests to §15.5 EmailTab
- Added alarm optimistic update tests to §15.5 OpsDashboardTab
- Fixed CICDTab divider: removed contradictory "only rendered if non-empty" note
- Added `relative` to chat input area (required for `@mention` `absolute` dropdown)
- Specced Enter-to-send for Chat (Enter = send, Shift+Enter = newline)
- Added corresponding test cases

**Pass 7 — context contracts and reply deduplication**
- Moved reply dedup logic into `SessionContext` `email_received` handler (right layer)
- Fixed dedup condition: sim-time comparison not wall-clock
- Specced no-Enter-submit for ticket comment textarea (intentional contrast with chat)
- Added Enter-to-send test to §15.5 ChatTab
- Added resolving overlay spec to §8.13 SimShell (shown during debrief generation)
- Added SimShell test block to §15.5 (was entirely absent)

**Pass 8 — dead state removal and type definitions**
- Removed `DebriefScreen` waiting state (dead code — resolving overlay on SimShell
  handles this; DebriefScreen only mounts with data available)
- Added `from !== 'trainee'` guard to email unread badge counting
- Added `Deployment` and `Alarm` type shapes to §9.1 (were referenced everywhere but
  never defined — specifically `Deployment.version` which drives button labels)

**Pass 9 — final consistency pass**
- Fixed §10 Sim→Debrief 30s timeout: now navigates to DebriefScreen which retries fetch
  on mount; added minimal loading state for the rare case where LLM takes >30s
- Removed §9.3 AuditContext tombstone section; renumbered §9.4→§9.3, §9.5→§9.4

---

## Final spec state

- **3251 lines**
- **20 sections** (§0 Usage Modes → §20 No Open Questions)
- **All design decisions resolved** — §20 explicitly closes open questions
- All component interfaces, DOM structures, interaction patterns, and test cases specified
- `docs/design/lld/07-ui-components.md` annotated as superseded with conflict list

---

## Test Results

No implementation yet — this entry covers design work only.

---

## Known Issues

None. The spec is implementation-ready.

---

## What Comes Next

Implement Phase 7 in the order specified at the end of the spec:

1. §18 configuration files (Tailwind, PostCSS, index.html)
2. §7 global CSS (`src/index.css`)
3. §8 primitive components with §15.5 tests
4. §9 contexts and hooks with §15.5 tests
5. §8.12 ScenarioPicker + §10 App.tsx screen navigation
6. §8.13 SimShell + §8.9 Topbar + §8.10 SpeedControl + §8.11 TabBar + §8.14 CoachPanelShell
7. §12 tabs (Email → Chat → Ticketing → Ops → Logs → Wiki → CI/CD)
8. §8.15 DebriefScreen

After each step: `npm test && npm run typecheck && npm run lint` in `client/` must be clean
before proceeding.
