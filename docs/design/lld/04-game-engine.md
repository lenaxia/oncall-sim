# LLD 04 — Core Game Engine

**Phase:** 4
**Depends on:** Phase 1 (shared types, scenario config types, testutil), Phase 3 (scenario loader, LoadedScenario)
**HLD sections:** §6.3, §6.4, §9, §10, §17, §18

---

## Purpose

The game engine is the runtime heart of each session. It drives the sim clock forward, fires scripted events on schedule, tracks dirty state, records trainee actions in the audit log, and evaluates resolution criteria. It does NOT make LLM calls (that is the stakeholder engine in Phase 5) and does NOT manage SSE connections (that is the API layer in Phase 6). It is designed for dependency injection so every component can be tested in isolation.

---

## Scope

```
server/src/engine/
  sim-clock.ts          # sim time management
  event-scheduler.ts    # fires scripted events at the right sim time
  audit-log.ts          # append-only trainee action log
  conversation-store.ts # in-memory store for all messages across all channels
  evaluator.ts          # checks audit log against evaluation criteria
  game-loop.ts          # tick loop orchestrator — calls all of the above
```

The stakeholder engine (`stakeholder-engine.ts`) is added in Phase 5. The game loop has a placeholder hook for it in this phase.

---

## 1. SimClock (`sim-clock.ts`)

The sim clock is the single source of truth for simulated time. The server owns it; the client only displays what it receives.

```typescript
export interface SimClock {
  // Current sim time in seconds since scenario start (t=0)
  getSimTime(): number

  // Advance sim time by the given number of real milliseconds × speed multiplier
  tick(realElapsedMs: number): void

  // Set speed. Valid values: 1 | 2 | 5 | 10
  setSpeed(speed: 1 | 2 | 5 | 10): void
  getSpeed(): 1 | 2 | 5 | 10

  // Pause/resume. While paused, tick() is a no-op.
  pause(): void
  resume(): void
  isPaused(): boolean

  // Returns a sim_time SimEvent for broadcasting to the client
  toSimTimeEvent(): Extract<SimEvent, { type: 'sim_time' }>
}

export function createSimClock(initialSpeed?: 1 | 2 | 5 | 10): SimClock
```

`TestSimClock` (defined in Phase 1 testutil) implements this interface with an `advance(simSeconds)` method for deterministic test control.

---

## 2. EventScheduler (`event-scheduler.ts`)

Fires pre-scripted events when sim time reaches their `at_second` (mapped from YAML `onset_second` / `at_second` fields). Each event fires exactly once — the scheduler tracks which have already fired.

```typescript
export interface EventScheduler {
  // Check current sim time against pending events.
  // Returns all events that are due at or before currentSimTime.
  // Marks each returned event as fired so it will not be returned again.
  tick(currentSimTime: number): ScriptedEvent[]

  // Reset all fired-event state (used when restarting a scenario)
  reset(): void
}

export function createEventScheduler(scenario: LoadedScenario): EventScheduler

// Union of all scriptable event types — each maps to one or more SimEvents
export type ScriptedEvent =
  | { kind: 'email';        simTime: number; email: EmailMessage }
  | { kind: 'chat_message'; simTime: number; channel: string; message: ChatMessage }
  | { kind: 'log_entry';    simTime: number; entry: LogEntry }
  | { kind: 'alarm_fired';  simTime: number; alarm: Alarm }
  | { kind: 'ticket';       simTime: number; ticket: Ticket }
  | { kind: 'deployment';   simTime: number; service: string; deployment: Deployment }
```

Auto-page alarms (`autoPage: true`) produce both an `alarm_fired` event AND a scripted email and chat message automatically — the scheduler handles this expansion, not the caller.

---

## 3. AuditLog (`audit-log.ts`)

Append-only log of all trainee actions with sim timestamps. Shared between the game loop, stakeholder engine, and evaluator.

```typescript
export interface AuditLog {
  // Append an action. simTime is stamped at time of call.
  record(action: ActionType, params: Record<string, unknown>, simTime: number): void

  // Return all entries. Returns a copy — safe to hold a reference.
  getAll(): AuditEntry[]

  // Return the most recent entry, or null if empty.
  getLast(): AuditEntry | null

  // Return all entries of a specific action type.
  getByAction(action: ActionType): AuditEntry[]
}

export function createAuditLog(): AuditLog
```

