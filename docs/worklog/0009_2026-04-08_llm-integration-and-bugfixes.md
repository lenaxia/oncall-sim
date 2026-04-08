# 0009 — Live LLM Integration + UI Bug Fixes

**Date:** 2026-04-08
**Status:** Complete

---

## What Was Done

Wired the live LLM (AWS Bedrock, claude-sonnet-4-6 via cross-region inference profile), diagnosed
and fixed a series of production bugs discovered during first real play sessions, and
established structured logging.

---

## LLM Integration

### Bedrock Provider — AWS Profile Support
`BedrockProvider` now accepts an explicit `profile` field via `@aws-sdk/credential-providers`
`fromIni`. The factory reads `AWS_PROFILE` from the environment. If unset, the default AWS SDK
credential chain is used (env vars → `~/.aws/credentials` → IAM role).

**Start command:**
```bash
LLM_PROVIDER=bedrock \
BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-6 \
AWS_PROFILE=cline-profile \
AWS_REGION=us-west-2 \
SCENARIOS_DIR=/path/to/scenarios \
npx tsx src/index.ts
```

The model ID must be the cross-region inference profile ARN format
(`us.anthropic.claude-sonnet-4-6`) — on-demand throughput is not supported for this model.

### Dirty Tick Re-trigger Fix
Previously: when a trainee action (chat message, @mention) arrived while an LLM call was
already in-flight, the action set `_dirty=true` but `triggerDirtyTick()` returned early.
When the in-flight call completed, `_dirty` was ignored — the pending action was silently dropped.
The LLM would only see it on the next game loop timer tick (~15 real seconds later).

Fix: the `.finally()` block in `triggerDirtyTick` now re-triggers immediately if `_dirty=true`
after the in-flight call resolves.

Also fixed: LLM-produced events (e.g. `send_message`) no longer set `_dirty=true` themselves,
which was causing double LLM calls on every dirty tick.

### @mention Cooldown Bypass
`silentUntilContacted` personas (David Park) were not responding to `@mentions` in public
channels. The eligibility check ran `silentUntilContacted` gate before the `directlyAddressed`
bypass — David was blocked before bypass could run.

Two fixes:
1. `_eligiblePersonas` now checks `directlyAddressed` first, before any gate
2. `handleChatMessage` sets `_personaCooldowns[personaId]` when a persona is @mentioned,
   so they stay eligible on subsequent ticks (not just the current dirty tick)

---

## Logging

Replaced all `console.*` calls with `pino` structured logger.

**Log levels:**
- `info` (default) — startup events, persona sends only. Silent during normal LLM operation.
- `debug` (`LOG_LEVEL=debug`) — LLM tick eligibility, call start/finish, tool call results
- `warn` — validation failures, context truncation, unknown tools
- `error` — LLM errors, unhandled exceptions

**Component field** on every log line: `loader`, `server`, `session-store`,
`stakeholder-engine`, `game-loop`.

**To monitor a live session:**
```bash
tmux capture-pane -t oncall -p | tail -40
```
Do NOT pipe through `tee` or redirect — this causes the tmux process to receive `C-c` on
tool call completion, killing the server.

---

## Server Engine Fixes

### Immediate First Tick
`game-loop.start()` now calls `tick()` synchronously before setting the interval. This fires
all `atSecond=0` scripted events (emails, chat messages, logs, alarms, deployments) immediately
when the session starts, so the SSE snapshot on first client connect is fully populated.
Previously the trainee saw empty tabs for up to 15 real seconds.

### ensureChannel
The conversation store `addChatMessage` only created a channel key when the first message
arrived. Channels with no messages until late in the sim (e.g. `#payments-eng` at t=180)
were invisible in the chat sidebar until that first message.

Fix: `populateInitialState` calls `store.ensureChannel(channel.name)` for all channels
declared in the scenario, so they appear from the start even if empty.

### Ticket Doubling Fix
`populateInitialState` was pre-seeding all tickets AND the scheduler was firing `ticket_created`
at `atSecond=0` on the immediate first tick — causing every ticket to appear twice.

Fix: `populateInitialState` only pre-seeds tickets with `atSecond < 0`. Tickets at `atSecond >= 0`
arrive exclusively via the scheduler's `ticket_created` event.

The fixture scenario's `ticket-001` was moved to `at_second: -1` (pre-incident ticket, already
open when the trainee starts). The payment scenario's `PAY-1042` stays at `at_second: -60`
for the same reason.

### Deployment Pre-seeding Removed
Deployments were pre-seeded in `populateInitialState` AND emitted by the scheduler on the
immediate first tick — causing duplication in the CI/CD tab. Fixed by removing deployments
from `populateInitialState`; the scheduler handles all deployments including historical ones
(negative `deployedAtSec`) on the first tick.

