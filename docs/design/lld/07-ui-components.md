# LLD 07 — UI Component Library

> **⚠ SUPERSEDED**
> This document has been replaced by `docs/design/ui-spec.md`, which went through nine
> revision passes after this LLD was written. `ui-spec.md` is the authoritative
> implementation reference for Phase 7 and Phase 8.
>
> **Do not implement from this file.** The following are known conflicts with `ui-spec.md`:
> - `AuditContext` is eliminated — audit log lives in `SessionState.auditLog` via SSE
> - `SessionState` shape is flat (not nested under `snapshot`)
> - `SessionProvider` requires `onError`, `onExpired`, `onDebriefReady` props (missing here)
> - `Badge` variants are `sev1/sev2/sev3/sev4` (not `critical/warning`); `count` prop removed
> - Design token set is incomplete — half the tokens defined in `ui-spec.md §2` are absent
> - `DebriefScreen` is fully specified in `ui-spec.md §8.15` (not a Phase 9 placeholder)
> - `useSSE` takes a `UseSSEOptions` object (not bare parameters)
>
> This file is retained as a historical record of original intent only.

**Phase:** 7
**Depends on:** Phase 1 (shared types — `SimEvent`, `SessionSnapshot`, `ActionType`, etc.)
**Can run in parallel with:** Phases 4–6
**HLD sections:** §5.1, §5.2, §5.3, §5.4, §5.5

---

## Purpose

Define and implement the reusable React component library and shared client infrastructure that all sim tabs (Phase 8) and the coach/debrief screens (Phase 9) build on. Establishes design tokens, primitives, hooks, and context providers. No tab-specific logic lives here.

---

## Scope

```
client/src/
  context/
    SessionContext.tsx     # active session state (SSE events → React state)
    ScenarioContext.tsx     # loaded scenario metadata
    AuditContext.tsx        # local audit action dispatch

  hooks/
    useSSE.ts              # SSE connection lifecycle + reconnect
    useSimClock.ts         # local interpolated sim clock display

  components/
    TabBar.tsx
    SpeedControl.tsx
    ScenarioPicker.tsx
    SimShell.tsx           # top-level layout: tabs + coach panel slot
    CoachPanelShell.tsx    # slide-out panel structure (content in Phase 9)
    DebriefScreen.tsx      # debrief layout shell (content in Phase 9)

    # Primitives
    Button.tsx
    Badge.tsx
    Panel.tsx
    Modal.tsx
    Spinner.tsx
    EmptyState.tsx
    MarkdownRenderer.tsx   # renders markdown body/description fields
    Timestamp.tsx          # formats sim seconds into HH:MM:SS display
```

---

## 1. Context Architecture

Three contexts cover all client state. Components import only what they need.

### `SessionContext.tsx`

Holds the full live sim state. Populated from the `session_snapshot` event on connect and updated incrementally by subsequent SSE events. All tab components read from this context.

```typescript
interface SessionState {
  sessionId:    string | null
  snapshot:     SessionSnapshot | null
  connected:    boolean
  reconnecting: boolean
  // Latest sim_time values — updated by sim_time SSE events independently of snapshot
  // so useSimClock can read them without scanning snapshot on every heartbeat
  simTime:      number
  speed:        1 | 2 | 5 | 10
  paused:       boolean
}

interface SessionContextValue {
  state:        SessionState
  // Dispatch an action to the server and record it locally in AuditContext.
  // Calls POST /api/sessions/:id/actions, then calls AuditContext.record.
  // Both happen regardless of server response — optimistic local recording.
  dispatchAction(action: ActionType, params: Record<string, unknown>): Promise<void>
  // Post a chat message. Calls POST /api/sessions/:id/chat.
  postChatMessage(channel: string, text: string): Promise<void>
  // Reply to an email. Calls POST /api/sessions/:id/email/reply.
  replyEmail(threadId: string, body: string): Promise<void>
  // Mark resolved. Calls POST /api/sessions/:id/resolve.
  resolve(): Promise<void>
  // Set speed/pause. Calls POST /api/sessions/:id/speed.
  setSpeed(speed: 1 | 2 | 5 | 10): Promise<void>
  setPaused(paused: boolean): Promise<void>
}

export const SessionContext = React.createContext<SessionContextValue>(...)
export function SessionProvider({ sessionId, children }: { sessionId: string, children: React.ReactNode }): JSX.Element
export function useSession(): SessionContextValue
```

