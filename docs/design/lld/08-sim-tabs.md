# LLD 08 — Sim Shell and Tab Implementations

**Phase:** 8
**Depends on:** Phase 1 (shared types), Phase 6 (REST API routes), Phase 7 (UI component library, contexts, hooks)
**HLD sections:** §5.2, §5.3, §5.4

---

## Purpose

Implement the full sim shell and all seven tab components. Each tab reads from `SessionContext` and dispatches actions via `useSession()`. No tab manages its own server connection — all data flows through the shared context.

---

## Scope

```
client/src/components/tabs/
  EmailTab.tsx
  ChatTab.tsx
  TicketingTab.tsx
  OpsDashboardTab.tsx
  LogsTab.tsx
  WikiTab.tsx
  CICDTab.tsx

client/src/App.tsx         # routing: picker → sim → debrief
```

---

## 1. App Routing (`App.tsx`)

```typescript
// Three screens, no URL routing needed — state-driven navigation.
type AppScreen = 'picker' | 'sim' | 'debrief'

export function App(): JSX.Element {
  const [screen, setScreen] = useState<AppScreen>('picker')
  const [sessionId, setSessionId] = useState<string | null>(null)

  async function handleStart(scenarioId: string) {
    // 1. Create session
    const { sessionId } = await fetch('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ scenarioId }),
    }).then(r => r.json())

    // 2. Fetch full scenario config for ScenarioContext (wiki pages, topology, etc.)
    const scenario = await fetch(`/api/scenarios/${scenarioId}`).then(r => r.json())

    setSessionId(sessionId)
    // ScenarioContext populated here from scenario response
    setScreen('sim')
  }

  // SessionContext emits navigation events via a callback:
  // - debrief_ready → setScreen('debrief')
  // - session_expired → setScreen('picker')
  // These are passed as props to SessionProvider.
}
```

---

## 2. EmailTab (`EmailTab.tsx`)

Displays an inbox list on the left and a thread view on the right.

```typescript
export function EmailTab(): JSX.Element
```

**Data:** reads `snapshot.emails` from `useSession()`. Groups by `threadId` for thread view.

**Unread tracking:** emails that arrived after the last time the trainee opened the Email tab are shown with an unread indicator. Unread count drives the tab badge in `TabBar`.

**Actions dispatched:**
- Opening the Email tab: `dispatchAction('open_tab', { tab: 'email' })`
- Replying to an email: calls `replyEmail(threadId, body)` from `useSession()`

**Layout:**
```
┌─────────────────┬────────────────────────────────┐
│ Inbox           │ Thread view                     │
│ ─────────────── │ ─────────────────────────────── │
│ [unread] From   │ Subject: ...                    │
│  Subject        │                                 │
│  T+00:02:15     │ From: pagerduty@...  T+00:00:00 │
│                 │ [email body]                    │
│ ...             │                                 │
│                 │ From: trainee        T+00:05:30 │
│                 │ [reply body]                    │
│                 │                                 │
│                 │ ┌─────────────────────────────┐ │
│                 │ │ Reply...                    │ │
│                 │ └─────────────────────────────┘ │
└─────────────────┴────────────────────────────────┘
```

---

## 3. ChatTab (`ChatTab.tsx`)

Slack-like interface with channel sidebar and message pane.

```typescript
export function ChatTab(): JSX.Element
```

**Data:** reads `snapshot.chatChannels` from `useSession()`. Channel list is derived from keys of `chatChannels`.

**DM channels:** channels with `dm:` prefix show as direct messages in a separate section of the sidebar. Opening a DM with a `silent_until_contacted` persona marks them engaged via the `direct_message_persona` action.

**Actions dispatched:**
- Opening the Chat tab: `dispatchAction('open_tab', { tab: 'chat' })`
- Posting a message: calls `postChatMessage(channel, text)` — also dispatches `post_chat_message` action internally
- Opening a DM for the first time: `dispatchAction('direct_message_persona', { personaId })`

**@mention handling:** when the trainee types `@<name>` in the message input, the UI shows a persona picker dropdown. On selection, the mention is inserted into the message text. No special server handling needed — the mention text is part of the message body which the stakeholder engine reads.

**Unread tracking:** messages in non-active channels since last viewed drive tab and channel badge counts.

**Layout:**
```
┌────────────┬──────────────────────────────────────┐
│ Channels   │ #incidents                           │
│ ─────────── │ ───────────────────────────────────  │
│ #incidents │ oncall-bot  T+00:00:00               │
│ #payment   │ error rate > 5%...                   │
│            │                                      │
│ DMs        │ checkout-eng  T+00:01:30             │
│ checkout-  │ hey, seeing issues on our end?       │
│  eng       │                                      │
│            │ trainee  T+00:02:00                  │
│            │ investigating now                    │
│            │                                      │
│            │ ┌──────────────────────────────────┐ │
│            │ │ Message #incidents...            │ │
│            │ └──────────────────────────────────┘ │
└────────────┴──────────────────────────────────────┘
```

---

## 4. TicketingTab (`TicketingTab.tsx`)

