// coach-engine.ts — LLM-powered coaching via tool calls.
//
// The coach runs on its own tick cycle (wired via onCoachTick in game-loop.ts).
// It has read-only access to sim state and writes only to the coach panel.
//
// Three helpfulness levels control proactive behaviour:
//   novice       — proactive nudges enabled; broad, guiding hints
//   intermediate — proactive nudges enabled; narrower hints, less hand-holding
//   expert       — silent unless the trainee explicitly asks; direct answers only

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

export interface CoachContext {
  sessionId: string;
  scenario: LoadedScenario;
  simTime: number;
  auditLog: AuditEntry[];
  simState: SimStateStoreSnapshot;
}

export interface CoachEngine {
  // Called by the game loop on each coach tick. Returns a CoachMessage if
  // the coach decides to say something proactively, or null if not.
  proactiveTick(context: CoachContext): Promise<CoachMessage | null>;

  // Called when the trainee sends a message via the coach panel.
  // Always returns a response (never null).
  respondToTrainee(
    message: string,
    context: CoachContext,
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

// ── Minimum proactive interval (sim-seconds) ──────────────────────────────────

const MIN_PROACTIVE_INTERVAL_SECONDS = 180;

// ── Retry config ──────────────────────────────────────────────────────────────

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call the LLM with exponential-backoff retry on LLMError.
 * Throws on the final failure so callers can decide what to do.
 */
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

/**
 * Extract the coaching message text from a response.
 * Prefers the send_coach_message tool call; falls back to response.text
 * for models that write prose instead of using the tool.
 */
function extractMessageText(response: LLMResponse): string {
  const toolCall = response.toolCalls.find(
    (tc) => tc.tool === "send_coach_message",
  );
  if (toolCall) {
    return ((toolCall.params["message"] as string | undefined) ?? "").trim();
  }
  // Model wrote prose instead of calling the tool — accept it
  return (response.text ?? "").trim();
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
        "If the trainee seems stuck or hasn't taken meaningful action recently, reach out proactively.",
        "You may suggest specific next steps (e.g. 'Have you checked the CI/CD tab?').",
      ].join("\n");

    case "intermediate":
      return [
        sharedPreamble,
        "",
        "## Coaching style — intermediate",
        "The trainee has some on-call experience. Be concise and less hand-holding.",
        "Ask leading questions rather than giving direct suggestions.",
        "Only nudge proactively when the trainee appears genuinely stuck — not just slow.",
        "Examples: 'What do the timestamps tell you?' rather than 'Look at the CI/CD tab'.",
      ].join("\n");

    case "expert":
      return [
        sharedPreamble,
        "",
        "## Coaching style — expert",
        "The trainee is an experienced SRE. Only respond when directly asked.",
        "Never send proactive messages — the trainee does not need or want them.",
        "When asked, give precise, direct answers without excessive explanation.",
        "Treat the trainee as a peer who is capable of working through the problem independently.",
      ].join("\n");
  }
}

// ── Context block included in every call ──────────────────────────────────────

function buildContextBlock(context: CoachContext): string {
  const lines: string[] = [];

  lines.push(`Current sim time: t=${context.simTime}`);

  // Only show meaningful (non-passive) actions — passive ones like open_tab
  // are noise that add no signal about what the trainee is actually doing.
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

// ── Engine factory ────────────────────────────────────────────────────────────

export function createCoachEngine(
  getLLMClient: () => LLMClient,
  scenario: LoadedScenario,
  level: CoachLevel,
): CoachEngine {
  let _lastProactiveSimTime: number | null = null;

  return { proactiveTick, respondToTrainee };

  async function proactiveTick(
    context: CoachContext,
  ): Promise<CoachMessage | null> {
    // Expert coaches never proactively reach out
    if (level === "expert") return null;

    // Enforce minimum interval between proactive messages
    if (
      _lastProactiveSimTime !== null &&
      context.simTime - _lastProactiveSimTime < MIN_PROACTIVE_INTERVAL_SECONDS
    ) {
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

    _lastProactiveSimTime = context.simTime;

    const msg: CoachMessage = {
      id: randomUUID(),
      text,
      simTime: context.simTime,
      proactive: true,
    };
    log.info(
      { simTime: context.simTime, level },
      "Coach sent proactive message",
    );
    return msg;
  }

  async function respondToTrainee(
    message: string,
    context: CoachContext,
  ): Promise<CoachMessage> {
    const messages = buildOnDemandPrompt(message, context);

    // Retry until we get a response — never return a fallback string.
    const response = await callWithRetry(getLLMClient, {
      role: "coach",
      messages,
      tools: COACH_TOOLS,
      sessionId: context.sessionId,
    });

    const text = extractMessageText(response);

    // If the model returned nothing at all after retries, throw so the caller
    // knows something went wrong (the UI should surface it without a fake message).
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

    const user = [
      contextBlock,
      "",
      "## Your task",
      "Decide whether to send a proactive coaching message right now.",
      "If the trainee is on track or has been making progress, stay silent — do not call any tool.",
      "If they appear stuck, overlooking something important, or could benefit from a nudge, call send_coach_message.",
    ].join("\n");

    return [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
  }

  function buildOnDemandPrompt(
    traineeMessage: string,
    context: CoachContext,
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