State update logic — how each `SimEvent` type mutates the snapshot:

```typescript
// Applied inside SessionProvider's SSE event handler:
switch (event.type) {
  case 'session_snapshot':
    setState(prev => ({ ...prev, snapshot: event.snapshot, connected: true }))

  case 'chat_message':
    setState(prev => ({
      ...prev,
      snapshot: {
        ...prev.snapshot!,
        chatChannels: {
          ...prev.snapshot!.chatChannels,
          [event.channel]: [...(prev.snapshot!.chatChannels[event.channel] ?? []), event.message],
        },
      },
    }))

  case 'email_received':
    setState(prev => ({
      ...prev,
      snapshot: {
        ...prev.snapshot!,
        emails: [...prev.snapshot!.emails, event.email],
      },
    }))

  case 'log_entry':
    setState(prev => ({
      ...prev,
      snapshot: {
        ...prev.snapshot!,
        logs: [...prev.snapshot!.logs, event.entry],
      },
    }))

  case 'alarm_fired':
    setState(prev => ({
      ...prev,
      snapshot: {
        ...prev.snapshot!,
        alarms: [...prev.snapshot!.alarms, event.alarm],
      },
    }))

  case 'alarm_silenced':
    setState(prev => ({
      ...prev,
      snapshot: {
        ...prev.snapshot!,
        alarms: prev.snapshot!.alarms.map(a =>
          a.id === event.alarmId ? { ...a, status: 'suppressed' } : a
        ),
      },
    }))

  case 'ticket_created':
    // ... add to tickets array

  case 'ticket_updated':
    // ... merge changes into existing ticket

  case 'ticket_comment':
    // ... add to ticketComments[ticketId]

  case 'deployment_update':
    // ... update deployments[service]

  case 'sim_time':
    // Updates simTime/speed/paused in SessionState directly — does not mutate snapshot.
    // useSimClock reads from these fields.
    setState(prev => ({
      ...prev,
      simTime: event.simTime,
      speed:   event.speed,
      paused:  event.paused,
    }))

  case 'session_expired':
    // Navigate to scenario picker — handled by App.tsx

  case 'debrief_ready':
    // Navigate to debrief screen — handled by App.tsx

  case 'coach_message':
    setState(prev => ({
      ...prev,
      snapshot: {
        ...prev.snapshot!,
        coachMessages: [...prev.snapshot!.coachMessages, event.message],
      },
    }))
}
```

### `ScenarioContext.tsx`

Holds the scenario metadata loaded at session start (for display in the UI — scenario title, service type, topology). Populated once and never updated during the session.

```typescript
interface ScenarioContextValue {
  scenarioId:  string | null
  title:       string | null
  serviceType: ServiceType | null
  topology:    TopologyConfig | null
  // wikiPages populated in Phase 8 when full scenario config is fetched at session start
  wikiPages:   Array<{ title: string; content: string }>
}

export function useScenario(): ScenarioContextValue
```

### `AuditContext.tsx`

Client-side audit log tracking. Records actions dispatched by the trainee for local display in the debrief screen without waiting for a server round-trip.

```typescript
interface AuditContextValue {
  localAuditLog: AuditEntry[]
  record(action: ActionType, params: Record<string, unknown>): void
}

export function useAudit(): AuditContextValue
```

---

## 2. Hooks

### `useSSE.ts`

```typescript
// Establishes and maintains an SSE connection for the given session.
// Calls onEvent for each received SimEvent.
// Handles reconnection with exponential backoff: 1s, 2s, 4s, max 30s.
export function useSSE(
  sessionId: string,
  onEvent:   (event: SimEvent) => void
): {
  connected:    boolean
  reconnecting: boolean
}
```

