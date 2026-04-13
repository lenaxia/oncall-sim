// DebugPanelShell.tsx — LLM call inspector, shown when DEBUG=true at runtime.
//
// Opens as a full-screen overlay with:
//   - Filter tabs: All | Stakeholder | Metrics | Coach | Debrief
//   - Entry list (left column): timestamp, role badge, label, duration
//   - Detail pane (right column): full request (system + user messages) and
//     response (tool calls or text), formatted for human readability

import { useState, useEffect, useCallback, useRef } from "react";
import {
  getEntries,
  clearEntries,
  subscribe,
  formatEntryForClipboard,
  type LLMDebugEntry,
  type LLMCallRole,
} from "../llm/llm-debug-store";

// ── Copy hook ─────────────────────────────────────────────────────────────────

function useCopyToClipboard(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return [copied, copy];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<LLMCallRole, string> = {
  stakeholder: "Stakeholder",
  metrics: "Metrics",
  coach: "Coach",
  debrief: "Debrief",
};

const ROLE_COLORS: Record<LLMCallRole, string> = {
  stakeholder: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  metrics: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  coach: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  debrief: "bg-purple-500/20 text-purple-300 border-purple-500/30",
};

const FILTER_TABS: Array<{ key: LLMCallRole | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "stakeholder", label: "Stakeholder" },
  { key: "metrics", label: "Metrics" },
  { key: "coach", label: "Coach" },
  { key: "debrief", label: "Debrief" },
];

// ── Hook ──────────────────────────────────────────────────────────────────────