---

## 4. ConversationStore (`conversation-store.ts`)

In-memory store of all messages across all channels (chat channels, DM channels, email threads, ticket comments). The stakeholder engine reads from this to build LLM context. The SSE broker reads from this to build `session_snapshot`.

```typescript
export interface ConversationStore {
  // Chat (includes DMs — channel naming: 'dm:<persona-id>')
  addChatMessage(channel: string, message: ChatMessage): void
  getChatChannel(channel: string): ChatMessage[]
  getAllChatChannels(): Record<string, ChatMessage[]>

  // Email
  addEmail(email: EmailMessage): void
  getEmailThread(threadId: string): EmailMessage[]
  getAllEmails(): EmailMessage[]

  // Tickets
  addTicket(ticket: Ticket): void
  updateTicket(ticketId: string, changes: Partial<Ticket>): void
  addTicketComment(ticketId: string, comment: TicketComment): void
  getTicket(ticketId: string): Ticket | null
  getAllTickets(): Ticket[]
  getTicketComments(ticketId: string): TicketComment[]

  // Logs
  addLogEntry(entry: LogEntry): void
  getAllLogs(): LogEntry[]

  // Alarms
  addAlarm(alarm: Alarm): void
  updateAlarmStatus(alarmId: string, status: AlarmStatus): void
  getAllAlarms(): Alarm[]

  // Deployments
  addDeployment(service: string, deployment: Deployment): void
  getDeployments(service: string): Deployment[]
  getAllDeployments(): Record<string, Deployment[]>

  // Snapshot — returns a point-in-time copy of all state
  // Safe to call concurrently with writes (returns snapshot, not live reference)
  snapshot(): ConversationStoreSnapshot
}

// Subset of SessionSnapshot containing only conversation-store-managed state
export interface ConversationStoreSnapshot {
  emails:         EmailMessage[]
  chatChannels:   Record<string, ChatMessage[]>
  tickets:        Ticket[]
  ticketComments: Record<string, TicketComment[]>
  logs:           LogEntry[]
  alarms:         Alarm[]
  deployments:    Record<string, Deployment[]>
}

export function createConversationStore(): ConversationStore
```

---

## 5. Evaluator (`evaluator.ts`)

Checks the audit log against the scenario's `evaluation.relevantActions` and `evaluation.redHerrings` after each trainee action. Results are used by the debrief LLM — not for real-time scoring.

```typescript
export interface Evaluator {
  // Called after each trainee action is recorded.
  // Returns updated evaluation state — the game loop can broadcast this if needed.
  evaluate(auditLog: AuditLog, scenario: LoadedScenario): EvaluationState
}

export interface EvaluationState {
  relevantActionsTaken: Array<{
    action:    string
    service?:  string
    why:       string
    takenAt:   number   // sim seconds
  }>
  redHerringsTaken: Array<{
    action:   string
    why:      string
    takenAt:  number
  }>
  // True when mark_resolved action has been taken
  resolved: boolean
}

export function createEvaluator(): Evaluator
```

---

## 6. GameLoop (`game-loop.ts`)

Orchestrates everything. One instance per session. Manages the real-time tick interval and coordinates all engine components.

