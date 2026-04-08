# 0003 — Phase 4: Core Game Engine

**Date:** 2026-04-07
**Phase:** 4 — Core Game Engine
**Status:** Complete

---

## What Was Done

Implemented the six engine modules that form the runtime heart of each session. The game engine drives the sim clock, fires scripted events on schedule, tracks trainee actions, evaluates resolution criteria, and coordinates the stakeholder engine hook. All modules use dependency injection and are tested in isolation. The engine never makes LLM calls and never manages SSE connections — those are Phase 5 and Phase 6 responsibilities.

### `server/src/engine/sim-clock.ts`

Implements the `SimClock` interface:

- `getSimTime()` — current sim seconds since scenario start
- `tick(realElapsedMs)` — advances sim time by `realElapsedMs × speed / 1000`; no-op when paused
- `setSpeed(speed)` / `getSpeed()` — valid values: 1, 2, 5, 10
- `pause()` / `resume()` / `isPaused()`
- `toSimTimeEvent()` — returns a `sim_time` `SimEvent` for SSE broadcasting

The `TestSimClock` in `testutil/index.ts` implements the same interface with a manual `advance(simSeconds)` method, giving tests deterministic time control without real timers.

### `server/src/engine/event-scheduler.ts`

Fires pre-scripted events when sim time reaches their `at_second`:

- `tick(currentSimTime)` — returns all `ScriptedEvent[]` due at or before `currentSimTime`; marks each as fired so it never fires twice
- `reset()` — clears fired-event state
- Auto-page alarm expansion: `autoPage: true` alarms produce `alarm_fired` + a scripted email from `pagerduty-bot` + a scripted chat message, all in one `tick()` call

`ScriptedEvent` union covers: `email`, `chat_message`, `log_entry`, `alarm_fired`, `ticket`, `deployment`.

### `server/src/engine/audit-log.ts`

Append-only trainee action log:

- `record(action, params, simTime)` — appends entry; `simTime` is stamped at time of call
- `getAll()` — returns a copy; safe to hold a reference
- `getLast()` — most recent entry or null
- `getByAction(action)` — filtered copy

### `server/src/engine/conversation-store.ts`

In-memory store for all messages across all channels. The stakeholder engine reads from this to build LLM context. The SSE broker reads it to build `session_snapshot`.

Supports: chat (including DMs via `dm:<persona-id>` channel naming), email, tickets, ticket comments, logs, alarms, deployments.

All read methods return deep copies (`JSON.parse(JSON.stringify(...))`) so callers cannot accidentally mutate store state.

`snapshot()` — returns a `ConversationStoreSnapshot` which is a deep-copied point-in-time view of all state.

### `server/src/engine/evaluator.ts`

Checks the audit log against `evaluation.relevantActions` and `evaluation.redHerrings` after each trainee action:

- Relevant actions: matched on `action` type and optionally `service`; deduplicated (first occurrence only)
- Red herrings: matched on `action` type; deduplicated
- `resolved`: `true` when `mark_resolved` action appears in the audit log
- Returns `EvaluationState` — used by debrief after resolution, not for real-time scoring

### `server/src/engine/game-loop.ts`

Orchestrates everything. One instance per session.

#### Interface

- `start()` — begins the real-time `setInterval` tick loop
- `stop()` — stops the loop permanently (session ended)
- `pause()` / `resume()` — delegates to `SimClock`
- `setSpeed(speed)` — delegates to `SimClock`
- `handleAction(action, params)` — records in audit log, evaluates, updates conversation store for state-affecting actions, emits `SimEvent`(s), marks dirty, calls `onDirtyTick` immediately if not in-flight
- `handleChatMessage(channel, text)` — records `post_chat_message`, adds to conversation store, emits `chat_message` event; if channel is `dm:` and persona is `silentUntilContacted`, marks them engaged
- `handleEmailReply(threadId, body)` — records `reply_email`, adds to conversation store, emits `email_received` event
- `handleCoachMessage(message)` — appends to internal `coachMessages` array, emits `coach_message` event
- `getConversationSnapshot()` — returns point-in-time conversation store snapshot
- `getSnapshot()` — returns full `SessionSnapshot` including all pre-generated metrics
- `getEvaluationState()` — returns current evaluation state
- `onEvent(handler)` — registers SSE broadcast handler; **returns a `() => void` cleanup function** to remove the handler (improvement over LLD spec which specified `void` return; this was added to fix a resource leak found during Phase 6 validation)

#### `handleAction` state mutations

- `update_ticket` → `store.updateTicket(ticketId, changes)` + `ticket_updated` event
- `add_ticket_comment` → `store.addTicketComment(ticketId, comment)` + `ticket_comment` event
- `suppress_alarm` → `store.updateAlarmStatus(alarmId, 'suppressed')` + `alarm_silenced` event
- `ack_page` → `store.updateAlarmStatus(alarmId, 'acknowledged')` + `sim_time` event

#### Tick sequence

1. Advance sim clock
2. Fire due scripted events (scheduler → conversation store → emit via `onEvent`)
3. Broadcast `sim_time` event
4. If dirty AND stakeholder engine not in-flight: call `onDirtyTick(context)` async; set `inFlight=true`; on resolve, broadcast returned events, set `inFlight=false`
5. On coach tick interval (every ~3 stakeholder ticks): call `onCoachTick(context)` if registered; append to `coachMessages` array; emit `coach_message`

#### Dirty state rules

Session is marked dirty on: scripted event fires, trainee action recorded, stakeholder engine returns events.
Dirty flag is cleared when `onDirtyTick` starts. New actions during an in-flight call set dirty again, triggering another call on the next tick.

#### `StakeholderContext`

Exported from `game-loop.ts` for Phase 5 to consume:

```typescript
interface StakeholderContext {
  sessionId:        string
  scenario:         LoadedScenario
  simTime:          number
  auditLog:         AuditEntry[]
  conversations:    ConversationStoreSnapshot
  personaCooldowns: Record<string, number>
}
```

---

## Test Results

| File | Tests |
|---|---|
| `sim-clock.test.ts` | 11 |
| `event-scheduler.test.ts` | 9 |
| `audit-log.test.ts` | 8 |
| `conversation-store.test.ts` | 22 |
| `evaluator.test.ts` | 8 |
| `game-loop.test.ts` | 28 |
| **Total** | **86** |

- **Pass rate:** 86/86
- **Known failures:** None
- **Typecheck:** Clean
- **Lint:** Clean

---

## Known Issues

None.

---

## What Comes Next

Phase 5 — LLM Client and Stakeholder Engine: implement the provider abstraction, mock provider, tool definitions, and stakeholder engine tick logic.
