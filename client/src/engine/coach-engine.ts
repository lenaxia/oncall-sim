// coach-engine.ts — LLM-powered coaching via tool calls.
//
// The coach runs on its own tick cycle (wired via onCoachTick in game-loop.ts).
// It has read-only access to sim state and writes only to the coach panel.
//
// Three helpfulness levels control proactive behaviour:
//   novice       — proactive nudges on inactivity, passive-browse stall, SEV1, red herring
//   intermediate — nudges on longer inactivity, passive-browse stall (higher threshold), red herring
//   expert       — silent unless the trainee explicitly asks, EXCEPT resolve-with-alarms-firing

const randomUUID = () => globalThis.crypto.randomUUID();

import type { CoachMessage } from "@shared/types/events";
import type {
  LLMClient,
  LLMMessage,
  LLMToolDefinition,
  LLMResponse,
} from "../llm/llm-client";
import { LLMError } from "../llm/llm-client";
import type { LoadedScenario } from "../scenario/types";
import type { SimStateStoreSnapshot } from "./sim-state-store";
import type { AuditEntry } from "@shared/types/events";
import { PASSIVE_ACTIONS } from "./metric-reaction-engine";
import { logger } from "../logger";

const log = logger.child({ component: "coach-engine" });

// ── Public types ──────────────────────────────────────────────────────────────

export type CoachLevel = "novice" | "intermediate" | "expert";

/**
 * Why the game loop is requesting a proactive coach tick right now.
 * The engine uses this to decide whether to fire and to tailor the prompt.
 *
 * Reasons are pre-computed in the game loop from objective signals so the
 * LLM receives precise context rather than having to infer it from raw state.
 */
export type CoachTriggerReason =
  /** Trainee has been inactive (wall-clock) since their last meaningful action */
  | { type: "inactivity"; wallSecondsSinceLastAction: number }
  /** Trainee has been switching tabs without taking any meaningful action */
  | {
      type: "passive_browse_stall";
      tabsSwitched: number;
      wallSecondsStalled: number;
    }
  /** A SEV1 alarm just fired and the trainee hasn't acknowledged it yet */
  | {
      type: "sev1_unacknowledged";
      alarmId: string;
      service: string;
      condition: string;
    }
  /** Trainee just took an action the scenario marks as a red herring */
  | { type: "red_herring"; action: string; why: string }
  /** Trainee called mark_resolved while alarms are still firing */
  | { type: "resolve_with_alarms_firing"; firingAlarmCount: number };

export interface CoachContext {
  sessionId: string;
  scenario: LoadedScenario;
  simTime: number;
  auditLog: AuditEntry[];
  simState: SimStateStoreSnapshot;
  /** Why the game loop is requesting this proactive tick. */
  triggerReason: CoachTriggerReason;
}

export interface CoachEngine {
  /**
   * Called by the game loop when a trigger condition is met.
   * Returns a CoachMessage if the coach decides to say something, null if not.
   */
  proactiveTick(context: CoachContext): Promise<CoachMessage | null>;

  /**
   * Called when the trainee sends a message via the coach panel.
   * Always returns a response (never null). Throws on unrecoverable LLM failure.
   */
  respondToTrainee(
    message: string,
    context: Omit<CoachContext, "triggerReason">,
  ): Promise<CoachMessage>;
}

// ── Tool definition ───────────────────────────────────────────────────────────

const SEND_COACH_MESSAGE_TOOL: LLMToolDefinition = {
  name: "send_coach_message",
  description:
    "Send a coaching message to the trainee. " +
    "Call this tool to deliver your coaching feedback, hint, or answer. " +
    "If you have nothing useful to say right now, do not call this tool.",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description:
          "The coaching message to send to the trainee (1–4 sentences).",
      },
    },
    required: ["message"],
  },
};

const COACH_TOOLS: LLMToolDefinition[] = [SEND_COACH_MESSAGE_TOOL];

// ── Minimum wall-time interval between proactive messages (ms) ────────────────
// Prevents back-to-back messages even if multiple triggers fire in quick succession.

const MIN_PROACTIVE_INTERVAL_MS = 60_000; // 1 real minute

