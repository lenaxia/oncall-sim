// useScenarioBuilder.ts — LLM-driven scenario co-authoring hook.
// Manages conversation state, tool call handling, draft state, and YAML serialisation.

import { useState, useRef, useCallback } from "react";
import yaml from "js-yaml";
import { createLLMClient } from "../llm/llm-client";
import type { LLMClient, LLMMessage } from "../llm/llm-client";
import { BUILDER_TOOLS } from "../llm/tool-definitions";
import { ScenarioValidator } from "../scenario/validator";
import type { ScenarioValidationError } from "../scenario/lint";
import type { RawScenarioConfig } from "../scenario/schema";
import { buildSchemaReference } from "../scenario/schema";

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

═══════════════════════════════════════════════════════════════
RECOMMENDED BUILD PROCESS — follow this sequence
═══════════════════════════════════════════════════════════════

Follow these phases in order. Complete each before moving to the next.
Call update_scenario + send_message after each phase.

PHASE 1 — Core incident (required first)
  Ask: what service, what goes wrong, how does it manifest?
  Build: id, title, description, difficulty, tags, timeline, topology
         (focal_service with components + at least one incident)
  Default: upstream: [], downstream: [] unless user specifies otherwise

PHASE 2 — Personas (required)
  Ask: who does the trainee interact with? (suggest 2–3 personas)
  Use ask_question for number and roles if not specified
  Build: personas array

  PERSONA DEFAULTS — apply these unless the user says otherwise:
  - silent_until_contacted: true for all personas
  - initiates_contact: false for all personas
  - cooldown_seconds: 120 (2 minutes between messages)
  This is a skill-building sim. The trainee should drive the scenario.
  Personas should only initiate contact if there is an explicit, realistic
  reason (e.g. an on-call manager paging the trainee at incident start,
  or a monitor bot firing an alert). When in doubt, keep them silent.

PHASE 3 — Remediation + evaluation (required)
  Ask: what is the correct fix? what are the red herrings?
  Build: remediation_actions (at least one is_correct_fix: true),
         evaluation (root_cause + debrief_context)

PHASE 4 — Supporting infrastructure (use defaults unless user wants detail)
  Build: alarms, ticketing, chat, wiki
  Default ALL of these unless the user specifically asks for customisation:
    logs: []
    feature_flags: []
    host_groups: []
    cicd: { pipelines: [], deployments: [] }
    email: []

PHASE 5 — Log generation (required, no user input needed)
  Without asking the user, generate realistic log_patterns and background_logs
  based on what has already been built:
  - background_logs: one entry per service in the topology using the most
    appropriate profile (java_web_service, nodejs_api, python_worker,
    sidecar_proxy). Cover from pre-incident through end of scenario.
  - log_patterns: 3–6 entries that tell the story of the incident — normal
    traffic before onset, degradation signals around onset_second, and
    error/warn patterns during the incident. Reference the actual service
    names, component types, and incident description from the topology.
  After generating, call send_message to briefly tell the user what log
  coverage was added and offer to adjust it.

PHASE 6 — Review + complete
  Call send_message with a summary of what was built and assumptions made
  Offer ask_question if any important choices are still open
  Call mark_complete when the user is satisfied

KEY RULE: Never author feature_flags, host_groups, or cicd.pipelines/deployments
unless the user explicitly asks for them. Always default these to empty arrays/objects.

═══════════════════════════════════════════════════════════════
CONVERSATION PRINCIPLES
═══════════════════════════════════════════════════════════════

- Build iteratively — populate fields from what the user provides, make
  reasonable assumptions for the rest, and tell the user what was assumed.
- Call update_scenario after each meaningful chunk of new information.
- After calling update_scenario, call send_message to explain what was built
  and prompt for the next piece of information needed.
- Use ask_question when the user needs to choose between specific alternatives.
  Keep option labels 1–5 words. Do not call ask_question more than once per turn.
- Do NOT put conversational text inside update_scenario or mark_complete parameters.
- Ask one focused question at a time. Never ask a list of five questions at once.
- For derived fields (id, title, tags) — derive from context, never ask the user.
- When the scenario feels complete, summarise and call mark_complete.
- After mark_complete succeeds, remain available for refinements.

VALIDATION:
- If update_scenario returns { ok: false, errors: [...] }, silently fix ALL
  errors in a single pass and call update_scenario again. Do not mention
  the errors to the user unless you cannot fix them after two attempts.