### add_ticket_comment Protocol Fix
Server `handleAction` for `add_ticket_comment` was reading `params.comment` (expected a full
`TicketComment` object) but the client sends `params.body` (a string). The guard
`if (ticketId && comment)` silently failed. Server now constructs the `TicketComment` from
`params.body` with a server-generated UUID.

### Action Field Rename
The REST `POST /api/sessions/:id/actions` body field was `type` but the server's action router
validated `action`. Fixed everywhere — client sends `{ action, params }`, tests updated.

---

## Wall-Clock Time

All timestamps in the UI now show wall-clock time (`19:07:42`) rather than sim-time offsets
(`T+00:03:42`). The server generates a `clockAnchorMs` (Unix ms for `simTime=0`) at session
creation and includes it in `SessionSnapshot`. By default this is `Date.now()` — the current
real time when the session starts.

**Rationale:** Real incidents show wall-clock times on all tooling. The trainee should not
know `T+00:00:00` is incident onset; they have to determine that themselves from the signals.

**Changes:**
- `SessionSnapshot.clockAnchorMs: number` added to shared types
- `SessionState.clockAnchorMs` in client context, initialised from snapshot
- `formatWallClock(simTime, anchorMs)` replaces `formatSimTime`
- `WallTimestamp` component reads `clockAnchorMs` from `useSession().state` directly
  (not via `useSimClock()` which has a rAF loop — safe for static timestamps in list items)
- `MetricChart` X-axis uses wall-clock `HH:MM` tick labels; `clockAnchorMs` is a prop
  (not from `useSimClock()`) to avoid rAF render-loop fighting Recharts `ResizeObserver`
- Metric chart X-axis uses a fixed 10-minute sliding window
  (`XAxis domain={[simTime-600, simTime]}`) so the line scrolls left as time advances
  rather than transforming/compressing

---

## UI Bug Fixes

### Email Unread State Resets on Tab Switch
`readIds` was local `useState` in `EmailTab`. When the trainee switched tabs, React unmounted
the component, destroying the set. On return, all emails appeared unread again.

Fix: `emailReadIds` and `emailSelectedThreadId` lifted to `SimShell` and passed as props.

### Chat Channel Resets on Tab Switch
Same cause: `activeChannel` was local `useState` in `ChatTab`. Unmounted on tab switch,
defaulted to first channel on return.

Fix: `chatActiveChannel` lifted to `SimShell`, passed as `activeChannel` prop.

### Chat Unread Badges Not Showing
`SimShell`'s `useEffect` for unread tracking had an empty body — it was a stub that was
never wired up. All four unread trackers (email, chat, alarms, tickets) were stubs.

Fix: Full unread tracking implemented in `SimShell`:
- Email: tracks `seenEmailIds` ref; new non-trainee emails add to `emailUnread` Set
- Chat: tracks `seenChatCounts` per channel; new non-trainee messages increment per-channel count
  if not on that channel; DMs also get unread badges
- Alarms: tracks firing alarm count; new alarms set `hasNewAlarm` when not on ops tab
- Tickets: tracks ticket count; new tickets increment `ticketUnread`
- CI/CD: tracks deployment version keys; new deployments increment `cicdUnread`

---

## First Scenario: payment-db-pool-exhaustion

A 15-minute training scenario simulating a DB connection pool exhaustion incident.

**Root cause:** A config typo in `v2.4.1` sets `MAX_DB_CONNECTIONS=5` instead of `50`. Under
normal load (~200 rps), the pool exhausts immediately. All requests queue and time out at the
30-second connection timeout.

**Personas:**
- Sara Chen (Staff SWE, Payments) — service owner, proactive, not silent-until-contacted
- David Park (DRE, Infrastructure) — silent-until-contacted, responds when paged or @mentioned

**Key diagnostic signals:** HikariCP pool stats logs (`idle=0, waiting=47`), CI/CD deployment
history (v2.4.1 deployed 20 minutes before onset), DB metrics (postgres-primary healthy,
contradicting the DB-problem hypothesis).

**Evaluation:**
- Relevant actions: `view_deployment_history`, `search_logs`, `read_wiki_page`, `trigger_rollback`
- Red herrings: `restart_service` (doesn't fix config), `suppress_alarm`, `scale_cluster`

---

## Test Results

```
Server:  615 / 615  (29 test files)
Client:  346 / 346  (27 test files)
Total:   961 / 961
```

---

## Known Issues Remaining

- `dmDispatched` ref in `ChatTab` resets if the component tree is fully unmounted (e.g. session
  expires and restarts). Not a real-session issue since the component stays mounted throughout.
- Post-action banner in CICDTab: 30s simTime-based dismiss not wired (deferred from 0008).
- Auto-scroll "N new entries" banner in Chat/Logs not implemented (deferred from 0008).
- Debrief narrative (Phase 9) still shows empty placeholder.
