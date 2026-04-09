# On-Call Training Simulator — High Level Design

## 1. Overview

A browser-based on-call incident simulation platform for training software engineers on AWS services. The trainee is placed inside a realistic incident environment — a single browser window containing all the tools a real on-call engineer uses — and must diagnose and resolve a high-severity event.

The simulator is scenario-driven and LLM-powered. Scenarios are fully defined in YAML config files. No code changes are required to add new scenarios. An LLM drives stakeholder communication and dynamic sim events in real time. A separate LLM coach observes the trainee and provides proactive guidance.

---

## 2. Goals

- Simulate a realistic on-call incident environment in a single browser tab
- Make scenarios fully config-driven — new scenarios require only YAML and Markdown files
- Use LLMs to make stakeholder communication feel real and reactive
- Track trainee actions honestly without gamification
- Provide a meaningful post-incident debrief driven by LLM narrative
- Support local development without an LLM API key via a mock mode
- Architecture should support future persistence, multi-user, and reactive metrics without requiring a redesign

---

## 3. Non-Goals (MVP)

- Multi-user or instructor tracking
- Durable session persistence (sessions are in-memory; a server restart loses all active sessions — see §19 for SSE reconnection within a running server)
- In-browser code editor and emergency deploy (Phase 2)
- Gamification or point scoring
- Mobile support

---

