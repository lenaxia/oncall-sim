# LLD 09 — Coach and Debrief

**Phase:** 9
**Depends on:** Phase 1 (shared types, testutil), Phase 4 (game engine — EvaluationState, AuditLog), Phase 5 (LLM client), Phase 6 (REST API — coach route stub, DebriefResult, session resolve), Phase 7 (UI component library, CoachPanelShell, DebriefScreen shell), Phase 8 (SimShell, full session running)
**HLD sections:** §5.5, §7.2, §22

---

## Purpose

Implement the coach LLM integration (proactive nudges + on-demand help) and the full debrief screen (incident timeline, action comparison, LLM narrative). This is the final phase — it completes the `POST /api/sessions/:id/coach` route stub from Phase 6 and populates the `DebriefResult.narrative` that was an empty string until now.

---

## Scope

```
server/src/engine/
  coach-engine.ts           # coach LLM tick + on-demand response
  debrief-generator.ts      # debrief LLM call

server/src/routes/
  coach.ts                  # replaces Phase 6 stub — full implementation

client/src/components/
  CoachPanel.tsx            # fills CoachPanelShell with actual coach UI
  debrief/
    DebriefContent.tsx      # full debrief screen content — replaces the Phase 7 shell stub
    IncidentTimeline.tsx    # visual timeline of events + actions
    ActionSummary.tsx       # comparison table: trainee actions vs ideal
    DebriefNarrative.tsx    # renders LLM narrative
    AuditLogView.tsx        # expandable full audit log
```

`DebriefContent.tsx` is the full implementation that the Phase 7 `DebriefScreen.tsx` shell renders as its `children`. The shell handles layout and polling; `DebriefContent` handles the four content sections. This avoids naming collision and keeps Phase 7's shell intact.

---

## 1. Coach Engine (`engine/coach-engine.ts`)

The coach runs on its own slower tick cycle, independent of the stakeholder engine. It has read-only access to sim state and only writes to the coach panel — never to sim channels.

```typescript
export interface CoachEngine {
  // Called by the game loop on each coach tick (configurable interval, default 3x slower
  // than stakeholder tick). Returns a CoachMessage if the coach has something to say,
  // or null if not.
  proactiveTick(context: CoachContext): Promise<CoachMessage | null>

  // Called by the API when the trainee sends a message via the coach panel.
  // Returns the coach's response.
  respondToTrainee(
    message: string,
    context: CoachContext
  ): Promise<CoachMessage>
}

export interface CoachContext {
  sessionId:     string
  scenario:      LoadedScenario
  simTime:       number
  auditLog:      AuditEntry[]
  conversations: ConversationStoreSnapshot   // contains alarms, deployments, logs, chat, etc.
  metrics:       Record<string, Record<string, TimeSeriesPoint[]>>
}

export function createCoachEngine(llmClient: LLMClient, scenario: LoadedScenario): CoachEngine
```

### Coach tick sequence

```
proactiveTick(context):
  1. Check if enough sim time has passed since last proactive message
     (minimum interval: 180 sim-seconds between proactive messages)
  2. If too soon: return null

  3. Build prompt:
     SYSTEM: coach persona — experienced SRE mentor, supportive but direct,
             never gives away answers, nudges toward the right questions
     CONTEXT:
       - scenario root cause and relevant actions (from evaluation config)
       - current sim time
       - trainee audit log (what they have done)
       - conversation history summary
       - current metric state (what the dashboards show)
       - active alarms
     TOOLS: getCoachTools() (read-only — Phase 5)
     INSTRUCTION:
       "Should you say something proactive right now?
        If yes, return a brief coaching message (1-3 sentences, Slack-message length).
        If no, return an empty response.
        Do NOT give away the root cause. Ask questions, point at data."

  4. Call llmClient.call({ role: 'coach', ... })
     - On LLMError: log, return null (coach silently skips this tick)

  5. If response has text: return CoachMessage { id, text, simTime, proactive: true }
  6. If empty response: return null
```

### On-demand response sequence

