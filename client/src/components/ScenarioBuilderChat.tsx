// ScenarioBuilderChat.tsx — right-panel chat UI for the scenario builder.
// Stateless; all state owned by useScenarioBuilder via ScenarioBuilderScreen.

import React, { useRef, useEffect, useState } from "react";
import { ThinkingDots } from "./ScenarioCanvas";
import { Button } from "./Button";
import type {
  BuilderMessage,
  PendingQuestion,
} from "../hooks/useScenarioBuilder";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScenarioBuilderChatProps {
  messages: BuilderMessage[];
  thinking: boolean;
  onSend: (text: string) => void;
  pendingQuestion?: PendingQuestion | null;
  onOptionSelect?: (option: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ScenarioBuilderChat({
  messages,
  thinking,
  onSend,
  pendingQuestion = null,
  onOptionSelect = () => {},
}: ScenarioBuilderChatProps) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages or thinking state change
  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [messages, thinking]);

  // Return focus to input whenever LLM finishes responding
  useEffect(() => {
    if (!thinking) {
      inputRef.current?.focus();
    }
  }, [thinking]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    onSend(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="h-full flex flex-col bg-sim-surface border-l border-sim-border">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-sim-border">
        <h2 className="text-xs font-semibold text-sim-text-muted uppercase tracking-wide">
          Scenario Builder
        </h2>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Thinking indicator as a transient bot bubble */}
        {thinking && (
          <div className="flex items-start gap-2">
            <div className="w-6 h-6 rounded-full bg-sim-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-xs text-sim-accent">AI</span>
            </div>
            <div className="bg-sim-surface-2 border border-sim-border rounded-lg px-3 py-2">
              <ThinkingDots />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Option buttons — shown when LLM asks a question and not thinking */}
      {pendingQuestion && !thinking && (
        <div className="flex-shrink-0 border-t border-sim-border px-4 pt-3 pb-1 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {pendingQuestion.options.map((option) => (
              <button
                key={option}
                onClick={() => onOptionSelect(option)}
                className="text-xs px-3 py-1.5 rounded border border-sim-accent text-sim-accent hover:bg-sim-accent/10 transition-colors"
              >
                {option}
              </button>
            ))}
          </div>
          <span className="text-xs text-sim-text-faint">
            Or type your own answer below
          </span>
        </div>
      )}

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-sim-border px-4 py-3 flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={thinking}
          placeholder="Describe your scenario..."
          className="flex-1 bg-sim-surface border border-sim-border rounded px-3 py-1.5 text-xs text-sim-text placeholder-sim-text-faint focus:outline-none focus:border-sim-accent disabled:opacity-40 disabled:cursor-not-allowed"
        />
        <Button
          variant="primary"
          size="sm"
          disabled={thinking || input.trim().length === 0}
          onClick={handleSend}
        >
          Send
        </Button>
      </div>
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: BuilderMessage }) {
  const isBot = message.role === "bot";

  if (isBot) {
    return (
      <div className="flex items-start gap-2">
        <div className="w-6 h-6 rounded-full bg-sim-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <span className="text-xs text-sim-accent">AI</span>
        </div>
        <div className="bg-sim-surface-2 border border-sim-border rounded-lg px-3 py-2 max-w-xs">
          <p className="text-xs text-sim-text whitespace-pre-wrap">
            {message.text}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 flex-row-reverse">
      <div className="w-6 h-6 rounded-full bg-sim-text-muted/20 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-xs text-sim-text-muted">You</span>
      </div>
      <div className="bg-sim-accent/10 border border-sim-accent/20 rounded-lg px-3 py-2 max-w-xs">
        <p className="text-xs text-sim-text whitespace-pre-wrap">
          {message.text}
        </p>
      </div>
    </div>
  );
}
