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
}

export interface UseScenarioBuilderReturn {
  state: ScenarioBuilderState;
  sendMessage: (text: string) => Promise<void>;
  downloadYaml: () => void;
  reset: () => void;
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a scenario co-author for an on-call incident training simulator.
Your job is to help the user build a realistic, playable AWS incident scenario through natural conversation.

CONVERSATION PRINCIPLES:
- Build iteratively: populate fields from what the user provides, make reasonable assumptions for
  the rest, and tell the user what was assumed.
- Call update_scenario after each meaningful chunk of new information — don't wait until everything
  is settled. The user can see the scenario take shape live as you call this tool.
- Ask one focused question at a time. Never ask a list of five questions at once.
- For derived fields (id, title, tags) — derive them from context, never ask the user.
- When the scenario feels complete, summarise what was built and assumptions made, then call mark_complete.
- After mark_complete succeeds, remain available for refinements.

VALIDATION:
- If update_scenario returns { ok: false, errors: [...] }, read ALL errors carefully,
  fix them ALL in a single pass, and call update_scenario again. Never ignore errors.
- If mark_complete fails, fix all errors with update_scenario then call mark_complete again.

═══════════════════════════════════════════════════════════════
EXACT SCHEMA — use these field names and types precisely
═══════════════════════════════════════════════════════════════

── TOP-LEVEL FIELDS ──────────────────────────────────────────
id: string (slug, e.g. "order-api-cascade")
title: string
description: string
difficulty: "easy" | "medium" | "hard"
tags: string[]
timeline: { default_speed: 1|2|5|10, duration_minutes: number }
topology: { focal_service: ServiceNode, upstream: ServiceNode[], downstream: ServiceNode[] }
engine: { tick_interval_seconds: 15, llm_event_tools: [] }
personas: Persona[]
remediation_actions: RemediationAction[]
evaluation: Evaluation
email: []
chat: { channels: [{ id: "incidents", name: "#incidents" }], messages: [] }
ticketing: Ticket[]
alarms: Alarm[]
wiki: { pages: [{ title: string, content: string }] }
cicd: { pipelines: [], deployments: [] }        ← OBJECT with two array fields, NOT an array
logs: []
log_patterns: []
background_logs: []
feature_flags: []
host_groups: []

── COMPONENT TYPES (discriminated union on "type") ───────────
Every component MUST have: id (string), label (string), inputs (string[])
Additional required fields per type:

  type: "load_balancer"    → no extra fields
  type: "api_gateway"      → no extra fields
  type: "sqs_queue"        → no extra fields
  type: "s3"               → no extra fields
  type: "scheduler"        → no extra fields

  type: "ecs_cluster"      → instance_count (int), utilization (0.0-1.0)
  type: "ec2_fleet"        → instance_count (int), utilization (0.0-1.0)
  type: "elasticache"      → instance_count (int), utilization (0.0-1.0)

  type: "lambda"           → reserved_concurrency (int), lambda_utilization (0.0-1.0)

  type: "kinesis_stream"   → shard_count (int)

  type: "rds"              → instance_count (int), max_connections (int),
                             utilization (0.0-1.0), connection_utilization (0.0-1.0)

