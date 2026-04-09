// stakeholder-engine.ts — tick-driven LLM caller wired as onDirtyTick hook.
// Never throws — all errors are logged and swallowed.

import { randomUUID } from "crypto";
import type { LoadedScenario } from "../scenario/types";
import type {
  SimEvent,
  ChatMessage,
  EmailMessage,
  LogEntry,
  Alarm,
  TicketComment,
} from "@shared/types/events";
import type { StakeholderContext } from "./game-loop";
import type { LLMClient, LLMMessage } from "../llm/llm-client";
import { LLMError } from "../llm/llm-client";
import { getStakeholderTools, validateToolCall } from "../llm/tool-definitions";
import { renderMetricSummary } from "../metrics/metric-summary";
import { logger } from "../logger";
import type { MetricStore } from "../metrics/metric-store";
import {
  resolveReactiveTarget,
  REACTIVE_SPEED_SECONDS,
} from "../metrics/patterns/reactive-overlay";
import type { ResolvedReactiveParams } from "../metrics/types";
import type {
  ReactiveSpeedTier,
  ReactiveOverlayType,
} from "@shared/types/events";

const log = logger.child({ component: "stakeholder-engine" });

// ── Token budget ──────────────────────────────────────────────────────────────

/**
 * Best-effort token estimate: 1 token ≈ 4 characters (widely used rough estimate).
 * Applied to user message content only — system prompt is always preserved.
 */
const CHARS_PER_TOKEN = 4;
const DEFAULT_TOKEN_BUDGET = 80_000; // configurable via env
const TOKEN_BUDGET = (() => {
  const env = parseInt(process.env.STAKEHOLDER_TOKEN_BUDGET ?? "", 10);
  return isNaN(env) ? DEFAULT_TOKEN_BUDGET : env;
})();

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ── Engine ────────────────────────────────────────────────────────────────────

export interface StakeholderEngine {
  tick(context: StakeholderContext): Promise<SimEvent[]>;
}

