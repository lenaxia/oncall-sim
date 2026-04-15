import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { ScenarioBuilderChat } from "../../src/components/ScenarioBuilderChat";
import type { BuilderMessage } from "../../src/hooks/useScenarioBuilder";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMsg(role: "bot" | "user", text: string): BuilderMessage {
  return { id: `msg-${Math.random()}`, role, text };
}

// ── Message rendering ─────────────────────────────────────────────────────────

describe("ScenarioBuilderChat — message rendering", () => {
  it("renders bot and user messages", () => {
    const messages: BuilderMessage[] = [
      makeMsg("bot", "What kind of incident?"),
      makeMsg("user", "Database overload"),
    ];
    render(
      <ScenarioBuilderChat
        messages={messages}
        thinking={false}
        onSend={vi.fn()}
      />,
    );
    expect(screen.getByText("What kind of incident?")).toBeInTheDocument();
    expect(screen.getByText("Database overload")).toBeInTheDocument();
  });

  it("renders seed bot message (first message always visible)", () => {
    const messages: BuilderMessage[] = [
      makeMsg("bot", "Describe your scenario in the chat"),
    ];
    render(
      <ScenarioBuilderChat
        messages={messages}
        thinking={false}
        onSend={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Describe your scenario in the chat"),
    ).toBeInTheDocument();
  });
});

// ── Thinking indicator ────────────────────────────────────────────────────────

describe("ScenarioBuilderChat — thinking indicator", () => {
  it("shows bouncing dots when thinking is true", () => {
    render(
      <ScenarioBuilderChat messages={[]} thinking={true} onSend={vi.fn()} />,
    );
    expect(screen.getByTestId("thinking-dots")).toBeInTheDocument();
  });

  it("hides thinking indicator when thinking is false", () => {
    render(
      <ScenarioBuilderChat messages={[]} thinking={false} onSend={vi.fn()} />,
    );
    expect(screen.queryByTestId("thinking-dots")).not.toBeInTheDocument();
  });
});

// ── Input interaction ─────────────────────────────────────────────────────────

describe("ScenarioBuilderChat — input", () => {
  it("calls onSend with input text when Send button clicked", async () => {
    const onSend = vi.fn();
    render(
      <ScenarioBuilderChat messages={[]} thinking={false} onSend={onSend} />,
    );
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "database overload");
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(onSend).toHaveBeenCalledWith("database overload");
  });

  it("calls onSend when Enter key pressed", async () => {
    const onSend = vi.fn();
    render(
      <ScenarioBuilderChat messages={[]} thinking={false} onSend={onSend} />,
    );
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "database overload{Enter}");
    expect(onSend).toHaveBeenCalledWith("database overload");
  });

  it("clears input after send", async () => {
    const onSend = vi.fn();
    render(
      <ScenarioBuilderChat messages={[]} thinking={false} onSend={onSend} />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    await userEvent.type(input, "hello");
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(input.value).toBe("");
  });

  it("does not call onSend with empty input", async () => {
    const onSend = vi.fn();
    render(
      <ScenarioBuilderChat messages={[]} thinking={false} onSend={onSend} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables input and send button while thinking", () => {
    render(
      <ScenarioBuilderChat messages={[]} thinking={true} onSend={vi.fn()} />,
    );
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });
});
