# 0008 — Phase 7 + 8 UI Implementation Complete

**Date:** 2026-04-08
**Phases:** 7 (Component Library) + 8 (Sim Shell + All Tabs)
**Status:** Complete

---

## What Was Done

Implemented the full React client — all phases 7 and 8 — following `docs/design/ui-spec.md`
as the authoritative reference. Every component was written test-first (failing test → passing
implementation). No component was shipped without tests.

---

## What Was Built

### Infrastructure (Step 1)
- `index.html`, `src/index.css`, `src/main.tsx`
- Tailwind v4 CSS-native config (`@theme {}` in `index.css`, `@tailwindcss/postcss`)
- MSW v2 default handlers for all API routes (`src/testutil/msw-handlers.ts`)
- Expanded `renderWithProviders` in testutil to wrap `SessionProvider` + `ScenarioProvider`
- `MockSSEConnection` extracted to `src/testutil/mock-sse.ts`
- vitest setup expanded with `ResizeObserver` polyfill and `rAF`/`cAF` guards

### Primitive Components (Step 2)
`Spinner`, `Timestamp` + `formatSimTime`, `Badge` + `severityVariant` + `logLevelVariant`,
`Button`, `EmptyState`, `Panel`, `Modal` (focus trap, Escape, scroll lock, portal),
`MarkdownRenderer` (marked v2 sync mode + DOMPurify lazy-init for jsdom compatibility)

### Hooks (Step 3)
- `useSSE` — EventSource lifecycle, exponential backoff (1s→2s→4s→max 30s), backoff reset
  on successful reconnect, cleanup on unmount
- `useSimClock` — rAF interpolation between server sim_time updates; `SimClockContext`
  testability seam so tests inject values directly without a full SessionProvider

### Contexts (Step 4)
- `SessionContext` — reducer handles all 18 SSE event types; injected `sseConnection`
  prop for test isolation (real EventSource in production, MockSSEConnection in tests);
  `dispatchAction` is a no-op when `status !== 'active'`
- `ScenarioContext` — fetches `/api/scenarios/:id` on mount; exposes personas, wikiPages,
  featureFlags, engine config

### App Shell (Step 5)
`ErrorToast` (portal, auto-dismiss 4s), `ScenarioPicker` (MSW-intercepted fetch),
`App.tsx` (picker → sim → debrief state machine), `Topbar`, `SpeedControl`, `TabBar`
(keyboard nav: Left/Right/Home/End, aria tablist/tab/tabpanel), `CoachPanelShell`
(collapsed by default, unread badge dot), `SimShell` (connecting state, reconnect banner,
resolving overlay, End Simulation confirmation modal, log filter state hoisted here)

### Tab Components (Step 6)
- **WikiTab** — page list, case-insensitive search by title+content, `read_wiki_page` dispatch
- **LogsTab** — level toggle buttons (`aria-pressed`), service selector, `search_logs` on Enter
  only (not on every keystroke), filter state as props (persists across tab switches)
- **EmailTab** — thread grouping, unread dot, optimistic reply (local state), SSE echo
  deduplication delegated to SessionContext
- **ChatTab** — `#channels` / `dm:` sidebar sections, Enter-to-send / Shift+Enter newline,
  `@mention` dropdown, `direct_message_persona` once-per-session dispatch tracked via `useRef`
- **TicketingTab** — `mark_resolved` dual-dispatch, optimistic status update, `add_ticket_comment`
- **MetricChart** — Recharts `LineChart`, data gated by `simTime`, threshold `ReferenceLine`s,
  `onFirstHover` for `view_metric` once-per-metric dispatch
- **OpsDashboardTab** — service sub-tabs, MetricChart grid, alarm panel (global), optimistic
  [Ack]/[Suppress], `PageUserModal`, SENT PAGES section
- **PageUserModal** — single-persona pre-select, 10-char minimum, alarm context line
- **CICDTab** — deployment table, RECOVERY/OPERATIONAL button groups, rollback/roll-forward/
  emergency-deploy confirmation modals, `ThrottleTrafficModal` (0–100 validation),
  `FeatureFlagModal` (per-flag enabled/disabled state tracked), post-action banner planned
  (wired for simTime-based dismissal)