Internally uses the browser `EventSource` API. On disconnect, sets `reconnecting: true` and starts backoff. On reconnect, `session_snapshot` resets all state (handled by `SessionContext`). Cleanup on unmount closes the `EventSource`.

### `useSimClock.ts`

```typescript
// Returns the current sim time as a display string (HH:MM:SS).
// Reads simTime, speed, and paused from SessionContext state (updated by sim_time events).
// Interpolates locally between server updates for smooth rendering at 10fps.
export function useSimClock(): {
  display:  string   // 'T+00:03:42' format
  simTime:  number   // raw seconds
  speed:    1 | 2 | 5 | 10
  paused:   boolean
}
```

---

## 3. Primitive Components

All primitives accept standard HTML attributes via rest props. Styling via Tailwind class composition.

### `Button.tsx`

```typescript
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?:    'sm' | 'md' | 'lg'
  loading?: boolean
}
export function Button(props: ButtonProps): JSX.Element
```

### `Badge.tsx`

```typescript
interface BadgeProps {
  label:     string
  variant?:  'default' | 'success' | 'warning' | 'critical' | 'info'
  count?:    number   // shows numeric notification dot
}
export function Badge(props: BadgeProps): JSX.Element
```

Used for: alarm severity (SEV1–SEV4 → critical/warning), unread notification counts on tabs.

### `Panel.tsx`

```typescript
interface PanelProps {
  title?:    string
  children:  React.ReactNode
  className?: string
}
export function Panel(props: PanelProps): JSX.Element
```

### `Modal.tsx`

```typescript
interface ModalProps {
  open:      boolean
  onClose:   () => void
  title:     string
  children:  React.ReactNode
}
export function Modal(props: ModalProps): JSX.Element
```

### `Spinner.tsx`

```typescript
interface SpinnerProps { size?: 'sm' | 'md' | 'lg' }
export function Spinner(props: SpinnerProps): JSX.Element
```

### `EmptyState.tsx`

```typescript
interface EmptyStateProps {
  title:    string
  message?: string
}
export function EmptyState(props: EmptyStateProps): JSX.Element
```

### `MarkdownRenderer.tsx`

```typescript
interface MarkdownRendererProps {
  content:    string
  className?: string
}
// Renders markdown using a lightweight library (e.g. marked + DOMPurify for sanitization).
// Never uses dangerouslySetInnerHTML without sanitization.
export function MarkdownRenderer(props: MarkdownRendererProps): JSX.Element
```

### `Timestamp.tsx`

```typescript
interface TimestampProps {
  simTime:  number   // sim seconds
  prefix?:  string   // default 'T+'
}
// Renders as 'T+00:03:42'
export function Timestamp(props: TimestampProps): JSX.Element
```

---

## 4. Layout Components

### `TabBar.tsx`

```typescript
interface Tab {
  id:       string
  label:    string
  badge?:   number   // unread count
}

interface TabBarProps {
  tabs:       Tab[]
  activeTab:  string
  onTabChange: (tabId: string) => void
}
export function TabBar(props: TabBarProps): JSX.Element
```

The seven tabs are defined in `SimShell.tsx` — `TabBar` is generic and does not know about specific tabs.

### `SpeedControl.tsx`

```typescript
// Reads current speed/paused state from useSimClock().
// Dispatches setSpeed/setPaused via useSession().
export function SpeedControl(): JSX.Element
```

### `SimShell.tsx`

```typescript
// Top-level sim layout. Renders TabBar, active tab content, SpeedControl, and CoachPanelShell.
// Manages active tab state locally.
export function SimShell(): JSX.Element
```

### `ScenarioPicker.tsx`

```typescript
interface ScenarioPickerProps {
  onStart: (scenarioId: string) => void
}
// Fetches GET /api/scenarios and renders a list of ScenarioSummary cards.
// onStart is called when the trainee clicks Start — App.tsx creates the session.
export function ScenarioPicker(props: ScenarioPickerProps): JSX.Element
```

