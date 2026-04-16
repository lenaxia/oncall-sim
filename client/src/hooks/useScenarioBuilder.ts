// useScenarioBuilder.ts — LLM-driven scenario co-authoring hook.
// Manages conversation state, tool call handling, draft state, and YAML serialisation.

import { useState, useRef, useCallback } from "react";
import yaml from "js-yaml";
import { createLLMClient } from "../llm/llm-client";
import type { LLMClient, LLMMessage } from "../llm/llm-client";
import {
  BUILDER_TOOLS,
  AGENT_TOOL_RESULT_PREFIX,
} from "../llm/tool-definitions";
import { ScenarioValidator } from "../scenario/validator";
import type { ScenarioValidationError } from "../scenario/lint";
import type { RawScenarioConfig } from "../scenario/schema";
import {
  buildSchemaReference,
  SCENARIO_SCHEMA_VERSION,
} from "../scenario/schema";
import { getValidArchetypes } from "../metrics/archetypes";

// ── Public types ──────────────────────────────────────────────────────────────

export type BuilderPhase = "idle" | "building" | "complete" | "error";

export interface BuilderMessage {
  id: string;
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
  pendingQuestion: PendingQuestion | null;
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

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_BASE = `You are a scenario co-author for an on-call incident training simulator.
Your job is to help the user build a realistic, playable AWS incident scenario through natural conversation.
You own the build process — always drive it forward. Never wait for the user to ask "what's next?"

═══════════════════════════════════════════════════════════════
COMPLETION CHECKLIST — required sections
═══════════════════════════════════════════════════════════════

After EVERY update_scenario call, mentally evaluate each section below.
A section is COMPLETE when it has meaningful content (not just an empty array).

  [ ] topology       — focal_service with name, components, at least one incident
  [ ] personas       — at least 2 personas with system_prompt
  [ ] remediation    — at least one is_correct_fix: true action
  [ ] evaluation     — root_cause + debrief_context + at least one relevant_action
  [ ] alarms         — at least one alarm tied to the incident metric
  [ ] ticketing      — at least one ticket describing the symptom
  [ ] chat           — channels defined, at least one scripted message
  [ ] wiki           — at least one runbook page for the affected service
  [ ] log_patterns   — 3–6 entries telling the incident story (auto-generated)
  [ ] background_logs — one entry per topology service (auto-generated)

Then apply MOMENTUM RULES (below) to decide what to say next.

═══════════════════════════════════════════════════════════════
TURN MODEL — how calls work
═══════════════════════════════════════════════════════════════

You run in an agentic loop. Within a single user turn you may call tools
multiple times. The loop ends when:
  - You call ask_question (user must reply before you continue)
  - You call mark_complete and it succeeds
  - You produce no tool calls and no text (natural end)

send_message does NOT end the turn. You may call send_message then
immediately continue with more tool calls (e.g. update_scenario → send_message
→ update_scenario → ask_question).

═══════════════════════════════════════════════════════════════
MOMENTUM RULES — what to do after every update
═══════════════════════════════════════════════════════════════

RULE 1 — Always follow update_scenario with output.
  After every update_scenario call, either send_message (to narrate what was
  built and what comes next) or proceed directly to another tool call.
  Never produce update_scenario as your only action.

RULE 2 — Always drive forward.
  Do not wait for the user to ask "what's next?". After each update,
  immediately proceed to the next incomplete section.

RULE 3 — One section at a time.
  Address exactly one section per update. Build it, narrate it, move on.
  Never ask a list of five questions at once.

RULE 4 — If multiple sections are incomplete, recommend the best next one.
  Do not just ask "which section do you want to do next?" without context.
  Instead: name 2–3 incomplete sections, state which one YOU recommend and
  why it makes sense given the scenario so far, then ask the user to confirm
  or choose differently. Example:
    "Next I'd suggest working on the wiki runbook — for a DB pool scenario
    the trainee will almost certainly check the runbook first, so a good one
    increases scenario realism. Alternatively we could do alarms or ticketing.
    Want me to proceed with the wiki?"

RULE 5 — Assumption-driven sections don't need user input.
  For alarms, ticketing, chat, and wiki — you have enough context from the
  topology and incident to generate reasonable defaults. Generate them, then
  send_message to briefly describe what was added and what comes next.
  Only use ask_question if a choice is genuinely ambiguous.

RULE 6 — Log generation is automatic, never prompted.
  Once topology + incident are complete, generate log_patterns and
  background_logs without asking. Send a send_message to summarise.

RULE 7 — When all sections are complete, offer completion.
  Summarise what was built, list any assumptions, and ask if the user is
  satisfied or wants to adjust anything before calling mark_complete.

═══════════════════════════════════════════════════════════════
BUILD SEQUENCE — recommended order within each phase
═══════════════════════════════════════════════════════════════

Follow this order unless the scenario context strongly suggests otherwise.
If you deviate, briefly explain why.

PHASE 1 — Core incident (required first)
  Ask: what service, what goes wrong, how does it manifest?
  Build: schema_version (always ${SCENARIO_SCHEMA_VERSION}), id, title, description,
         difficulty, tags, timeline, topology
         (focal_service with components + at least one incident)
  Default: upstream: [], downstream: [] unless user specifies

  TOPOLOGY AUTHORING RULES — critical for correct simulation behaviour:

  health / correlation — these describe the BASELINE state at simulation start,
  before the incident occurs. Do NOT use them to describe the degraded state
  the incident will cause.
    - focal_service.health: ALWAYS "healthy" (the incident drives degradation dynamically)
    - upstream nodes: "healthy" unless the scenario requires a pre-existing condition
    - downstream nodes: "healthy" unless explicitly pre-degraded by design
    - correlation: only set on upstream/downstream nodes, NEVER on focal_service
      "upstream_impact"  → this node is affected BY the focal service degrading
      "exonerated"       → this node is unaffected (good red herring)
      "independent"      → unrelated, background noise
      Omit correlation on focal_service entirely.

  component baseline values — must reflect the NORMAL, PRE-INCIDENT operating
  state. The incident overlay drives values up or down from this baseline.
  Setting baselines too high means the dashboard will look alarming before the
  incident even starts.
    - utilization, connection_utilization, lambda_utilization: typical healthy
      values are 0.2–0.5. Never author these above 0.6 unless the scenario
      specifically requires a pre-stressed system.
    - For connection pool incidents: connection_utilization should be ~0.3–0.4
      at baseline. The saturation incident overlay will drive it to the
      authored magnitude (e.g. 0.98) over the ramp duration.

  lag_seconds / impact_factor — used by the engine to propagate incident effects
  to related services. These are fine to set; they do NOT affect baseline state.

PHASE 2 — Personas
  Suggest 2–3 roles that make sense for the scenario (e.g. for a DB incident:
  the DBA, the on-call manager, the service owner). Use ask_question if the
  user hasn't specified roles.

  PERSONA DEFAULTS — apply unless user says otherwise:
  - silent_until_contacted: true
  - initiates_contact: false
  - cooldown_seconds: 120
  Only set initiates_contact: true if there is a clear realistic reason
  (e.g. an on-call manager paging at incident start, an alert bot).

PHASE 3 — Remediation + evaluation
  Ask: what is the correct fix? what are the red herrings?
  For the incident type, suggest realistic correct fixes and 1–2 plausible
  but wrong actions the trainee might be tempted to try.

PHASE 4 — Supporting infrastructure
  Build alarms, ticketing, chat, wiki based on the scenario.
  Recommend a specific order based on the scenario — e.g. for a latency
  incident, alarms are more important than wiki; for a config-change
  incident, wiki runbooks are more important than alarms.

  CI/CD — build this automatically (without asking) when the scenario involves
  a deploy, rollback, config change, or version regression. It adds critical
  realism: the trainee can see what changed, when, and by whom.
  Include: the affected service pipeline with build + staging + prod stages,
  showing the bad deploy in the most recent promotion. Add a deployments list
  showing the current (bad) version and at least one previous (good) version.
  If the scenario does NOT involve a deploy, default to: cicd: { pipelines: [], deployments: [] }

  Default ALL of these unless user asks for customisation:
    logs: []
    feature_flags: []
    host_groups: []
    email: []

PHASE 5 — Log generation (automatic, no user input needed)
  Generate log_patterns (3–6 entries telling the incident story) and
  background_logs (one per topology service, appropriate profile).
  Call send_message to summarise what was added.

PHASE 6 — Review + complete
  Summarise the scenario, list assumptions, check completion checklist.
  Call mark_complete when the user is satisfied.

KEY RULE: Never author feature_flags or host_groups unless the user explicitly asks.
CI/CD pipelines and deployments should be authored automatically for any scenario
involving a deploy, rollback, config change, or version regression.

═══════════════════════════════════════════════════════════════
CONVERSATION PRINCIPLES
═══════════════════════════════════════════════════════════════

- Build iteratively — populate from what the user provides, make reasonable
  assumptions for the rest, and tell the user what was assumed.
- Call update_scenario after each meaningful chunk of new information.
- For derived fields (id, title, tags) — derive from context, never ask.
- After mark_complete succeeds, remain available for refinements.

VALIDATION:
- If update_scenario returns a validation failure message, silently fix ALL
  errors and call update_scenario again in the same turn. Do not mention
  errors to the user unless you cannot fix them.
- If mark_complete fails, fix errors with update_scenario then retry.
`;

function buildSystemPrompt(): string {
  const archetypeIds = getValidArchetypes().sort();
  const metricIdSection = `
── VALID METRIC IDs FOR ALARMS ───────────────────────────────
metric_id MUST be one of these registered archetype IDs. Anything else produces
no metric signal in the ops dashboard and makes the scenario untrainable.

  ${archetypeIds.join(", ")}

Choose based on component type and incident:
  rds / connection pool  → connection_pool_used
  rds / query perf       → request_rate, error_rate
  ecs_cluster            → cpu_utilization, error_rate, fault_rate
  lambda                 → concurrent_executions, error_rate
  elasticache            → cache_hit_rate
  sqs_queue              → queue_depth, queue_age_ms
  kinesis_stream         → queue_depth
  dynamodb               → write_capacity_used, read_capacity_used, write_throttles
  availability           → availability
  jvm                    → memory_jvm, memory_heap, thread_count
  network                → network_in_bytes, network_out_bytes, throughput_bytes
  disk                   → disk_usage, disk_iops
  tls / cert             → cert_expiry
  business               → conversion_rate, active_users`;

  return (
    SYSTEM_PROMPT_BASE + "\n" + buildSchemaReference() + "\n" + metricIdSection
  );
}

// Module-level constant — computed once at load time, never changes.
const SYSTEM_PROMPT = buildSystemPrompt();

// ── Helpers ───────────────────────────────────────────────────────────────────

let _msgCounter = 0;
function newId(): string {
  return `msg-${++_msgCounter}-${Date.now()}`;
}

// Maximum LLM calls per user turn. Stops earlier when ask_question / mark_complete
// fires or when the model returns nothing (natural stop).
export const MAX_AGENT_ITERATIONS = 5;

const SEED_MESSAGE: BuilderMessage = {
  id: newId(),
  role: "bot",
  text: "What kind of incident do you want to train your engineers on? Describe it in as much or as little detail as you like.",
};

function makeInitialState(): ScenarioBuilderState {
  return {
    phase: "idle",
    messages: [{ ...SEED_MESSAGE, id: newId() }],
    draft: null,
    assumptions: [],
    validatedYaml: null,
    validationErrors: [],
    thinking: false,
    pendingQuestion: null,
  };
}

// Deep-merge b into a. Arrays in b replace arrays in a (not appended).
function deepMerge(
  a: Partial<RawScenarioConfig>,
  b: unknown,
): Partial<RawScenarioConfig> {
  if (typeof b !== "object" || b === null) return a;
  const result = { ...a } as Record<string, unknown>;
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
    if (
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      typeof result[k] === "object" &&
      result[k] !== null &&
      !Array.isArray(result[k])
    ) {
      result[k] = deepMerge(result[k] as Partial<RawScenarioConfig>, v);
    } else {
      result[k] = v;
    }
  }
  return result as Partial<RawScenarioConfig>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useScenarioBuilder(): UseScenarioBuilderReturn {
  // State ref for capturing current values inside async callbacks
  const stateRef = useRef<ScenarioBuilderState>(makeInitialState());

  const [state, setStateInternal] = useState<ScenarioBuilderState>(
    () => stateRef.current,
  );

  function setState(
    updater: (prev: ScenarioBuilderState) => ScenarioBuilderState,
  ) {
    setStateInternal((prev) => {
      const next = updater(prev);
      stateRef.current = next;
      return next;
    });
  }

  // LLM client — created once, lazily
  const clientRef = useRef<LLMClient | null>(null);
  const clientPromiseRef = useRef<Promise<LLMClient> | null>(null);

  async function getClient(): Promise<LLMClient> {
    if (clientRef.current) return clientRef.current;
    if (!clientPromiseRef.current) {
      clientPromiseRef.current = createLLMClient().then((c) => {
        clientRef.current = c;
        return c;
      });
    }
    return clientPromiseRef.current;
  }

  // Full conversation history sent to the LLM on every call.
  // The current YAML state is appended to the system prompt so the LLM always
  // has the authoritative draft in context without polluting the message history
  // with synthetic user/assistant turns.
  function buildMessages(
    currentMessages: BuilderMessage[],
    currentDraft: Partial<RawScenarioConfig> | null,
  ): LLMMessage[] {
    const yamlState = currentDraft
      ? yaml.dump(currentDraft, { indent: 2, lineWidth: 120 })
      : "(no draft yet)";

    const systemContent =
      SYSTEM_PROMPT +
      `\n\n═══════════════════════════════════════════════════════════════\n` +
      `CURRENT SCENARIO DRAFT (authoritative — update_scenario patches this)\n` +
      `═══════════════════════════════════════════════════════════════\n` +
      `\`\`\`yaml\n${yamlState}\n\`\`\``;

    const history: LLMMessage[] = [{ role: "system", content: systemContent }];

    for (const msg of currentMessages) {
      history.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.text,
      });
    }
    return history;
  }

  // ── update_scenario tool handler ──────────────────────────────────────────

  function handleUpdateScenario(
    params: Record<string, unknown>,
    currentDraft: Partial<RawScenarioConfig> | null,
    currentAssumptions: string[],
  ):
    | {
        ok: true;
        draft: Partial<RawScenarioConfig>;
        assumptions: string[];
      }
    | {
        ok: false;
        errors: ScenarioValidationError[];
      } {
    const patch = params["patch"] as unknown;
    const assumptions = (params["assumptions"] as string[] | undefined) ?? [];

    const candidate = deepMerge(currentDraft ?? {}, patch);
    const result = ScenarioValidator.partial(candidate);

    if (!result.ok) {
      return { ok: false, errors: result.errors };
    }

    return {
      ok: true,
      draft: result.data,
      assumptions: [...currentAssumptions, ...assumptions],
    };
  }

  // ── mark_complete tool handler ─────────────────────────────────────────────

  function handleMarkComplete(currentDraft: Partial<RawScenarioConfig> | null):
    | {
        ok: true;
        yamlStr: string;
      }
    | {
        ok: false;
        errors: ScenarioValidationError[];
      } {
    const result = ScenarioValidator.strict(currentDraft ?? {});

    if (!result.ok) {
      return { ok: false, errors: result.errors };
    }

    const yamlStr = yaml.dump(result.data, { indent: 2, lineWidth: 120 });
    return { ok: true, yamlStr };
  }

  // Maximum LLM calls per user turn. The loop stops earlier when ask_question
  // or mark_complete fires, or when the model returns nothing (natural stop).

  // ── sendMessage ───────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    const userMsg: BuilderMessage = { id: newId(), role: "user", text };

    // Capture current state BEFORE setState so we have the pre-update values.
    const currentDraft = stateRef.current.draft;
    const currentAssumptions = stateRef.current.assumptions;
    const currentMessages = stateRef.current.messages;

    setState((prev) => ({
      ...prev,
      phase: prev.phase === "idle" ? "building" : prev.phase,
      messages: [...prev.messages, userMsg],
      thinking: true,
      pendingQuestion: null,
    }));

    try {
      const client = await getClient();

      // Accumulated outputs for this turn
      const newMessages: BuilderMessage[] = [];
      let newDraft = currentDraft;
      let newAssumptions = currentAssumptions;
      let newPhase: BuilderPhase = "building";
      let newYaml: string | null = null;
      let newErrors: ScenarioValidationError[] = [];
      let newPendingQuestion: PendingQuestion | null = null;

      // Running message history threaded across iterations.
      // Starts with the conversation up to and including the new user message.
      // The system message is rebuilt on every iteration (see inside loop) so
      // the model always sees the current draft YAML. Synthetic tool-result
      // messages are appended after each iteration to give the model context
      // without needing tool-role messages.
      // Initialise with just the base history; the loop replaces the system
      // message on the first iteration with the correct (possibly updated) draft.
      let iterMessages = buildMessages(
        [...currentMessages, userMsg],
        currentDraft,
      );

      // ── Agentic loop ──────────────────────────────────────────────────────
      // Each iteration: call LLM → process tool calls → decide whether to stop.
      // Stop conditions (in priority order):
      //   1. ask_question called → waiting for user input
      //   2. mark_complete succeeded → scenario complete
      //   3. No tool calls and no text → model naturally finished
      //   4. MAX_AGENT_ITERATIONS reached → safety stop
      for (let iter = 0; iter < MAX_AGENT_ITERATIONS; iter++) {
        // Rebuild system prompt with the latest draft on every iteration so the
        // model always sees the current YAML state, not a stale snapshot.
        const freshSystem = buildMessages(
          [...currentMessages, userMsg],
          newDraft,
        )[0];
        iterMessages = [freshSystem, ...iterMessages.slice(1)];

        const response = await client.call({
          role: "scenario_builder",
          messages: iterMessages,
          tools: BUILDER_TOOLS,
          sessionId: "builder",
        });

        // Collect text first (some models emit text alongside tool calls)
        if (response.text) {
          newMessages.push({ id: newId(), role: "bot", text: response.text });
        }

        // Natural stop — model returned nothing
        if (response.toolCalls.length === 0 && !response.text) {
          break;
        }

        let stopAfterIter = false;
        const toolResultMessages: string[] = [];

        for (const tc of response.toolCalls) {
          if (tc.tool === "update_scenario") {
            const result = handleUpdateScenario(
              tc.params,
              newDraft,
              newAssumptions,
            );
            if (result.ok) {
              newDraft = result.draft;
              newAssumptions = result.assumptions;
              toolResultMessages.push(
                `${AGENT_TOOL_RESULT_PREFIX} update_scenario: applied successfully.`,
              );
            } else {
              const errSummary = result.errors
                .map((e) => `${e.path}: ${e.message}`)
                .join("\n");
              toolResultMessages.push(
                `${AGENT_TOOL_RESULT_PREFIX} update_scenario: validation failed — fix all errors and call update_scenario again:\n${errSummary}`,
              );
            }
          } else if (tc.tool === "mark_complete") {
            const result = handleMarkComplete(newDraft);
            if (result.ok) {
              newPhase = "complete";
              newYaml = result.yamlStr;
              newPendingQuestion = null;
              stopAfterIter = true;
              toolResultMessages.push(
                `${AGENT_TOOL_RESULT_PREFIX} mark_complete: succeeded.`,
              );
            } else {
              newErrors = result.errors;
              const errText =
                "The scenario has validation errors that need fixing:\n" +
                result.errors
                  .map((e) => `- ${e.path}: ${e.message}`)
                  .join("\n");
              newMessages.push({ id: newId(), role: "bot", text: errText });
              toolResultMessages.push(
                `${AGENT_TOOL_RESULT_PREFIX} mark_complete: failed — fix errors with update_scenario then call mark_complete again:\n${errText}`,
              );
            }
          } else if (tc.tool === "send_message") {
            const msg = (tc.params["message"] as string | undefined) ?? "";
            if (msg) {
              newMessages.push({ id: newId(), role: "bot", text: msg });
              toolResultMessages.push(
                `${AGENT_TOOL_RESULT_PREFIX} send_message: delivered.`,
              );
            } else {
              toolResultMessages.push(
                `${AGENT_TOOL_RESULT_PREFIX} send_message: ignored — message was empty. Call send_message with a non-empty message.`,
              );
            }
            // send_message does NOT stop the loop — model may send more
          } else if (tc.tool === "ask_question") {
            const q = (tc.params["question"] as string | undefined) ?? "";
            const opts = (tc.params["options"] as string[] | undefined) ?? [];
            if (q && opts.length >= 2) {
              newMessages.push({ id: newId(), role: "bot", text: q });
              newPendingQuestion = { question: q, options: opts };
              toolResultMessages.push(
                `${AGENT_TOOL_RESULT_PREFIX} ask_question: delivered. Waiting for user reply.`,
              );
              stopAfterIter = true; // ask_question always ends the turn
            } else {
              // Invalid ask_question — do not stop the turn, let model try again
              toolResultMessages.push(
                `${AGENT_TOOL_RESULT_PREFIX} ask_question: ignored — question must be non-empty and options must have at least 2 items.`,
              );
            }
          }
        }

        // Append tool results as a synthetic user message so the model has
        // context on the next iteration without needing tool-role messages.
        // The AGENT_TOOL_RESULT_PREFIX on every line lets the mock provider
        // and any future tooling detect loop-iteration messages reliably.
        if (toolResultMessages.length > 0) {
          iterMessages = [
            ...iterMessages,
            { role: "user", content: toolResultMessages.join("\n\n") },
          ];
        }

        if (stopAfterIter) break;
      }

      setState((prev) => ({
        ...prev,
        phase:
          newPhase === "complete"
            ? "complete"
            : prev.phase === "idle"
              ? "building"
              : prev.phase,
        messages: [...prev.messages, ...newMessages],
        draft: newDraft,
        assumptions: newAssumptions,
        validatedYaml: newYaml ?? prev.validatedYaml,
        validationErrors: newErrors,
        thinking: false,
        pendingQuestion: newPendingQuestion,
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "An error occurred";
      setState((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: newId(),
            role: "bot" as const,
            text: `Something went wrong: ${msg}. Please try again.`,
          },
        ],
        thinking: false,
      }));
    }
  }, []);

  // ── downloadYaml ──────────────────────────────────────────────────────────

  const downloadYaml = useCallback((): void => {
    const yaml = state.validatedYaml;
    if (!yaml) return;
    const blob = new Blob([yaml], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${state.draft?.id ?? "scenario"}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [state.validatedYaml, state.draft?.id]);

  // ── reset ──────────────────────────────────────────────────────────────────

  const reset = useCallback((): void => {
    const initial = makeInitialState();
    stateRef.current = initial;
    setStateInternal(initial);
  }, []);

  return { state, sendMessage, downloadYaml, reset };
}
