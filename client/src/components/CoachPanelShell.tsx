import { useState, useRef, useEffect } from "react";
import { useSession } from "../context/SessionContext";
import type { CoachLevel } from "../engine/coach-engine";
import { WallTimestamp } from "./Timestamp";
import { ThinkingDots } from "./ThinkingDots";

// ── Level config ───────────────────────────────────────────────────────────────

const LEVEL_ORDER: CoachLevel[] = ["novice", "intermediate", "expert"];

const LEVEL_META: Record<CoachLevel, { label: string; description: string }> = {
  novice: {
    label: "Novice",
    description: "Proactive guidance and broad hints",
  },
  intermediate: {
    label: "Intermediate",
    description: "Nudges when stuck, leading questions",
  },
  expert: {
    label: "Expert",
    description: "Silent unless asked — direct answers only",
  },
};

function nextLevel(current: CoachLevel): CoachLevel {
  const idx = LEVEL_ORDER.indexOf(current);
  return LEVEL_ORDER[(idx + 1) % LEVEL_ORDER.length];
}

// ── Welcome message shown before any LLM messages arrive ─────────────────────

const WELCOME_BY_LEVEL: Record<CoachLevel, string> = {
  novice:
    "Hi! I'm your coach. I'll send you proactive hints as you work through the incident. " +
    "You can also ask me anything below — I won't reveal the root cause, but I'll point you in the right direction.",
  intermediate:
    "I'm your coach. I'll nudge you if you seem stuck, but I'll mostly let you work. " +
    "Ask me questions anytime.",
  expert:
    "I'm your coach. I won't interrupt — ask me a question if you want a second opinion.",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function isTraineeMessage(id: string): boolean {
  return id.startsWith("trainee:");
}

// ── Typing indicator ──────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="px-3 py-2 border-t border-sim-border-muted flex flex-col gap-0.5 items-start">
      <span className="text-[10px] text-sim-text-faint font-mono">Coach</span>
      <div className="px-2.5 py-2 rounded bg-sim-border self-start flex items-center gap-1">
        <ThinkingDots />
      </div>
    </div>
  );
}

export function CoachPanelShell() {
  const { state, sendCoachMessage, setCoachLevel } = useSession();
  const [open, setOpen] = useState(false);
  const [lastSeenCount, setLastSeenCount] = useState(0);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = state.coachMessages;
  const messageCount = messages.length;
  const hasUnread = !open && messageCount > lastSeenCount;

  function toggle() {
    if (!open) setLastSeenCount(messageCount);
    setOpen((prev) => !prev);
  }

  // Clear badge when panel opens with new messages
  useEffect(() => {
    if (open) setLastSeenCount(messageCount);
  }, [open, messageCount]);

  // Scroll to bottom on new messages or when typing indicator appears
  useEffect(() => {
    if (
      open &&
      messagesEndRef.current &&
      typeof messagesEndRef.current.scrollIntoView === "function"
    ) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, open, sending]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    try {
      await sendCoachMessage(text);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const currentLevel = state.coachLevel;
  const levelMeta = LEVEL_META[currentLevel];

  return (
    <div className="flex-shrink-0 flex items-center border-l border-sim-border relative">
      {/* Toggle button */}
      <button
        aria-label="Toggle coach panel"
        className="relative px-3 py-2.5 text-xs text-sim-text-muted hover:text-sim-text transition-colors duration-75"
        onClick={toggle}
      >
        Coach
        {hasUnread && (
          <span
            data-coach-badge=""
            className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-sim-accent"
            aria-hidden="true"
          />
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          data-testid="coach-panel"
          className="absolute right-0 top-full z-30 w-80 bg-sim-surface border border-sim-border rounded shadow-lg flex flex-col"
          style={{ maxHeight: "32rem" }}
        >
          {/* Header: title + pill level toggle + close */}
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-sim-border">
            <span className="text-xs font-semibold text-sim-text">Coach</span>

            {/* Single cycling pill */}
            <button
              onClick={() => setCoachLevel(nextLevel(currentLevel))}
              title={levelMeta.description}
              className="ml-1 px-2 py-0.5 text-[11px] rounded-full bg-sim-accent/20 text-sim-accent border border-sim-accent/30 hover:bg-sim-accent/30 transition-colors font-mono leading-none"
            >
              {levelMeta.label}
            </button>

            <button
              aria-label="Close coach panel"
              onClick={toggle}
              className="ml-auto text-sim-text-faint hover:text-sim-text text-xs leading-none"
            >
              ✕
            </button>
          </div>

          {/* Message list */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {/* Welcome message — always shown above LLM messages */}
            <div className="px-3 pt-3 pb-1">
              <div className="flex flex-col gap-0.5 items-start">
                <span className="text-[10px] text-sim-text-faint font-mono">
                  Coach
                </span>
                <div className="max-w-[90%] px-2.5 py-1.5 rounded text-xs leading-snug bg-sim-border text-sim-text-muted italic">
                  {WELCOME_BY_LEVEL[currentLevel]}
                </div>
              </div>
            </div>

            {messages.length > 0 && (
              <div className="flex flex-col">
                {messages.map((msg) => {
                  const isMine = isTraineeMessage(msg.id);
                  return (
                    <div
                      key={msg.id}
                      data-testid={`coach-msg-${msg.id}`}
                      className={`px-3 py-2 border-t border-sim-border-muted flex flex-col gap-0.5 ${
                        isMine ? "items-end" : "items-start"
                      }`}
                    >
                      {/* Role label */}
                      <span className="text-[10px] text-sim-text-faint font-mono">
                        {isMine ? "You" : "Coach"}
                      </span>
                      {/* Bubble */}
                      <div
                        className={`max-w-[90%] px-2.5 py-1.5 rounded text-xs leading-snug ${
                          isMine
                            ? "bg-sim-accent/20 text-sim-text self-end"
                            : "bg-sim-border text-sim-text self-start"
                        }`}
                      >
                        {msg.text}
                      </div>
                      {/* Timestamp */}
                      <WallTimestamp simTime={msg.simTime} />
                    </div>
                  );
                })}
                {sending && <TypingIndicator />}
                <div ref={messagesEndRef} />
              </div>
            )}
            {messages.length === 0 && sending && (
              <div className="flex flex-col">
                <TypingIndicator />
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input row */}
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-t border-sim-border">
            <input
              type="text"
              placeholder="Ask the coach..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              className="flex-1 bg-sim-bg border border-sim-border rounded px-2 py-1 text-xs text-sim-text placeholder-sim-text-faint focus:outline-none focus:border-sim-accent disabled:opacity-50"
            />
            <button
              aria-label="Send"
              onClick={() => void handleSend()}
              disabled={!input.trim() || sending}
              className="px-2.5 py-1 text-xs rounded bg-sim-accent text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