```
respondToTrainee(message, context):
  1. Build prompt (same as proactive but includes the trainee's message as final user turn)
  2. Call llmClient.call({ role: 'coach', ... })
     - On LLMError: return a fallback message ("I'm having trouble responding right now")
  3. Return CoachMessage { id, text, simTime, proactive: false }
```

---

## 2. Game Loop Integration

The coach engine is wired into the game loop in the session factory (Phase 6). The game loop needs a second tick hook for the coach:

```typescript
// Addition to GameLoopDependencies in Phase 4 (game-loop.ts):
// Phase 9 adds this field — Phase 4 stub is undefined (no coach in Phase 4).
onCoachTick?: (context: CoachContext) => Promise<CoachMessage | null>
```

The game loop fires `onCoachTick` every N ticks (where N makes the coach tick interval ~3x the stakeholder interval). When `onCoachTick` returns a non-null `CoachMessage`, the game loop (as defined in Phase 4 §6 tick sequence):
- Appends the message to its internal `coachMessages` array
- Emits `coach_message` SSE event via `onEvent`
- `getSnapshot()` returns `coachMessages` from this array — reconnecting clients receive full history

The session factory in Phase 6 is updated to wire the coach hook in:

```typescript
// In createSession() (Phase 6 session.ts), updated in Phase 9:
const coachEngine = createCoachEngine(llmClient, scenario)

const gameLoop = createGameLoop({
  ...existingDeps,
  onCoachTick: (ctx) => coachEngine.proactiveTick(toCoachContext(ctx, metrics)),
})
```