### `CoachPanelShell.tsx`

```typescript
// Slide-out panel with open/close toggle and notification badge.
// Content slot is empty in Phase 7 — filled by Phase 9.
interface CoachPanelShellProps {
  children?: React.ReactNode   // Phase 9 inserts coach UI here
  badgeCount?: number          // unread coach messages
}
export function CoachPanelShell(props: CoachPanelShellProps): JSX.Element
```

### `DebriefScreen.tsx`

```typescript
// Full-screen debrief layout shell.
// Content slot is empty in Phase 7 — filled by Phase 9.
interface DebriefScreenProps {
  sessionId: string
  children?: React.ReactNode
}
export function DebriefScreen(props: DebriefScreenProps): JSX.Element
```

---

## 5. Test Strategy

All client tests use `renderWithProviders` and `buildTestSnapshot` from `client/src/testutil`.

### Context tests

```
SessionContext:
  - session_snapshot event populates snapshot state
  - chat_message event appends to correct channel
  - email_received event appends to emails array
  - alarm_fired event appends to alarms array
  - alarm_silenced event updates alarm status
  - ticket_created appends to tickets array
  - ticket_updated merges changes into existing ticket
  - session_expired triggers navigation (mock router)
  - debrief_ready triggers navigation (mock router)

useSSE:
  - connected=true after successful connection
  - reconnecting=true after disconnect
  - exponential backoff: 1s → 2s → 4s → max 30s
  - onEvent called for each received event
  - cleanup closes EventSource on unmount
```

### Hook tests

```
useSimClock:
  - returns 'T+00:00:00' at simTime=0
  - returns 'T+00:03:42' at simTime=222
  - paused=true reflected in return value
```

### Primitive component tests

```
Button:
  - renders with correct variant classes
  - loading=true shows Spinner, disables button
  - onClick called on click
  - disabled prevents onClick

Badge:
  - renders label
  - count renders numeric dot
  - variant maps to correct color class

MarkdownRenderer:
  - renders markdown as HTML
  - sanitizes script tags (XSS prevention)

Timestamp:
  - simTime=0 → 'T+00:00:00'
  - simTime=3662 → 'T+01:01:02'
  - custom prefix used
```

### Layout component tests

```
TabBar:
  - renders all tab labels
  - active tab has active styling
  - onTabChange called with correct tabId on click
  - badge count shown when provided

SpeedControl:
  - renders current speed
  - clicking 2x calls setSpeed(2)
  - clicking pause calls setPaused(true)

ScenarioPicker:
  - fetches /api/scenarios and renders scenario cards
  - onStart called with correct scenarioId on click
  - loading state shown while fetching
  - error state shown on fetch failure
```

---

## 6. Design Tokens

Tailwind config extended with sim-specific tokens:

```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        'sim-bg':        '#0d1117',   // dark terminal background
        'sim-surface':   '#161b22',   // panel background
        'sim-border':    '#30363d',
        'sim-text':      '#e6edf3',
        'sim-text-muted':'#8b949e',
        'sev1':          '#ff0000',
        'sev2':          '#ff6600',
        'sev3':          '#ffcc00',
        'sev4':          '#0099ff',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
}
```

The sim is monospace-first — everything uses `font-mono`. This matches the terminal/dashboard aesthetic.

---

## 7. Definition of Done

- [ ] All three contexts implemented with correct SSE event → state mapping
- [ ] `useSSE` reconnects with exponential backoff
- [ ] `useSimClock` interpolates between server updates
- [ ] All primitive components implemented with Tailwind styling
- [ ] `MarkdownRenderer` sanitizes HTML before rendering
- [ ] `ScenarioPicker` fetches and displays scenario list
- [ ] `SimShell`, `CoachPanelShell`, `DebriefScreen` layout shells implemented
- [ ] `renderWithProviders` and `buildTestSnapshot` from testutil used in all tests
- [ ] All tests in §5 pass
- [ ] No `any` types