## 4. System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser                                                            │
│                                                                     │
│  ┌─────────────────────────────────────┐   ┌─────────────────────┐ │
│  │  Sim Shell                          │   │  Coach Panel        │ │
│  │                                     │   │  (slide-out)        │ │
│  │  [ Email ][ Chat ][ Tickets ]       │   │                     │ │
│  │  [ Ops   ][ Logs ][ Wiki   ][ CICD ]│   │  Proactive nudges   │ │
│  │                                     │   │  + on-demand help   │ │
│  │  Speed: [1x][2x][5x][10x]  [Pause] │   │                     │ │
│  └─────────────────────────────────────┘   └─────────────────────┘ │
│                        │  SSE + REST                               │
└────────────────────────┼────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────────┐
│  Node.js / Express Server                                           │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  REST API    │  │  SSE Stream  │  │  Game Engine             │  │
│  │              │  │              │  │                          │  │
│  │  /scenarios  │  │  /events     │  │  game-loop               │  │
│  │  /actions    │  │  (per        │  │  event-scheduler         │  │
│  │  /llm        │  │   session)   │  │  stakeholder-engine      │  │
│  │  /sessions   │  │              │  │  audit-log               │  │
│  └──────────────┘  └──────────────┘  │  evaluator               │  │
│                                      └──────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  LLM Client (abstraction layer)                              │   │
│  │  OpenAI-compatible  |  AWS Bedrock                           │   │
│  │  Mock mode (MOCK_LLM=true)                                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────────┐
│  File System                                                        │
│                                                                     │
│  scenarios/<id>/scenario.yaml                                       │
│  scenarios/<id>/email/*.md                                          │
│  scenarios/<id>/tickets/*.md                                        │
│  scenarios/<id>/wiki/*.md                                           │
│  scenarios/<id>/mock-llm-responses.yaml                             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. Frontend

### 5.1 Tech Stack

- **React** + **TypeScript**
- **Tailwind CSS** for styling
- **Recharts** for time-series metric graphs
- **EventSource** (SSE) for real-time event delivery from the server
- **React Context** for global sim state (active scenario, timeline, audit log)

### 5.2 Application Screens

```
Scenario Picker  →  Sim Shell  →  Debrief Screen
```

**Scenario Picker:** Lists all available scenarios loaded from the server. Shows title, description, service type, difficulty, and tags. Trainee selects a scenario and clicks Start.

**Sim Shell:** The main training environment. Contains the tab bar, all sim tabs, the speed/pause controls, and the coach panel.

**Debrief Screen:** Shown after the trainee marks the incident resolved. Displays the LLM-generated narrative, a comparison of trainee actions vs the ideal response path, and the full audit log.

### 5.3 Tabs

| Tab               | Description                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Email**         | Inbox list and thread view. Emails arrive on the scenario timeline. Trainee can reply (reply is logged as an action, LLM may respond). |
| **Chat**          | Multi-channel Slack-like interface. Trainee can post messages and @mention personas. LLM-driven personas respond on ticks.             |
| **Ticketing**     | Ticket list and detail view. Trainee can update status, severity, add comments. LLM personas can comment on tickets.                   |
| **Ops Dashboard** | Per-service metric graphs (error rate, latency, request rate, etc.) with threshold markers. Time series data rendered via Recharts.    |
| **Logs**          | Scrollable, filterable log stream. Log entries arrive on the scenario timeline and via LLM event injection.                            |
| **Wiki**          | Rendered Markdown runbooks. Read-only. Viewing a page is logged as an action.                                                          |
| **CI/CD**         | Pipeline list and deployment history per service. Trainee can trigger rollback, roll-forward, or emergency deploy.                     |

### 5.4 Speed Control and Pause

A persistent control bar shows current sim time and speed. Speed options: `1x`, `2x`, `5x`, `10x`. Pause button halts the timeline. The server is the source of truth for sim time — the client sends speed changes and pause/resume via REST, the server adjusts the game loop accordingly.

### 5.5 Coach Panel

A slide-out panel on the right side. Has a notification badge when the coach has a proactive message. The trainee can open it at any time to ask for help. The coach LLM has read-only tool access to sim state and responds grounded in what has actually happened. The coach never posts to sim channels.

---

## 6. Backend

### 6.1 Tech Stack

- **Node.js** + **Express** + **TypeScript**
- **Server-Sent Events (SSE)** for real-time event delivery to the client
- **js-yaml** for scenario config parsing
- **Zod** for scenario config schema validation at load time
- **In-memory session state** (MVP — designed to be replaced with a persistence layer)

### 6.2 REST API

| Method   | Path                            | Description                                                                                                                                    |
| -------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/scenarios`                | List all available scenarios                                                                                                                   |
| `GET`    | `/api/scenarios/:id`            | Load a specific scenario config                                                                                                                |
| `POST`   | `/api/sessions`                 | Start a new sim session, returns session ID                                                                                                    |
| `DELETE` | `/api/sessions/:id`             | End a session                                                                                                                                  |
| `GET`    | `/api/sessions/:id/events`      | SSE stream for this session                                                                                                                    |
| `POST`   | `/api/sessions/:id/actions`     | Record a trainee action                                                                                                                        |
| `POST`   | `/api/sessions/:id/speed`       | Set speed multiplier or pause/resume                                                                                                           |
| `POST`   | `/api/sessions/:id/chat`        | Trainee posts a chat message to a channel (includes DMs — see §9)                                                                              |
| `POST`   | `/api/sessions/:id/email/reply` | Trainee replies to an email thread                                                                                                             |
| `POST`   | `/api/sessions/:id/resolve`     | Trainee marks incident resolved, triggers async debrief generation; client waits for `debrief_ready` SSE event then polls the debrief endpoint |
| `GET`    | `/api/sessions/:id/debrief`     | Fetch completed debrief result; returns 404 until generation completes, 200 with debrief payload once ready                                    |
| `POST`   | `/api/sessions/:id/coach`       | Trainee sends a message to the coach (session-scoped)                                                                                          |

### 6.3 Game Engine

The game engine is the core of the server. It runs per session.

**game-loop:** A timer that fires every N real milliseconds, adjusted by the speed multiplier. On each tick it calls the event scheduler and (if dirty) the stakeholder engine. Respects pause state.

**event-scheduler:** Checks the scenario's pre-scripted events against the current sim time and fires any that are due. Events include: emails arriving, log entries appearing, bot messages, initial page/alarm.

**stakeholder-engine:** Invoked on each tick (if dirty) and immediately after any trainee action. Builds a context payload and calls the LLM. Receives structured tool call responses and executes them after server-side validation.

**audit-log:** An append-only in-memory log of all trainee actions with sim timestamps. Used by the stakeholder engine (passed to LLM as context), the evaluator, and the debrief LLM.

**conversation-store:** In-memory store of all messages across all channels (chat, email, tickets). Passed to the stakeholder engine on each tick. Broadcasts new messages to the client via SSE.

**evaluator:** Checks the audit log against the scenario's `relevant_actions` config after each action. Used by the debrief LLM — not used for real-time scoring.

### 6.4 Dirty State Tracking

The stakeholder engine skips the LLM call if nothing has changed since the last evaluation. A session is marked dirty when:

- A scripted event fires
- A trainee action is received
- A previous LLM call injected messages

This prevents unnecessary LLM API calls on idle ticks.

---

## 7. LLM Architecture

### 7.1 Provider Abstraction

All LLM calls go through a single `llm-client` module. It supports:

- **OpenAI-compatible** — any endpoint implementing the OpenAI chat completions API (OpenAI, Azure OpenAI, local Ollama, etc.)
- **AWS Bedrock** — uses the AWS SDK with IAM credentials, supports Anthropic Claude and Amazon Nova models via Bedrock
- **Mock mode** — `MOCK_LLM=true` returns canned responses from `scenarios/<id>/mock-llm-responses.yaml`. Fully deterministic. Required for tests.

Provider is selected via environment variables:

```
LLM_PROVIDER=openai|bedrock
OPENAI_API_KEY=...
OPENAI_BASE_URL=...          # optional, for Azure or local endpoints
OPENAI_MODEL=gpt-4o          # default
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=...
MOCK_LLM=true|false
```

### 7.2 Three LLM Roles

**Stakeholder Engine LLM**

Called once per dirty tick. Receives full sim context. Uses tool calls to communicate and fire events. The server validates all tool calls before executing them.

Communication tools:

- `send_message(persona, channel, message)`
- `send_email(persona, to, subject, body)`
- `add_ticket_comment(persona, ticket_id, message)`

Event tools (server-validated against scenario config):

- `fire_alarm(service, metric, value, severity)`
- `silence_alarm(alarm_id)`
- `inject_log_entry(service, level, message)`
- `trigger_cascade(service, effect)`
- `apply_metric_response(affected_metrics)` — mutates live metric trajectories in response to trainee actions; server validates all service/metric references and computes the actual series points; LLM supplies semantic parameters only (see §8.3)

**Coach LLM**

Called when the trainee opens the coach panel or when the coach has a proactive message (on its own slower tick cycle). Uses read-only tool calls to ground its responses in actual sim state.

Read-only observation tools:

- `get_audit_log()`
- `get_conversation_history(channel)`
- `get_current_metrics(service)`
- `get_active_alarms()`
- `get_deployment_history(service)`

**Debrief LLM**

One-shot call after the trainee marks resolved. All data is injected directly into the prompt — no tool calls. Receives the full audit log, the complete conversation history, and the scenario's `evaluation` config. Produces a structured narrative debrief (see §22).

Context injected into prompt:

- Scenario `evaluation` config (root cause, relevant actions, red herrings, debrief context)
- Full audit log with sim timestamps
- Which relevant actions were taken and at what sim time
- Which red herrings were triggered
- Complete conversation history across all channels

### 7.3 Responsibility Boundaries

| Actor           | Communicate         | Fire events                    | Remediation actions            |
| --------------- | ------------------- | ------------------------------ | ------------------------------ |
| Stakeholder LLM | Yes (via tools)     | Yes (server-validated)         | No                             |
| Coach LLM       | Coach panel only    | No                             | No                             |
| Debrief LLM     | Debrief screen only | No                             | No                             |
| Trainee         | Yes                 | No                             | Yes (UI actions)               |
| Scripted events | Yes                 | Yes (deterministic)            | No                             |
| Server          | No                  | Yes (executes trainee actions) | Yes (executes trainee actions) |

The core principle: **LLM controls communication and dynamic events. Server controls mechanics. Trainee controls remediation.**

---

## 8. Scenario Config System

### 8.1 Structure

Each scenario is a directory under `scenarios/`:

```
scenarios/
  <scenario-id>/
    scenario.yaml                  # master config
    email/                         # email body markdown files
    tickets/                       # ticket description markdown files
    wiki/                          # runbook markdown files
    mock-llm-responses.yaml        # canned responses for mock mode
```

### 8.2 Scenario Config Sections

| Section                      | Description                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `id`, `title`, `description` | Scenario metadata                                                                                           |
| `service_type`               | `api`, `workflow`, `serverless`, `database`, `console`                                                      |
| `difficulty`, `tags`         | For the picker screen                                                                                       |
| `timeline`                   | Default speed multiplier, duration in minutes                                                               |
| `topology`                   | Focal service, upstream/downstream service names                                                            |
| `engine`                     | Tick interval in sim seconds, enabled LLM event tools and their constraints                                 |
| `email`                      | Scripted emails with arrival time (`at_second`)                                                             |
| `chat`                       | Channel definitions and scripted messages with arrival time                                                 |
| `ticketing`                  | Pre-created tickets with initial state                                                                      |
| `ops_dashboard`              | Per-service metric definitions — see §8.3. Can be split to `metrics.yaml` via `ops_dashboard_file`.         |
| `alarms`                     | Named alarm conditions, severities, onset times, auto-page config — see §8.5                                |
| `logs`                       | Scripted log entries with arrival time                                                                      |
| `wiki`                       | Runbook pages (references markdown files)                                                                   |
| `cicd`                       | Pipelines and deployment history per service                                                                |
| `personas`                   | LLM persona definitions — see §8.7                                                                          |
| `remediation_actions`        | What each action does mechanically, `is_correct_fix`, side effects                                          |
| `evaluation`                 | Root cause description, relevant actions with rationale, red herrings with rationale, debrief context prose |

### 8.3 Metric Generation

Rather than authoring raw `{t, v}` time series by hand, scenario authors declare the **shape and behavior** of each metric. The server generates the actual series at scenario load time using a seeded PRNG. The client receives pre-computed series as part of the `session_snapshot` — no generation happens client-side.

#### Generation Model

Every metric series is the sum of four independent layers applied in sequence:

```
point(t) = baseline(t) + rhythm(t) + noise(t) + incident_overlay(t)
```

| Layer                | Purpose                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **baseline**         | Steady-state mean, derived from archetype defaults scaled by `scale` or author-supplied `baseline_value`                                            |
| **rhythm**           | Predictable periodic variation driven by the service's `traffic_profile`. Rhythm-sensitive archetypes inherit this automatically; others ignore it. |
| **noise**            | Random variation that makes the metric look real. Never zero — real services are never perfectly stable.                                            |
| **incident overlay** | Transforms the existing value (not replaces it) so baseline noise continues through the incident window.                                            |

#### Tiered Authoring

Authors implicitly choose how much to specify per metric.

**Tier 1 — archetype only.** One line. All parameters derived from incident type matrix, archetype defaults, service scale, and health.

```yaml
- archetype: cpu_utilization
```

**Tier 2 — archetype + known scenario values (the common case).** Author supplies numbers they already know from the real incident: the baseline they observed, the threshold that fired the alert, and the peak value. No statistical knowledge required. `resolved_value` is optional — it defaults to `baseline_value` and only needs to be set when "recovered" is not "back to baseline" (e.g. a traffic spike scenario where the service was legitimately scaled up).

```yaml
- archetype: error_rate
  critical_threshold: 5
  incident_peak: 14.2 # the number that fired the alert
  onset_second: 30 # author knows latency preceded errors
  # resolved_value omitted → defaults to baseline_value (~0.8%)

- archetype: request_rate
  resolved_value: 520 # traffic spike scenario — scaled up to handle new load, not back to 350 rps
```

**Tier 3 — full override.** Author overrides the overlay type or any other parameter. For unusual incident shapes or custom metric types not covered by archetypes.

```yaml
- archetype: custom
  label: "Batch Queue Depth"
  unit: count
  baseline_value: 0
  noise: low
  incident_response:
    overlay: gradual_degradation
    onset_second: -300
    peak_value: 4700
    ramp_duration_seconds: 300
```

**Escape hatch — raw series.** Bypasses the generator entirely. Use for cert expiry countdowns, discrete state changes, or anything the generator cannot express.

```yaml
- archetype: cert_expiry
  label: "TLS Cert Days Remaining"
  unit: days
  critical_threshold: 3
  series_override:
    - { t: -86400, v: 2 }
    - { t: 0, v: 1 }
    - { t: 86400, v: 0 }
```

#### Noise

Authors control noise with a named level — no statistical knowledge required. Archetype defaults encode the right statistical behavior per metric type.

**Noise levels** — author-configurable per metric, defaults to archetype default:

| Level     | Multiplier | Meaning                                |
| --------- | ---------- | -------------------------------------- |
| `low`     | 0.5x       | Rock solid — internal platform service |
| `medium`  | 1x         | Normal healthy service                 |
| `high`    | 2x         | Busy service with noisy clients        |
| `extreme` | 4x         | Flaky or overloaded service            |

**Health multiplier** — set at service level, stacks with metric noise level:

| Health     | Multiplier | Meaning                               |
| ---------- | ---------- | ------------------------------------- |
| `healthy`  | 1x         | Normal baseline noise                 |
| `degraded` | 1.5x       | Under stress, noisier than usual      |
| `flaky`    | 2.5x       | Chronic issues, high background noise |

**Noise types** — archetype-defined, not author-configured:

| Type              | Behavior                                            | Used for                                          |
| ----------------- | --------------------------------------------------- | ------------------------------------------------- |
| `gaussian`        | Symmetric random variation around mean              | Latency, stable counters                          |
| `random_walk`     | Drifts with momentum, pulled back toward mean       | CPU, memory                                       |
| `sporadic_spikes` | Gaussian base with occasional sharp upward impulses | Error rate, fault rate — real 4xx and fault noise |
| `sawtooth_gc`     | Gradual growth punctuated by periodic GC drops      | JVM heap                                          |
| `none`            | No noise                                            | Cert countdown, discrete state metrics            |

#### Incident Overlays

Overlays transform the existing value rather than replacing it, preserving baseline noise throughout.

**Static overlays** — applied at generation time, fixed for the life of the session:

| Overlay               | Behavior                                                       |
| --------------------- | -------------------------------------------------------------- |
| `spike_and_sustain`   | Ramps to `peak_value` over a short ramp window, stays elevated |
| `sudden_drop`         | Multiplies value by `drop_factor` at `onset_second`            |
| `saturation`          | Climbs to `ceiling` over `saturation_duration_seconds`         |
| `gradual_degradation` | Slow linear climb from `onset_second` to `peak_value`          |
| `none`                | Metric unaffected — used on exonerated services                |

**Reactive overlays** — applied at runtime by the server when the LLM calls `apply_metric_response`. All reactive overlays start from the metric's current live value and move toward `resolved_value` (recovery) or `incident_peak` (worsening). Noise is preserved throughout. Speed is one of: `1m`, `5m`, `15m`, `30m`, `60m` (sim-seconds: 60, 300, 900, 1800, 3600).

| Overlay            | Behavior                                                                                                                                                                                                                                                                                                 | Speed parameter meaning          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `smooth_decay`     | Exponential curve toward target. `v(t) = target + (current − target) × e^(−λt)` where `λ = ln(2) / (speed / 2)`                                                                                                                                                                                          | Total recovery duration          |
| `stepped`          | Four discrete equal drops at evenly-spaced intervals                                                                                                                                                                                                                                                     | Total duration across all steps  |
| `queue_burndown`   | Holds at current elevated value for the full speed duration, then sharp `smooth_decay` with 30s half-life. Models backlog drain — metric stays high until the backlog clears                                                                                                                             | Plateau length before cliff      |
| `oscillating`      | Bounces between current value and target. `damping` mode: amplitude decays toward `resolved_value` over speed duration. `sustained` mode: constant amplitude indefinitely until another `apply_metric_response` call. LLM sets `oscillation_mode` and `cycle_seconds` (clamped server-side to [30, 300]) | Damping decay constant           |
| `blip_then_decay`  | Spikes 30% above current value, holds for `speed × 0.1` seconds, then `smooth_decay` to target. Models restart or failover transient                                                                                                                                                                     | Total duration including blip    |
| `cascade_clear`    | Applies `smooth_decay` to each metric in the call sequentially: infrastructure archetypes first, then quality, then business metrics. Each delayed by `speed / metric_count` seconds                                                                                                                     | Total sequential recovery window |
| `sawtooth_rebound` | `smooth_decay` to target over `speed / 2`, then `gradual_degradation` back toward `incident_peak` over remaining `speed / 2`. Repeats until another action. Models a fix that buys time without resolving root cause                                                                                     | Full sawtooth period             |
| `cliff`            | Near-instant jump to `resolved_value` at `currentSimTime + 5s`. Models circuit breaker trip or hard failover                                                                                                                                                                                             | Ignored — always 5s              |

#### `apply_metric_response` — how the server processes it

When the LLM calls `apply_metric_response`, the server:

1. Validates every `service` and `metric_id` against the scenario topology — rejects unknown references with a log entry, never crashes.
2. Looks up `resolved_value` for each metric (author-supplied or defaulting to `baseline_value`).
3. Reads the metric's current live value (last point in the session's `TimeSeriesPoint[]` at or before `currentSimTime`).
4. Pre-computes the full reactive overlay series from `currentSimTime` onward using the resolved pattern, speed, magnitude, and direction. All math is server-side — the LLM never touches numbers.
5. Replaces future pre-generated points in the session metric store from `currentSimTime` onward with the new reactive series. This is a splice, not an append — if two actions fire in sequence, the second overlay starts from wherever the metric actually is at that point, not from the original incident peak.
6. Streams `metric_update` SSE events for each new point as sim time advances past them — the client sees the graph update in real time, not all at once.
7. Logs the `apply_metric_response` call in the audit log as a system event (not a trainee action) so the debrief timeline is accurate.

**Magnitude mapping:**

- `full` → target is `resolved_value`
- `partial` → target is midpoint between `currentValue` and `resolved_value`

**Direction mapping:**

- `recovery` → moves toward `resolved_value`
- `worsening` → moves toward `incident_peak` (or 20% beyond it if already at peak, capped at archetype max)

**Noise is always preserved.** Recovery points are not smooth — the existing noise type and level continue through the reactive window using the same seeded PRNG, continuing from where the static series left off.

**The LLM tool parameters:**

```typescript
apply_metric_response({
  affected_metrics: Array<{
    service: string; // must match scenario topology
    metric_id: string; // must match a metric on that service
    direction: "recovery" | "worsening";
    pattern: ReactiveOverlayType;
    speed: "1m" | "5m" | "15m" | "30m" | "60m";
    magnitude: "full" | "partial";
    // Only present when pattern='oscillating':
    oscillation_mode?: "damping" | "sustained";
    cycle_seconds?: number; // server clamps to [30, 300]
  }>,
});
```

The LLM may specify different patterns and speeds per metric in a single call — this is how asymmetric recovery is expressed. Example: `error_rate` recovers `smooth_decay` at `5m`, while `p99_latency_ms` uses `queue_burndown` at `30m` because the request backlog must drain before latency improves.

**Stakeholder prompt context injection** — the stakeholder engine injects this block into every prompt:

```
Available metric response tool: apply_metric_response
Use after any trainee action that changes the incident trajectory.

Services and metrics in this scenario:
  payment-service: error_rate, p99_latency_ms, connection_pool_used, request_rate, cpu_utilization
  checkout-service: conversion_rate, error_rate, p99_latency_ms
  fraud-detection: error_rate, p99_latency_ms

Patterns: smooth_decay | stepped | queue_burndown | oscillating | blip_then_decay |
          cascade_clear | sawtooth_rebound | cliff
Speed: 1m | 5m | 15m | 30m | 60m
Direction: recovery (toward resolved state) | worsening (toward incident peak)
Magnitude: full (complete recovery) | partial (halfway to resolved state)

Rules:
- Check the audit log before calling — do not re-apply a response to a metric that already
  has an active reactive overlay in progress from the same action.
- Use direction=worsening when the trainee's action made the situation worse.
- Use magnitude=partial when the action helps but does not fix the root cause.
- Use different patterns per metric in one call to model asymmetric recovery.
- For oscillating, set oscillation_mode=sustained if the fix does not address root cause.
```

#### Incident Type Registry

The `incident_type` field on the focal service provides free defaults for Tier 1 metrics — it is a shortcut, not a contract. For each `(incident_type, archetype)` pair the registry defines: overlay type, default peak factor (multiple of baseline), and default onset offset in seconds relative to `t=0`.

**Unrecognized `incident_type` values do not cause a validation error.** The generator falls back gracefully: Tier 1 metrics produce baseline+rhythm+noise with no incident overlay. The server logs a warning at scenario load time so the author knows to add explicit `incident_peak` values for any metric that needs incident behavior. This preserves the "no code changes to add new scenarios" goal — new incident types work immediately via Tier 2 authoring, and can be added to the registry later to enable Tier 1 defaults.

**`onset_second` on any metric is always relative to `t=0`** — the absolute sim-time origin, not relative to any service-level field. Negative values are valid and mean the metric's incident behavior begins before the scenario's nominal incident start (precursors).

When an author provides `incident_peak`, the generator converts it to a factor internally: `factor = incident_peak / resolved_baseline_value`. Authors never see or reason about factors — they always write numbers they already know.

**`connection_pool_exhaustion`** — pool to a dependency exhausts; timeouts cascade into errors and latency. Dependency itself is healthy throughout.

| Archetype              | Overlay             | Default peak factor | Default onset offset |
| ---------------------- | ------------------- | ------------------- | -------------------- |
| `connection_pool_used` | `saturation`        | ceiling             | -90s (precursor)     |
| `p99_latency_ms`       | `spike_and_sustain` | 40x                 | 0s                   |
| `p50_latency_ms`       | `spike_and_sustain` | 12x                 | 0s                   |
| `error_rate`           | `spike_and_sustain` | 15x                 | +30s                 |
| `fault_rate`           | `spike_and_sustain` | 10x                 | +30s                 |
| `request_rate`         | `sudden_drop`       | 0.6x                | +30s                 |
| `cpu_utilization`      | `spike_and_sustain` | 1.8x                | +15s                 |
| `availability`         | `sudden_drop`       | 0.85x               | +30s                 |

**`bad_deploy_latency`** — deployment introduces slow code; latency climbs first, errors follow.

| Archetype              | Overlay               | Default peak factor | Default onset offset |
| ---------------------- | --------------------- | ------------------- | -------------------- |
| `p99_latency_ms`       | `spike_and_sustain`   | 25x                 | 0s                   |
| `p50_latency_ms`       | `spike_and_sustain`   | 8x                  | 0s                   |
| `error_rate`           | `spike_and_sustain`   | 8x                  | +60s                 |
| `cpu_utilization`      | `spike_and_sustain`   | 1.5x                | 0s                   |
| `request_rate`         | `sudden_drop`         | 0.75x               | +60s                 |
| `connection_pool_used` | `gradual_degradation` | 0.7x ceiling        | 0s                   |

**`traffic_spike`** — organic or synthetic surge; no bugs, just volume.

| Archetype              | Overlay             | Default peak factor | Default onset offset |
| ---------------------- | ------------------- | ------------------- | -------------------- |
| `request_rate`         | `spike_and_sustain` | 3.5x                | 0s                   |
| `cpu_utilization`      | `spike_and_sustain` | 2.2x                | 0s                   |
| `p99_latency_ms`       | `spike_and_sustain` | 4x                  | +15s                 |
| `p50_latency_ms`       | `spike_and_sustain` | 2x                  | +15s                 |
| `error_rate`           | `spike_and_sustain` | 5x                  | +30s                 |
| `connection_pool_used` | `saturation`        | ceiling             | +15s                 |
| `memory_jvm`           | `spike_and_sustain` | 1.4x                | +30s                 |

**`memory_leak`** — gradual heap growth building before `t=0`; slow burn.

| Archetype         | Overlay               | Default peak factor | Default onset offset |
| ----------------- | --------------------- | ------------------- | -------------------- |
| `memory_jvm`      | `gradual_degradation` | 2.5x                | -300s                |
| `memory_heap`     | `gradual_degradation` | 2.8x                | -300s                |
| `p99_latency_ms`  | `gradual_degradation` | 6x                  | -120s                |
| `cpu_utilization` | `gradual_degradation` | 1.6x                | -120s                |
| `error_rate`      | `spike_and_sustain`   | 6x                  | 0s                   |
| `request_rate`    | `sudden_drop`         | 0.7x                | +30s                 |

**`dependency_outage`** — hard dependency goes completely down; clean signal, no ambiguity.

| Archetype        | Overlay             | Default peak factor | Default onset offset |
| ---------------- | ------------------- | ------------------- | -------------------- |
| `error_rate`     | `spike_and_sustain` | 20x                 | 0s                   |
| `fault_rate`     | `spike_and_sustain` | 18x                 | 0s                   |
| `p99_latency_ms` | `spike_and_sustain` | 50x                 | 0s                   |
| `request_rate`   | `sudden_drop`       | 0.5x                | 0s                   |
| `availability`   | `sudden_drop`       | 0.6x                | 0s                   |

#### Correlated Service Generation

**`upstream_impact`** — the correlated service's incident component is derived from the focal service's incident delta, scaled by `impact_factor` and shifted by `lag_seconds`. Baseline and noise are generated independently using the correlated service's own `scale` and `health`.

```
correlated_incident_delta(t) = focal_incident_delta(t - lag_seconds) × impact_factor
correlated_point(t) = correlated_baseline(t) + correlated_rhythm(t)
                    + correlated_noise(t) + correlated_incident_delta(t)
```

Propagation is limited to **traffic and quality archetypes only**: `error_rate`, `fault_rate`, `availability`, `p99_latency_ms`, `p50_latency_ms`, `request_rate`. Infrastructure archetypes (`cpu_utilization`, `memory_jvm`, `memory_heap`, `disk_usage`, `connection_pool_used`) are never propagated — they are local to the service that owns them and an upstream service would not share these effects. Authors who need infrastructure effects on a correlated service should add them explicitly via `overrides` with Tier 2 or Tier 3 config.

**`exonerated`** — baseline + rhythm + noise only. No incident overlay by definition. The generator validates that no `incident_response` exists on any exonerated metric and that noise stays within normal statistical bounds during the incident window to prevent accidental false signals.

**`independent`** — mechanically identical to `exonerated`. Semantic distinction: `exonerated` means the service appears in logs or alerts but is healthy; `independent` means it is not topologically involved.

#### Traffic Profiles

Named profiles map to concrete rhythm parameters. Defined in code, referenced by name in config.

| Profile              | Pattern                       | Description                                                 |
| -------------------- | ----------------------------- | ----------------------------------------------------------- |
| `business_hours_web` | sinusoidal weekly             | Peaks ~2pm local, troughs ~3am, weekends 55% of weekday     |
| `business_hours_b2b` | sinusoidal weekly             | Peaks ~11am local, minimal weekend traffic (15%)            |
| `always_on_api`      | flat with slight daily ripple | Internal or global API — no strong daily pattern            |
| `batch_nightly`      | sawtooth daily                | Flat during day, sharp spike at batch window, drops after   |
| `batch_weekly`       | sawtooth weekly               | Flat most of week, large spike on scheduled day             |
| `none`               | flat                          | No rhythm — suitable for error rate, fault rate, disk usage |

#### PRNG Seeding

All noise functions receive a seeded PRNG instance seeded from `hash(scenarioId + sessionId + metricId)`. This guarantees:

- Same session → same noise on every render (consistent dashboard)
- Different session → different noise (re-running a scenario feels fresh)
- One PRNG per metric → no correlated noise across metrics on the same service

Tests use `series_override` for full determinism independent of PRNG.

#### Scenario Config — `ops_dashboard` Section

```yaml
ops_dashboard:
  pre_incident_seconds: 600 # history window before t=0
  resolution_seconds: 15 # one data point per 15 sim-seconds

  focal_service:
    name: payment-service
    scale:
      typical_rps: 350
      instance_count: 4
      max_connections: 18
    traffic_profile: business_hours_web
    health: degraded
    incident_type: connection_pool_exhaustion

    metrics:
      - archetype: error_rate
        critical_threshold: 5
        incident_peak: 14.2 # author knows this — it's what fired the alert
        onset_second: 30 # lags behind latency and pool exhaustion

      - archetype: request_rate # Tier 1 — fully derived

      - archetype: p99_latency_ms
        warning_threshold: 500
        critical_threshold: 2000
        incident_peak: 4800 # SLA breach value

      - archetype: connection_pool_used
        critical_threshold: 18 # pool max
        onset_second: -90 # precursor — saturates before errors appear

      - archetype: cpu_utilization # Tier 1 — fully derived

  correlated_services:
    - name: checkout-service
      correlation: upstream_impact
      lag_seconds: 15
      impact_factor: 0.6
      health: healthy
      overrides:
        - archetype: conversion_rate # business metric unique to checkout
          baseline_value: 68
          incident_peak: 28

    - name: fraud-detection
      correlation: exonerated
      health: healthy
      overrides: # only what the trainee needs to see to exonerate
        - archetype: p99_latency_ms
          baseline_value: 45 # fast internal service — different from focal
        - archetype: error_rate
          baseline_value: 0.3 # low and stays low — the exonerating signal
```

#### Generation at Load Time

The metric generator runs once per session when the scenario starts. It produces a complete `{t, v}` array for each metric covering `[-pre_incident_seconds, scenario_duration_seconds]` at `resolution_seconds` intervals. This array is stored in session state and delivered to the client in the `session_snapshot`.

**Graph time-gating:** The client uses current sim time as the right edge of the graph viewport. As sim time advances, more of the pre-generated series becomes visible — the trainee sees data revealed in real time, not a static chart showing the full incident upfront. The full series is delivered in the snapshot but the client only renders up to `currentSimTime`. This is both more realistic and prevents the trainee from seeing the incident spike before it happens in sim time.

**Payload size:** At `resolution_seconds: 15` and `pre_incident_seconds: 600`, a 30-minute scenario generates 160 points per metric (`(600 + 1800) / 15`). Across 10 metrics on 3 services that is 4,800 data points — well within a single JSON payload. Authors should tune `resolution_seconds` per scenario: short high-intensity scenarios can use `10`, long slow-burn scenarios (memory leak) can use `30` without losing fidelity.

**Config file size:** For complex scenarios with many services and metrics the `ops_dashboard` section can grow large. Authors may optionally split it into a separate `metrics.yaml` file in the scenario directory and reference it from `scenario.yaml` via `ops_dashboard_file: metrics.yaml`. The server resolves the reference at load time. All other scenario config remains in `scenario.yaml`.

### 8.4 Metric Archetypes

The complete list of valid archetypes. Every archetype has built-in defaults for noise type, rhythm inheritance, and scale derivation. Authors reference these by name in metric config.

**Traffic and throughput**

| Archetype          | Unit    | Noise type        | Inherits rhythm | Scale derivation            |
| ------------------ | ------- | ----------------- | --------------- | --------------------------- |
| `request_rate`     | rps     | `gaussian`        | Yes             | `typical_rps`               |
| `error_rate`       | percent | `sporadic_spikes` | No              | None (absolute)             |
| `fault_rate`       | percent | `sporadic_spikes` | No              | None (absolute)             |
| `availability`     | percent | `gaussian`        | No              | None (absolute)             |
| `throughput_bytes` | bytes/s | `gaussian`        | Yes             | `typical_rps` × avg payload |

**Latency**

| Archetype         | Unit | Noise type | Inherits rhythm | Scale derivation |
| ----------------- | ---- | ---------- | --------------- | ---------------- |
| `p50_latency_ms`  | ms   | `gaussian` | Weakly          | None (absolute)  |
| `p99_latency_ms`  | ms   | `gaussian` | Weakly          | None (absolute)  |
| `p999_latency_ms` | ms   | `gaussian` | Weakly          | None (absolute)  |

**Infrastructure — compute**

| Archetype         | Unit    | Noise type    | Inherits rhythm | Scale derivation |
| ----------------- | ------- | ------------- | --------------- | ---------------- |
| `cpu_utilization` | percent | `random_walk` | Yes             | None (absolute)  |
| `memory_heap`     | mb      | `random_walk` | No              | `instance_count` |
| `memory_jvm`      | mb      | `sawtooth_gc` | No              | `instance_count` |
| `memory_system`   | mb      | `random_walk` | No              | `instance_count` |
| `thread_count`    | count   | `random_walk` | Yes             | `instance_count` |

**Infrastructure — storage and network**

| Archetype           | Unit    | Noise type | Inherits rhythm | Scale derivation |
| ------------------- | ------- | ---------- | --------------- | ---------------- |
| `disk_usage`        | percent | `gaussian` | No              | None (absolute)  |
| `disk_iops`         | iops    | `gaussian` | Yes             | `typical_rps`    |
| `network_in_bytes`  | bytes/s | `gaussian` | Yes             | `typical_rps`    |
| `network_out_bytes` | bytes/s | `gaussian` | Yes             | `typical_rps`    |

**Connections and queues**

| Archetype              | Unit  | Noise type | Inherits rhythm | Scale derivation  |
| ---------------------- | ----- | ---------- | --------------- | ----------------- |
| `connection_pool_used` | count | `gaussian` | Yes             | `max_connections` |
| `queue_depth`          | count | `gaussian` | Yes             | `typical_rps`     |
| `queue_age_ms`         | ms    | `gaussian` | No              | None (absolute)   |

**Business metrics**

| Archetype         | Unit    | Noise type | Inherits rhythm | Scale derivation |
| ----------------- | ------- | ---------- | --------------- | ---------------- |
| `conversion_rate` | percent | `gaussian` | Yes             | None (absolute)  |
| `active_users`    | count   | `gaussian` | Yes             | `typical_rps`    |

**Special**

| Archetype     | Unit           | Noise type                       | Inherits rhythm | Scale derivation             |
| ------------- | -------------- | -------------------------------- | --------------- | ---------------------------- |
| `cert_expiry` | days           | `none`                           | No              | None — use `series_override` |
| `custom`      | author-defined | author-defined via `noise` level | Author-defined  | None                         |

---

### 8.5 Alarms

Alarms are defined in the scenario config and are the primary mechanism by which the trainee receives the initial page. They are distinct from metrics — an alarm is a named condition with a severity, tied to a metric threshold. Alarms can be pre-firing at `t=0`, fire at a specific `onset_second`, or be fired dynamically by the LLM stakeholder engine during the scenario.

```yaml
alarms:
  - id: payment-error-rate-critical
    service: payment-service
    metric_id: error_rate
    condition: "error_rate > 5%" # human-readable — shown in the alarm UI
    severity: SEV2
    onset_second: 30 # fires when error_rate overlay kicks in
    auto_page: true # triggers pagerduty-style email + bot message
    page_message: "payment-service error rate 14.2% (threshold: 5%)"

  - id: payment-pool-saturation
    service: payment-service
    metric_id: connection_pool_used
    condition: "connection_pool_used >= 18 (max)"
    severity: SEV3
    onset_second: -90 # precursor — fires before the main error rate alarm
    auto_page: false # visible on ops dashboard but no page sent
```

**Alarm lifecycle:**

- `auto_page: true` alarms automatically inject a scripted email (pagerduty-style) and a bot message into `#incidents` at `onset_second`. The content is driven by `page_message`.
- Alarms appear in the ops dashboard alarm panel with their severity and condition.
- Trainee actions `ack_page`, `suppress_alarm`, and `escalate_page` operate on alarm IDs.
- The LLM stakeholder engine can fire additional alarms via the `fire_alarm` tool (subject to `llm_event_tools` constraints in §8.6).
- Alarms are included in the `session_snapshot` and the `alarm_fired` / `alarm_silenced` SSE events keep the client in sync.

### 8.6 LLM Event Tool Constraints

The scenario config declares which event tools the LLM may use and any constraints:

```yaml
engine:
  llm_event_tools:
    - tool: apply_metric_response
      enabled: true # always validated server-side; no additional constraints needed
    - tool: fire_alarm
      max_calls: 2
    - tool: inject_log_entry
      enabled: true
    - tool: trigger_cascade
      services: [checkout-service]
```

The server validates every LLM tool call against this config before executing it. For `apply_metric_response`, validation confirms that every `service` and `metric_id` in the call exists in the scenario topology — the LLM never fabricates metric references.

### 8.7 Persona Behavior Rules

- **Team oncall personas** (e.g. `fraud-detection-oncall`) are silent until contacted by the trainee. This builds the muscle of proactive cross-team communication.
- **Stakeholder personas** (e.g. `eng-manager`, `checkout-eng`) may initiate contact autonomously — the LLM decides based on their system prompt and the conversation history.
- **Inbound events** (e.g. a downstream service filing a ticket at `t=0`) are scripted events, not LLM-driven.
- **Coach** never participates in sim channels.

**Persona config fields:**

| Field                    | Required | Description                                                                     |
| ------------------------ | -------- | ------------------------------------------------------------------------------- |
| `id`                     | Yes      | Unique identifier referenced throughout scenario config                         |
| `display_name`           | Yes      | Name shown in chat, email, and ticket UI                                        |
| `avatar_color`           | No       | Hex color for avatar in chat UI                                                 |
| `initiates_contact`      | Yes      | Whether this persona may send unprompted messages                               |
| `cooldown_seconds`       | Yes      | Minimum sim seconds between any two messages from this persona                  |
| `silent_until_contacted` | Yes      | If true, persona will not speak until the trainee @mentions them or opens a DM  |
| `system_prompt`          | Yes      | LLM instruction defining the persona's role, knowledge, and communication style |

```yaml
personas:
  - id: eng-manager
    display_name: "Jordan (Eng Manager)"
    avatar_color: "#E24A4A"
    initiates_contact: true
    cooldown_seconds: 300 # won't message more than once per 5 sim-minutes
    silent_until_contacted: false
    system_prompt: |
      You are Jordan, the engineering manager. You want brief status updates
      every 5 minutes: impact, theory, ETA. Be terse.

  - id: fraud-detection-oncall
    display_name: "Sam (Fraud Detection)"
    avatar_color: "#4AE29A"
    initiates_contact: false
    cooldown_seconds: 60
    silent_until_contacted: true # will not speak until trainee @mentions them or DMs them
    system_prompt: |
      You are Sam, on-call for fraud-detection. Your service is healthy.
      If asked, confirm clearly and note your dashboards look normal.
```

---

## 9. Trainee Action Taxonomy

All trainee actions are recorded in the audit log with sim timestamp. The server recognizes the following action types:

**Incident Management**

- `ack_page` — acknowledge the pagerduty alert
- `escalate_page` — escalate to another person
- `update_ticket` — change status, severity, or description
- `add_ticket_comment` — post a comment on the ticket
- `mark_resolved` — declare the incident over (win condition)

**Communication**

- `post_chat_message` — post to a named channel; if the message contains an @mention of a `silent_until_contacted` persona, that persona is marked as engaged and the stakeholder engine is triggered immediately
- `reply_email` — reply to an email thread
- `direct_message_persona` — post a message to a persona's DM channel. DMs are represented as regular chat channels with the naming convention `dm:<persona-id>` (e.g. `dm:fraud-detection-oncall`). This fits the existing `chat_message` SSE event and `POST /api/sessions/:id/chat` route without requiring a separate construct. Opening a DM for the first time with a `silent_until_contacted` persona marks them as engaged.

**Investigation**

- `open_tab` — open a sim tab (logs, dashboard, wiki, cicd)
- `search_logs` — submit a log search/filter query
- `view_metric` — interact with a metric on the dashboard
- `read_wiki_page` — open a specific runbook page
- `view_deployment_history` — open the CI/CD tab deployment history

**Remediation**

- `trigger_rollback` — roll back a service to a previous version
- `trigger_roll_forward` — deploy a newer version
- `restart_service` — restart a service or container
- `scale_cluster` — scale up or down
- `throttle_traffic` — apply rate limiting
- `suppress_alarm` — silence an alarm
- `emergency_deploy` — push a hotfix build
- `toggle_feature_flag` — enable or disable a feature flag

**Monitoring**

- `monitor_recovery` — view metrics after a remediation action (tracked by time-on-dashboard after action)

---

## 10. Session Lifecycle

```
1. Trainee selects scenario on picker screen
2. POST /api/sessions  →  server creates session, starts game loop
3. Client connects to SSE stream GET /api/sessions/:id/events
4. Game loop starts at t=0:
     - Scripted events fire on schedule
     - Stakeholder engine evaluates on each dirty tick
     - LLM tool calls injected into sim via SSE
5. Trainee takes actions via REST (POST /api/sessions/:id/actions)
     - Audit log updated
     - Stakeholder engine immediately triggered
     - Evaluator checks criteria
6. Trainee clicks "Mark Resolved" (POST /api/sessions/:id/resolve)
7. Game loop stops
8. Server begins async debrief generation (Debrief LLM call)
9. Server sends `debrief_ready` SSE event (carries sessionId)
10. Client polls GET /api/sessions/:id/debrief until 200
11. Client navigates to Debrief screen with debrief payload
```

---

## 11. Mock Mode

When `MOCK_LLM=true`, the `llm-client` module bypasses all API calls and returns responses from `scenarios/<id>/mock-llm-responses.yaml`. Required for all automated tests. Makes the sim fully deterministic.

Mock responses are keyed by `role` (which LLM is being called) and `trigger` (what caused the call).

```yaml
# scenarios/api-error-rate-spike/mock-llm-responses.yaml

stakeholder_responses:
  # trigger: tick_N = fires on the Nth stakeholder engine tick
  - trigger: tick_2
    tool_calls:
      - tool: send_message
        params:
          {
            persona: checkout-eng,
            channel: "#incidents",
            message: "Still seeing issues our end, any update?",
          }

  # trigger: after_action:<action_type>:<optional_param>
  - trigger: after_action:trigger_rollback:payment-service
    tool_calls:
      - tool: send_message
        params:
          {
            persona: checkout-eng,
            channel: "#incidents",
            message: "Looks like things are recovering on our side",
          }
      - tool: inject_log_entry
        params:
          {
            service: payment-service,
            level: INFO,
            message: "Rollback to v2.4.0 complete — connection pool recovering",
          }

coach_responses:
  # trigger: proactive_tick_N = fires on the Nth coach tick
  - trigger: proactive_tick_2
    message: "You've been in the logs for a while — have you checked the CI/CD tab for recent deployments?"

  # trigger: on_demand = response to trainee asking for help
  - trigger: on_demand
    message: "Look at the timestamps on recent deployments relative to when the error rate started climbing."

debrief_response:
  narrative: |
    The incident was caused by a misconfigured timeout introduced in v2.4.1 of payment-service...
    [full mock debrief narrative for tests]
```

If a trigger has no matching entry in the mock file, the LLM role returns an empty response (no tool calls, no message). This is valid — it means the stakeholder or coach had nothing to say at that moment.

---

## 12. Testing Strategy

Tests live alongside source code. Both server and client have full test coverage from day one.

```
server/
  __tests__/
    engine/
      game-loop.test.ts
      stakeholder-engine.test.ts
      event-scheduler.test.ts
      evaluator.test.ts
      audit-log.test.ts
    metrics/
      generator.test.ts             # series length, resolution, value bounds
      patterns/
        baseline.test.ts
        rhythm.test.ts
        noise.test.ts               # statistical properties — mean, std dev within tolerance
        incident-overlay.test.ts    # overlay applied at correct onset_second
    routes/
      scenarios.test.ts
      actions.test.ts
      sessions.test.ts

client/
  src/__tests__/
    tabs/
      EmailTab.test.tsx
      ChatTab.test.tsx
      TicketingTab.test.tsx
      OpsDashboardTab.test.tsx
      LogsTab.test.tsx
      WikiTab.test.tsx
      CICDTab.test.tsx
    components/
      CoachPanel.test.tsx
      SpeedControl.test.tsx
      ScenarioPicker.test.tsx
```

All game engine tests run with `MOCK_LLM=true`. The mock scenario fixture provides a minimal but complete scenario for unit testing.

---

## 13. Launch Scenario: API Error Rate Spike

**ID:** `api-error-rate-spike`
**Service type:** `api`
**Difficulty:** Medium

**Premise:** A deployment to `payment-service` 5 minutes before the incident introduced a timeout misconfiguration on the `fraud-detection` HTTP client. The misconfiguration causes connection pool exhaustion on the `fraud-detection` client inside `payment-service`, which cascades into a rising error rate returned to callers of `payment-service`.

**The trap:** Log output prominently features `fraud-detection` connection errors. The naive response is to investigate or attempt to remediate `fraud-detection` directly. The correct response is to notice the recent `payment-service` deployment and roll it back. `fraud-detection` itself is healthy throughout the incident.

**Topology:**

```
mobile-app  ──►  checkout-service  ──►  payment-service  ──►  fraud-detection
                                                          ──►  ledger-service
```

**Key signals:**

- `payment-service` error rate spikes from ~0.8% baseline to 14% at `t=0` (with realistic 4xx noise throughout)
- `payment-service` deployment `v2.4.1` at `t=-300s` (5 min before incident)
- `connection_pool_used` to `fraud-detection` saturates at `t=-90s` — a precursor the alert doesn't surface
- Logs: `TimeoutException` and connection pool exhaustion on `fraud-detection` client
- `fraud-detection` metrics: normal error rate (~0.3%), normal latency — the exonerating signal
- `checkout-service` conversion rate drops from 68% to ~28% — visible business impact

**Metrics config summary (`ops_dashboard`):**

```yaml
focal_service:
  name: payment-service
  scale: { typical_rps: 350, instance_count: 4, max_connections: 18 }
  traffic_profile: business_hours_web
  health: degraded
  incident_type: connection_pool_exhaustion
  metrics:
    - archetype: error_rate
      critical_threshold: 5
      incident_peak: 14.2
      onset_second: 30
    - archetype: request_rate
    - archetype: p99_latency_ms
      warning_threshold: 500
      critical_threshold: 2000
      incident_peak: 4800
    - archetype: connection_pool_used
      critical_threshold: 18
      onset_second: -90
    - archetype: cpu_utilization

correlated_services:
  - name: checkout-service
    correlation: upstream_impact
    lag_seconds: 15
    impact_factor: 0.6
    health: healthy
    overrides:
      - archetype: conversion_rate
        baseline_value: 68
        incident_peak: 28
  - name: fraud-detection
    correlation: exonerated
    health: healthy
    overrides:
      - archetype: p99_latency_ms
        baseline_value: 45
      - archetype: error_rate
        baseline_value: 0.3
```

**Personas:**

- `checkout-eng` — upstream, frustrated, wants updates (initiates contact)
- `eng-manager` — wants impact and ETA (initiates contact)
- `fraud-detection-oncall` — silent until contacted; can confirm service is healthy

**Correct resolution path:**

1. Acknowledge the page
2. Review logs → identify timeout/pool exhaustion pattern
3. Review CI/CD → notice `v2.4.1` deployed 5 min before incident
4. Roll back `payment-service` to `v2.4.0`
5. Monitor recovery on error rate metric
6. Update ticket with root cause and resolution
7. Mark resolved

---

## 14. Project Structure

```
oncall-sim/
├── docs/
│   └── design/
│       ├── hld.md                        # this document
│       └── lld/                          # component-level design docs
├── scenarios/
│   ├── api-error-rate-spike/
│   │   ├── scenario.yaml
│   │   ├── email/
│   │   ├── tickets/
│   │   ├── wiki/
│   │   └── mock-llm-responses.yaml
│   └── _fixture/                         # minimal scenario used by all tests
│       └── scenario.yaml
├── server/
│   ├── src/
│   │   ├── index.ts                      # express app entry point
│   │   ├── config.ts                     # env var loading and validation
│   │   ├── routes/
│   │   │   ├── scenarios.ts
│   │   │   ├── sessions.ts
│   │   │   ├── actions.ts
│   │   │   └── llm.ts
│   │   ├── engine/
│   │   │   ├── game-loop.ts
│   │   │   ├── event-scheduler.ts
│   │   │   ├── stakeholder-engine.ts
│   │   │   ├── audit-log.ts
│   │   │   ├── conversation-store.ts
│   │   │   ├── sim-clock.ts
│   │   │   └── evaluator.ts
│   │   ├── metrics/
│   │   │   ├── generator.ts              # orchestrates full series generation per metric
│   │   │   ├── resolver.ts               # parameter resolution chain: author → registry → archetype → scale
│   │   │   ├── incident-types.ts         # incident type registry: (incident_type × archetype) → response profile
│   │   │   ├── archetypes.ts             # archetype defaults: noise type, rhythm inheritance, scale derivation
│   │   │   ├── patterns/
│   │   │   │   ├── baseline.ts           # flat baseline generation
│   │   │   │   ├── rhythm.ts             # traffic profiles → sinusoidal/sawtooth rhythm deltas
│   │   │   │   ├── noise.ts              # gaussian, random_walk, sporadic_spikes, sawtooth_gc
│   │   │   │   └── incident-overlay.ts   # spike_and_sustain, sudden_drop, saturation, gradual_degradation
│   │   │   └── correlation.ts            # upstream_impact and exonerated service derivation
│   │   ├── llm/
│   │   │   ├── llm-client.ts             # provider abstraction interface
│   │   │   ├── openai-provider.ts
│   │   │   ├── bedrock-provider.ts
│   │   │   ├── mock-provider.ts
│   │   │   └── tool-definitions.ts       # tool schemas for all three LLM roles
│   │   ├── scenario/
│   │   │   ├── loader.ts                 # load + validate scenario YAML
│   │   │   └── schema.ts                 # Zod schema for scenario.yaml
│   │   ├── session/
│   │   │   ├── session-store.ts          # in-memory session registry
│   │   │   └── session.ts                # session model
│   │   ├── sse/
│   │   │   └── sse-broker.ts             # manages SSE connections per session
│   │   └── types/
│   │       └── events.ts                 # shared SSE event type definitions
│   ├── __tests__/
│   │   ├── engine/
│   │   ├── routes/
│   │   └── llm/
│   ├── package.json
│   └── tsconfig.json
├── client/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── context/
│   │   │   ├── ScenarioContext.tsx
│   │   │   ├── SessionContext.tsx
│   │   │   └── AuditContext.tsx
│   │   ├── hooks/
│   │   │   ├── useSSE.ts                 # SSE connection + reconnect logic
│   │   │   └── useSimClock.ts            # local sim time display
│   │   ├── components/
│   │   │   ├── TabBar.tsx
│   │   │   ├── SpeedControl.tsx
│   │   │   ├── CoachPanel.tsx
│   │   │   ├── ScenarioPicker.tsx
│   │   │   ├── DebriefScreen.tsx
│   │   │   └── tabs/
│   │   │       ├── EmailTab.tsx
│   │   │       ├── ChatTab.tsx
│   │   │       ├── TicketingTab.tsx
│   │   │       ├── OpsDashboardTab.tsx
│   │   │       ├── LogsTab.tsx
│   │   │       ├── WikiTab.tsx
│   │   │       └── CICDTab.tsx
│   │   └── types/
│   │       └── events.ts                 # re-exports from shared/types/events.ts via path alias
│   ├── __tests__/
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── shared/
│   └── types/
│       └── events.ts                     # canonical SSE event + data types
│                                         # server and client both reference this
│                                         # via tsconfig path aliases — no copying or symlinking
├── .env.example
├── package.json                          # root workspace package.json
└── README.md
```

---

## 15. Configuration

All server configuration is via environment variables. A `.env.example` file is committed to the repo. The server validates required variables at startup and exits with a clear error if any are missing.

```bash
# LLM provider: openai | bedrock
LLM_PROVIDER=openai

# OpenAI-compatible settings (used when LLM_PROVIDER=openai)
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1   # override for Azure, Ollama, etc.
OPENAI_MODEL=gpt-4o

# AWS Bedrock settings (used when LLM_PROVIDER=bedrock)
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0

# Mock mode: bypasses all LLM API calls, required for tests
MOCK_LLM=false

# Server
PORT=3001
SCENARIOS_DIR=../scenarios              # path to scenarios directory

# LLM timeouts and retries
LLM_TIMEOUT_MS=30000
LLM_MAX_RETRIES=2
```

---

## 16. SSE Event Schema

The SSE stream is the primary channel for server → client communication. All events are JSON. Every event has a `type` discriminator field. The client handles each type independently.

```typescript
// Canonical type definitions live in shared/types/events.ts
// Server and client both import from this location (see §14 project structure)

// Core data shapes
interface TimeSeriesPoint {
  t: number;
  v: number;
} // t = sim seconds from t=0, v = value
interface AuditEntry {
  simTime: number;
  action: string;
  params: Record<string, unknown>;
}
interface ChatMessage {
  id: string;
  persona: string;
  text: string;
  simTime: number;
}
interface Email {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  simTime: number;
  threadId: string;
}
interface Ticket {
  id: string;
  title: string;
  severity: string;
  status: string;
  description: string;
  createdBy: string;
  simTime: number;
}
interface TicketComment {
  id: string;
  author: string;
  body: string;
  simTime: number;
}
interface LogEntry {
  id: string;
  simTime: number;
  level: string;
  service: string;
  message: string;
}
interface Alarm {
  id: string;
  service: string;
  metric: string;
  condition: string;
  value: number;
  severity: string;
  status: "firing" | "acknowledged" | "suppressed";
  simTime: number;
}
interface Deployment {
  version: string;
  deployedAtSec: number;
  status: string;
  commitMessage: string;
  author: string;
}

// Full sim state snapshot (sent on SSE reconnect)
interface SessionSnapshot {
  sessionId: string;
  scenarioId: string;
  simTime: number;
  speed: number;
  paused: boolean;
  emails: Email[];
  chatChannels: Record<string, ChatMessage[]>;
  tickets: Ticket[];
  ticketComments: Record<string, TicketComment[]>;
  logs: LogEntry[];
  metrics: Record<string, Record<string, TimeSeriesPoint[]>>; // service → metricId → series
  alarms: Alarm[];
  deployments: Record<string, Deployment[]>; // service → deployments
  auditLog: AuditEntry[];
  coachMessages: string[];
}

// Discriminated union of all possible SSE events
type SimEvent =
  | { type: "session_snapshot"; snapshot: SessionSnapshot } // first event on any SSE connection; full state
  | { type: "session_expired"; reason: string } // session was cleaned up; redirect to picker
  | { type: "sim_time"; simTime: number; speed: number; paused: boolean } // heartbeat every real second
  | { type: "email_received"; email: Email }
  | { type: "chat_message"; channel: string; message: ChatMessage }
  | { type: "ticket_created"; ticket: Ticket }
  | { type: "ticket_updated"; ticketId: string; changes: Partial<Ticket> }
  | { type: "ticket_comment"; ticketId: string; comment: TicketComment }
  | { type: "log_entry"; entry: LogEntry }
  | {
      type: "metric_update";
      service: string;
      metricId: string;
      point: TimeSeriesPoint;
    } // streamed as reactive overlay points become visible at current sim time
  | { type: "alarm_fired"; alarm: Alarm }
  | { type: "alarm_silenced"; alarmId: string }
  | { type: "deployment_update"; service: string; deployment: Deployment }
  | { type: "coach_message"; message: string }
  | { type: "debrief_ready"; sessionId: string } // poll GET /api/sessions/:id/debrief using existing session ID
  | { type: "error"; code: string; message: string };
```

The client's SSE hook dispatches incoming events into the appropriate context/store based on `type`. The `session_snapshot` event is always the first event sent on a new or reconnected SSE connection and gives the client the complete current state.

---

## 17. Sim Clock

The sim clock is owned by the server. It is not a wall clock — it is a logical counter that advances according to the speed multiplier and respects pause.

**How it works:**

- The server stores `simTimeMs` (elapsed simulation milliseconds since scenario start) and `lastRealTimestampMs` (the real wall-clock time of the last update)
- On each game loop tick: `simTimeMs += realElapsed * speedMultiplier`
- When paused: `lastRealTimestampMs` is not advanced
- The server broadcasts a `sim_time` event to the client every real second

**Client display:**

- The client receives `sim_time` events and maintains a local display clock
- The display clock interpolates between server updates for smooth rendering
- The client never drives sim time — it only displays what the server reports

**Scripted event scheduling:**

- Events are keyed by `at_second` (seconds of sim time since `t=0`)
- The event scheduler compares `at_second * 1000` against `simTimeMs` on each tick
- Once fired, events are marked so they don't re-fire

---

## 18. Concurrency and Race Conditions

The server is single-threaded Node.js. However, async operations (LLM calls, file reads) create interleaving risks that must be managed explicitly.

**Key risks:**

1. **Tick fires while a previous LLM call is in flight.** Mitigation: the stakeholder engine sets an `inFlight` flag when an LLM call starts. If `inFlight` is true, the next tick skips the LLM call but remains dirty.

2. **Trainee action arrives while LLM call is in flight.** Mitigation: the action is recorded in the audit log immediately (synchronous). The stakeholder engine sees it on the next tick after the in-flight call completes.

3. **Multiple SSE clients for the same session** (e.g. browser tab refresh before old connection closes). Mitigation: the SSE broker tracks connections by session ID. New connections receive a full state snapshot on connect (see Section 19). Old connections are cleaned up on the next heartbeat timeout.

4. **Conversation-store writes during LLM context build.** Mitigation: context is built as a snapshot at the start of each tick evaluation. New messages arriving mid-evaluation don't affect the current LLM call; they are picked up on the next tick.

---

## 19. SSE Reconnection and State Recovery

Network drops and browser tab refreshes are expected. The client must be able to reconnect and restore full sim state without restarting the scenario.

**Server-side:**

- Sessions survive SSE disconnection (the game loop continues running)
- The session stores a full state snapshot: all emails, all chat messages, all log entries, current metric series, all ticket state, deployment history, audit log, current sim time
- On a new SSE connection for an existing session, the server immediately sends a `session_snapshot` event containing the full state before resuming the live event stream

**Client-side:**

- The `useSSE` hook detects disconnection and attempts reconnection with exponential backoff (1s, 2s, 4s, max 30s)
- On reconnect, the client clears local state and repopulates from the `session_snapshot`
- A "reconnecting..." indicator is shown during backoff

**Session expiry:**

- Sessions with no SSE connection for more than 10 minutes are cleaned up from memory
- If the client reconnects after expiry, it receives a `session_expired` event and is redirected to the scenario picker

---

## 20. LLM Resilience

LLM API calls can fail, time out, or return malformed responses. The game loop must never crash due to LLM errors.

**Timeout:** Every LLM call has a hard timeout (`LLM_TIMEOUT_MS`, default 30s). If exceeded, the call is abandoned and the session remains dirty for the next tick.

**Retries:** Failed calls are retried up to `LLM_MAX_RETRIES` times (default 2) with a 1s delay between attempts. Retries are not attempted for 4xx errors (bad request, invalid API key).

**Malformed tool call responses:** The server validates every tool call response against the expected schema before execution. Invalid tool calls are logged and skipped — they do not crash the engine or corrupt session state.

**Graceful degradation:** If the LLM is persistently unavailable (all retries exhausted), the game loop continues running. Scripted events still fire. Only the dynamic stakeholder responses are absent. The coach panel shows a warning that AI responses are temporarily unavailable.

**Rate limiting:** If the LLM provider returns a 429, the stakeholder engine backs off exponentially and skips ticks until the backoff window expires.

---

## 21. Scenario Validation

Scenarios are validated at server startup, not at request time. A malformed scenario causes the server to log a clear error and exclude that scenario from the available list — it does not prevent other scenarios from loading or the server from starting.

Validation uses a Zod schema that checks:

- All required fields are present and correctly typed
- All file references (`body_file`, `content_file`, etc.) resolve to existing files
- All persona IDs referenced in chat/email/ticket configs exist in the `personas` section
- All remediation action IDs referenced in `evaluation.relevant_actions` exist in `remediation_actions`
- All alarm `metric_id` values reference a metric defined in `ops_dashboard` for the same service
- All alarm `service` values reference a service defined in `ops_dashboard`
- All metric `archetype` values are valid entries from the archetype registry (§8.4); unrecognized archetypes are a validation error, unlike unrecognized `incident_type` which is a warning
- All `correlated_services` names appear in the scenario `topology`
- Time series `series_override` data points have valid `t` and `v` values
- No duplicate IDs within any section (alarm IDs, metric IDs, persona IDs, event IDs)

Validation errors are printed at startup with the scenario ID, field path, and a human-readable message.

---

## 22. Debrief

The debrief screen is the trainee's post-incident learning moment. It is shown immediately after "Mark Resolved" and is never skipped.

**Content:**

1. **Incident timeline** — a visual timeline of key events: scripted events, trainee actions, and LLM-injected events, all plotted against sim time. Shows what happened when.

2. **Action summary** — a table comparing what the trainee did against the scenario's `relevant_actions` and `red_herrings`. For each relevant action: did they do it, and how quickly? For each red herring: did they go down the wrong path?

3. **LLM narrative** — a 3-5 paragraph narrative generated by the Debrief LLM. Structured as:
   - What the incident was and what caused it
   - What the trainee did well
   - What an experienced SRE would have done differently
   - Key things to watch for in future incidents of this type

4. **Full audit log** — an expandable section showing every recorded action with sim timestamp.

**Debrief LLM prompt structure:**

- System: "You are an experienced SRE providing post-incident feedback to an engineer in training."
- Context: scenario `evaluation` config (root cause, relevant actions, red herrings, debrief context)
- Trainee data: full audit log with timestamps, which relevant actions were taken, which red herrings were triggered
- Instruction: produce the narrative in the defined structure

The debrief does not use tool calls — all data is injected directly into the prompt as context.

---

## 23. User Stories

### Trainee

**Scenario Selection**

- As a trainee, I want to see a list of available scenarios with title, description, difficulty, and service type so I can choose an appropriate training exercise.
- As a trainee, I want to start a scenario and immediately be placed in a realistic incident environment so there is no ambiguity about when training begins.

**Email**

- As a trainee, I want to receive pagerduty-style alert emails that arrive during the scenario so I experience a realistic initial notification.
- As a trainee, I want to reply to emails so I can practice written stakeholder communication.
- As a trainee, I want to see email threads grouped by conversation so I can follow a discussion.

**Chat**

- As a trainee, I want to post messages to incident channels so I can practice real-time communication during an incident.
- As a trainee, I want to receive messages from simulated stakeholders in chat channels so I experience realistic pressure and requests for updates.
- As a trainee, I want to @mention a specific persona to engage them directly, especially when reaching out to other team oncalls, so I build the habit of proactive cross-team communication.
- As a trainee, I want to open a direct message with a persona so I can have a focused conversation without cluttering the main channel.

**Ticketing**

- As a trainee, I want to view the active incident ticket so I have a central place to see the reported impact and severity.
- As a trainee, I want to update the ticket status and severity so I can practice incident lifecycle management.
- As a trainee, I want to add comments to the ticket so I can practice documenting my investigation and actions in real time.
- As a trainee, I want to mark the ticket as resolved to signal I believe the incident is over and trigger the debrief.

**Ops Dashboard**

- As a trainee, I want to view time-series metric graphs for each service in the topology so I can identify anomalies and understand blast radius.
- As a trainee, I want to see warning and critical threshold lines on metric graphs so I know what normal looks like vs. degraded.
- As a trainee, I want to view metrics for downstream and upstream services, not just the focal service, so I can distinguish root cause from cascading effects.

**Logs**

- As a trainee, I want to see a real-time log stream that populates during the scenario so I experience log-diving under pressure.
- As a trainee, I want to filter and search logs by keyword, service, and severity so I can find relevant signal efficiently.
- As a trainee, I want new log entries to appear during the scenario (both scripted and LLM-injected) so the log stream feels live.

**Wiki / Runbooks**

- As a trainee, I want to read service runbooks so I can practice finding and applying documented procedures during an incident.
- As a trainee, I want runbooks to be searchable so I can find relevant procedures quickly.

**CI/CD**

- As a trainee, I want to view recent deployment history for each service so I can correlate deployments with incident timing.
- As a trainee, I want to trigger a rollback on a service so I can practice remediating a bad deploy.
- As a trainee, I want to see the result of a rollback reflected in the sim (correct fix = metrics recover; incorrect fix = no change) so I learn which actions are effective.
- As a trainee, I want to trigger other remediation actions (restart, scale, throttle, feature flag) so I can practice the full range of on-call responses.

**Alarms**

- As a trainee, I want to acknowledge an active alarm so I can practice alarm management.
- As a trainee, I want to escalate a page to another person so I can practice escalation decisions.
- As a trainee, I want to suppress an alarm so I can practice noise reduction during an incident.

**Timeline and Speed**

- As a trainee, I want to control the simulation speed so I can adjust the pacing to match my current skill level.
- As a trainee, I want to pause the simulation so I can take time to investigate without the clock running.

**Coach**

- As a trainee, I want to ask the coach for help at any time so I can get guidance when I am stuck without it feeling like failure.
- As a trainee, I want the coach to proactively nudge me if I am idle or appear to be missing something important so I do not stay stuck without realizing it.
- As a trainee, I want coach messages to be separate from the simulation channels so they do not break immersion or clutter the incident timeline.

**Debrief**

- As a trainee, I want to see a timeline of the full incident after resolution so I can understand the sequence of events.
- As a trainee, I want to see a comparison of my actions against the ideal response path so I know what I did well and what I missed.
- As a trainee, I want to read an LLM-generated narrative that explains the root cause, assesses my performance, and gives me concrete things to improve so I leave with actionable learning.
- As a trainee, I want to see my full audit log so I can review every action I took and when.

---

### Scenario Author

- As a scenario author, I want to define a complete scenario using only YAML and Markdown files so I do not need to touch application code.
- As a scenario author, I want to define scripted events (emails, log entries, bot messages) at specific sim-time offsets so key signals arrive predictably.
- As a scenario author, I want to define LLM personas with system prompts, cooldowns, and contact behavior so I can control how stakeholders behave without hardcoding responses.
- As a scenario author, I want to define which remediation actions fix the incident and which are red herrings so the sim responds correctly to trainee actions.
- As a scenario author, I want to define evaluation criteria (relevant actions, red herrings, debrief context) so the debrief LLM has authoritative reference material.
- As a scenario author, I want to define mock LLM responses so my scenario can be tested deterministically without a live API key.
- As a scenario author, I want the server to validate my scenario config at startup and report clear errors so I can fix mistakes quickly.

---

## 24. Future Work (Post-MVP)

- **Session persistence** — store session state to disk or a database so refresh restores progress without data loss
- **In-browser code editor** — edit a config or code file and trigger an emergency deploy pipeline
- **Multi-user / instructor mode** — session tracking without login, instructor review dashboard showing trainee audit logs
- **Additional scenario types** — database connection exhaustion, memory leak, traffic spike, bad config deploy, dependency outage, certificate expiry
- **Gamification** — optional points/scoring layer on top of the action audit log, leaderboard
- **Custom scenario builder** — UI for creating scenarios without editing YAML directly
- **Scenario versioning** — track changes to scenario configs over time so historical session replays remain accurate
