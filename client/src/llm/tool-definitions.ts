// tool-definitions.ts — LLM tool schemas for stakeholder, coach, and builder roles.

import type { LLMToolDefinition, LLMToolCall } from "./llm-client";
import type { LoadedScenario } from "../scenario/types";

// ── Communication tools (always enabled for stakeholder) ─────────────────────

export const COMMUNICATION_TOOLS: LLMToolDefinition[] = [
  {
    name: "send_message",
    description: "Send a chat message as a persona to a channel.",
    parameters: {
      type: "object",
      properties: {
        persona: {
          type: "string",
          description: "The persona ID sending the message.",
        },
        channel: {
          type: "string",
          description:
            'The channel to post to, e.g. "#incidents" or "dm:trainee".',
        },
        message: { type: "string", description: "The message text." },
      },
      required: ["persona", "channel", "message"],
    },
  },
  {
    name: "send_email",
    description: "Send an email as a persona to the trainee.",
    parameters: {
      type: "object",
      properties: {
        persona: {
          type: "string",
          description: "The persona ID sending the email.",
        },
        thread_id: { type: "string", description: "The email thread ID." },
        subject: { type: "string", description: "Email subject line." },
        body: { type: "string", description: "Email body (markdown)." },
      },
      required: ["persona", "thread_id", "subject", "body"],
    },
  },
  {
    name: "add_ticket_comment",
    description: "Add a comment to a ticket as a persona.",
    parameters: {
      type: "object",
      properties: {
        persona: {
          type: "string",
          description: "The persona ID adding the comment.",
        },
        ticket_id: { type: "string", description: "The ticket ID." },
        comment: { type: "string", description: "The comment text." },
      },
      required: ["persona", "ticket_id", "comment"],
    },
  },
];

// ── Event tools (conditionally enabled via scenario llm_event_tools config) ───