`toCoachContext` maps `StakeholderContext` + session-level data to `CoachContext`. The game loop passes `StakeholderContext` to both hooks. The session factory provides the pre-generated `metrics` separately (they don't change during the session). Alarms, deployments, logs, and chat history are accessed via `context.conversations` (the conversation store snapshot).

```typescript
function toCoachContext(
  stakeholderCtx: StakeholderContext,
  metrics:        Record<string, Record<string, TimeSeriesPoint[]>>
): CoachContext {
  return {
    sessionId:     stakeholderCtx.sessionId,
    scenario:      stakeholderCtx.scenario,
    simTime:       stakeholderCtx.simTime,
    auditLog:      stakeholderCtx.auditLog,
    conversations: stakeholderCtx.conversations,
    metrics,
  }
}
```

---

## 3. Coach Route (`routes/coach.ts`)

Replaces the Phase 6 501 stub with the full implementation.

```typescript
// POST /api/sessions/:id/coach
// Body: { message: string }
// Calls coachEngine.respondToTrainee(), broadcasts coach_message SSE event,
// returns { message: CoachMessage }.
router.post('/:id/coach', async (req, res) => {
  const session = sessionStore.get(req.params.id)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  if (session.status !== 'active') return res.status(409).json({ error: 'Session not active' })

  const { message } = req.body
  // Build coach context from the session's current game loop state
  const snap         = session.gameLoop.getSnapshot()
  const coachContext: CoachContext = {
    sessionId:     session.id,
    scenario:      session.scenario,
    simTime:       snap.simTime,
    auditLog:      snap.auditLog,
    conversations: session.gameLoop.getConversationSnapshot(),
    metrics:       snap.metrics,
  }
  const response = await session.coachEngine.respondToTrainee(message, coachContext)

  // Game loop owns coach messages — route delegates appending and broadcasting
  // by calling handleCoachMessage which appends to the internal array and emits SSE
  session.gameLoop.handleCoachMessage(response)

  res.json({ message: response })
})
```

`Session` model (Phase 6) gains one new field in Phase 9:
```typescript
// Added to Session interface in Phase 9:
coachEngine: CoachEngine
// coachMessages is NOT on Session — it is owned by the game loop
// and returned via gameLoop.getSnapshot().coachMessages
```

---

## 4. Debrief Generation

Phase 6's `POST /api/sessions/:id/resolve` fires async debrief generation. In Phase 6 this was a stub returning an empty narrative. Phase 9 provides the full implementation.

```typescript
// server/src/engine/debrief-generator.ts  (new in Phase 9)

export async function generateDebrief(
  session:   Session,
  llmClient: LLMClient
): Promise<DebriefResult> {
  const evaluationState = session.gameLoop.getEvaluationState()
  const auditLog        = session.gameLoop.getSnapshot().auditLog
  const snapshot        = session.gameLoop.getSnapshot()

  const prompt = buildDebriefPrompt({
    evaluation:      session.scenario.evaluation,
    evaluationState,
    auditLog,
    conversations:   snapshot,
    simTime:         snapshot.simTime,
  })

  const response = await llmClient.call({
    role:     'debrief',
    messages: prompt,
    tools:    [],          // debrief uses no tools — all data injected into prompt
    sessionId: session.id,
  })

  return {
    narrative:         response.text ?? '',
    evaluationState,
    auditLog,
    resolvedAtSimTime: snapshot.simTime,
  }
}

function buildDebriefPrompt(params: DebriefPromptParams): LLMMessage[] {
  return [
    {
      role:    'system',
      content: 'You are an experienced SRE providing post-incident feedback to an engineer in training. Be honest, specific, and constructive.',
    },
    {
      role:    'user',
      content: `
INCIDENT ROOT CAUSE:
${params.evaluation.rootCause}

IDEAL RESPONSE PATH:
${params.evaluation.relevantActions.map(a => `- ${a.action}: ${a.why}`).join('\n')}

RED HERRINGS (common mistakes):
${params.evaluation.redHerrings.map(a => `- ${a.action}: ${a.why}`).join('\n')}

DEBRIEF CONTEXT:
${params.evaluation.debriefContext}

TRAINEE AUDIT LOG (what they actually did):
${params.auditLog.map(e => `T+${formatSimTime(e.simTime)}: ${e.action} ${JSON.stringify(e.params)}`).join('\n')}

RELEVANT ACTIONS TAKEN: ${params.evaluationState.relevantActionsTaken.map(a => a.action).join(', ') || 'none'}
RED HERRINGS TAKEN: ${params.evaluationState.redHerringsTaken.map(a => a.action).join(', ') || 'none'}
RESOLVED AT: T+${formatSimTime(params.simTime)}

Write a 3-5 paragraph debrief structured as:
1. What the incident was and what caused it
2. What the trainee did well
3. What an experienced SRE would have done differently
4. Key things to watch for in future incidents of this type
      `.trim(),
    },
  ]
}
```

---

## 5. Coach Panel UI (`components/CoachPanel.tsx`)

Fills the `CoachPanelShell` from Phase 7 with actual coach UI content.

```typescript
export function CoachPanel(): JSX.Element
```

**Data:** reads `snapshot.coachMessages` from `useSession()`.

**Layout:**
```
┌────────────────────────────────┐
│ Coach             [×]          │
├────────────────────────────────┤
│ T+00:03:00  [proactive]        │
│ You've been in the logs for    │
│ a while. Have you checked      │
│ the CI/CD tab?                 │
│                                │
│ T+00:05:30  [you asked]        │
│ What should I look for?        │
│                                │
│ T+00:05:31  [coach]            │
│ Look at deployment timestamps  │
│ relative to when errors began. │
├────────────────────────────────┤
│ ┌──────────────────────────┐   │
│ │ Ask the coach...         │   │
│ └──────────────────────────┘   │
│                       [Send]   │
└────────────────────────────────┘
```

**On send:** calls `POST /api/sessions/:id/coach` with the message text. The response is a `CoachMessage` which the server also broadcasts via SSE — the `SessionContext` `coach_message` handler appends it to `snapshot.coachMessages`, updating the UI.

**Notification badge:** unread coach messages (proactive ones that arrived while panel was closed) drive the badge on `CoachPanelShell`.

---

## 6. Debrief Screen UI

Fills the `DebriefScreen` shell from Phase 7 with full content via the `children` prop.

### `DebriefContent.tsx`

```typescript
interface DebriefContentProps {
  sessionId: string
}

export function DebriefContent({ sessionId }: DebriefContentProps): JSX.Element
```

Polls `GET /api/sessions/:id/debrief` every 2 seconds until 200. Shows loading state while waiting. On 200, renders all four sub-components inside the Phase 7 `DebriefScreen` shell.

### `IncidentTimeline.tsx`

```typescript
interface IncidentTimelineProps {
  auditLog:  AuditEntry[]
  simTime:   number   // resolved at time
}
export function IncidentTimeline(props: IncidentTimelineProps): JSX.Element
```

Renders a horizontal timeline. Each entry is a dot with a tooltip showing the action type, params, and sim timestamp. Trainee actions in one color, scripted events (from audit log entries tagged as scripted) in another.

### `ActionSummary.tsx`

```typescript
interface ActionSummaryProps {
  evaluationState: EvaluationState
  scenario:        LoadedScenario
}
export function ActionSummary(props: ActionSummaryProps): JSX.Element
```

Two-column table:

| Ideal action | Trainee did this? | When |
|---|---|---|
| view_logs | ✅ | T+00:01:12 |
| view_deployment_history | ✅ | T+00:06:00 |
| trigger_rollback (payment-service) | ✅ | T+00:08:20 |
| monitor_recovery | ❌ | — |

Red herrings section below:

| Red herring | Trainee fell for it? |
|---|---|
| trigger_rollback (fraud-detection) | ❌ |

### `DebriefNarrative.tsx`

```typescript
interface DebriefNarrativeProps {
  narrative: string   // LLM-generated markdown
}
export function DebriefNarrative(props: DebriefNarrativeProps): JSX.Element
```

Renders the LLM narrative using `MarkdownRenderer`. The narrative is markdown from the LLM.

### `AuditLogView.tsx`

```typescript
interface AuditLogViewProps {
  auditLog: AuditEntry[]
}
export function AuditLogView(props: AuditLogViewProps): JSX.Element
```

Expandable/collapsible table of every trainee action with sim timestamp and params. Collapsed by default.

---

## 7. Test Strategy

### `coach-engine.test.ts`

```
proactiveTick:
  - returns null when called before minimum interval has elapsed
  - returns CoachMessage when LLM returns text
  - returns null when LLM returns empty response
  - returns null on LLMError (never throws)
  - proactive: true on returned message

respondToTrainee:
  - returns CoachMessage with proactive: false
  - on LLMError: returns fallback message (never throws)
  - trainee message included in prompt context
```

### `debrief-generator.test.ts`

```
generateDebrief:
  - returns DebriefResult with narrative from LLM response
  - evaluationState populated from game loop
  - auditLog populated from game loop snapshot
  - resolvedAtSimTime correct
  - on LLMError: returns DebriefResult with empty narrative (never throws)
```

### `routes/coach.test.ts` (integration)

```
POST /api/sessions/:id/coach:
  - 200 with CoachMessage on valid request
  - 404 for unknown session
  - 409 for resolved session
  - coach_message SSE event broadcast to session connections
```

### Client tests

```
CoachPanel:
  - renders proactive messages from snapshot.coachMessages
  - send button calls POST /api/sessions/:id/coach
  - response appended to message list
  - unread badge count matches unread proactive messages

DebriefScreen:
  - shows loading state while polling
  - renders all four sections when debrief is ready
  - IncidentTimeline renders correct number of entries
  - ActionSummary shows ✅ for taken relevant actions
  - ActionSummary shows ❌ for missed relevant actions
  - DebriefNarrative renders markdown
  - AuditLogView is collapsed by default, expands on click
```

---

## 8. Definition of Done

- [ ] `CoachEngine` with proactive and on-demand modes implemented
- [ ] Coach tick wired into game loop via `onCoachTick` hook
- [ ] `POST /api/sessions/:id/coach` route fully implemented (replaces 501 stub)
- [ ] `Session` model updated with `coachEngine` field (coachMessages owned by game loop, not Session)
- [ ] `generateDebrief` produces a full `DebriefResult` with LLM narrative
- [ ] `DebriefResult.narrative` is no longer an empty stub
- [ ] `CoachPanel` renders coach messages and supports on-demand questions
- [ ] `DebriefContent` polls and renders all four content sections inside Phase 7 `DebriefScreen` shell
- [ ] Coach never posts to sim channels — only to coach panel
- [ ] All tests in §7 pass using `testutil` helpers
- [ ] No `any` types
