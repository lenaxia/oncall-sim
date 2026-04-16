# Phase 12 — Scenario Builder & Custom Scenario Upload

**Version:** 1.3
**Last Updated:** 2026-04-16
**Status:** Implemented (v1.0.40) — Amendment 1.2 pending implementation

---

## Table of Contents

1. [Purpose & Scope](#1-purpose--scope)
2. [Feature Overview](#2-feature-overview)
3. [Screen Layout](#3-screen-layout)
4. [Architecture](#4-architecture)
5. [LLM Role & Tools](#5-llm-role--tools)
   - 5a. [Amendment 1.2 — send_message & ask_question tools](#5a-amendment-12--send_message--ask_question-tools)
6. [ScenarioValidator — Reusable Validation Pipeline](#6-scenariovalidator--reusable-validation-pipeline)
7. [Tool Call Validation Pipeline](#7-tool-call-validation-pipeline)
8. [useScenarioBuilder Hook](#8-usescenariobuilder-hook)
9. [Component Tree](#9-component-tree)
10. [ScenarioCanvas — Card Definitions](#10-scenariocanvas--card-definitions)
11. [Thinking Indicator](#11-thinking-indicator)
12. [Download Button States](#12-download-button-states)
13. [Upload Feature](#13-upload-feature)
14. [Mock Mode](#14-mock-mode)
15. [New & Modified Files](#15-new--modified-files)
16. [TypeScript Interfaces](#16-typescript-interfaces)
17. [Test Strategy](#17-test-strategy)
18. [Non-Goals](#18-non-goals)

---

## 1. Purpose & Scope

Phase 12 adds two user-facing features to the scenario selection screen:

1. **Scenario Builder** — an LLM-driven collaborative chat that helps a user author a new scenario YAML from scratch. The user describes what they want at any level of detail; the LLM fills gaps, makes opinionated assumptions, asks targeted clarifying questions, and incrementally builds the scenario. The result is rendered live as a card-based canvas. When complete, the user downloads a validated YAML file.

2. **Custom Scenario Upload** — a file picker on the scenario selection screen that accepts a local `.yaml` file, validates it through the existing loader pipeline, and adds it to the in-memory scenario list.

Both features are entirely client-side. No server changes required.

---

## 2. Feature Overview

### Scenario Builder

- Accessed via **"Build scenario"** button on the `ScenarioPicker` screen.
- Opens a full-screen `ScenarioBuilderScreen` (new `AppScreen` value `"builder"`).
- Left 2/3: **ScenarioCanvas** — live-updating card grid representing the current scenario draft.
- Right 1/3: **ScenarioBuilderChat** — scrollable message history + text input.
- The LLM iteratively builds the scenario through conversation. It calls `update_scenario` whenever it commits new data. Cards update live with a brief highlight pulse on change.
- When the LLM (or user) judges the scenario complete, the LLM calls `mark_complete`. The Download button becomes primary.
- After download, the user clicks **← Back to scenarios** in the header.

### Custom Scenario Upload

- Accessible via **"Load scenario"** button at the top of `ScenarioPicker`, adjacent to **"Build scenario"**.
- Opens a hidden `<input type="file" accept=".yaml,.yml">`.
- Validates through the existing `loadScenarioFromText` pipeline with a `noOpResolver` (rejects `body_file` / `content_file` refs — uploaded YAMLs must be self-contained).
- Success: scenario prepended to the in-memory list with a "Custom" badge. No page navigation.
- Failure: inline error block below the two buttons, listing each `field: message` pair, dismissable.

---

## 3. Screen Layout

### ScenarioPicker (modified header)

```
┌──────────────────────────────────────────────────────────────┐
│  On-Call Training Simulator                                  │
│  Select a scenario to begin your training session.           │
│                                                              │
│  [ Build scenario ]  [ Load scenario ]                       │
│  [upload error block — only shown on validation failure]     │
├──────────────────────────────────────────────────────────────┤
│  [scenario cards...]                                         │
└──────────────────────────────────────────────────────────────┘
```

### ScenarioBuilderScreen (new full-screen)

```
┌────────────────────────────────────────────┬─────────────────────────┐
│  ← Back to scenarios  [Download .yaml]     │                         │
├────────────────────────────────────────────┤   Scenario Builder      │
│                                            ├─────────────────────────┤
│   SCENARIO CANVAS  (2/3 width)             │                         │
│   scrollable                               │   [message history]     │
│                                            │   scrollable            │
│   ┌─────────────────────────────────────┐  │                         │
│   │ Overview                            │  │   bot: "What kind of    │
│   │  Title · Difficulty · Duration      │  │   incident..."          │
│   │  Tags                               │  │                         │
│   └─────────────────────────────────────┘  │   user: "database       │
│                                            │   going down..."        │
│   ┌─────────────────────────────────────┐  │                         │
│   │ Incident                            │  │   bot: "Got it. [...]"  │
│   │  Service · Component · Onset        │  │                         │
│   │  Overlay · Magnitude                │  │   [··· thinking]        │
│   └─────────────────────────────────────┘  │                         │
│                                            ├─────────────────────────┤
│   ┌─────────────────────────────────────┐  │                         │
│   │ Service Topology                    │  │   [text input]  [Send]  │
│   │  ALB → ECS → RDS                    │  │                         │
│   └─────────────────────────────────────┘  │                         │
│                                            │                         │
│   ┌─────────────────────────────────────┐  │                         │
│   │ Personas  (2)                       │  │                         │
│   │  ● Sara Chen · Staff SWE · Payments │  │                         │
│   │  ● David Park · DRE · Infra         │  │                         │
│   └─────────────────────────────────────┘  │                         │
│                                            │                         │
│   ┌─────────────────────────────────────┐  │                         │
│   │ Remediation Actions                 │  │                         │
│   │  ✓ rollback (correct fix)           │  │                         │
│   │  ✗ restart_service                  │  │                         │
│   └─────────────────────────────────────┘  │                         │
│                                            │                         │
│   ┌─────────────────────────────────────┐  │                         │
│   │ Evaluation                          │  │                         │
│   │  Root cause · Debrief context       │  │                         │
│   └─────────────────────────────────────┘  │                         │
│                                            │                         │
│   ┌─────────────────────────────────────┐  │                         │
│   │ Timeline & Engine                   │  │                         │
│   │  Speed · Duration · Tick interval   │  │                         │
│   └─────────────────────────────────────┘  │                         │
│                                            │                         │
│   ┌─────────────────────────────────────┐  │                         │
│   │ Assumptions                         │  │                         │
│   │  Fields filled without asking       │  │                         │
│   └─────────────────────────────────────┘  │                         │
│                                            │                         │
│   [validation error bar — bottom, sticky]  │                         │
└────────────────────────────────────────────┴─────────────────────────┘
```

**Empty state** (before first `update_scenario`):

Canvas shows a single centred placeholder:

```
  Start describing your scenario in the chat →
  The scenario will take shape here as you talk.
```

Once the user sends their first message and the LLM is thinking, the placeholder adds the bouncing dots indicator.

---

## 4. Architecture

### Data flow

```
User types message
  → useScenarioBuilder.sendMessage(text)
    → append user BuilderMessage to state.messages
    → set state.thinking = true
    → call LLMClient.call({ role: "scenario_builder", messages, tools: BUILDER_TOOLS })
    → LLMResponse arrives:
        for each text chunk  → append bot BuilderMessage
        for each tool call:
          if tool === "update_scenario":
            → run UpdateScenarioValidationPipeline(patch, currentDraft)
            → if PASS: merge into state.draft, re-render canvas cards (highlight pulse)
                       return { ok: true } to LLM as tool result
            → if FAIL: do NOT update draft or canvas
                       return { ok: false, errors: [...] } to LLM as tool result
                       LLM receives errors and must fix + retry
          if tool === "mark_complete":
            → run UpdateScenarioValidationPipeline(currentDraft) [full re-validation]
            → if PASS: serialise YAML, set state.validatedYaml, set state.phase = "complete"
                       return { ok: true }
            → if FAIL: return { ok: false, errors: [...] }
    → set state.thinking = false
```

### Responsibility boundaries

| Layer                   | Responsibility                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `useScenarioBuilder`    | All state, LLM orchestration, tool call handling, validation pipeline                 |
| `ScenarioBuilderScreen` | Layout (2/3 + 1/3 split), header bar, download trigger                                |
| `ScenarioCanvas`        | Rendering draft as cards; receives `draft` + `thinking` as props; stateless           |
| `ScenarioBuilderChat`   | Message list rendering + input; fires `sendMessage`; stateless except scroll position |
| `ScenarioPicker`        | Upload button + file reading + inline error display                                   |

### No coupling to the game engine

The builder lives entirely outside a sim session. It uses `createLLMClient()` from `llm-client.ts` directly — the same factory used by the game engine, but instantiated independently in the hook. No `GameLoop`, `StakeholderEngine`, `SessionContext`, or `ScenarioContext` involvement.

---

## 5. LLM Role & Tools

### New LLMRole

```ts
// llm-client.ts
export type LLMRole = "stakeholder" | "coach" | "debrief" | "scenario_builder";
```

### Builder Tools

Four tools defined in `tool-definitions.ts` under the `BUILDER_TOOLS` export: `update_scenario`, `mark_complete`, `send_message`, and `ask_question`. The first two manage scenario data; the latter two manage communication. See Section 5a for the full definitions of `send_message` and `ask_question`.

#### `update_scenario`

Called whenever the LLM wants to commit new or changed scenario data. The patch is a partial `RawScenarioConfig` (snake_case, matching the Zod schema). Arrays are **replaced**, not appended — the LLM always sends the full updated array for any array field it changes.

```ts
{
  name: "update_scenario",
  description:
    "Commit new or changed scenario data. The patch is merged into the current draft. " +
    "Arrays are replaced in full — always send the complete updated array for any array field. " +
    "The patch is validated before being applied. If validation fails, errors are returned and " +
    "you must fix them before the draft is updated. Call this as often as you like — after " +
    "each user answer, after making an assumption, mid-conversation.",
  parameters: {
    type: "object",
    required: ["patch"],
    properties: {
      patch: {
        type: "object",
        description:
          "Partial RawScenarioConfig (snake_case). Only include fields you are adding or changing.",
      },
      assumptions: {
        type: "array",
        description:
          "List of assumptions made in this patch — fields filled without asking the user. " +
          "These are displayed on the canvas Assumptions card.",
        items: { type: "string" },
      },
    },
  },
}
```

#### `mark_complete`

Called when the LLM judges the scenario is ready. Triggers final full validation. On success, the Download button becomes primary and the phase transitions to `"complete"`. On failure, errors are returned for fixing.

```ts
{
  name: "mark_complete",
  description:
    "Signal that the scenario is ready for download. Triggers final validation. " +
    "If validation fails, errors are returned — fix them with update_scenario and call again. " +
    "After mark_complete succeeds, remain available for refinements: the user can still ask " +
    "for changes. Each change should call update_scenario then mark_complete again.",
  parameters: {
    type: "object",
    properties: {},
  },
}
```

### System Prompt

The builder system prompt is a constant in `useScenarioBuilder.ts`. It includes:

1. **Role description**: "You are a scenario co-author for an on-call incident training simulator. Your job is to help the user build a realistic, playable scenario through natural conversation."

2. **Conversation principles**:
   - Start by inviting the user to describe the incident — anything from one sentence to a full brief.
   - Build iteratively: populate fields from what the user provides, make reasonable assumptions for the rest, and tell the user what was assumed.
   - Call `update_scenario` after each meaningful chunk of new information — don't wait until everything is settled.
   - Use `send_message` after `update_scenario` to tell the user what was built and prompt for the next piece of information needed — do not put conversational text inside tool parameters.
   - Use `ask_question` when the user needs to choose between specific alternatives (difficulty, incident type, persona roles). Keep option labels 1–5 words. Handle free-form replies gracefully.
   - Ask one focused question at a time. Never ask a list of five questions at once.
   - Cover, at minimum: incident type and affected service, at least one persona, at least one remediation action (with `is_correct_fix: true`), and evaluation/debrief context.
   - For derived fields (`id`, `title`, `tags`) — derive from context, never ask.
   - When the scenario feels complete, summarise what was built and what assumptions were made, then call `mark_complete`.
   - After `mark_complete` succeeds, remain available for refinements.

3. **Schema reference**: A full, precise schema reference card (not vague prose) giving the exact field names, discriminated union values, required fields per component type, and magnitude constraints — sufficient for the LLM to produce valid YAML without guessing. As of v1.0.39 this is embedded verbatim in the system prompt constant. Key items:
   - 12 valid component `type` values with exact required fields per type
   - `topology` `upstream`/`downstream` nodes require `name`, `description`, `components: []`, `incidents: []`
   - `ticketing` is an **array** of ticket objects (not an object)
   - `cicd` is `{ pipelines: [], deployments: [] }` (not an array)
   - `personas`: at least one required; must have `id`, `display_name`, `job_title`, `team`, `system_prompt`
   - `remediation_actions`: at least one required; at least one must have `is_correct_fix: true`
   - `topology.focal_service.incidents`: `affected_component` must match a component `id`
   - `evaluation.root_cause`: non-empty string
   - `timeline.duration_minutes`: positive number
   - Incident magnitude rules per `onset_overlay` type

4. **Opinionated defaults** (fields the LLM should fill without asking unless the user specifies):
   - `engine.tick_interval_seconds: 15`
   - `chat.channels`: one channel `{ id: "incidents", name: "#incidents" }`
   - `email`: empty array (unless user describes email interactions)
   - `ticketing`: one SEV2 open ticket created by the first persona at `at_second: 0`
   - `wiki.pages`: one page with a basic runbook stub
   - `logs`: empty array (LLM may add if relevant)
   - `log_patterns`: empty array
   - `background_logs`: empty array
   - `cicd`: empty pipelines and deployments arrays
   - `feature_flags`: empty array
   - `host_groups`: empty array
   - `alarms`: at least one SEV2 alarm on the affected component's primary metric

5. **Error handling instruction**: "If `update_scenario` returns `{ ok: false, errors: [...] }`, read all errors carefully, fix them all in a single pass, and call `update_scenario` again with the corrected data. Never ignore errors."

---

## 5a. Amendment 1.2 — `send_message` & `ask_question` Tools

### Motivation

The original two-tool design (`update_scenario`, `mark_complete`) has no structured mechanism for the LLM to:

1. **Communicate to the user mid-sequence** — e.g. after calling `update_scenario`, the LLM needs to tell the user what it just built and prompt for the next piece of information it needs. Without a tool for this, the LLM either buries text in the `assumptions` parameter (wrong place) or can only speak via the plain `text` field of the LLM response, which only fires once per round-trip.
2. **Present a structured choice** — when the LLM has 3–4 equally valid options (difficulty, incident type, persona roles, remediation type), asking the user to type their answer introduces friction and increases the chance of misunderstanding. A choice widget lets the user click an option and keeps the conversation moving.

### New Tools

Two new tools added to `BUILDER_TOOLS` in `tool-definitions.ts`.

---

#### `send_message`

Used by the LLM to emit a conversational message at any point in the tool-call sequence — after a patch, mid-refinement, or to prompt the user for the next piece of information needed to continue building the scenario.

**Key distinction from plain LLM text response:** Plain text is emitted once at the end of the LLM's turn. `send_message` can be called between other tool calls within the same turn (e.g. call `update_scenario`, then call `send_message` to tell the user what was built and ask what to work on next).

```ts
{
  name: "send_message",
  description:
    "Send a message to the user. Use this to: explain what you just built, " +
    "tell the user what assumptions were made, or ask for the next piece of " +
    "information you need to continue building the scenario. " +
    "Call this after update_scenario to explain the patch. " +
    "Do NOT put conversational text inside update_scenario or mark_complete parameters.",
  parameters: {
    type: "object",
    required: ["message"],
    properties: {
      message: {
        type: "string",
        description: "The message to display to the user.",
      },
    },
  },
}
```

**Hook behaviour:** Appends a `BuilderMessage { role: "bot", text: message }` to `state.messages`. No state transition. No round-trip to the LLM.

---

#### `ask_question`

Used by the LLM to present a focused question with 2–5 labelled options rendered as clickable buttons. The question and its options persist in the chat until resolved.

```ts
{
  name: "ask_question",
  description:
    "Ask the user a focused question with selectable options. " +
    "Use when the user needs to choose between specific alternatives " +
    "(e.g. difficulty level, incident type, number of personas). " +
    "Keep option labels short — 1 to 5 words each. " +
    "The user may ignore the options and type a free-form reply instead; " +
    "handle either response gracefully.",
  parameters: {
    type: "object",
    required: ["question", "options"],
    properties: {
      question: {
        type: "string",
        description: "The question to ask.",
      },
      options: {
        type: "array",
        description: "2 to 5 short option labels (1–5 words each).",
        items: { type: "string" },
        minItems: 2,
        maxItems: 5,
      },
    },
  },
}
```

**Hook behaviour:**

1. Appends a `BuilderMessage { role: "bot", text: question }` to `state.messages` so the question persists in history after dismissal.
2. Sets `state.pendingQuestion = { question, options }`.

**Resolution — two paths:**

| Path                       | What happens                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| User clicks an option      | `sendMessage(optionLabel)` called; `pendingQuestion` cleared before the LLM call; option label sent as normal user message |
| User types free-form reply | `pendingQuestion` cleared before `sendMessage` is called; typed text sent as normal user message                           |

In both cases the LLM receives a plain user message and continues the conversation. It never receives a special "option selected" signal — the option label is simply the user's next message.

---

### State Changes

One new field on `ScenarioBuilderState`:

```ts
export interface ScenarioBuilderState {
  phase: BuilderPhase;
  messages: BuilderMessage[];
  draft: Partial<RawScenarioConfig> | null;
  assumptions: string[];
  validatedYaml: string | null;
  validationErrors: ScenarioValidationError[];
  thinking: boolean;
  pendingQuestion: PendingQuestion | null; // ← NEW
}

export interface PendingQuestion {
  question: string;
  options: string[];
}
```

`pendingQuestion` is set to `null`:

- On mount (initial state)
- When `sendMessage` is called (whether from option click or free-form input) — cleared **before** the LLM call so the buttons disappear immediately as feedback that the choice was registered
- When `reset()` is called

---

### UI — `ScenarioBuilderChat` changes

The `ScenarioBuilderChat` component receives `pendingQuestion` as a prop (alongside `messages`, `thinking`, `onSend`).

**Rendering position:** The pending question widget renders between the message list and the input area — below the last message bubble, above the text input. It is not a bubble itself; it renders inline as a card:

```
┌──────────────────────────────────────────┐
│  [message list scrollable area]          │
│                                          │
│    bot: "What difficulty should this     │
│          scenario be?"                   │
│                                          │
├──────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │   Easy   │  │  Medium  │  │  Hard  │ │
│  └──────────┘  └──────────┘  └────────┘ │
│  Or type your own answer below           │
├──────────────────────────────────────────┤
│  [text input]                   [Send]   │
└──────────────────────────────────────────┘
```

**Interaction rules:**

- Option buttons are only shown when `pendingQuestion !== null && !thinking`
- Clicking an option calls `onOptionSelect(label)` (new prop) — which calls `sendMessage(label)` in the parent, which clears `pendingQuestion` and sends to LLM
- A muted sub-label "Or type your own answer below" appears beneath the option row to signal free-form is always available
- While `thinking` is true, option buttons are hidden (replaced by the thinking indicator) — the question bubble remains in message history
- The input field remains enabled while options are shown — free-form always works

**New prop:**

```ts
interface ScenarioBuilderChatProps {
  messages: BuilderMessage[];
  thinking: boolean;
  onSend: (text: string) => void;
  pendingQuestion: PendingQuestion | null; // ← NEW
  onOptionSelect: (option: string) => void; // ← NEW
}
```

`onOptionSelect` in `ScenarioBuilderScreen`:

```ts
function handleOptionSelect(option: string) {
  // Clears pendingQuestion then sends the option label as a user message
  // Both happen inside sendMessage — pendingQuestion is cleared at the start
  // of sendMessage before the LLM call.
  sendMessage(option);
}
```

`sendMessage` already clears `thinking` and appends the user message. It must also clear `pendingQuestion` at the start:

```ts
setState((prev) => ({
  ...prev,
  phase: prev.phase === "idle" ? "building" : prev.phase,
  messages: [...prev.messages, userMsg],
  thinking: true,
  pendingQuestion: null, // ← always clear on any new message
}));
```

---

### System Prompt Additions

Three new instructions added to the `CONVERSATION PRINCIPLES` section of the system prompt:

```
- Use send_message to communicate with the user mid-sequence — after calling
  update_scenario, use send_message to tell the user what was built and prompt
  for the next piece of information you need to continue building the scenario.
- Use ask_question when you want the user to choose between specific alternatives
  (e.g. difficulty, incident type, number of personas). Keep option labels
  short — 1 to 5 words. The user may ignore options and type freely; handle
  either response gracefully.
- Do NOT put conversational text inside update_scenario assumptions or
  mark_complete parameters. Use send_message for all communication.
```

---

### Tool Call Ordering Convention

The recommended call sequence for a typical exchange is:

```
1. update_scenario(patch, assumptions)   ← commit the data
2. send_message("Here's what I built...  ← explain it
   What should we work on next?")
```

Or when a choice is needed:

```
1. update_scenario(patch)
2. ask_question("How hard should this be?", ["Easy", "Medium", "Hard"])
```

The LLM may call these in any order within a single turn. The hook processes them sequentially in the order they appear in `response.toolCalls`.

**Edge cases:**

- **Multiple `ask_question` calls in one turn:** The last call wins — earlier pending questions are overwritten silently. The LLM should not call `ask_question` more than once per turn.
- **`ask_question` and `mark_complete` in the same turn:** If `mark_complete` succeeds, `pendingQuestion` is cleared when committing state — a completed scenario never has a pending question displayed. The LLM should not combine these in the same turn.
- **`ask_question` and `send_message` in the same turn:** Permitted. `send_message` messages are appended first; `ask_question` sets the pending question last. The result is a bot message followed by the option buttons.

---

### Modified Files Summary (Amendment 1.2)

| File                                              | Change                                                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `client/src/llm/tool-definitions.ts`              | Add `send_message` and `ask_question` to `BUILDER_TOOLS`                                                                               |
| `client/src/hooks/useScenarioBuilder.ts`          | Add `pendingQuestion` to state; handle `send_message` and `ask_question` tool calls; clear `pendingQuestion` at start of `sendMessage` |
| `client/src/components/ScenarioBuilderChat.tsx`   | Add `pendingQuestion` + `onOptionSelect` props; render option button row between message list and input                                |
| `client/src/components/ScenarioBuilderScreen.tsx` | Pass `pendingQuestion` and `onOptionSelect` to `ScenarioBuilderChat`                                                                   |
| `scenarios/_fixture/mock-llm-responses.yaml`      | Add `send_message` and `ask_question` fixture entries to `scenario_builder_responses` (see Section 13 for full fixture format)         |

The fixture additions required for Amendment 1.2 (to be appended to `scenario_builder_responses` in the existing fixture file):

```yaml
# send_message fixture — triggered after update_scenario to prompt the user
- trigger: "send_message_after_update"
  text: ""
  tool_calls:
    - tool: send_message
      params:
        message: "I've drafted the topology and incident. What difficulty level should this scenario be?"

# ask_question fixture — triggered when the mock receives a "difficulty" message
- trigger: "ask_difficulty"
  text: ""
  tool_calls:
    - tool: ask_question
      params:
        question: "How difficult should this scenario be for the trainee?"
        options: ["Easy", "Medium", "Hard"]
```

In practice, the mock provider's `_matchBuilder` uses trigger keyword matching (see Section 13 for the matching logic). These fixtures allow the existing test suite to exercise the new tool handlers without a real LLM.

---

### Test Cases (Amendment 1.2)

**`tool-definitions.ts`**

- `BUILDER_TOOLS` contains exactly 4 tools: `update_scenario`, `mark_complete`, `send_message`, `ask_question`
- `send_message` requires `message` string parameter
- `ask_question` requires `question` string and `options` array

**`useScenarioBuilder` hook**

- `send_message` tool call appends a bot message with the given text
- `ask_question` tool call appends a bot message with the question text AND sets `pendingQuestion`
- `sendMessage()` clears `pendingQuestion` regardless of input source
- `reset()` clears `pendingQuestion`
- `pendingQuestion` is `null` in initial state

**`ScenarioBuilderChat` component**

- Renders option buttons when `pendingQuestion` is non-null and `thinking` is false
- Does not render option buttons when `pendingQuestion` is null
- Does not render option buttons when `thinking` is true
- Clicking an option calls `onOptionSelect` with the option label
- "Or type your own answer below" hint visible when options are shown
- Input field remains enabled when options are shown

---

## 6. ScenarioValidator — Reusable Validation Pipeline

### Problem with the current approach

The existing validation logic is split across three places that were designed independently:

- `schema.ts` — Zod parse; always expects a complete `RawScenarioConfig`
- `validator.ts` — `validateCrossReferences`; expects a fully Zod-parsed object
- `loader.ts` — `loadScenarioFromText`; wires the two together but also transforms and resolves file refs, making it unsuitable as a pure validator

The builder needs **incremental validation on a partial draft** (sections are added one at a time). The uploader needs **full validation** identical to what the loader does, but without the transform step. Both need the new lint rules. Currently there is no way to call just the validation steps without also triggering the transform.

### Solution: `ScenarioValidator` (`client/src/scenario/validator.ts` — extended)

A single exported object that is the **one place** all validation logic flows through. The loader, the builder, and the uploader all call it. `validator.ts` already owns cross-reference logic — it is the natural home for this.

```ts
// client/src/scenario/validator.ts  (existing exports unchanged; new export added)

export const ScenarioValidator = {
  full,
  partial,
  section,
} as const;
```

---

#### `ScenarioValidator.full(raw: unknown): ValidationResult<RawScenarioConfig>`

**Used by:** `loadScenarioFromText` (loader), `ScenarioPicker` upload handler, `useScenarioBuilder` on `mark_complete`.

Runs the complete three-stage pipeline on a raw (untyped) object:

```
1. ScenarioSchema.safeParse(raw)
   → on fail: return { ok: false, errors (source: "schema") }

2. validateCrossReferences(parsed)
   → on fail: return { ok: false, errors (source: "cross_ref") }

3. lintScenario(parsed, { partial: false })
   → on fail: return { ok: false, errors (source: "lint") }

All pass: return { ok: true, data: parsed }
```

Returns `{ ok: true, data: RawScenarioConfig }` on success so callers get the typed, Zod-coerced object without parsing twice.

---

#### `ScenarioValidator.partial(draft: unknown): ValidationResult<Partial<RawScenarioConfig>>`

**Used by:** `useScenarioBuilder` on every `update_scenario` tool call.

Validates an incomplete draft. Missing top-level required fields do not fail — only fields that _are_ present are checked for correctness.

```
1. ScenarioSchema.deepPartial().safeParse(draft)
   → validates structure of present fields only
   → missing required top-level fields silently ignored

2. validateCrossReferences(draft)  [partial-aware overload]
   → runs only checks where both referencing and referenced fields are present
   → e.g. skips alarm→service check if topology has not been authored yet

3. lintScenario(draft, { partial: true })
   → skips rules that require a complete scenario
   → runs rules on whatever sections are present
   → e.g. duplicate persona ids checked as soon as 2+ personas present

All pass: return { ok: true, data: draft }
```

---

#### `ScenarioValidator.section<K extends ScenarioSection>(section: K, value: unknown): ValidationResult`

**Used by:** `useScenarioBuilder` for targeted per-section feedback when the LLM updates a single section in isolation.

```ts
export type ScenarioSection =
  | "personas"
  | "remediation_actions"
  | "topology"
  | "timeline"
  | "engine"
  | "alarms"
  | "email"
  | "chat"
  | "ticketing"
  | "wiki"
  | "cicd"
  | "evaluation"
  | "logs"
  | "log_patterns"
  | "background_logs"
  | "feature_flags"
  | "host_groups";
```

Each section key maps to its sub-schema (defined in `schema.ts`). All sub-schemas must be exported — currently only `ScenarioSchema`, `ComponentSchema`, `IncidentConfigSchema`, and `ServiceNodeSchema` are exported; the remaining sub-schemas need to be added as named exports.

```ts
const SECTION_SCHEMAS: Record<ScenarioSection, z.ZodTypeAny> = {
  personas: z.array(PersonaSchema),
  remediation_actions: z.array(RemediationActionSchema),
  topology: TopologySchema,
  timeline: TimelineSchema,
  engine: EngineSchema,
  alarms: z.array(AlarmConfigSchema),
  email: z.array(ScriptedEmailSchema),
  chat: ChatSchema,
  ticketing: z.array(TicketSchema),
  wiki: WikiSchema,
  cicd: CICDSchema,
  evaluation: EvaluationSchema,
  logs: z.array(ScriptedLogSchema),
  log_patterns: z.array(LogPatternSchema),
  background_logs: z.array(BackgroundLogsSchema),
  feature_flags: z.array(FeatureFlagSchema),
  host_groups: z.array(HostGroupSchema),
};
```

Section validation pipeline:

```
1. SECTION_SCHEMAS[section].safeParse(value)
   → on fail: return { ok: false, errors (source: "schema") }

2. Section-scoped lint rules (only those applicable to this section)
   → "personas":            no_duplicate_persona_ids
   → "remediation_actions": correct_fix_exists, no_duplicate_action_ids
   → "topology":            incident_has_affected_component, focal_service_has_components
   → "timeline":            duration_positive, incident_onset_in_range (if topology also known)
   → "evaluation":          evaluation_root_cause_non_empty

All pass: return { ok: true, data: typed section value }
```

Cross-reference rules are **not** run in section mode — cross-refs span multiple sections (e.g. alarm→service requires both `alarms` and `topology`). Those are caught by `partial` or `full` mode.

---

### `ValidationResult` — shared return type

```ts
export interface ValidationSuccess<T> {
  ok: true;
  data: T;
}

export interface ValidationFailure {
  ok: false;
  errors: ScenarioValidationError[];
}

export type ValidationResult<T = unknown> =
  | ValidationSuccess<T>
  | ValidationFailure;

export interface ScenarioValidationError {
  source: "schema" | "cross_ref" | "lint";
  rule?: string; // lint rule name, e.g. "correct_fix_exists"
  path: string; // field path, e.g. "remediation_actions[0].is_correct_fix"
  message: string; // actionable fix instruction
}
```

`ScenarioValidationError` replaces the existing `ValidationError` type `{ scenarioId, field, message }`. The old type is kept as a deprecated alias in this commit; callers are migrated to the new type before the alias is removed.

---

### How existing callers change

| Caller                                      | Before                                                              | After                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `loadScenarioFromText`                      | calls `ScenarioSchema.safeParse` + `validateCrossReferences` inline | calls `ScenarioValidator.full(raw)` internally; public API unchanged                                                                   |
| `ScenarioPicker` upload handler             | calls `loadScenarioFromText` (entangled with transform)             | calls `loadScenarioFromText` — which now delegates to `ScenarioValidator.full` internally, so upload errors flow through the same path |
| `useScenarioBuilder` — `update_scenario`    | new                                                                 | calls `ScenarioValidator.partial(candidate)`                                                                                           |
| `useScenarioBuilder` — `mark_complete`      | new                                                                 | calls `ScenarioValidator.full(draft)`                                                                                                  |
| `useScenarioBuilder` — per-section feedback | new                                                                 | calls `ScenarioValidator.section("personas", value)` etc.                                                                              |

`loadScenarioFromText` continues to be the single entry point for both bundled and remote loading. The transform step remains in the loader and is not part of the validator.

---

### `lintScenario` — Authoring Quality Rules (`client/src/scenario/lint.ts`)

These rules validate scenario authoring quality — things structurally valid per the Zod schema but that produce a broken or unplayable simulation.

Accepts a `{ partial: boolean }` option. When `partial: true`, rules requiring a complete scenario are skipped unless the relevant fields are already present.

| Rule ID                           | Section                       | Check                                                        | Skipped when partial?                                       |
| --------------------------------- | ----------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| `at_least_one_persona`            | `personas`                    | `personas.length >= 1`                                       | yes — skipped until personas present                        |
| `at_least_one_remediation`        | `remediation_actions`         | `remediation_actions.length >= 1`                            | yes                                                         |
| `correct_fix_exists`              | `remediation_actions`         | `some(r => r.is_correct_fix === true)`                       | yes                                                         |
| `incident_onset_in_range`         | `topology` + `timeline`       | `onset_second <= duration_minutes * 60`                      | yes — only when both present                                |
| `incident_has_affected_component` | `topology`                    | `affected_component` in `focal_service.components[].id`      | no — checked whenever incidents and components both present |
| `focal_service_has_components`    | `topology`                    | `focal_service.components.length >= 1`                       | yes                                                         |
| `evaluation_root_cause_non_empty` | `evaluation`                  | `root_cause.trim().length > 0`                               | yes                                                         |
| `no_duplicate_persona_ids`        | `personas`                    | all `personas[].id` unique                                   | no — checked as soon as 2+ personas present                 |
| `no_duplicate_action_ids`         | `remediation_actions`         | all `remediation_actions[].id` unique                        | no                                                          |
| `persona_refs_valid`              | `chat` + `email` + `personas` | refs in `chat.messages[].persona`, `email[].from/to` resolve | no — checked whenever referencing section present           |
| `duration_positive`               | `timeline`                    | `duration_minutes > 0`                                       | no — checked whenever timeline present                      |

---

### Separation of concerns (final state)

| File           | Responsibility                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `schema.ts`    | Zod sub-schemas (all exported) + root `ScenarioSchema`                                                                    |
| `validator.ts` | `validateCrossReferences` (unchanged) + `ScenarioValidator` object + `ValidationResult` + `ScenarioValidationError` types |
| `lint.ts`      | `lintScenario(candidate, options)` — authoring quality rules only                                                         |
| `loader.ts`    | YAML parse + `ScenarioValidator.full` + transform; public API unchanged                                                   |

---

## 7. Tool Call Validation Pipeline

Every `update_scenario` call from the LLM runs this pipeline **before** the draft is updated or the canvas re-rendered. If any stage fails, the draft is not touched and the structured error payload is returned to the LLM as a tool result.

```
LLM calls update_scenario(patch, assumptions?)
  │
  ├─ deep-merge patch into current draft → candidate
  │
  ├─ ScenarioValidator.partial(candidate)
  │    ├─ pass → apply candidate to draft, update canvas (highlight pulse)
  │    │         accumulate assumptions, return { ok: true }
  │    └─ fail → do NOT touch draft or canvas
  │              return { ok: false, errors: [...] } as tool result
  │              LLM reads errors, fixes, calls update_scenario again
  │
  └─ (continues conversation)

LLM calls mark_complete()
  │
  ├─ ScenarioValidator.full(currentDraft)
  │    ├─ pass → serialise to YAML, set phase="complete", set validatedYaml
  │    │         return { ok: true }
  │    └─ fail → return { ok: false, errors: [...] }
  │              LLM fixes with update_scenario, then calls mark_complete again
  │
  └─ (continues conversation)
```

### Tool result payloads

**Success:**

```json
{ "ok": true }
```

**Failure:**

```json
{
  "ok": false,
  "errors": [
    {
      "source": "schema",
      "path": "personas[0].cooldown_seconds",
      "message": "Expected number, received string"
    },
    {
      "source": "cross_ref",
      "path": "alarms[0].metric_id",
      "message": "metric_id 'foo' not found in registered archetypes"
    },
    {
      "source": "lint",
      "rule": "correct_fix_exists",
      "path": "remediation_actions",
      "message": "At least one remediation action must have is_correct_fix: true"
    }
  ]
}
```

The `source` field tells the LLM which layer caught the issue. The LLM's system prompt instructs it to read all errors, fix them all in one pass, and call `update_scenario` again.

---

## 8. `useScenarioBuilder` Hook

**Location:** `client/src/hooks/useScenarioBuilder.ts`

### State

```ts
type BuilderPhase = "idle" | "building" | "complete" | "error";

interface ScenarioBuilderState {
  phase: BuilderPhase;
  messages: BuilderMessage[];
  draft: Partial<RawScenarioConfig> | null; // null until first update_scenario
  assumptions: string[]; // accumulated from all update_scenario calls
  validatedYaml: string | null; // non-null after mark_complete succeeds
  validationErrors: ScenarioValidationError[]; // populated on mark_complete failure
  thinking: boolean; // LLM call in-flight
}
```

### Public API

```ts
interface UseScenarioBuilderReturn {
  state: ScenarioBuilderState;
  sendMessage: (text: string) => Promise<void>;
  downloadYaml: () => void; // triggers browser download of validatedYaml
  reset: () => void; // clears all state, returns to idle
}
```

### Initialization

On mount, the hook:

1. Calls `createLLMClient()` and caches the client instance.
2. Prepends the system prompt to the message history (as a `role: "system"` message — not shown in the UI).
3. Appends one visible bot message without an LLM call: `"What kind of incident do you want to train your engineers on? Describe it in as much or as little detail as you like."` This seeds the conversation immediately with no latency.

### `sendMessage` flow

```ts
async function sendMessage(text: string): Promise<void> {
  // 1. Append user message to state.messages
  // 2. Set state.thinking = true
  // 3. Build LLMRequest: role="scenario_builder", full message history, tools=BUILDER_TOOLS
  // 4. Await LLMClient.call(request)
  // 5. For each item in response:
  //      text → append bot BuilderMessage
  //      tool_call "update_scenario" → runUpdatePipeline(params.patch, params.assumptions)
  //      tool_call "mark_complete"   → runMarkComplete()
  // 6. Set state.thinking = false
}
```

### `runUpdatePipeline(patch, assumptions)`

```ts
function runUpdatePipeline(
  patch: unknown,
  assumptions: string[] = [],
): { ok: true } | { ok: false; errors: ScenarioValidationError[] } {
  const candidate = deepMerge(state.draft ?? {}, patch);

  const result = ScenarioValidator.partial(candidate);
  if (!result.ok) return result; // { ok: false, errors }

  setState((prev) => ({
    ...prev,
    draft: result.data,
    assumptions: [...prev.assumptions, ...assumptions],
  }));

  return { ok: true };
}
```

All validation logic — partial Zod parse, partial cross-ref checks, partial lint — lives in `ScenarioValidator.partial`. The hook does not duplicate any of it.

### `runMarkComplete`

```ts
function runMarkComplete():
  | { ok: true }
  | { ok: false; errors: ScenarioValidationError[] } {
  const result = ScenarioValidator.full(state.draft);
  if (!result.ok) return result; // { ok: false, errors }

  const yamlStr = yaml.dump(result.data, { indent: 2, lineWidth: 120 });

  setState((prev) => ({
    ...prev,
    phase: "complete",
    validatedYaml: yamlStr,
    validationErrors: [],
  }));

  return { ok: true };
}
```

### Message history sent to LLM

The full `state.messages` array is sent on every call, giving the LLM complete conversation context. Tool results are appended as `role: "tool"` messages in the OpenAI tool-calling format so the LLM can read validation errors and self-correct.

---

## 9. Component Tree

```
App
└── ScenarioBuilderScreen          new — full-screen layout + header
    ├── ScenarioCanvas             new — left 2/3, card grid
    │   ├── OverviewCard
    │   ├── IncidentCard
    │   ├── ServiceTopologyCard
    │   ├── PersonasCard
    │   ├── RemediationActionsCard
    │   ├── EvaluationCard
    │   ├── TimelineEngineCard
    │   └── AssumptionsCard
    └── ScenarioBuilderChat        new — right 1/3, chat UI
        ├── BuilderMessageList
        ├── ThinkingIndicator
        └── BuilderMessageInput
```

All canvas cards are **read-only**. The user edits via chat only.

`ScenarioBuilderScreen` owns the layout. It receives the `UseScenarioBuilderReturn` value from `useScenarioBuilder` and passes slices down to each child as props. No context is used — the builder is a standalone feature with no shared context with the sim session.

---

## 10. ScenarioCanvas — Card Definitions

Each card renders from `draft` (a `Partial<RawScenarioConfig>`). Before a section has any data, its card shows a muted placeholder row: "Not yet defined".

Cards animate a brief highlight on change: a 500ms background pulse (`transition-colors`) triggered by a `useEffect` watching the relevant draft slice.

| Card                    | Source fields                                                             | Key display elements                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Overview**            | `title`, `description`, `difficulty`, `timeline.duration_minutes`, `tags` | Title (large), description, difficulty badge (colour-coded), duration, tag pills                                                     |
| **Incident**            | `topology.focal_service.incidents[0]`                                     | `description`, `affected_component`, `onset_overlay` badge, `onset_second` formatted as `T+Xm`, `magnitude`, `propagation_direction` |
| **Service Topology**    | `topology.focal_service`, `topology.upstream`, `topology.downstream`      | Focal service name + component type chain (e.g. `ALB → ECS → RDS`), upstream/downstream service names                                |
| **Personas**            | `personas`                                                                | One row per persona: colour swatch (from `avatar_color`), `display_name`, `job_title`, `team`, "initiates" / "silent" badge          |
| **Remediation Actions** | `remediation_actions`                                                     | One row per action: ✓ (green) or ✗ (muted) correct-fix indicator, `type`, `service`, `side_effect` if present                        |
| **Evaluation**          | `evaluation`                                                              | `root_cause` (truncated to 2 lines), `debrief_context` (truncated to 2 lines), count of relevant actions and red herrings            |
| **Timeline & Engine**   | `timeline`, `engine`                                                      | `default_speed`, `duration_minutes`, `pre_incident_seconds`, `tick_interval_seconds`                                                 |
| **Assumptions**         | accumulated from all `update_scenario` `assumptions` arrays               | Bulleted list of assumption strings; muted style to signal "review these"                                                            |

Validation errors (if any, from the most recent `mark_complete` failure) are shown in a sticky bar at the bottom of the canvas, outside the scroll container, listing `source — path: message` for each error.

---

## 11. Thinking Indicator

The `thinking: boolean` flag in state drives two visual elements simultaneously:

### Chat panel

A bot message bubble with a bouncing three-dot animation appears at the bottom of the message list while `thinking === true`. It is not a real `BuilderMessage` — it is a transient UI element rendered separately after the message list, conditionally on `thinking`. It disappears when the response arrives.

```
┌──────────────────────────────┐
│  ●  ···                      │  ← three dots bouncing (CSS animation)
└──────────────────────────────┘
```

CSS animation: three dots staggered with `animation-delay` values of `0ms`, `150ms`, `300ms`, each doing a `translateY` bounce on a `600ms` infinite loop.

### Canvas empty state (before first `update_scenario`)

When `draft === null && thinking === true`, the centred empty state placeholder replaces its static text with the same three-dot animation: "Thinking…" with bouncing dots.

### Canvas cards (during updates)

No per-card thinking indicator. Cards that have data show their current data throughout. The highlight pulse after a successful `update_scenario` is sufficient to communicate that the card just changed.

---

## 12. Download Button States

The Download button lives in the `ScenarioBuilderScreen` header, always visible.

| `phase`    | `validatedYaml`                                        | Button state        | Appearance                                                                |
| ---------- | ------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------- |
| `idle`     | `null`                                                 | Disabled            | Greyed, `opacity-40`                                                      |
| `building` | `null`                                                 | Disabled            | Greyed, `opacity-40`                                                      |
| `building` | non-null (prior complete, then user asked for changes) | Active with warning | Secondary style, label "Download (validating…)"                           |
| `complete` | non-null, no validation errors                         | Active              | Primary style, label "Download scenario.yaml"                             |
| `complete` | non-null, validation errors remain                     | Active with warning | Secondary style, label "Download (warnings)", tooltip listing error count |

`downloadYaml()` triggers a browser download using a temporary `<a download="scenario.yaml" href={objectUrl}>` pattern. The object URL is created from `validatedYaml` and immediately revoked after `.click()`.

---

## 13. Upload Feature

### Location

Two buttons in the `ScenarioPicker` header, always visible:

```tsx
<Button variant="secondary" size="sm" onClick={handleBuild}>
  Build scenario
</Button>
<Button variant="secondary" size="sm" onClick={handleUploadClick}>
  Load scenario
</Button>
<input
  ref={fileInputRef}
  type="file"
  accept=".yaml,.yml"
  style={{ display: 'none' }}
  onChange={handleFileChange}
/>
```

### Upload validation pipeline

```ts
async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0];
  if (!file) return;

  // Reset input so the same file can be re-selected after fixing errors
  e.target.value = "";

  const text = await file.text();

  // noOpResolver: uploaded YAMLs must be self-contained
  const noOpResolver = (_: string): Promise<string> =>
    Promise.reject(
      new Error(
        "File references (body_file, content_file, etc.) are not supported in uploaded scenarios. " +
          "Inline all content directly in the YAML.",
      ),
    );

  const result = await loadScenarioFromText(text, noOpResolver);

  if (isScenarioLoadError(result)) {
    setUploadErrors(result.errors); // shown inline below the buttons
  } else {
    setUploadErrors([]);
    setScenarios((prev) =>
      prev
        ? [
            {
              summary: toScenarioSummary(result),
              loaded: result,
              custom: true,
            },
            ...prev,
          ]
        : [
            {
              summary: toScenarioSummary(result),
              loaded: result,
              custom: true,
            },
          ],
    );
  }
}
```

### Inline error display

```
[ Build scenario ]  [ Load scenario ]

⚠ Could not load scenario.yaml — 3 errors:
  · personas: At least one persona is required
  · topology.focal_service.incidents[0].affected_component: 'rds' not found in components
  · evaluation.root_cause: must not be empty
                                                    [×  dismiss]
```

### Custom badge

Uploaded scenarios get a `custom: true` flag in the in-memory list. The picker card renders a small "Custom" pill badge next to the difficulty badge.

---

## 14. Mock Mode

### New fixture keys

`scenarios/_fixture/mock-llm-responses.yaml` gains a new top-level key `scenario_builder_responses`:

```yaml
scenario_builder_responses:
  - trigger: "generic"
    text: "Got it — sounds like a database connection pool exhaustion scenario. Let me start building that out."
    tool_calls:
      - tool: update_scenario
        params:
          patch:
            id: "fixture-db-pool"
            title: "Database Connection Pool Exhausted"
            difficulty: "medium"
            tags: ["database", "connection-pool"]
            timeline:
              default_speed: 2
              duration_minutes: 15
              pre_incident_seconds: 43200
              resolution_seconds: 60
          assumptions:
            - "id derived from scenario description"
            - "difficulty set to medium (default)"

  - trigger: "mark_complete"
    text: "The scenario is complete. Here's what I built..."
    tool_calls:
      - tool: mark_complete
        params: {}
```

### MockProvider changes

`MockProvider.call()` gains a branch for `role === "scenario_builder"`:

```ts
if (request.role === "scenario_builder") {
  return Promise.resolve(this._matchBuilder(request));
}
```

`_matchBuilder` looks for `scenario_builder_responses` in the fixture. The `"generic"` trigger matches any first message. The `"mark_complete"` trigger matches when the last user message contains "complete" or "done". Unmatched requests return `{ toolCalls: [], text: "" }`.

### `MockLLMResponses` type update

```ts
export interface MockLLMResponses {
  stakeholder_responses: MockStakeholderResponse[];
  coach_responses: MockCoachResponse[];
  debrief_response: { narrative: string };
  scenario_builder_responses: MockBuilderResponse[]; // new
}

export interface MockBuilderResponse {
  trigger: string;
  text?: string;
  tool_calls: Array<{ tool: string; params: Record<string, unknown> }>;
}
```

---

## 15. New & Modified Files

### New files

```
client/src/components/ScenarioBuilderScreen.tsx
client/src/components/ScenarioCanvas.tsx
client/src/components/ScenarioBuilderChat.tsx
client/src/hooks/useScenarioBuilder.ts
client/src/scenario/lint.ts
client/__tests__/components/ScenarioBuilderScreen.test.tsx
client/__tests__/components/ScenarioCanvas.test.tsx
client/__tests__/components/ScenarioBuilderChat.test.tsx
client/__tests__/hooks/useScenarioBuilder.test.ts
client/__tests__/scenario/lint.test.ts
```

### Modified files

| File                                         | Change                                                                                                                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/src/scenario/schema.ts`              | Export all sub-schemas (`PersonaSchema`, `TopologySchema`, etc.) so `ScenarioValidator.section` can reference them                                                                                                            |
| `client/src/scenario/validator.ts`           | Add `ScenarioValidator` object, `ValidationResult`, `ScenarioValidationError`, `ScenarioSection` types; migrate `loadScenarioFromText` to use `ScenarioValidator.full` internally; keep `ValidationError` as deprecated alias |
| `client/src/scenario/loader.ts`              | Replace inline `ScenarioSchema.safeParse` + `validateCrossReferences` calls with `ScenarioValidator.full`; public API unchanged                                                                                               |
| `client/src/llm/llm-client.ts`               | Add `"scenario_builder"` to `LLMRole` union                                                                                                                                                                                   |
| `client/src/llm/tool-definitions.ts`         | Add `BUILDER_TOOLS` export (`update_scenario`, `mark_complete`, `send_message`, `ask_question`)                                                                                                                               |
| `client/src/llm/mock-provider.ts`            | Add `scenario_builder_responses` to `MockLLMResponses`; add `_matchBuilder` branch                                                                                                                                            |
| `client/src/components/ScenarioPicker.tsx`   | Add "Build scenario" + "Load scenario" buttons; upload logic; inline error display; custom badge on cards                                                                                                                     |
| `client/src/App.tsx`                         | Add `"builder"` to `AppScreen` union; render `ScenarioBuilderScreen` on `screen === "builder"`                                                                                                                                |
| `scenarios/_fixture/mock-llm-responses.yaml` | Add `scenario_builder_responses` section                                                                                                                                                                                      |

---

## 16. TypeScript Interfaces

New types are distributed across three files based on concern:

```ts
// ── validator.ts — shared validation types (new exports alongside existing) ───

export interface ValidationSuccess<T> {
  ok: true;
  data: T;
}

export interface ValidationFailure {
  ok: false;
  errors: ScenarioValidationError[];
}

export type ValidationResult<T = unknown> =
  | ValidationSuccess<T>
  | ValidationFailure;

export interface ScenarioValidationError {
  source: "schema" | "cross_ref" | "lint";
  rule?: string; // lint rule name, e.g. "correct_fix_exists"
  path: string; // field path, e.g. "remediation_actions[0].is_correct_fix"
  message: string; // actionable fix instruction
}

export type ScenarioSection =
  | "personas"
  | "remediation_actions"
  | "topology"
  | "timeline"
  | "engine"
  | "alarms"
  | "email"
  | "chat"
  | "ticketing"
  | "wiki"
  | "cicd"
  | "evaluation"
  | "logs"
  | "log_patterns"
  | "background_logs"
  | "feature_flags"
  | "host_groups";

export const ScenarioValidator: {
  full: (raw: unknown) => ValidationResult<RawScenarioConfig>;
  partial: (draft: unknown) => ValidationResult<Partial<RawScenarioConfig>>;
  section: (section: ScenarioSection, value: unknown) => ValidationResult;
};

// ── lint.ts — authoring quality rules ────────────────────────────────────────

export interface LintOptions {
  partial: boolean; // when true, skip rules that require a complete scenario
}

export function lintScenario(
  candidate: Partial<RawScenarioConfig>,
  options: LintOptions,
): ScenarioValidationError[]; // source always "lint"

// ── useScenarioBuilder.ts — hook-local types ─────────────────────────────────

export type BuilderPhase = "idle" | "building" | "complete" | "error";

export interface BuilderMessage {
  id: string; // uuid, for React key
  role: "bot" | "user";
  text: string;
}

export interface ScenarioBuilderState {
  phase: BuilderPhase;
  messages: BuilderMessage[];
  draft: Partial<RawScenarioConfig> | null;
  assumptions: string[];
  validatedYaml: string | null;
  validationErrors: ScenarioValidationError[];
  thinking: boolean;
  pendingQuestion: PendingQuestion | null; // null until LLM calls ask_question
}

export interface PendingQuestion {
  question: string;
  options: string[];
}

export interface UseScenarioBuilderReturn {
  state: ScenarioBuilderState;
  sendMessage: (text: string) => Promise<void>;
  downloadYaml: () => void;
  reset: () => void;
}
```

---

## 17. Test Strategy

### TDD workflow (mandatory per project guidelines)

Write test → run (must fail) → write code → run (must pass) → refactor.

### `ScenarioValidator` tests (`__tests__/scenario/validator.test.ts` — extended)

**`ScenarioValidator.full`** — happy path:

- Returns `{ ok: true, data }` for the fixture scenario
- `data` is identical to direct `ScenarioSchema.parse()` output

**`ScenarioValidator.full`** — unhappy paths:

- Returns `{ ok: false }` with `source: "schema"` for malformed YAML object
- Returns `{ ok: false }` with `source: "cross_ref"` for unknown persona ref
- Returns `{ ok: false }` with `source: "lint"` for missing correct fix

**`ScenarioValidator.partial`** — happy paths:

- Returns `{ ok: true }` for empty object `{}`
- Returns `{ ok: true }` for draft with only `personas` populated
- Returns `{ ok: true }` for draft with valid partial topology

**`ScenarioValidator.partial`** — unhappy paths:

- Returns `{ ok: false, source: "schema" }` for malformed field type (e.g. `personas[0].cooldown_seconds: "notanumber"`)
- Returns `{ ok: false, source: "lint" }` for duplicate persona IDs (checked even when partial)
- Does NOT return error for missing required top-level fields (e.g. missing `alarms`)

**`ScenarioValidator.section`** — happy path per section:

- `section("personas", [validPersona])` → `{ ok: true }`
- `section("remediation_actions", [validAction])` → `{ ok: true }`

**`ScenarioValidator.section`** — unhappy paths:

- `section("personas", [persona, personaWithDuplicateId])` → `{ ok: false, source: "lint", rule: "no_duplicate_persona_ids" }`
- `section("remediation_actions", actionsWithNoCorrectFix)` → `{ ok: false, source: "lint", rule: "correct_fix_exists" }`
- `section("personas", "not-an-array")` → `{ ok: false, source: "schema" }`

### `lint.ts` tests (`__tests__/scenario/lint.test.ts`)

One test per rule, `partial: false`:

- `at_least_one_persona` — empty personas array
- `correct_fix_exists` — all actions have `is_correct_fix: false`
- `incident_onset_in_range` — `onset_second > duration_minutes * 60`
- `incident_has_affected_component` — `affected_component` not in component ids
- `evaluation_root_cause_non_empty` — whitespace-only string
- `no_duplicate_persona_ids` — two personas with same id
- `persona_refs_valid` — chat message references unknown persona
- `duration_positive` — `duration_minutes: 0`

`partial: true` skipping:

- `correct_fix_exists` skipped when `remediation_actions` absent from draft
- `at_least_one_persona` skipped when `personas` absent from draft
- `no_duplicate_persona_ids` still runs when 2+ personas present

### `useScenarioBuilder.ts` tests (`__tests__/hooks/useScenarioBuilder.test.ts`)

All tests run with the mock LLM provider.

Happy paths:

- Initial state: `phase === "idle"`, `draft === null`, one bot seed message
- `sendMessage` → thinking cycles `false → true → false`
- `update_scenario` tool call with valid patch: draft updated, assumptions accumulated
- `mark_complete` after valid draft: `phase === "complete"`, `validatedYaml` non-null
- `downloadYaml` with non-null yaml: does not throw
- `reset`: state returns to initial

Unhappy paths:

- `update_scenario` with schema error: draft unchanged, `{ ok: false }` returned as tool result, appended to message history
- `update_scenario` with lint error: draft unchanged
- `mark_complete` on incomplete draft: errors returned, phase stays `"building"`
- LLM call throws: `thinking` set to false, error bot message appended

### `ScenarioCanvas.tsx` tests (`__tests__/components/ScenarioCanvas.test.tsx`)

- Renders empty state when `draft === null` and `thinking === false`
- Renders empty state with bouncing dots when `draft === null` and `thinking === true`
- Renders Overview card fields when draft has title/difficulty/tags
- Renders Personas card with one row per persona
- Renders correct-fix checkmark (✓) and red-herring indicator (✗) on remediation actions
- Renders Assumptions card with accumulated assumption strings
- Renders validation error bar when `validationErrors` non-empty

### `ScenarioBuilderChat.tsx` tests (`__tests__/components/ScenarioBuilderChat.test.tsx`)

- Renders seed bot message on mount
- Renders user and bot messages in correct order
- Renders bouncing-dot thinking indicator when `thinking === true`
- Thinking indicator absent when `thinking === false`
- Sends message on Enter key press
- Sends message on Send button click
- Input disabled while `thinking === true`
- Input cleared after send

### `ScenarioPicker.tsx` upload tests (added to existing test file)

- "Build scenario" button calls `onCreateScenario`
- "Load scenario" button triggers file input click
- Valid YAML file upload: scenario prepended to list with "Custom" badge, no errors shown
- Invalid YAML file upload: inline error block shown, scenario not added to list
- Upload error block dismissed by × button
- Same file can be re-selected after fixing errors (input value reset)

---

## 18. Non-Goals

The following are explicitly out of scope for Phase 12:

- **Streaming LLM responses** — the full response is rendered at once when the LLM call completes.
- **Persisting builder state** — closing the browser tab or navigating away loses the in-progress scenario. A future phase could add localStorage autosave.
- **`body_file` / `content_file` refs in uploaded YAMLs** — uploaded scenarios must inline all content. The `noOpResolver` enforces this with a clear error.
- **Inline canvas editing** — the canvas is read-only. All changes go through the chat.
- **Multiple concurrent builder sessions** — one builder session at a time; `reset()` clears it.
- **Saving to server** — download to local file only.
- **LLM-generated mock fixture completeness** — the mock fixture covers enough to run tests; it does not attempt to cover every possible LLM response.

---

| Version | Date       | Changes                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.0     | 2026-04-15 | Initial design                                                                                                                                                                                                                                                                                                                                                                                               |
| 1.1     | 2026-04-15 | Added `ScenarioValidator` reusable pipeline; `validator.ts` extended as single validation entry point; `useScenarioBuilder` simplified to call `ScenarioValidator` directly; `schema.ts` sub-schemas to be exported; `loader.ts` migrated internally                                                                                                                                                         |
| 1.2     | 2026-04-16 | Amendment: `send_message` and `ask_question` builder tools; `pendingQuestion` state; option button UI in `ScenarioBuilderChat`                                                                                                                                                                                                                                                                               |
| 1.3     | 2026-04-16 | LLD review fixes: "Two tools" → "Four tools"; Section 5 system prompt updated to reflect new tool instructions; multiple `ask_question`/`mark_complete` same-turn edge cases documented; fixture YAML examples added for new tools; `PendingQuestion` + `pendingQuestion` added to Section 16 interfaces; Section 5 schema reference updated to reflect exact reference card; duplicate Section 9 renumbered |