```typescript
export interface GameLoop {
  // Start the loop. Fires ticks at the configured interval.
  start(): void

  // Stop the loop permanently (session ended).
  stop(): void

  // Pause/resume the sim clock only. Loop continues running.
  pause(): void
  resume(): void

  setSpeed(speed: 1 | 2 | 5 | 10): void

  // Called by the API layer when a trainee action arrives.
  // Records in audit log, evaluates, marks dirty.
  // page_user: creates a PageAlert, stores it, emits page_sent event, marks persona engaged.
  handleAction(action: ActionType, params: Record<string, unknown>): void

  // Called by the API layer when a trainee posts a chat message.
  // Records post_chat_message action, adds to conversation store, emits chat_message event.
  // If channel starts with 'dm:' and the persona is silent_until_contacted, marks them engaged.
  handleChatMessage(channel: string, text: string): void

  // Called by the API layer when a trainee replies to an email.
  // Records reply_email action, adds to conversation store, emits email_received event.
  handleEmailReply(threadId: string, body: string): void

  // Returns a point-in-time snapshot of the conversation store.
  // Used by the coach route (Phase 9) to build CoachContext without a StakeholderContext.
  getConversationSnapshot(): ConversationStoreSnapshot

  // Called by the coach route (Phase 9) when the trainee gets an on-demand coach response.
  // Appends the message to the internal coachMessages array and emits coach_message SSE event.
  // Mirrors what onCoachTick does for proactive messages.
  handleCoachMessage(message: CoachMessage): void

  // Returns a full SessionSnapshot for SSE reconnection.
  // coachMessages is populated by the onCoachTick hook — starts as [] in Phase 4,
  // appended to by the game loop whenever onCoachTick returns a non-null CoachMessage.
  // This ensures reconnecting clients receive the full coach message history.
  getSnapshot(): SessionSnapshot

  // Current evaluation state — used by debrief after resolution.
  getEvaluationState(): EvaluationState

  // Returns the simulation event log for use in the debrief timeline.
  // Contains all significant SimEvents (excludes sim_time heartbeats and session_snapshot).
  // Capped at 500 entries. Used by the resolve route to populate DebriefResult.eventLog.
  getEventLog(): SimEventLogEntry[]

  // Register a callback invoked with each SimEvent produced by the loop.
  // Returns a cleanup function — call it to unregister the handler (prevents resource leak).
  onEvent(handler: (event: SimEvent) => void): () => void
}

export interface GameLoopDependencies {
  scenario:     LoadedScenario
  sessionId:    string
  clock:        SimClock
  scheduler:    EventScheduler
  auditLog:     AuditLog
  store:        ConversationStore
  evaluator:    Evaluator
  metrics:      Record<string, Record<string, TimeSeriesPoint[]>>   // pre-generated
  // Stakeholder engine hook — called on dirty ticks (Phase 5 fills this in)
  // Returns SimEvents produced by the stakeholder engine so the game loop
  // can broadcast them via onEvent.
  // In Phase 4 this is a no-op stub returning Promise<[]>.
  onDirtyTick?: (context: StakeholderContext) => Promise<SimEvent[]>
  // Coach engine hook — called on coach ticks (Phase 9 fills this in)
  // Returns a CoachMessage if the coach has something to say, or null if not.
  // In Phase 4 this is a no-op stub returning Promise<null>.
  onCoachTick?: (context: StakeholderContext) => Promise<CoachMessage | null>
}

export function createGameLoop(deps: GameLoopDependencies): GameLoop
```

### Tick sequence

```
tick():
  1. Advance sim clock: clock.tick(realElapsedMs)
  2. Fire due scripted events: scheduler.tick(clock.getSimTime())
     - For each ScriptedEvent: add to conversation store + emit SimEvent via onEvent
     - Mark session dirty
  3. Broadcast sim_time event: emit clock.toSimTimeEvent()
  4. If dirty AND stakeholder engine not in-flight:
     - Call onDirtyTick(context) — async, does not block tick
     - Set inFlight = true; clear dirty flag
     - onDirtyTick resolves with SimEvent[]:
         - broadcast each returned event via onEvent
         - if any events returned → mark dirty again (stakeholders spoke)
         - set inFlight = false
  5. On coach tick interval (every ~3 stakeholder ticks):
     - Call onCoachTick(context) if registered
     - If returns non-null CoachMessage:
         - append to internal coachMessages array
         - emit coach_message SimEvent via onEvent
     - On error: log and continue (never throws)
```

### Dirty state rules

Session is marked dirty when:
- A scripted event fires
- A trainee action is recorded via `handleAction`
- The stakeholder engine injects one or more messages (Phase 5)

Session dirty flag is cleared when the stakeholder engine call starts. If another action arrives while the call is in-flight, dirty is set again and the next tick will trigger another call.

### `handleAction` sequence

```
handleAction(action, params):
  1. Record in auditLog with current sim time
  2. Evaluate: evaluator.evaluate(auditLog, scenario)
  3. Update conversation store if action affects visible state:
     - update_ticket → store.updateTicket(...)
     - add_ticket_comment → store.addTicketComment(...)
     - suppress_alarm → store.updateAlarmStatus(alarmId, 'suppressed')
     - ack_page → store.updateAlarmStatus(alarmId, 'acknowledged')
     - page_user → store.addPage(PageAlert); emit page_sent event; mark persona engaged
  4. Emit corresponding SimEvent(s) via onEvent
  5. Emit sim_time event (keeps client clock in sync)
  6. Mark session dirty
  7. If onDirtyTick registered AND not in-flight: call immediately (bypass tick timer)
```