// ── Retry config ──────────────────────────────────────────────────────────────

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callWithRetry(
  getLLMClient: () => LLMClient,
  request: Parameters<LLMClient["call"]>[0],
): Promise<LLMResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await getLLMClient().call(request);
    } catch (err) {
      lastErr = err;
      if (err instanceof LLMError && attempt < MAX_RETRIES) {
        log.warn({ code: err.code, attempt }, "Coach LLM error — retrying");
        await sleep(RETRY_BASE_MS * 2 ** attempt);
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

function extractMessageText(response: LLMResponse): string {
  const toolCall = response.toolCalls.find(
    (tc) => tc.tool === "send_coach_message",
  );
  if (toolCall) {
    return ((toolCall.params["message"] as string | undefined) ?? "").trim();
  }
  return (response.text ?? "").trim();
}

// ── Level gating ──────────────────────────────────────────────────────────────
//
// Determines whether a given trigger reason should fire for a given level.
// The LLM is only called when this returns true.

function shouldFireForLevel(
  reason: CoachTriggerReason,
  level: CoachLevel,
): boolean {
  switch (reason.type) {
    case "resolve_with_alarms_firing":
      // Always fire — even experts can benefit from this safety net
      return true;

    case "red_herring":
      // Novice and intermediate only — experts work it out themselves
      return level === "novice" || level === "intermediate";

    case "sev1_unacknowledged":
      // Novice and intermediate — experts know to check their alerts
      return level === "novice" || level === "intermediate";

    case "inactivity":
      if (level === "expert") return false;
      if (level === "novice") return reason.wallSecondsSinceLastAction >= 120; // 2 min
      if (level === "intermediate")
        return reason.wallSecondsSinceLastAction >= 240; // 4 min
      return false;

    case "passive_browse_stall":
      if (level === "expert") return false;
      if (level === "novice")
        // 3+ tabs in 2+ minutes
        return reason.tabsSwitched >= 3 && reason.wallSecondsStalled >= 120;
      if (level === "intermediate")
        // 5+ tabs in 5+ minutes
        return reason.tabsSwitched >= 5 && reason.wallSecondsStalled >= 300;
      return false;
  }
}

// ── System prompt builders ────────────────────────────────────────────────────

function buildSystemPrompt(
  level: CoachLevel,
  scenario: LoadedScenario,
): string {
  const sharedPreamble = [
    "You are an experienced SRE coach observing a trainee working through a live incident simulation.",
    "You must NEVER reveal the root cause directly.",
    "Guide the trainee by asking questions and pointing at observable data.",
    "Keep messages short — 1 to 4 sentences, Slack-message length.",
    "Use the send_coach_message tool to deliver your message.",
    "",
    `Scenario: ${scenario.title}`,
    `Root cause category (do NOT reveal): ${scenario.evaluation.rootCause}`,
  ].join("\n");

  switch (level) {
    case "novice":
      return [
        sharedPreamble,
        "",
        "## Coaching style — novice",
        "The trainee is new to on-call work. Be warm, encouraging, and proactive.",
        "Offer broad orientation hints: which tab or tool to look at, what pattern to notice.",
        "You may suggest specific next steps (e.g. 'Have you checked the CI/CD tab?').",
      ].join("\n");

    case "intermediate":
      return [
        sharedPreamble,
        "",
        "## Coaching style — intermediate",
        "The trainee has some on-call experience. Be concise and less hand-holding.",
        "Ask leading questions rather than giving direct suggestions.",
        "Examples: 'What do the timestamps tell you?' rather than 'Look at the CI/CD tab'.",
      ].join("\n");

    case "expert":
      return [
        sharedPreamble,
        "",
        "## Coaching style — expert",
        "The trainee is an experienced SRE. Only respond when directly asked, or when they make an objective mistake (e.g. marking resolved with alarms still firing).",
        "When asked, give precise, direct answers without excessive explanation.",
        "Treat the trainee as a peer.",
      ].join("\n");
  }
}

// ── Context block ─────────────────────────────────────────────────────────────

function buildContextBlock(
  context: CoachContext | Omit<CoachContext, "triggerReason">,
): string {
  const lines: string[] = [];

  lines.push(`Current sim time: t=${context.simTime}`);

  const meaningfulActions = context.auditLog.filter(
    (e) => !PASSIVE_ACTIONS.has(e.action),
  );

  if (meaningfulActions.length > 0) {
    lines.push("", "## Trainee Actions (recent, excluding passive navigation)");
    for (const entry of meaningfulActions.slice(-20)) {
      lines.push(
        `  t=${entry.simTime}  ${entry.action}  ${JSON.stringify(entry.params)}`,
      );
    }
  } else {
    lines.push("", "## Trainee Actions", "  (none yet)");
  }

  const alarms = context.simState.alarms.filter((a) => a.status === "firing");
  if (alarms.length > 0) {
    lines.push("", "## Active Alarms");
    for (const alarm of alarms) {
      lines.push(`  ${alarm.severity} | ${alarm.service} | ${alarm.condition}`);
    }
  }

  return lines.join("\n");
}

// ── Trigger reason → human-readable context for the prompt ───────────────────

function buildTriggerBlock(reason: CoachTriggerReason): string {
  switch (reason.type) {
    case "inactivity":
      return [
        "## Why you are being asked to coach right now",
        `The trainee has not taken any meaningful action for ${Math.round(reason.wallSecondsSinceLastAction / 60)} real minutes.`,
        "They may be stuck, unsure where to look, or waiting passively.",
      ].join("\n");

    case "passive_browse_stall":
      return [
        "## Why you are being asked to coach right now",
        `The trainee has switched tabs ${reason.tabsSwitched} times over ${Math.round(reason.wallSecondsStalled / 60)} real minutes without taking any meaningful action.`,
        "They appear to be browsing without a clear plan.",
      ].join("\n");

    case "sev1_unacknowledged":
      return [
        "## Why you are being asked to coach right now",
        `A SEV1 alarm just fired on ${reason.service}: "${reason.condition}"`,
        "The trainee has not acknowledged it. This may indicate they missed it or don't know what to do.",
      ].join("\n");

    case "red_herring":
      return [
        "## Why you are being asked to coach right now",
        `The trainee just performed action "${reason.action}", which is a known red herring for this scenario.`,
        `Context: ${reason.why}`,
        "Gently redirect them without revealing the root cause.",
      ].join("\n");

    case "resolve_with_alarms_firing":
      return [
        "## Why you are being asked to coach right now",
        `The trainee just marked the incident as resolved, but ${reason.firingAlarmCount} alarm(s) are still firing.`,
        "This is an objective mistake — they should verify the alarms have cleared before resolving.",
      ].join("\n");
  }
}

// ── Engine factory ────────────────────────────────────────────────────────────

export function createCoachEngine(
  getLLMClient: () => LLMClient,
  scenario: LoadedScenario,
  level: CoachLevel,
): CoachEngine {
  let _lastProactiveWallMs: number | null = null;

  return { proactiveTick, respondToTrainee };

  async function proactiveTick(
    context: CoachContext,
  ): Promise<CoachMessage | null> {
    const { triggerReason } = context;

    // Gate 1: level eligibility
    if (!shouldFireForLevel(triggerReason, level)) return null;

    // Gate 2: minimum wall-time cooldown between proactive messages
    const nowMs = Date.now();
    if (
      _lastProactiveWallMs !== null &&
      nowMs - _lastProactiveWallMs < MIN_PROACTIVE_INTERVAL_MS
    ) {
      log.debug(
        {
          reason: triggerReason.type,
          cooldownRemainingMs:
            MIN_PROACTIVE_INTERVAL_MS - (nowMs - _lastProactiveWallMs),
        },
        "Coach proactive tick suppressed by cooldown",
      );
      return null;
    }

    const messages = buildProactivePrompt(context);

    let response: LLMResponse;
    try {
      response = await callWithRetry(getLLMClient, {
        role: "coach",
        messages,
        tools: COACH_TOOLS,
        sessionId: context.sessionId,
      });
    } catch (err) {
      log.warn(
        { err },
        "Coach proactiveTick: all retries failed — skipping tick",
      );
      return null;
    }

    const text = extractMessageText(response);
    if (!text) return null;

    _lastProactiveWallMs = Date.now();

    const msg: CoachMessage = {
      id: randomUUID(),
      text,
      simTime: context.simTime,
      proactive: true,
    };
    log.info(
      { simTime: context.simTime, level, reason: triggerReason.type },
      "Coach sent proactive message",
    );
    return msg;
  }

  async function respondToTrainee(
    message: string,
    context: Omit<CoachContext, "triggerReason">,
  ): Promise<CoachMessage> {
    const messages = buildOnDemandPrompt(message, context);

    const response = await callWithRetry(getLLMClient, {
      role: "coach",
      messages,
      tools: COACH_TOOLS,
      sessionId: context.sessionId,
    });

    const text = extractMessageText(response);

    if (!text) {
      throw new LLMError(
        "Coach returned empty response after retries",
        "invalid_response",
      );
    }

    return {
      id: randomUUID(),
      text,
      simTime: context.simTime,
      proactive: false,
    };
  }

  function buildProactivePrompt(context: CoachContext): LLMMessage[] {
    const system = buildSystemPrompt(level, scenario);
    const contextBlock = buildContextBlock(context);
    const triggerBlock = buildTriggerBlock(context.triggerReason);

    const user = [
      contextBlock,
      "",
      triggerBlock,
      "",
      "## Your task",
      "Send a coaching message using send_coach_message.",
      "Focus on the specific situation described above.",
      "Do not repeat information the trainee already knows.",
    ].join("\n");

    return [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
  }

  function buildOnDemandPrompt(
    traineeMessage: string,
    context: Omit<CoachContext, "triggerReason">,
  ): LLMMessage[] {
    const system = buildSystemPrompt(level, scenario);
    const contextBlock = buildContextBlock(context);

    const user = [
      contextBlock,
      "",
      "## Trainee asks",
      traineeMessage,
      "",
      "## Your task",
      "Respond to the trainee's question using the send_coach_message tool.",
      "You must always call send_coach_message when the trainee asks you something directly.",
    ].join("\n");

    return [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
  }
}