export function createStakeholderEngine(
  llmClient: LLMClient,
  scenario: LoadedScenario,
  metricStore: MetricStore,
): StakeholderEngine {
  // persona last-spoke times: personaId → simTime of last message
  const _lastSpoke: Record<string, number> = {};

  return {
    async tick(context: StakeholderContext): Promise<SimEvent[]> {
      try {
        return await _tick(context);
      } catch (err) {
        log.error({ err }, "Unexpected error in tick");
        return [];
      }
    },
  };

  async function _tick(context: StakeholderContext): Promise<SimEvent[]> {
    // Step 1: eligible personas
    const eligible = _eligiblePersonas(context);
    log.debug(
      {
        simTime: context.simTime,
        eligible,
        directlyAddressed: [...context.directlyAddressed],
      },
      "Stakeholder tick",
    );
    if (eligible.length === 0) return [];

    // Step 2: build prompt
    const messages = _buildPrompt(context, eligible);
    const tools = getStakeholderTools(scenario);

    // Step 3: call LLM
    log.debug({ eligible, simTime: context.simTime }, "Calling LLM");
    let response;
    try {
      response = await llmClient.call({
        role: "stakeholder",
        messages,
        tools,
        sessionId: context.sessionId,
      });
      log.debug(
        {
          tools: response.toolCalls.map((t) => t.tool),
          simTime: context.simTime,
        },
        "LLM responded",
      );
    } catch (err) {
      if (err instanceof LLMError) {
        log.error({ code: err.code, err: err.message }, "LLM error");
        return [];
      }
      throw err;
    }

    // Step 4: validate and execute tool calls
    const events: SimEvent[] = [];
    const callCounts: Record<string, number> = {};
    const activeAlarmIds = new Set(
      context.conversations.alarms.map((a) => a.id),
    );

    for (const toolCall of response.toolCalls) {
      callCounts[toolCall.tool] = callCounts[toolCall.tool] ?? 0;

      const validation = validateToolCall(
        toolCall,
        scenario,
        callCounts,
        tools,
        activeAlarmIds,
      );
      if (!validation.valid) {
        log.warn({
          tool: toolCall.tool,
          reason: validation.reason,
        });
        continue;
      }

      callCounts[toolCall.tool]++;
      const produced = _executeTool(toolCall.tool, toolCall.params, context);
      events.push(...produced);

      // Step 5: update last-spoke times
      if (toolCall.tool === "send_message" || toolCall.tool === "send_email") {
        const personaId = toolCall.params["persona"] as string | undefined;
        if (personaId) _lastSpoke[personaId] = context.simTime;
      }
    }

    return events;
  }

  function _eligiblePersonas(context: StakeholderContext): string[] {
    return scenario.personas
      .filter((persona) => {
        // Direct address (@mention or DM) always makes a persona eligible,
        // even if silent_until_contacted or in cooldown.
        if (context.directlyAddressed.has(persona.id)) return true;

        // silent_until_contacted: only eligible after the trainee has explicitly
        // reached out (DM, page_user, or prior @mention that set personaCooldowns).
        if (persona.silentUntilContacted) {
          const engaged = context.personaCooldowns[persona.id] != null;
          if (!engaged) return false;
        }

        // Normal cooldown check
        const lastSpoke = _lastSpoke[persona.id] ?? -Infinity;
        return lastSpoke + persona.cooldownSeconds <= context.simTime;
      })
      .map((p) => p.id);
  }

  function _buildPrompt(
    context: StakeholderContext,
    eligiblePersonaIds: string[],
  ): LLMMessage[] {
    const eligiblePersonas = scenario.personas.filter((p) =>
      eligiblePersonaIds.includes(p.id),
    );

    const systemContent = [
      "# Stakeholder Engine Instructions",
      "",
      "You are driving one or more personas in an on-call incident simulation.",
      "Your job is to make personas react realistically to the ongoing incident.",
      "Only speak through available tools. Never break character.",
      "",
      "## Active Personas",
      ...eligiblePersonas.map(
        (p) => `### ${p.displayName} (id: ${p.id})\n${p.systemPrompt}`,
      ),
      "",
      "## Scenario Context",
      `Scenario: ${scenario.title}`,
      `Focal service: ${scenario.topology.focalService}`,
      "",
      renderMetricSummary(context.metricSummary, scenario),
      "",
      "## Instructions",
      "- Only send messages if the personas have something meaningful to say given the current situation.",
      "- Respect persona cooldowns — do not send multiple rapid messages from the same persona.",
      "- If nothing meaningful needs to be said, do not call any tools.",
      "",
      ..._buildMetricResponseContext(),
    ].join("\n");

    // Audit log — always preserved in full (short, critical for evaluation context)
    const auditLines = ["## Trainee Actions"];
    for (const entry of context.auditLog) {
      auditLines.push(
        `[t=${entry.simTime}] ${entry.action} ${JSON.stringify(entry.params)}`,
      );
    }

    // Persona cooldowns context
    const cooldownLines = ["## Persona Last Spoke"];
    for (const [personaId, lastSpoke] of Object.entries(_lastSpoke)) {
      cooldownLines.push(`${personaId}: t=${lastSpoke}`);
    }

    // Conversation history — subject to truncation
    const userContent = _buildUserContent(context, auditLines, cooldownLines);

    return [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ];
  }

  function _buildMetricResponseContext(): string[] {
    // Only inject if apply_metric_response is enabled for this scenario
    const isEnabled = scenario.engine.llmEventTools.some(
      (t) => t.tool === "apply_metric_response" && t.enabled !== false,
    );
    if (!isEnabled) return [];

    // Build service → metricId list from scenario topology
    const serviceLines: string[] = [];
    const focal = scenario.opsDashboard.focalService;
    serviceLines.push(
      `  ${focal.name}: ${focal.metrics.map((m) => m.archetype).join(", ")}`,
    );
    for (const cs of scenario.opsDashboard.correlatedServices) {
      const metricIds =
        cs.overrides?.map((m) => m.archetype) ??
        focal.metrics.map((m) => m.archetype);
      serviceLines.push(`  ${cs.name}: ${metricIds.join(", ")}`);
    }

    return [
      "## Metric Response Tool: apply_metric_response",
      "Use after any trainee action that changes the incident trajectory.",
      "",
      "Services and metrics in this scenario:",
      ...serviceLines,
      "",
      "Patterns: smooth_decay | stepped | queue_burndown | oscillating | blip_then_decay | cascade_clear | sawtooth_rebound | cliff",
      "Speed: 1m | 5m | 15m | 30m | 60m",
      "Direction: recovery (toward resolved state) | worsening (toward incident peak)",
      "Magnitude: full (complete) | partial (halfway to resolved state)",
      "",
      "Rules:",
      "- Only call apply_metric_response when a trainee action has actually changed the situation.",
      "- Use direction=worsening when the action made the situation worse.",
      "- Use magnitude=partial when the fix is incomplete or does not address root cause.",
      "- Specify different patterns and speeds per metric in one call for asymmetric recovery.",
      "- For oscillating: set oscillation_mode=sustained if root cause is not addressed.",
    ];
  }

  /**
   * Builds the user message content, applying context window truncation if the
   * combined conversation history exceeds TOKEN_BUDGET.
   */
  function _buildUserContent(
    context: StakeholderContext,
    auditLines: string[],
    cooldownLines: string[],
  ): string {
    const header = `Current sim time: t=${context.simTime}`;

    // Fixed sections (always included)
    const fixedSections = [
      "",
      auditLines.join("\n"),
      "",
      cooldownLines.join("\n"),
      "",
      "Based on the above context, decide what (if anything) the eligible personas should do now.",
    ].join("\n");

    // Build full conversation history lines (chronological)
    const allChats = Object.values(context.conversations.chatChannels).flat();
    allChats.sort((a, b) => a.simTime - b.simTime);

    const chatLines = allChats.map(
      (msg) =>
        `[t=${msg.simTime}] ${msg.channel} | ${msg.persona}: ${msg.text}`,
    );

    const emails = [...context.conversations.emails].sort(
      (a, b) => a.simTime - b.simTime,
    );
    const emailLines = emails.map(
      (e) =>
        `[t=${e.simTime}] EMAIL | from:${e.from} to:${e.to} | ${e.subject}: ${e.body.slice(0, 200)}`,
    );

    const allHistoryLines = [...chatLines, ...emailLines];
    // Sort combined history by sim time prefix (lines start with "[t=N]")
    allHistoryLines.sort((a, b) => {
      const tA = parseInt(a.match(/^\[t=(-?\d+)\]/)?.[1] ?? "0", 10);
      const tB = parseInt(b.match(/^\[t=(-?\d+)\]/)?.[1] ?? "0", 10);
      return tA - tB;
    });

    // Check whether the full content fits within budget
    const fullConversation = [
      "## Conversation History",
      ...allHistoryLines,
    ].join("\n");
    const fullContent = [header, "", fullConversation, fixedSections].join(
      "\n",
    );

    if (estimateTokens(fullContent) <= TOKEN_BUDGET) {
      return fullContent;
    }

    // Truncation needed — keep as many recent messages as fit, summarise the rest
    log.warn(
      {
        simTime: context.simTime,
        estimatedTokens: estimateTokens(fullContent),
        budget: TOKEN_BUDGET,
      },
      "Context window truncation triggered",
    );

    // Binary-search for the maximum suffix of history lines that fits
    const fixedTokens = estimateTokens([header, fixedSections].join("\n"));
    const budgetForHistory = TOKEN_BUDGET - fixedTokens - 200; // 200 token margin for section headers

    let kept = allHistoryLines.length;
    while (kept > 0) {
      const candidate = allHistoryLines.slice(allHistoryLines.length - kept);
      if (estimateTokens(candidate.join("\n")) <= budgetForHistory) break;
      kept--;
    }

    const droppedCount = allHistoryLines.length - kept;
    const conversationSection: string[] = ["## Conversation History"];

    if (droppedCount > 0) {
      conversationSection.push(
        `[${droppedCount} older message(s) omitted — context window limit reached at t=${context.simTime}]`,
      );
    }
    conversationSection.push(
      ...allHistoryLines.slice(allHistoryLines.length - kept),
    );

    return [header, "", conversationSection.join("\n"), fixedSections].join(
      "\n",
    );
  }

  function _executeTool(
    tool: string,
    params: Record<string, unknown>,
    context: StakeholderContext,
  ): SimEvent[] {
    switch (tool) {
      case "send_message": {
        const msg: ChatMessage = {
          id: randomUUID(),
          channel: params["channel"] as string,
          persona: params["persona"] as string,
          text: params["message"] as string,
          simTime: context.simTime,
        };
        log.info(
          {
            persona: msg.persona,
            channel: msg.channel,
            simTime: context.simTime,
          },
          "Persona sent chat message",
        );
        return [{ type: "chat_message", channel: msg.channel, message: msg }];
      }

      case "send_email": {
        const email: EmailMessage = {
          id: randomUUID(),
          threadId: params["thread_id"] as string,
          from: params["persona"] as string,
          to: "trainee",
          subject: params["subject"] as string,
          body: params["body"] as string,
          simTime: context.simTime,
        };
        log.info(
          {
            persona: email.from,
            subject: email.subject,
            simTime: context.simTime,
          },
          "Persona sent email",
        );
        return [{ type: "email_received", email }];
      }

      case "add_ticket_comment": {
        const comment: TicketComment = {
          id: randomUUID(),
          ticketId: params["ticket_id"] as string,
          author: params["persona"] as string,
          body: params["comment"] as string,
          simTime: context.simTime,
        };
        return [
          { type: "ticket_comment", ticketId: comment.ticketId, comment },
        ];
      }

      case "fire_alarm": {
        const alarm: Alarm = {
          id: params["alarm_id"] as string,
          service: params["service"] as string,
          metricId: "unknown",
          condition: (params["condition"] as string) ?? "",
          value: 0,
          severity: (params["severity"] as Alarm["severity"]) ?? "SEV2",
          status: "firing",
          simTime: context.simTime,
        };
        return [{ type: "alarm_fired", alarm }];
      }

      case "silence_alarm": {
        const alarmId = params["alarm_id"] as string;
        return [{ type: "alarm_silenced", alarmId }];
      }

      case "inject_log_entry": {
        const entry: LogEntry = {
          id: randomUUID(),
          simTime: context.simTime,
          level: (params["level"] as LogEntry["level"]) ?? "INFO",
          service: params["service"] as string,
          message: params["message"] as string,
        };
        return [{ type: "log_entry", entry }];
      }

      case "trigger_cascade": {
        const logEntry: LogEntry = {
          id: randomUUID(),
          simTime: context.simTime,
          level: "ERROR",
          service: params["service"] as string,
          message: `Cascade failure from upstream: ${params["reason"] as string}`,
        };
        const cascadeAlarm: Alarm = {
          id: `cascade-${randomUUID()}`,
          service: params["service"] as string,
          metricId: "error_rate",
          condition: "cascade_failure",
          value: 0,
          severity: "SEV2",
          status: "firing",
          simTime: context.simTime,
        };
        return [
          { type: "log_entry", entry: logEntry },
          { type: "alarm_fired", alarm: cascadeAlarm },
        ];
      }

      case "apply_metric_response": {
        const entries = params["affected_metrics"];
        if (!Array.isArray(entries)) return [];

        for (const rawEntry of entries as Record<string, unknown>[]) {
          const service = rawEntry["service"] as string | undefined;
          const metricId = rawEntry["metric_id"] as string | undefined;
          if (!service || !metricId) continue;

          // Validate service exists in scenario topology
          const focalService = scenario.opsDashboard.focalService;
          const isKnownService =
            service === focalService.name ||
            scenario.opsDashboard.correlatedServices.some(
              (cs) => cs.name === service,
            );
          if (!isKnownService) {
            log.warn(
              { service },
              "apply_metric_response: unknown service, skipping entry",
            );
            continue;
          }

          // Validate metricId exists on service
          const knownMetrics: string[] =
            service === focalService.name
              ? focalService.metrics.map((m) => m.archetype)
              : (() => {
                  const cs = scenario.opsDashboard.correlatedServices.find(
                    (c) => c.name === service,
                  );
                  return (
                    cs?.overrides?.map((m) => m.archetype) ??
                    focalService.metrics.map((m) => m.archetype)
                  );
                })();
          if (!knownMetrics.includes(metricId)) {
            log.warn(
              { service, metricId },
              "apply_metric_response: unknown metric_id, skipping entry",
            );
            continue;
          }

          const direction =
            (rawEntry["direction"] as "recovery" | "worsening") ?? "recovery";
          const pattern =
            (rawEntry["pattern"] as ReactiveOverlayType) ?? "smooth_decay";
          const speed = (rawEntry["speed"] as ReactiveSpeedTier) ?? "5m";
          const magnitude =
            (rawEntry["magnitude"] as "full" | "partial") ?? "full";

          const speedSeconds = REACTIVE_SPEED_SECONDS[speed];

          // cascade_clear: expand to per-metric smooth_decay with staggered start times
          if (pattern === "cascade_clear") {
            const INFRA_ARCHETYPES = new Set([
              "cpu_utilization",
              "memory_used",
              "memory_rss",
              "connection_pool_used",
              "thread_count",
              "heap_used",
            ]);
            const QUALITY_ARCHETYPES = new Set([
              "error_rate",
              "fault_rate",
              "availability",
              "p99_latency_ms",
              "p50_latency_ms",
            ]);

            const group = INFRA_ARCHETYPES.has(metricId)
              ? 0
              : QUALITY_ARCHETYPES.has(metricId)
                ? 1
                : 2;
            const staggeredSimTime =
              context.simTime + (group * speedSeconds) / 3;

            const rp = metricStore.getResolvedParams(service, metricId);
            const currentValue = metricStore.getCurrentValue(
              service,
              metricId,
              context.simTime,
            );
            if (!rp || currentValue === null) continue;

            const targetValue = resolveReactiveTarget(
              direction,
              magnitude,
              currentValue,
              rp.resolvedValue,
              rp.peakValue,
            );
            const expandedParams: ResolvedReactiveParams = {
              service,
              metricId,
              direction,
              magnitude,
              pattern: "smooth_decay",
              speedSeconds,
              currentValue,
              targetValue,
            };
            metricStore.applyReactiveOverlay(expandedParams, staggeredSimTime);
            log.info(
              {
                service,
                metricId,
                pattern: "smooth_decay (cascade_clear)",
                direction,
                speed,
                simTime: staggeredSimTime,
              },
              "apply_metric_response executed",
            );
            continue;
          }

          const rp = metricStore.getResolvedParams(service, metricId);
          const currentValue = metricStore.getCurrentValue(
            service,
            metricId,
            context.simTime,
          );
          if (!rp || currentValue === null) {
            log.warn(
              { service, metricId },
              "apply_metric_response: no resolved params or current value, skipping",
            );
            continue;
          }

          const targetValue = resolveReactiveTarget(
            direction,
            magnitude,
            currentValue,
            rp.resolvedValue,
            rp.peakValue,
          );

          let oscillationMode: "damping" | "sustained" | undefined;
          let cycleSeconds: number | undefined;
          if (pattern === "oscillating") {
            oscillationMode =
              (rawEntry["oscillation_mode"] as
                | "damping"
                | "sustained"
                | undefined) ?? "damping";
            const rawCycle = rawEntry["cycle_seconds"] as number | undefined;
            cycleSeconds =
              rawCycle != null ? Math.min(300, Math.max(30, rawCycle)) : 60;
          }

          const resolvedParams: ResolvedReactiveParams = {
            service,
            metricId,
            direction,
            pattern,
            speedSeconds,
            magnitude,
            currentValue,
            targetValue,
            ...(oscillationMode !== undefined ? { oscillationMode } : {}),
            ...(cycleSeconds !== undefined ? { cycleSeconds } : {}),
          };

          metricStore.applyReactiveOverlay(resolvedParams, context.simTime);
          log.info(
            {
              service,
              metricId,
              pattern,
              direction,
              speed,
              magnitude,
              simTime: context.simTime,
            },
            "apply_metric_response executed",
          );
        }

        return []; // metric_update events are streamed by the game loop via getPointsInWindow
      }

      default:
        log.warn({ tool }, "Unknown tool call");
        return [];
    }
  }
}