export const EVENT_TOOLS: LLMToolDefinition[] = [
  {
    name: "select_metric_reaction",
    description:
      "Assess the cumulative effect of the trainee's recent actions on each active " +
      "incident metric and declare a per-metric reaction. Only list metrics that actually " +
      "change — omitted metrics are treated as no_effect. Hints are provided per metric " +
      "in the prompt but are non-binding.\n\n" +
      "Outcomes per metric:\n" +
      "  full_recovery — metric returns to baseline (root cause resolved for this metric)\n" +
      "  partial_recovery — metric improves but root cause not fully addressed\n" +
      "  worsening — metric degrades further (wrong action or side effect)\n" +
      "  no_effect — metric trajectory unchanged (action irrelevant to this metric)",
    parameters: {
      type: "object",
      required: ["metric_reactions"],
      properties: {
        metric_reactions: {
          type: "array",
          description:
            "One entry per metric whose trajectory changes. " +
            "Omit a metric to leave it unaffected (implicit no_effect).",
          items: {
            type: "object",
            required: ["metric_id", "outcome"],
            properties: {
              metric_id: {
                type: "string",
                description:
                  "The metric_id as shown in the Per-Metric Reactions section (e.g. 'recommendation-service/connection_pool_used'). Always use the full service/metricId format.",
              },
              outcome: {
                type: "string",
                enum: [
                  "full_recovery",
                  "partial_recovery",
                  "worsening",
                  "no_effect",
                ],
                description:
                  "The net effect of the actions on this specific metric.",
              },
              pattern: {
                type: "string",
                enum: [
                  "smooth_decay",
                  "cliff",
                  "stepped",
                  "blip_then_decay",
                  "queue_burndown",
                  "oscillating",
                  "sawtooth_rebound",
                ],
                description:
                  "Visual shape of the transition. Hint is provided but non-binding. " +
                  "smooth_decay = gradual exponential. cliff = near-instant. " +
                  "stepped = discrete steps. blip_then_decay = spike then decay. " +
                  "queue_burndown = flat then rapid. oscillating = cycles. " +
                  "sawtooth_rebound = periodic bounces.",
              },
              speed: {
                type: "string",
                enum: ["1m", "5m", "15m", "30m", "60m"],
                description:
                  "How quickly the transition completes. Default: 5m. " +
                  "1m for immediate fixes. 15m–30m for infra changes. 60m for slow recovery.",
              },
              magnitude: {
                type: "number",
                minimum: 0,
                maximum: 1,
                description:
                  "How far toward the target to move (0.0–1.0). " +
                  "Defaults: full_recovery=1.0, partial_recovery=0.5, worsening=1.0. " +
                  "Use 0.2 for barely-improved, 0.8 for nearly-resolved.",
              },
              sustained: {
                type: "boolean",
                description:
                  "true (default) = change persists. " +
                  "false = reverts to scripted incident after transition (transient blip).",
              },
              oscillating_mode: {
                type: "string",
                enum: ["damping", "sustained"],
                description:
                  "Only for pattern=oscillating. damping (default) or sustained.",
              },
              cycle_seconds: {
                type: "number",
                minimum: 30,
                maximum: 300,
                description:
                  "Only for pattern=oscillating. Period in seconds. Default: 60.",
              },
            },
          },
        },
        reasoning: {
          type: "string",
          description:
            "One or two sentences explaining the per-metric decisions. " +
            "Mention which actions drove each outcome.",
        },
      },
    },
  },
  {
    name: "apply_metric_response",
    description: `Mutate live metric trajectories in response to a trainee action.
      Use this when the trainee has done something that changes the incident trajectory —
      either improving or worsening the situation. Specify each affected metric individually
      to model realistic asymmetric recovery. The server handles all math; you specify
      semantic parameters only.`,
    parameters: {
      type: "object",
      required: ["affected_metrics"],
      properties: {
        affected_metrics: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: [
              "service",
              "metric_id",
              "direction",
              "pattern",
              "speed",
              "magnitude",
            ],
            properties: {
              service: { type: "string" },
              metric_id: { type: "string" },
              direction: { type: "string", enum: ["recovery", "worsening"] },
              pattern: {
                type: "string",
                enum: [
                  "smooth_decay",
                  "stepped",
                  "queue_burndown",
                  "oscillating",
                  "blip_then_decay",
                  "cascade_clear",
                  "sawtooth_rebound",
                  "cliff",
                ],
              },
              speed: {
                type: "string",
                enum: ["1m", "5m", "15m", "30m", "60m"],
              },
              magnitude: { type: "string", enum: ["full", "partial"] },
              sustained: {
                type: "boolean",
                description:
                  "If false, metric reverts to scripted incident behavior after speedSeconds. Defaults to true (persists until overwritten by another action). Only set false for transient one-off effects.",
              },
              oscillation_mode: {
                type: "string",
                enum: ["damping", "sustained"],
              },
              cycle_seconds: { type: "number", minimum: 30, maximum: 300 },
            },
          },
        },
      },
    },
  },
  {
    name: "fire_alarm",
    description: "Fire a new alarm event in the simulation.",
    parameters: {
      type: "object",
      properties: {
        alarm_id: { type: "string" },
        service: { type: "string" },
        condition: { type: "string" },
        severity: { type: "string", enum: ["SEV1", "SEV2", "SEV3", "SEV4"] },
        message: { type: "string" },
      },
      required: ["alarm_id", "service", "severity", "message"],
    },
  },
  {
    name: "silence_alarm",
    description: "Silence an existing alarm.",
    parameters: {
      type: "object",
      properties: {
        alarm_id: { type: "string" },
      },
      required: ["alarm_id"],
    },
  },
  {
    name: "inject_log_entry",
    description: "Inject a log entry for a service.",
    parameters: {
      type: "object",
      properties: {
        service: { type: "string" },
        level: { type: "string", enum: ["DEBUG", "INFO", "WARN", "ERROR"] },
        message: { type: "string" },
      },
      required: ["service", "level", "message"],
    },
  },
  {
    name: "trigger_cascade",
    description: "Trigger a cascading failure to a dependent service.",
    parameters: {
      type: "object",
      properties: {
        service: { type: "string", description: "The service to cascade to." },
        reason: { type: "string", description: "Reason for the cascade." },
      },
      required: ["service", "reason"],
    },
  },
];

// ── Coach tools (read-only, always enabled) ───────────────────────────────────

export const COACH_TOOLS: LLMToolDefinition[] = [
  {
    name: "send_coach_message",
    description: "Send a coaching message to the trainee.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "The coaching message." },
      },
      required: ["message"],
    },
  },
];

// ── Tool set builders ─────────────────────────────────────────────────────────

/**
 * Returns stakeholder tool definitions for the scenario.
 * COMMUNICATION_TOOLS always included.
 * EVENT_TOOLS filtered by scenario.engine.llmEventTools config,
 * excluding select_metric_reaction (handled by metric-reaction-engine).
 */
export function getStakeholderTools(
  scenario: LoadedScenario,
): LLMToolDefinition[] {
  const enabledTools = new Set<string>(
    scenario.engine.llmEventTools
      .filter((t) => t.enabled !== false)
      .map((t) => t.tool),
  );
  const eventTools = EVENT_TOOLS.filter(
    (t) =>
      enabledTools.has(t.name) &&
      t.name !== "select_metric_reaction" &&
      t.name !== "apply_metric_response",
  );
  return [...COMMUNICATION_TOOLS, ...eventTools];
}

/**
 * Returns the tool list for the metric reaction engine — select_metric_reaction only.
 * Schema is static; no dynamic population needed.
 * Enabled when the scenario has select_metric_reaction in llm_event_tools.
 */
