# 0010 — Pipeline Redesign, Metric Thresholds, Ticket Metadata, UI Fixes

**Date:** 2026-04-08
**Status:** Complete

---

## What Was Done

Full CI/CD pipeline redesign (multi-pipeline, stage flow, alarm-driven dynamic blockers),
metric threshold lines wired from scenario config, ticket metadata panel, and a series of
UI correctness fixes identified during live playtesting.

---

## CI/CD Pipeline Redesign

### Data Model

**Shared types** — new pipeline model:

```
PipelineStage {
  id, name, type (build|deploy)
  currentVersion, previousVersion
  status (not_started|in_progress|succeeded|failed|blocked)
  deployedAtSec, commitMessage, author
  blockers: StageBlocker[]        // active blockers — can be multiple simultaneously
  alarmWatches: string[]          // alarm IDs that dynamically block when firing
  tests: StageTest[]              // integration/regression test results
  promotionEvents: PromotionEvent[] // last 5 promotion history entries (newest first)
}

Pipeline { id, name, service, stages[] }

StageBlocker { type, alarmId?, message, suppressedUntil? }
PromotionEvent { version, simTime, status, note }
StageTest { name, status, url?, note? }
```

**Key design decisions from reading real Amazon pipeline data:**

- Multiple blockers per stage (alarm + time_window simultaneously is common)
- Alarm blockers are dynamic (derived from `alarmWatches`), not static initial state
- Each stage carries test results and recent promotion history — this is the key
  signal trainee's use to understand what changed and when
- `pipeline_stage_updated` SSE event carries the full updated stage

### Dynamic Alarm Blockers (the key correctness fix)

**Bug:** Pre-Prod stage was statically set to `status: blocked` from t=0, before the
alarm had fired. This gave away the incident onset time and broke realism.

**Fix:** Separated initial state from dynamic watches:

- `blockers[]` — active blockers, initially empty for alarm-watched stages
- `alarmWatches: string[]` — alarm IDs to monitor; when alarm fires, a blocker is
  automatically added to `blockers[]`; when alarm is suppressed, blocker is cleared;
  when suppression expires (30 sim-min), blocker reinstates

**Alarm status → blocker behavior:**
| Alarm status | Blocker state |
|---|---|
| Not fired yet | No blocker (stage is healthy) |
| `firing` | Blocker added automatically |
| `acknowledged` | Blocker stays (ACK ≠ resolved) |
| `suppressed` | Blocker removed (let it through) |
| Suppression expires (alarm still firing) | Blocker reinstates |
| Metric drops below threshold | Alarm goes away, blocker removed |

### Actions

Four new action types with server-side state effects:

- `trigger_rollback { pipelineId, stageId }` — rolls stage back to `previousVersion`,
  records a `PromotionEvent`, clears blockers
- `override_blocker { pipelineId, stageId }` — sets `suppressedUntil = simTime + 1800`
  on all alarm blockers; sets stage to `succeeded`
- `approve_gate { pipelineId, stageId }` — removes `manual_approval` blockers, sets
  stage to `in_progress`
- `block_promotion { pipelineId, stageId, reason }` — adds a `manual_approval` blocker

### CICDTab Redesign

**Pipeline list (top):**
| Column | What it shows |
|---|---|
| Pipeline | Name |
| Status | HEALTHY / BLOCKED / DEPLOYING / FAILED with color dot |
| Last Prod Deploy | Relative sim-time (e.g. "20m ago") |
| Versions Pending Prod | Count of stages with different version than prod |

**Stage flow:** Horizontal pill row `Build → Staging → Pre-Prod → Prod`

- Pill color: green (succeeded), blue (in_progress), red (blocked/failed), gray (not_started)
- Blocker icons shown on pill (🔔 alarm, ⏰ time_window, 👤 manual)
- Click pill to expand stage detail

**Stage detail panel:**

- Header: version, commit message, author, deployed time, status badge
- Active blockers section (red background): each blocker with icon, message, suppression
  status
- Two-column footer: Test results | Recent promotions (last 5)
- Action buttons: Rollback, Override Blocker, Approve Gate, Block Promotion

### Multiple Pipelines

Payment scenario has two pipelines:

- `payment-service` — Build→Staging→Pre-Prod→Prod; Pre-Prod watches `alarm-latency-001`
- `fraud-service` — all stages healthy (independent, not involved in incident)

The fraud pipeline is a deliberate distraction — trainees may investigate it thinking
it's related to the payment incident. It isn't.

---

## Metric Threshold Lines

**Bug:** Threshold reference lines were missing from ops dashboard charts despite being
configured in the scenario YAML.

**Root cause:** `ScenarioContext.normalise()` was not extracting `opsDashboard.focalService.metrics`
thresholds into `ScenarioConfig`. `OpsDashboardTab` was passing empty `warningThreshold`
and `criticalThreshold` to `MetricChart`.

**Fix:**

- Added `MetricMeta { label, unit, criticalThreshold? }` to `ScenarioConfig`
- `ScenarioConfig.metricsMeta: Record<string, Record<string, MetricMeta>>` — keyed by
  service → metricId
- `normalise()` extracts from `opsDashboard.focalService.metrics[]` and
  `opsDashboard.correlatedServices[].overrides[]`
