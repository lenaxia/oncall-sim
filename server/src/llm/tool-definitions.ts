// tool-definitions.ts — LLM tool schemas for stakeholder and coach roles.

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
 * EVENT_TOOLS filtered by scenario.engine.llmEventTools config.
 */
export function getStakeholderTools(
  scenario: LoadedScenario,
): LLMToolDefinition[] {
  const enabledTools = new Set(
    scenario.engine.llmEventTools
      .filter((t) => t.enabled !== false)
      .map((t) => t.tool),
  );
  const eventTools = EVENT_TOOLS.filter((t) => enabledTools.has(t.name));
  return [...COMMUNICATION_TOOLS, ...eventTools];
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

  if (tool === "apply_metric_response") {
    const entries = params["affected_metrics"];
    if (!Array.isArray(entries) || entries.length === 0) {
      return {
        valid: false,
        reason:
          "apply_metric_response: affected_metrics must be a non-empty array",
      };
    }
    for (const entry of entries as Record<string, unknown>[]) {
      if (
        !entry["service"] ||
        !entry["metric_id"] ||
        !entry["direction"] ||
        !entry["pattern"] ||
        !entry["speed"] ||
        !entry["magnitude"]
      ) {
        return {
          valid: false,
          reason:
            "apply_metric_response: each entry requires service, metric_id, direction, pattern, speed, magnitude",
        };
      }
    }
  }

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