export function getMetricReactionTools(
  scenario: LoadedScenario,
): LLMToolDefinition[] {
  const enabled = scenario.engine.llmEventTools.some(
    (t) => t.tool === "select_metric_reaction" && t.enabled !== false,
  );
  if (!enabled) return [];
  const tool = EVENT_TOOLS.find((t) => t.name === "select_metric_reaction");
  return tool ? [tool] : [];
}

/**
 * Returns the coach tool definitions — always the same set.
 */
export function getCoachTools(): LLMToolDefinition[] {
  return [...COACH_TOOLS];
}

// ── Tool call validation ──────────────────────────────────────────────────────

export interface ToolCallValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates a tool call before execution.
 * For apply_metric_response: structural validation only — topology validation
 * (service/metricId existence) happens in the stakeholder engine execution step.
 * callCounts tracks per-tool invocations within the current tick.
 */
export function validateToolCall(
  toolCall: LLMToolCall,
  scenario: LoadedScenario,
  callCounts: Record<string, number>,
  activeTools?: LLMToolDefinition[],
  activeAlarmIds?: Set<string>,
): ToolCallValidationResult {
  const { tool, params } = toolCall;

  // Tool must be in active tool list
  const toolDef = (activeTools ?? getStakeholderTools(scenario)).find(
    (t) => t.name === tool,
  );
  if (!toolDef) {
    return {
      valid: false,
      reason: `Tool '${tool}' is not in the active tool definitions for this scenario`,
    };
  }

  // Validate required params present
  const schema = toolDef.parameters as {
    required?: string[];
    properties?: Record<string, unknown>;
  };
  const required = schema.required ?? [];
  for (const req of required) {
    if (params[req] == null || params[req] === "") {
      return {
        valid: false,
        reason: `Missing required param '${req}' for tool '${tool}'`,
      };
    }
  }

  // Tool-specific constraints

  // select_metric_reaction: reaction_id is validated by required-field check above
  // and the static enum in the tool schema. No additional validation needed.

  if (tool === "fire_alarm") {
    const toolConfig = scenario.engine.llmEventTools.find(
      (t) => t.tool === "fire_alarm",
    );
    const maxCalls = toolConfig?.maxCalls ?? Infinity;
    const count = callCounts[tool] ?? 0;
    if (count >= maxCalls) {
      return {
        valid: false,
        reason: `fire_alarm max_calls (${maxCalls}) exceeded for this tick`,
      };
    }
  }

  if (tool === "trigger_cascade") {
    const toolConfig = scenario.engine.llmEventTools.find(
      (t) => t.tool === "trigger_cascade",
    );
    const allowList = toolConfig?.services ?? [];
    const targetSvc = params["service"] as string | undefined;
    if (allowList.length > 0 && targetSvc && !allowList.includes(targetSvc)) {
      return {
        valid: false,
        reason: `trigger_cascade target '${targetSvc}' not in allowed services list`,
      };
    }
  }

  if (tool === "silence_alarm") {
    const alarmId = params["alarm_id"] as string | undefined;
    if (alarmId && activeAlarmIds && !activeAlarmIds.has(alarmId)) {
      return {
        valid: false,
        reason: `silence_alarm: alarm '${alarmId}' does not exist`,
      };
    }
  }

  return { valid: true };
}

// ── Builder tools (scenario_builder role) ─────────────────────────────────────

export const BUILDER_TOOLS: LLMToolDefinition[] = [
  {
    name: "update_scenario",
    description:
      "Commit new or changed scenario data. The patch is deep-merged into the current draft. " +
      "Arrays are replaced in full — always send the complete updated array for any array field you change. " +
      "The patch is validated before being applied. If validation fails, errors are returned and you must " +
      "fix them before the draft updates. Call this as often as you like — after each user answer, " +
      "after making an assumption, mid-conversation.",
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
            "List of fields you filled without asking the user. Displayed on the canvas Assumptions card.",
          items: { type: "string" },
        },
      },
    },
  },
  {
    name: "mark_complete",
    description:
      "Signal that the scenario is ready for download. Triggers final full validation. " +
      "If validation fails, errors are returned — fix them with update_scenario then call mark_complete again. " +
      "After mark_complete succeeds, remain available for refinements. " +
      "Each change should call update_scenario then mark_complete again.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "send_message",
    description:
      "Send a message to the user. Use this to: explain what you just built, " +
      "tell the user what assumptions were made, or ask for the next piece of " +
      "information you need to continue building the scenario. " +
      "Call this after update_scenario to explain the patch and prompt the user. " +
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
  },
  {
    name: "ask_question",
    description:
      "Ask the user a focused question with selectable options. " +
      "Use when the user needs to choose between specific alternatives " +
      "(e.g. difficulty level, incident type, number of personas). " +
      "Keep option labels short — 1 to 5 words each. " +
      "The user may ignore the options and type a free-form reply instead; " +
      "handle either response gracefully. " +
      "Do not call ask_question more than once per turn.",
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
  },
];