  type: "dynamodb"         → write_capacity (int), read_capacity (int),
                             write_utilization (0.0-1.0), read_utilization (0.0-1.0)

VALID TYPE VALUES (only these 12): load_balancer, api_gateway, ecs_cluster, ec2_fleet,
  lambda, kinesis_stream, sqs_queue, dynamodb, rds, elasticache, s3, scheduler

── TOPOLOGY ──────────────────────────────────────────────────
topology: {
  focal_service: ServiceNode,     ← the main service the incident affects
  upstream: ServiceNode[],        ← services that CALL the focal service (can be [])
  downstream: ServiceNode[]       ← services the focal service CALLS (can be [])
}

Every ServiceNode (focal_service, upstream[], downstream[]) MUST have:
  name: string          ← REQUIRED
  description: string   ← REQUIRED
  components: []        ← REQUIRED (can be empty array for upstream/downstream)
  incidents: []         ← REQUIRED (can be empty array for upstream/downstream)

Example upstream/downstream node (minimal valid form):
  { name: "web-frontend", description: "React SPA calling the order API", components: [], incidents: [] }

── INCIDENT ──────────────────────────────────────────────────
{
  id: string,
  affected_component: string,   ← must match a component id in the same focal_service
  description: string,
  onset_overlay: "spike_and_sustain" | "gradual_degradation" | "saturation" | "sudden_drop",
  onset_second: number,          ← seconds from session start; use negative for pre-incident
  magnitude: number,             ← for saturation: 0.0-1.0; for others: > 0
  propagation_direction: "upstream" | "downstream" | "both"   ← optional, default "upstream"
}
magnitude rules:
  saturation      → magnitude must be > 0 and ≤ 1.0
  sudden_drop     → magnitude must be > 0 and < 1.0 (fraction the metric drops TO)
  spike_and_sustain / gradual_degradation → magnitude > 0 (multiplier, e.g. 5.0 = 5× normal)

── PERSONA ───────────────────────────────────────────────────
{
  id: string,
  display_name: string,
  job_title: string,
  team: string,
  avatar_color: string (hex),
  initiates_contact: boolean,
  cooldown_seconds: number,
  silent_until_contacted: boolean,
  system_prompt: string
}

── REMEDIATION ACTION ────────────────────────────────────────
{
  id: string,
  type: "rollback" | "roll_forward" | "restart_service" | "scale_cluster" |
        "throttle_traffic" | "emergency_deploy" | "toggle_feature_flag",
  service: string,
  is_correct_fix: boolean,
  side_effect: string (optional)
  // rollback / roll_forward / emergency_deploy: target_version (string)
  // emergency_deploy: target_stage (string)
  // toggle_feature_flag: flag_id (string), flag_enabled (boolean)
}

── TICKET ────────────────────────────────────────────────────
ticketing is an ARRAY of ticket objects (not an object):
[
  {
    id: string,
    title: string,
    severity: "SEV1" | "SEV2" | "SEV3" | "SEV4",
    status: "open" | "in_progress" | "resolved",
    description: string,
    created_by: string (persona id),
    assignee: "trainee" (optional),
    at_second: number
  }
]

── EVALUATION ────────────────────────────────────────────────
{
  root_cause: string (non-empty),
  relevant_actions: [{ action: string, why: string, service: string (optional) }],
  red_herrings: [{ action: string, why: string }],
  debrief_context: string (non-empty)
}

── ALARM ─────────────────────────────────────────────────────
{
  id: string,
  service: string,
  metric_id: string,
  condition: string,
  severity: "SEV1" | "SEV2" | "SEV3" | "SEV4",
  auto_fire: boolean,
  auto_page: boolean,
  onset_second: number (optional),
  page_message: string (optional)
}
═══════════════════════════════════════════════════════════════`;

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

  // Full conversation history including system prompt (not shown in UI)
  // We build this from current state on every call.
  function buildMessages(currentMessages: BuilderMessage[]): LLMMessage[] {
    const history: LLMMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
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

  // ── sendMessage ───────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    // 1. Append user message and set thinking
    const userMsg: BuilderMessage = { id: newId(), role: "user", text };
    setState((prev) => ({
      ...prev,
      phase: prev.phase === "idle" ? "building" : prev.phase,
      messages: [...prev.messages, userMsg],
      thinking: true,
    }));

    // Read current values from ref (sync, always up-to-date)
    const currentDraft = stateRef.current.draft;
    const currentAssumptions = stateRef.current.assumptions;
    const currentMessages = stateRef.current.messages;

    // 2. Call LLM
    try {
      const client = await getClient();
      const response = await client.call({
        role: "scenario_builder",
        messages: buildMessages([...currentMessages, userMsg]),
        tools: BUILDER_TOOLS,
        sessionId: "builder",
      });

      // 3. Process response — collect state updates
      const newMessages: BuilderMessage[] = [];
      let newDraft = currentDraft;
      let newAssumptions = currentAssumptions;
      let newPhase: BuilderPhase = "building";
      let newYaml: string | null = null;
      let newErrors: ScenarioValidationError[] = [];

      // Process text response
      if (response.text) {
        newMessages.push({ id: newId(), role: "bot", text: response.text });
      }

      // Process tool calls
      for (const tc of response.toolCalls) {
        if (tc.tool === "update_scenario") {
          const toolResult = handleUpdateScenario(
            tc.params,
            newDraft,
            newAssumptions,
          );
          if (toolResult.ok) {
            newDraft = toolResult.draft;
            newAssumptions = toolResult.assumptions;
          } else {
            // Feed error back as a user message (tool result)
            const errText =
              "I encountered validation errors:\n" +
              toolResult.errors
                .map((e) => `- [${e.source}] ${e.path}: ${e.message}`)
                .join("\n") +
              "\n\nPlease fix these issues.";
            newMessages.push({ id: newId(), role: "bot", text: errText });
          }
        } else if (tc.tool === "mark_complete") {
          const completeResult = handleMarkComplete(newDraft);
          if (completeResult.ok) {
            newPhase = "complete";
            newYaml = completeResult.yamlStr;
          } else {
            const errText =
              "The scenario has validation errors that need fixing before it can be downloaded:\n" +
              completeResult.errors
                .map((e) => `- [${e.source}] ${e.path}: ${e.message}`)
                .join("\n");
            newMessages.push({ id: newId(), role: "bot", text: errText });
            newErrors = completeResult.errors;
          }
        }
      }

      // 4. Commit all state changes atomically
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
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "An error occurred";
      setState((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: newId(),
            role: "bot",
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
