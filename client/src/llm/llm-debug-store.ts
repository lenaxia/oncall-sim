// llm-debug-store.ts — singleton ring buffer for LLM call tracing.
//
// Records every inbound request and outbound response so the DebugPanel can
// display them in real time. Only active when VITE_DEBUG=true; in all other
// builds the store is a no-op and the interceptor adds zero overhead.
//
// Architecture:
//   - Pure module-level singleton (no React state) — survives component
//     remounts and can be written to from engine code outside React.
//   - Listeners are registered by the DebugPanel via useLLMDebugStore().
//   - Max 200 entries kept to avoid unbounded memory growth.

import type { LLMRequest, LLMResponse } from "./llm-client";

export type LLMCallRole = "stakeholder" | "metrics" | "coach" | "debrief";

// How the metric-reaction engine identifies itself — it passes role:"stakeholder"
// but uses only the select_metric_reaction tool, so we reclassify it here.
function classifyRole(request: LLMRequest): LLMCallRole {
  const hasMetricTool = request.tools.some(
    (t) => t.name === "select_metric_reaction",
  );
  if (hasMetricTool) return "metrics";
  if (request.role === "coach") return "coach";
  if (request.role === "debrief") return "debrief";
  return "stakeholder";
}

export interface LLMDebugEntry {
  id: string;
  /** Wall-clock timestamp of the request */
  timestamp: number;
  role: LLMCallRole;
  sessionId: string;
  /** Full request sent to the LLM */
  request: LLMRequest;
  /** Response received — null while in-flight, 'error' on failure */
  response: LLMResponse | "error" | null;
  /** Wall-clock ms elapsed from request to response */
  durationMs: number | null;
  /** Short human label derived from the primary action in the request */
  label: string;
}

const MAX_ENTRIES = 200;
const _entries: LLMDebugEntry[] = [];
const _listeners = new Set<() => void>();
let _seq = 0;

function _notify() {
  for (const fn of _listeners) fn();
}

function _makeLabel(request: LLMRequest): string {
  // Try to extract the most recent trainee action from the user message content
  const userMsg = [...request.messages]
    .reverse()
    .find((m) => m.role === "user");
  if (userMsg) {
    // Look for "## Trainee Action(s)" pattern — action word follows on same or next line,
    // possibly indented and prefixed with a t=<n> timestamp.
    const actionMatch = userMsg.content.match(
      /##\s*Trainee Actions?\b[^\n]*\n\s*(?:t=\d+\s+)?(\w+)/,
    );
    if (actionMatch) return actionMatch[1];
    // Look for the first tool name in the system prompt as a fallback label
  }
  // Fall back to tool names
  if (request.tools.length > 0) return request.tools[0].name;
  return request.role;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function recordRequest(request: LLMRequest): string {
  const id = `llm-${++_seq}-${Date.now()}`;
  const entry: LLMDebugEntry = {
    id,
    timestamp: Date.now(),
    role: classifyRole(request),
    sessionId: request.sessionId,
    request,
    response: null,
    durationMs: null,
    label: _makeLabel(request),
  };
  _entries.push(entry);
  if (_entries.length > MAX_ENTRIES) _entries.shift();
  _notify();
  return id;
}

export function recordResponse(
  id: string,
  response: LLMResponse | "error",
  startMs: number,
) {
  const entry = _entries.find((e) => e.id === id);
  if (!entry) return;
  entry.response = response;
  entry.durationMs = Date.now() - startMs;
  _notify();
}

export function getEntries(): readonly LLMDebugEntry[] {
  return _entries;
}

export function clearEntries() {
  _entries.length = 0;
  _notify();
}

/** Reset all state — for use in tests only. */
export function _resetForTesting() {
  _entries.length = 0;
  _listeners.clear();
  _seq = 0;
}

// ── Clipboard formatter ───────────────────────────────────────────────────────

/**
 * Formats a single request/response pair as clean human-readable text
 * suitable for pasting into an LLM CLI or chat window for debugging.
 *
 * Format:
 *   === LLM Call: <role> | <label> | <timestamp> ===
 *
 *   --- REQUEST ---
 *   [SYSTEM]
 *   <content>
 *
 *   [USER]
 *   <content>
 *
 *   Tools available: tool_a, tool_b
 *
 *   --- RESPONSE ---
 *   TOOL CALL: select_metric_reaction
 *   <json params>
 *
 *   (or TEXT: <text> for non-tool responses)
 */
export function formatEntryForClipboard(entry: LLMDebugEntry): string {
  const lines: string[] = [];
  const ts = new Date(entry.timestamp).toISOString();

  lines.push(
    `=== LLM Call: ${ROLE_LABELS[entry.role]} | ${entry.label} | ${ts} ===`,
    "",
  );

  // ── Request ──
  lines.push("--- REQUEST ---", "");
  for (const msg of entry.request.messages) {
    lines.push(`[${msg.role.toUpperCase()}]`);
    lines.push(msg.content);
    lines.push("");
  }

  if (entry.request.tools.length > 0) {
    lines.push(
      `Tools available: ${entry.request.tools.map((t) => t.name).join(", ")}`,
      "",
    );
  }

  // ── Response ──
  lines.push("--- RESPONSE ---", "");
  if (entry.response === null) {
    lines.push("(in flight — no response yet)");
  } else if (entry.response === "error") {
    lines.push("ERROR: LLM call failed");
  } else {
    const { toolCalls, text } = entry.response;
    if (text) {
      lines.push("TEXT:");
      lines.push(text);
      lines.push("");
    }
    for (const tc of toolCalls) {
      lines.push(`TOOL CALL: ${tc.tool}`);
      lines.push(JSON.stringify(tc.params, null, 2));
      lines.push("");
    }
    if (!text && toolCalls.length === 0) {
      lines.push("(empty response)");
    }
  }

  if (entry.durationMs != null) {
    lines.push("", `Duration: ${entry.durationMs}ms`);
  }

  return lines.join("\n");
}

const ROLE_LABELS: Record<LLMCallRole, string> = {
  stakeholder: "Stakeholder",
  metrics: "Metrics",
  coach: "Coach",
  debrief: "Debrief",
};

export function subscribe(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