- If mark_complete fails, fix errors with update_scenario then call mark_complete again.
`;

function buildSystemPrompt(): string {
  return SYSTEM_PROMPT_BASE + "\n" + buildSchemaReference();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let _msgCounter = 0;
function newId(): string {
  return `msg-${++_msgCounter}-${Date.now()}`;
}

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

  // Full conversation history including system prompt (not shown in UI).
  // Injects the current YAML state as the first two messages after the system
  // prompt so the LLM always has the authoritative draft in context, regardless
  // of how many turns have elapsed.
  function buildMessages(
    currentMessages: BuilderMessage[],
    currentDraft: Partial<RawScenarioConfig> | null,
  ): LLMMessage[] {
    const history: LLMMessage[] = [
      { role: "system", content: buildSystemPrompt() },
    ];

    // Inject current YAML state. Done on every request so the LLM never has to
    // reconstruct it from memory. Two messages are used — user then assistant —
    // to avoid a back-to-back user message which some providers reject.
    const yamlState = currentDraft
      ? yaml.dump(currentDraft, { indent: 2, lineWidth: 120 })
      : "(no draft yet)";
    history.push({
      role: "user",
      content: `Current scenario YAML state:\n\`\`\`yaml\n${yamlState}\`\`\``,
    });
    history.push({
      role: "assistant",
      content: "Understood. I have the current YAML state.",
    });

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

  // Maximum silent auto-retries when update_scenario validation fails.
  const MAX_UPDATE_RETRIES = 2;

  // ── sendMessage ───────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    const userMsg: BuilderMessage = { id: newId(), role: "user", text };
    setState((prev) => ({
      ...prev,
      phase: prev.phase === "idle" ? "building" : prev.phase,
      messages: [...prev.messages, userMsg],
      thinking: true,
      pendingQuestion: null,
    }));

    const currentDraft = stateRef.current.draft;
    const currentAssumptions = stateRef.current.assumptions;
    const currentMessages = stateRef.current.messages;

    try {
      const client = await getClient();

      // Build the full conversation history to send to the LLM.
      // On retry this grows to include the injected error tool result.
      let messages = buildMessages([...currentMessages, userMsg], currentDraft);

      let newMessages: BuilderMessage[] = [];
      let newDraft = currentDraft;
      let newAssumptions = currentAssumptions;
      let newPhase: BuilderPhase = "building";
      let newYaml: string | null = null;
      let newErrors: ScenarioValidationError[] = [];
      let newPendingQuestion: PendingQuestion | null = null;

      // We make at most 1 + MAX_UPDATE_RETRIES LLM calls total.
      // On each loop we process the response; if update_scenario fails we
      // inject the errors into the message list and loop again silently.
      for (let attempt = 0; attempt <= MAX_UPDATE_RETRIES; attempt++) {
        const response = await client.call({
          role: "scenario_builder",
          messages,
          tools: BUILDER_TOOLS,
          sessionId: "builder",
        });

        // Reset per-attempt accumulators (we only keep the last successful pass)
        const attemptMessages: BuilderMessage[] = [];
        let updateFailed = false;
        let failureErrors: ScenarioValidationError[] = [];

        if (response.text) {
          attemptMessages.push({
            id: newId(),
            role: "bot",
            text: response.text,
          });
        }

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
            } else {
              updateFailed = true;
              failureErrors = result.errors;
            }
          } else if (tc.tool === "mark_complete") {
            const result = handleMarkComplete(newDraft);
            if (result.ok) {
              newPhase = "complete";
              newYaml = result.yamlStr;
              newPendingQuestion = null;
            } else {
              newErrors = result.errors;
              attemptMessages.push({
                id: newId(),
                role: "bot",
                text:
                  "The scenario has validation errors that need fixing:\n" +
                  result.errors
                    .map((e) => `- ${e.path}: ${e.message}`)
                    .join("\n"),
              });
            }
          } else if (tc.tool === "send_message") {
            const msg = (tc.params["message"] as string | undefined) ?? "";
            if (msg)
              attemptMessages.push({ id: newId(), role: "bot", text: msg });
          } else if (tc.tool === "ask_question") {
            const q = (tc.params["question"] as string | undefined) ?? "";
            const opts = (tc.params["options"] as string[] | undefined) ?? [];
            if (q && opts.length >= 2) {
              attemptMessages.push({ id: newId(), role: "bot", text: q });
              newPendingQuestion = { question: q, options: opts };
            }
          }
        }

        if (updateFailed && attempt < MAX_UPDATE_RETRIES) {
          // Silent retry: inject errors as a user message and loop again.
          // Discard any messages from this attempt — user never sees them.
          messages = [
            ...messages,
            {
              role: "user" as const,
              content:
                "update_scenario validation failed. Fix all errors and call update_scenario again:\n" +
                JSON.stringify(failureErrors, null, 2),
            },
          ];
          continue;
        }

        // Commit this attempt's messages (success, or final failed attempt)
        newMessages = [...newMessages, ...attemptMessages];

        if (updateFailed) {
          // All retries exhausted — show a brief, friendly message
          const fields = [
            ...new Set(failureErrors.map((e) => e.path.split(".")[0])),
          ];
          newMessages.push({
            id: newId(),
            role: "bot",
            text:
              `I couldn't apply that change after ${MAX_UPDATE_RETRIES + 1} attempts ` +
              `(fields: ${fields.join(", ")}). Try asking me to simplify that section.`,
          });
        }

        break; // success or exhausted — stop looping
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