function useLLMDebugStore() {
  const [, forceRender] = useState(0);
  useEffect(() => {
    return subscribe(() => forceRender((n) => n + 1));
  }, []);
  return { entries: getEntries(), clear: clearEntries };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: LLMCallRole }) {
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-mono leading-none ${ROLE_COLORS[role]}`}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

function StatusDot({ entry }: { entry: LLMDebugEntry }) {
  if (entry.response === null)
    return (
      <span
        className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block"
        title="In flight"
      />
    );
  if (entry.response === "error")
    return (
      <span
        className="w-2 h-2 rounded-full bg-red-500 inline-block"
        title="Error"
      />
    );
  return (
    <span
      className="w-2 h-2 rounded-full bg-emerald-500 inline-block"
      title="OK"
    />
  );
}

// Renders a single LLMMessage (system / user / assistant) with good typography
function MessageBlock({ msg }: { msg: { role: string; content: string } }) {
  const [collapsed, setCollapsed] = useState(msg.role === "system");
  const lines = msg.content.split("\n");
  const preview = lines.slice(0, 3).join("\n");
  const isLong = lines.length > 3;

  const roleStyle =
    msg.role === "system"
      ? "text-amber-400"
      : msg.role === "user"
        ? "text-sky-400"
        : "text-purple-400";

  return (
    <div className="border border-sim-border rounded bg-sim-bg mb-2">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
        onClick={() => setCollapsed((c) => !c)}
      >
        <span
          className={`text-[11px] font-mono font-semibold uppercase ${roleStyle}`}
        >
          {msg.role}
        </span>
        <span className="text-[10px] text-sim-text-faint ml-auto">
          {lines.length} line{lines.length !== 1 ? "s" : ""}
          {isLong ? (collapsed ? " ▸" : " ▾") : ""}
        </span>
      </button>
      <div className="px-3 pb-2">
        <pre className="text-[11px] text-sim-text font-mono whitespace-pre-wrap break-words leading-relaxed">
          {collapsed && isLong ? preview + "\n…" : msg.content}
        </pre>
        {collapsed && isLong && (
          <button
            className="text-[10px] text-sim-accent hover:underline mt-1"
            onClick={() => setCollapsed(false)}
          >
            Show all {lines.length} lines
          </button>
        )}
      </div>
    </div>
  );
}

// Renders the response — tool calls formatted as readable blocks, or plain text
function ResponseBlock({ entry }: { entry: LLMDebugEntry }) {
  if (entry.response === null) {
    return (
      <div className="text-xs text-amber-400 font-mono px-2 py-3">
        ⏳ Waiting for response…
      </div>
    );
  }
  if (entry.response === "error") {
    return (
      <div className="text-xs text-red-400 font-mono px-2 py-3">
        ✗ LLM call failed
      </div>
    );
  }

  const { toolCalls, text } = entry.response;

  return (
    <div className="flex flex-col gap-2">
      {text && (
        <div className="border border-sim-border rounded bg-sim-bg">
          <div className="px-3 py-1.5 text-[11px] font-mono font-semibold text-purple-400 uppercase">
            text
          </div>
          <pre className="px-3 pb-2 text-[11px] text-sim-text font-mono whitespace-pre-wrap break-words leading-relaxed">
            {text}
          </pre>
        </div>
      )}
      {toolCalls.map((tc, i) => (
        <div key={i} className="border border-emerald-500/30 rounded bg-sim-bg">
          <div className="px-3 py-1.5 text-[11px] font-mono font-semibold text-emerald-400 uppercase flex items-center gap-2">
            <span>tool_call</span>
            <span className="text-emerald-300 normal-case">{tc.tool}</span>
          </div>
          <pre className="px-3 pb-2 text-[11px] text-sim-text font-mono whitespace-pre-wrap break-words leading-relaxed">
            {JSON.stringify(tc.params, null, 2)}
          </pre>
        </div>
      ))}
      {toolCalls.length === 0 && !text && (
        <div className="text-xs text-sim-text-faint font-mono px-2 py-3">
          (empty response)
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

function DebugPanel({ onClose }: { onClose: () => void }) {
  const { entries, clear } = useLLMDebugStore();
  const [filter, setFilter] = useState<LLMCallRole | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const prevCountRef = useRef(0);
  const [copied, copy] = useCopyToClipboard();

  // Auto-select the newest entry when it arrives (unless user has manually selected one)
  const filtered =
    filter === "all" ? [...entries] : entries.filter((e) => e.role === filter);
  const displayEntries = [...filtered].reverse(); // newest first

  useEffect(() => {
    if (entries.length > prevCountRef.current && selectedId === null) {
      setSelectedId(displayEntries[0]?.id ?? null);
    }
    prevCountRef.current = entries.length;
  }, [entries.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected =
    entries.find((e) => e.id === selectedId) ?? displayEntries[0] ?? null;

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    // Full-screen backdrop
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-stretch justify-stretch"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Panel — takes most of the screen with a comfortable margin */}
      <div className="m-4 flex-1 bg-sim-surface border border-sim-border rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-b border-sim-border bg-sim-surface">
          <span className="text-sm font-semibold text-sim-text">LLM Debug</span>
          <span className="text-xs text-sim-text-faint">
            {entries.length} call{entries.length !== 1 ? "s" : ""} recorded
          </span>

          {/* Filter tabs */}
          <div className="flex items-center gap-1 ml-2">
            {FILTER_TABS.map((tab) => {
              const count =
                tab.key === "all"
                  ? entries.length
                  : entries.filter((e) => e.role === tab.key).length;
              return (
                <button
                  key={tab.key}
                  onClick={() => setFilter(tab.key)}
                  className={`px-2 py-0.5 text-xs rounded transition-colors ${
                    filter === tab.key
                      ? "bg-sim-accent text-white"
                      : "text-sim-text-muted hover:text-sim-text hover:bg-sim-border"
                  }`}
                >
                  {tab.label}
                  {count > 0 && (
                    <span className="ml-1 opacity-70">({count})</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] font-mono text-sim-text-faint select-all">
              v{__APP_VERSION__}
            </span>
            <button
              onClick={clear}
              className="text-xs text-sim-text-muted hover:text-sim-text px-2 py-0.5 rounded hover:bg-sim-border transition-colors"
            >
              Clear
            </button>
            <button
              onClick={onClose}
              className="text-xs text-sim-text-muted hover:text-sim-text px-2 py-0.5 rounded hover:bg-sim-border transition-colors"
              aria-label="Close debug panel"
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* Body: entry list + detail pane */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: entry list */}
          <div className="w-72 flex-shrink-0 border-r border-sim-border overflow-y-auto">
            {displayEntries.length === 0 ? (
              <div className="px-4 py-8 text-xs text-sim-text-faint text-center">
                No LLM calls yet.
                <br />
                Trigger a trainee action to see traffic.
              </div>
            ) : (
              displayEntries.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => setSelectedId(entry.id)}
                  className={`w-full text-left px-3 py-2 border-b border-sim-border-muted flex flex-col gap-1 transition-colors ${
                    selected?.id === entry.id
                      ? "bg-sim-accent/10 border-l-2 border-l-sim-accent"
                      : "hover:bg-sim-border/30"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <StatusDot entry={entry} />
                    <RoleBadge role={entry.role} />
                    <span className="text-[10px] text-sim-text-faint ml-auto font-mono">
                      {entry.durationMs != null ? `${entry.durationMs}ms` : "…"}
                    </span>
                  </div>
                  <div className="text-xs text-sim-text font-mono truncate">
                    {entry.label}
                  </div>
                  <div className="text-[10px] text-sim-text-faint font-mono">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                    {" · "}
                    {entry.request.messages.length} msg
                    {entry.request.messages.length !== 1 ? "s" : ""}
                    {entry.request.tools.length > 0 &&
                      ` · ${entry.request.tools.length} tool${entry.request.tools.length !== 1 ? "s" : ""}`}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Right: detail pane */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {selected == null ? (
              <div className="text-xs text-sim-text-faint text-center mt-12">
                Select a call to inspect it.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Meta row */}
                <div className="flex items-center gap-3 pb-2 border-b border-sim-border">
                  <RoleBadge role={selected.role} />
                  <StatusDot entry={selected} />
                  <span className="text-xs text-sim-text font-mono">
                    {selected.label}
                  </span>
                  <span className="text-xs text-sim-text-faint font-mono">
                    {new Date(selected.timestamp).toLocaleTimeString()}
                    {selected.durationMs != null &&
                      ` · ${selected.durationMs}ms`}
                  </span>
                  <button
                    onClick={() => copy(formatEntryForClipboard(selected))}
                    className="ml-auto px-2 py-0.5 text-xs rounded border transition-colors font-mono
                      border-sim-border text-sim-text-muted hover:text-sim-text hover:border-sim-accent
                      data-[copied=true]:border-emerald-500 data-[copied=true]:text-emerald-400"
                    data-copied={copied}
                    title="Copy this request/response pair to clipboard"
                  >
                    {copied ? "✓ Copied" : "Copy"}
                  </button>
                </div>

                {/* Tools available */}
                {selected.request.tools.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold text-sim-text-muted uppercase mb-1">
                      Tools ({selected.request.tools.length})
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {selected.request.tools.map((t) => (
                        <span
                          key={t.name}
                          className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-sim-border text-sim-text-muted"
                        >
                          {t.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Request messages */}
                <div>
                  <div className="text-[11px] font-semibold text-sim-text-muted uppercase mb-2">
                    Request — {selected.request.messages.length} message
                    {selected.request.messages.length !== 1 ? "s" : ""}
                  </div>
                  {selected.request.messages.map((msg, i) => (
                    <MessageBlock key={i} msg={msg} />
                  ))}
                </div>

                {/* Response */}
                <div>
                  <div className="text-[11px] font-semibold text-sim-text-muted uppercase mb-2">
                    Response
                  </div>
                  <ResponseBlock entry={selected} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shell (button + panel toggle) ─────────────────────────────────────────────

export function DebugPanelShell() {
  const [open, setOpen] = useState(false);
  const { entries } = useLLMDebugStore();

  // Count in-flight calls for the badge
  const inFlight = entries.filter((e) => e.response === null).length;

  return (
    <div className="flex-shrink-0 flex items-center border-l border-sim-border">
      <button
        aria-label="Toggle LLM debug panel"
        onClick={() => setOpen((o) => !o)}
        className="relative px-3 py-2.5 text-xs text-sim-yellow hover:text-amber-300 transition-colors duration-75 font-mono"
      >
        Debug
        {inFlight > 0 && (
          <span
            className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"
            aria-hidden="true"
          />
        )}
      </button>
      {open && <DebugPanel onClose={() => setOpen(false)} />}
    </div>
  );
}