Ticket list on the left, detail view on the right.

```typescript
export function TicketingTab(): JSX.Element
```

**Data:** reads `snapshot.tickets` and `snapshot.ticketComments` from `useSession()`.

**Actions dispatched:**
- Opening the Ticketing tab: `dispatchAction('open_tab', { tab: 'ticketing' })`
- Updating ticket status/severity: `dispatchAction('update_ticket', { ticketId, changes })`
- Adding a comment: `dispatchAction('add_ticket_comment', { ticketId, body })`
- Marking resolved: `dispatchAction('mark_resolved', { ticketId })` then calls `resolve()`

**Ticket status flow:** `open` → `in_progress` → `resolved`. Status can only move forward. "Mark Resolved" button only appears when status is `in_progress`.

**Severity badges:** SEV1–SEV4 use `Badge` component with `critical`/`warning` variants.

---

## 5. OpsDashboardTab (`OpsDashboardTab.tsx`)

Per-service metric graphs with time-gated data reveal.

```typescript
export function OpsDashboardTab(): JSX.Element
```

**Data:** reads `snapshot.metrics` and `snapshot.alarms` from `useSession()`. Current sim time from `useSimClock()`.

**Time-gating:** the graph renders only data points where `t <= currentSimTime`. As simTime advances, the graph viewport right-edge advances to reveal more data. Pre-incident data (`t < 0`) is always fully visible — the "history" window.

**Chart rendering:** uses Recharts `LineChart`. One `LineChart` per metric. Multiple services shown as separate tabs within the dashboard.

```typescript
interface MetricChartProps {
  metricId:   string
  service:    string
  series:     TimeSeriesPoint[]   // full pre-generated series
  simTime:    number              // current — used to gate visible data
  warningThreshold?:  number
  criticalThreshold?: number
  label:      string
  unit:       string
}
export function MetricChart(props: MetricChartProps): JSX.Element
```

**Threshold lines:** rendered as `ReferenceLine` in Recharts. Warning = yellow, critical = red.

**Alarm panel:** shows all `snapshot.alarms` with their status. Trainee can:
- Acknowledge: `dispatchAction('ack_page', { alarmId })`
- Suppress: `dispatchAction('suppress_alarm', { alarmId })`
- Escalate: `dispatchAction('escalate_page', { alarmId, to: string })`

**Actions dispatched:**
- Opening the Ops Dashboard tab: `dispatchAction('open_tab', { tab: 'ops_dashboard' })`
- Interacting with a specific metric graph: `dispatchAction('view_metric', { service, metricId })`

---

## 6. LogsTab (`LogsTab.tsx`)

Scrollable, filterable log stream.

```typescript
export function LogsTab(): JSX.Element
```

**Data:** reads `snapshot.logs` from `useSession()`. New entries arrive via `log_entry` SSE events and are appended to `snapshot.logs` by `SessionContext`.

**Filtering:** client-side filter — does not call the server. Filter controls:
- Free-text search (matches `message` and `service`)
- Severity selector (DEBUG / INFO / WARN / ERROR — multi-select)
- Service selector (derived from unique service values in log entries)

**Auto-scroll:** when the trainee is scrolled to the bottom, new entries auto-scroll. If the trainee has scrolled up, new entries do not auto-scroll (shows "N new entries" badge instead).