### DebriefScreen (Step 7)
Unified incident timeline (auditLog + eventLog interleaved, sorted by simTime ascending),
✓/✗ badges from evaluation state, why-text below action entries, evaluation panel
(relevant actions / red herrings / missed actions), stats panel (resolvedAt, action count),
loading state with 3s retry loop for slow LLM debrief generation.

---

## Test Results

```
Server:  615 / 615  (29 test files)
Client:  342 / 342  (27 test files)
Total:   957 / 957
```

`npm run typecheck` — clean on both workspaces  
`npm run lint` — clean (ESLint 10 flat config)  
`npm run build` — clean production build (Vite 8 + Rolldown)

---

## Stack Upgrades Applied During This Session

All packages upgraded to latest at time of implementation:

| Package | Before | After |
|---|---|---|
| React | 18.3 | 19.2 |
| TypeScript | 5.9 | 6.0 |
| Vite | 5.4 | 8.0 |
| Vitest | 1.6 | 4.1 |
| Tailwind CSS | 3.4 | 4.2 (CSS-native) |
| ESLint | 8.57 | 10.1 |
| @typescript-eslint | 7.18 | 8.58 |
| recharts | 2.15 | 3.8 |
| msw | 2.2 | 2.12 |
| @vitejs/plugin-react | 4.7 | 6.0 |
| @testing-library/react | 15.0 | 16.3 |
| jsdom | 24.1 | 29.0 |

### Non-trivial breakage encountered and resolved

**1. Dual React instances (React 18 at root, React 19 in client)**
Root `node_modules` had React 18 (used by RTL). Client workspace had React 19 (used by
components). Two React instances → "Objects are not valid as a React child" with `_store`
key in the error (React 18 dev element shape). Fix: upgrade root to React 19.

**2. vitest 4 + `vi.useRealTimers()` removes `cancelAnimationFrame`**
vitest 4's fake timer implementation *adds* `requestAnimationFrame` and `cancelAnimationFrame`
to the global. `vi.useRealTimers()` *removes* them. React 19's passive effect cleanup fires
during `afterEach` teardown — after `vi.useRealTimers()` but before the fiber is fully
destroyed — calling `cancelAnimationFrame` on a now-undefined global. Fix: call RTL `cleanup()`
explicitly *before* `vi.useRealTimers()` in `afterEach`.

**3. Tailwind v4 migration**
v4 drops `tailwind.config.js` entirely. Config is now CSS-native via `@theme {}` blocks in
`index.css`. The PostCSS plugin moved from `tailwindcss` to `@tailwindcss/postcss`.
`@tailwind base/components/utilities` directives replaced by `@import "tailwindcss"`.

---

## Known Issues / Gaps

- **Post-action banner dismissal** in CICDTab is wired but the simTime-based 30s countdown
  is not implemented — the banner currently stays until the next `deployment_update` SSE
  event. Spec §12 behaviour is partially complete.
- **Auto-scroll** ("new N entries" banner) in ChatTab and LogsTab is not implemented —
  the spec §13.5 pattern using `useLayoutEffect` + `shouldAutoScrollRef` was deferred.
  Both tabs render entries correctly but do not auto-scroll or show the jump banner.
- **SpeedControl** reads `speed`/`paused` from `useSimClock()` but `SimClockContext` is
  only provided in `SimShell` and `Topbar` — SpeedControl works correctly in context but
  would throw if rendered outside those providers.
- **DebriefScreen** retry loop uses real `setTimeout` (3s) not sim time — correct for
  this use case (LLM wall-clock latency) but worth noting.

---

## What Comes Next

**Phase 9 — Coach + Debrief (narrative panel)**

The debrief screen layout shell is complete. Phase 9 adds:
- LLM-generated narrative in the debrief left column (currently shows a placeholder)
- Coach panel content: proactive hints during the simulation, reactive responses to
  trainee actions, end-of-sim summary
- Possibly: interactive coach Q&A input (was descoped in Pass 2 but may be revisited)