---

## 7. StakeholderContext

The context payload passed to the stakeholder engine hook on each dirty tick. Defined here as it is assembled by the game loop; the stakeholder engine (Phase 5) consumes it.

```typescript
export interface StakeholderContext {
  sessionId:       string
  scenario:        LoadedScenario
  simTime:         number
  auditLog:        AuditEntry[]
  conversations:   ConversationStoreSnapshot
  personaCooldowns: Record<string, number>   // personaId → last-spoke simTime
}
```

---

## 8. Test Strategy

All tests use `buildTestClock`, `buildTestSession`, `buildAuditLog`, `expectEvent`, and `expectAction` from `testutil`. The `onDirtyTick` hook is always a no-op stub in Phase 4 tests.

### `sim-clock.test.ts`

```
createSimClock:
  - getSimTime() starts at 0
  - tick(1000) at speed=1 advances simTime by 1
  - tick(1000) at speed=10 advances simTime by 10
  - pause() → tick() is a no-op
  - resume() → tick() advances again
  - setSpeed changes subsequent ticks
  - toSimTimeEvent() returns correct simTime, speed, paused values
```

### `event-scheduler.test.ts`

```
createEventScheduler:
  - events at t=0 are returned on first tick with simTime=0
  - events at t=30 are not returned until simTime >= 30
  - each event returned exactly once (not on subsequent ticks)
  - auto_page alarm fires email + chat message + alarm_fired event
  - reset() causes events to fire again from the start
  - multiple events at same t all returned in same tick call
```

### `audit-log.test.ts`

```
createAuditLog:
  - record() appends entry with correct action and simTime
  - getAll() returns entries in insertion order
  - getAll() returns a copy — mutations do not affect the log
  - getLast() returns most recent entry, null on empty log
  - getByAction() filters correctly
```

### `conversation-store.test.ts`

```
chat:
  - addChatMessage adds to correct channel
  - getChatChannel returns messages in insertion order
  - unknown channel returns empty array

email:
  - addEmail stored and retrievable by threadId
  - getAllEmails returns all emails

tickets:
  - addTicket stored and retrievable
  - updateTicket merges changes — does not replace entire ticket
  - addTicketComment stored under correct ticketId

alarms:
  - addAlarm stores with status='firing'
  - updateAlarmStatus changes status only

snapshot:
  - returns deep copy — mutations to returned snapshot do not affect store
```

### `evaluator.test.ts`

```
createEvaluator:
  - relevant action in audit log → appears in relevantActionsTaken
  - red herring in audit log → appears in redHerringsTaken
  - mark_resolved action → resolved=true
  - action not in either list → ignored silently
  - same action taken twice → appears once in relevantActionsTaken (deduped)
```

### `game-loop.test.ts`

```
tick sequence:
  - scripted event at t=0 fires on first tick
  - scripted event at t=30 does not fire until simTime >= 30
  - onDirtyTick called after scripted event fires
  - onDirtyTick NOT called on clean tick
  - inFlight=true prevents second concurrent onDirtyTick call
  - inFlight clears after onDirtyTick resolves

handleAction:
  - action recorded in auditLog
  - correct SimEvent emitted via onEvent
  - session marked dirty after action
  - onDirtyTick called immediately if not in-flight

getSnapshot:
  - returns SessionSnapshot with correct sessionId, scenarioId, simTime
  - metrics field matches pre-generated metrics passed in dependencies
  - chatChannels, emails, tickets reflect current conversation store state

pause/resume:
  - pause() stops sim time advancing
  - resume() resumes sim time advancing
  - setSpeed changes tick rate
```

---

## 9. Definition of Done

- [ ] All six engine modules implemented with no `any`
- [ ] `SimClock` interface implemented with `createSimClock` factory
- [ ] `TestSimClock` in `testutil` implements `SimClock` interface
- [ ] `onDirtyTick` hook is a typed no-op stub in Phase 4 — Phase 5 fills it
- [ ] `StakeholderContext` exported from `game-loop.ts` for Phase 5 to consume
- [ ] `getSnapshot()` returns a `SessionSnapshot` matching the shape in Phase 1
- [ ] All tests in §8 pass using `testutil` helpers
- [ ] No `any` types