**Actions dispatched:**
- Opening the Logs tab: `dispatchAction('open_tab', { tab: 'logs' })`
- Submitting a search: `dispatchAction('search_logs', { query, filters })`

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│ Search: [______________] Level: [ALL▼] Service: [ALL▼]│
├─────────────────────────────────────────────────────┤
│ T+00:00:01  ERROR  payment-service                  │
│   TimeoutException connecting to fraud-detection    │
│ T+00:00:02  ERROR  payment-service                  │
│   Connection pool exhausted [18/18]                 │
│ T+00:00:03  WARN   payment-service                  │
│   Retry attempt 3/3 — giving up                     │
└─────────────────────────────────────────────────────┘
```

---

## 7. WikiTab (`WikiTab.tsx`)

Rendered Markdown runbook pages.

```typescript
export function WikiTab(): JSX.Element
```

**Data:** wiki pages are loaded into `ScenarioContext` at session start. When `App.tsx` creates a session, it calls `GET /api/scenarios/:id` to fetch the full scenario config (including wiki page content) and populates `ScenarioContext`. Wiki content is read-only and never changes during a session. This is a one-time fetch at session creation — not a per-tab fetch.

`ScenarioContext` already includes `wikiPages: Array<{ title: string; content: string }>` as defined in Phase 7 (LLD 07 §1). This field is populated here in Phase 8 when `App.tsx` fetches the full scenario config.

**Search:** client-side full-text search across all wiki page content.

**Actions dispatched:**
- Opening the Wiki tab: `dispatchAction('open_tab', { tab: 'wiki' })`
- Reading a specific page: `dispatchAction('read_wiki_page', { pageTitle })`

---

## 8. CICDTab (`CICDTab.tsx`)

Pipeline list with deployment history and remediation action buttons.

```typescript
export function CICDTab(): JSX.Element
```

**Data:** reads `snapshot.deployments` from `useSession()`. Grouped by service.

**Deployment history:** each service shows a table of deployments ordered by `deployedAtSec` descending. The currently active deployment is highlighted. Deployments before `t=0` use relative timestamps ("5 minutes before incident").

**Remediation actions:** rendered as buttons per deployment row or per service. Each button is only active when the action is valid (e.g. rollback is only available on a `previous` deployment). Confirmation modal shown before executing irreversible actions.

**Actions dispatched:**
- Opening the CI/CD tab: `dispatchAction('open_tab', { tab: 'cicd' })`
- Viewing deployment history: `dispatchAction('view_deployment_history', { service })`
- Triggering rollback: `dispatchAction('trigger_rollback', { service, targetVersion })`
- Triggering roll-forward: `dispatchAction('trigger_roll_forward', { service, targetVersion })`
- Restarting service: `dispatchAction('restart_service', { service })`
- Scaling cluster: `dispatchAction('scale_cluster', { service, direction: 'up' | 'down' })`
- Throttling traffic: `dispatchAction('throttle_traffic', { service })`
- Emergency deploy: `dispatchAction('emergency_deploy', { service })`
- Toggling feature flag: `dispatchAction('toggle_feature_flag', { service, flagId, enabled })`

**Post-action feedback:** after a remediation action, the UI shows a banner: "Rollback triggered — monitoring for recovery" until the next `deployment_update` SSE event arrives. If no recovery metrics improve (wrong fix), the banner eventually clears with no fanfare.

---

## 9. Tab Notification Badges

Each tab maintains an unread/unseen count that drives the badge in `TabBar`. Logic per tab:

| Tab | Badge condition |
|---|---|
| Email | Emails received since tab was last active |
| Chat | Messages in any channel since that channel was last viewed |
| Ticketing | Ticket comments received since tab was last active |
| Ops Dashboard | New alarms fired since tab was last active |
| Logs | No badge — logs are continuous |
| Wiki | No badge |
| CI/CD | New deployments since tab was last active |

Badge counts are local client state — not stored in the server session.

---

## 10. Test Strategy

All tests use `renderWithProviders(ui, { snapshot })` from `client/src/testutil`.

### `EmailTab.test.tsx`

```
- renders empty state when no emails
- renders email list from snapshot.emails
- clicking an email shows thread view
- reply form submits via replyEmail()
- unread badge count matches unread emails
- open_tab action dispatched on mount
```

### `ChatTab.test.tsx`

```
- renders channel list from snapshot.chatChannels keys
- renders messages in active channel in order
- dm: channels appear in DMs section
- message input submits via postChatMessage()
- @mention dropdown appears on @ input
- direct_message_persona dispatched on first DM open
- unread badge per channel
```

### `TicketingTab.test.tsx`

```
- renders ticket list from snapshot.tickets
- clicking ticket shows detail with comments
- update_ticket dispatched on status/severity change
- add_ticket_comment dispatched on comment submit
- mark_resolved calls resolve() and dispatches action
- mark_resolved only available when status=in_progress
```

### `OpsDashboardTab.test.tsx`

```
- MetricChart renders only data points where t <= simTime
- at simTime=0, only t<=0 points visible
- at simTime=60, t<=60 points visible
- threshold lines rendered at warningThreshold and criticalThreshold
- alarm panel shows alarms from snapshot.alarms
- ack_page dispatched on acknowledge
- suppress_alarm dispatched on suppress
- view_metric dispatched on graph interaction
```

### `LogsTab.test.tsx`

```
- renders log entries from snapshot.logs
- new entries appended as SSE log_entry events arrive
- text search filters by message content
- severity filter hides non-matching levels
- service filter hides non-matching services
- auto-scroll when at bottom, no scroll when scrolled up
- search_logs action dispatched on search submit
```

### `WikiTab.test.tsx`

```
- renders wiki page list from ScenarioContext
- clicking page renders MarkdownRenderer with page content
- read_wiki_page action dispatched on page open
- search filters pages by content
```

### `CICDTab.test.tsx`

```
- renders deployment history grouped by service
- active deployment highlighted
- rollback button dispatches trigger_rollback with correct version
- confirmation modal shown before rollback
- post-action banner shown after dispatching action
- view_deployment_history action dispatched on tab open
```

---

## 11. Definition of Done

- [ ] All seven tabs implemented and reading from `SessionContext`
- [ ] `App.tsx` manages screen transitions: picker → sim → debrief
- [ ] OpsDashboard time-gates metric data to `currentSimTime`
- [ ] WikiTab fetches full scenario from `GET /api/scenarios/:id` and caches in `ScenarioContext`
- [ ] All remediation actions dispatch correctly via `dispatchAction`
- [ ] Tab badge counts tracked as local client state
- [ ] All confirmation modals use `Modal` primitive
- [ ] All tests in §10 pass using `renderWithProviders`
- [ ] No `any` types