- `OpsDashboardTab` reads `scenario.metricsMeta[service][metricId]` and passes
  `criticalThreshold` to `MetricChart`

**Removed warning (yellow) threshold line** — only the critical (red) alarm threshold
is shown. The yellow line added visual noise without meaningful training value.

---

## Computed Alarm Firing

**Before:** All alarms were scripted (`autoFire: false`, fired at `onset_second`).

**After:** Alarms can be computed (`autoFire: true`) — fires when the metric series
value crosses `threshold`. The game loop checks on every tick.

- `alarm_latency_001`: `threshold: 2000` (ms), `auto_fire: true`
- `alarm_error_001`: `threshold: 5` (%), `auto_fire: true`
- Fixture alarm: stays `auto_fire: false` for test determinism

`Alarm.value` now carries the actual metric value at the time of breach (was always 0).

---

## Ticket Metadata Panel

Three-column layout: `[ticket list] [metadata panel] [description + comments]`

**Metadata panel contains:**

- Status dropdown (change status via select, not buttons)
- Severity dropdown
- Assignee select (personas + "Me (on-call)") — `Ticket.assignee` is now required
- Opened wall-clock time + elapsed sim-time
- Reported by (persona name)

**Removed:** Mark In Progress / Mark Resolved buttons from the right-side detail pane.
Status is now changed exclusively via the metadata panel dropdown, consistent with
how real ticketing systems work.

**`Ticket.assignee`** is now required (not optional). Defaults to `'trainee'` in the
loader when not specified in YAML. Scenario YAML can set an explicit assignee.

---

## 24h Metric History + Brush Zoom

`pre_incident_seconds` increased from 300s to 86400s (24h). `resolution_seconds`
changed from 30s to 60s. Results in 1,456 points per metric at 1-min resolution.

MetricChart now renders a Recharts `Brush` component below the main chart:

- Default window: last 4 hours (240 points visible)
- User can drag brush handles to zoom into any time range
- Full 24h of baseline trend visible for context
- `isAnimationActive: false` eliminates render churn on new data points

---

## Ops Dashboard Fixes

**Metric chart re-render delay on tab switch:** `OpsDashboardTab` was conditionally
rendered (`{activeTab === 'ops' && ...}`), unmounting on tab switch and triggering
Recharts' `ResizeObserver` re-init on return. Fixed by keeping it always mounted,
hidden with CSS `display: none` when inactive.

**activeService state** lifted to `SimShell` so the selected service persists across
tab switches.

---

## Unread Badge Correctness

**Bug:** Email unread badge cleared when switching to the email tab, even before any
email was read. Chat badge cleared when switching to the chat tab.

**Fix:**

- Email badge: only decrements when a thread is explicitly opened (`onSelectThread`)
- Chat badge: only clears for the channel the user clicks into (`onChannelChange`)
- Ops alarm dot: reflects live firing alarm count (auto-clears when all alarms
  acked/suppressed, not on tab open)
- Tickets/CICD: still clear on tab open (all items immediately visible on arrival)

---

## Chat + Email State Persistence

`emailSelectedThreadId`, `emailReadIds`, `chatActiveChannel` lifted from component
`useState` to `SimShell` props. Components unmount on tab switch; without lifting,
state was destroyed and reset on return.

---

## Server Improvements

**Logging:** Replaced all `console.*` with `pino` structured logger:

- `info` (default): startup + persona sends only
- `debug` (`LOG_LEVEL=debug`): LLM tick eligibility, call start/finish, tool calls
- `warn`: validation failures, context truncation
- `error`: LLM errors, unhandled exceptions

**Bedrock:** `BedrockProvider` accepts `AWS_PROFILE` via `fromIni` credential provider.
`BEDROCK_MODEL_ID` must be the cross-region inference profile format
(`us.anthropic.claude-sonnet-4-6`).

---

## Test Results

```
Server:  615 / 615  (29 test files)
Client:  359 / 359  (27 test files)
Total:   974 / 974
```

---

## Commits in This Session

- `fix(charts)`: single red threshold line only — remove warning (yellow) line
- `feat(metrics)`: 72h→24h historical data with Brush zoom/pan
- `fix(pipeline)`: alarm blockers are dynamic (alarmWatches), not static initial state
- `feat(cicd)`: pipeline stage model with alarm-linked blockers, stage flow UI
- `feat(ticketing)`: metadata panel with status/severity/assignee dropdowns and elapsed time
- `feat`: threshold lines on metric charts + computed alarm firing from metric breaches
- `fix(ui)`: remove mark-in-progress/resolved buttons, ops dashboard stay-mounted
- `fix(client)`: tab badges persist until content is read, not cleared on tab switch
- Various bug fixes: email/chat state persistence, clock anchor, protocol fixes

---

## Known Issues / Deferred

- **Code editor / code review** — deliberately deferred; rollback is the correct
  incident response action; code changes during an incident are a separate epic
- **Post-action banner in CICDTab** — 30s simTime-based dismiss not wired
- **Auto-scroll "N new entries" banner** — Chat and Logs still lack auto-scroll
- **Debrief narrative** (Phase 9) — empty placeholder
- **Coach interactive Q&A** — messages shown but no input
