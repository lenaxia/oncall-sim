import { describe, it, expect } from "vitest";
import { screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useState } from "react";
import {
  renderWithProviders,
  buildTestSnapshot,
  buildChatMessage,
  buildMockGameLoop,
} from "../../src/testutil/index";
import { ChatTab } from "../../src/components/tabs/ChatTab";

const defaultChatUnread = new Map<string, number>();

function ChatTabWrapper({
  channels = {},
  chatUnread = defaultChatUnread,
}: {
  channels?: Record<string, ReturnType<typeof buildChatMessage>[]>;
  chatUnread?: Map<string, number>;
}) {
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  return (
    <ChatTab
      chatUnread={chatUnread}
      activeChannel={activeChannel}
      onChannelChange={setActiveChannel}
    />
  );
}

function renderChat(
  channels: Record<string, ReturnType<typeof buildChatMessage>[]> = {},
  chatUnread = defaultChatUnread,
) {
  const mockLoop = buildMockGameLoop();
  const result = renderWithProviders(
    <ChatTabWrapper channels={channels} chatUnread={chatUnread} />,
    { mockLoop },
  );
  act(() => {
    mockLoop.emit({
      type: "session_snapshot",
      snapshot: buildTestSnapshot({ chatChannels: channels }),
    });
  });
  return { ...result, mockLoop };
}

describe("ChatTab", () => {
  describe("channel list", () => {
    it("renders # channels in CHANNELS section", () => {
      renderChat({ "#incidents": [] });
      expect(screen.getAllByText("#incidents").length).toBeGreaterThan(0);
    });

    it("DM channels shown in DMS section", () => {
      renderChat({ "dm:fixture-persona": [] });
      expect(screen.getByText(/DMS/i)).toBeInTheDocument();
    });

    it("clicking channel shows its messages", async () => {
      const user = userEvent.setup();
      renderChat({
        "#incidents": [buildChatMessage({ text: "hello channel" })],
      });
      await user.click(screen.getAllByText("#incidents")[0]);
      expect(screen.getByText("hello channel")).toBeInTheDocument();
    });
  });

  describe("messages", () => {
    it("messages rendered in chronological order", async () => {
      const user = userEvent.setup();
      const msg1 = buildChatMessage({
        text: "first",
        simTime: 10,
        channel: "#incidents",
      });
      const msg2 = buildChatMessage({
        text: "second",
        simTime: 20,
        channel: "#incidents",
      });
      renderChat({ "#incidents": [msg2, msg1] });
      await user.click(screen.getAllByText("#incidents")[0]);
      const first = screen.getByText("first");
      const second = screen.getByText("second");
      expect(
        first.compareDocumentPosition(second) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("persona messages use sim-persona colour", async () => {
      const user = userEvent.setup();
      const msg = buildChatMessage({
        persona: "fixture-persona",
        channel: "#incidents",
      });
      renderChat({ "#incidents": [msg] });
      await user.click(screen.getAllByText("#incidents")[0]);
      const senderEl = screen.getByText("fixture-persona", {
        selector: "[data-sender]",
      });
      expect(senderEl.className).toContain("sim-persona");
    });

    it("trainee messages use sim-trainee colour", async () => {
      const user = userEvent.setup();
      const msg = buildChatMessage({
        persona: "trainee",
        text: "my msg",
        channel: "#incidents",
      });
      renderChat({ "#incidents": [msg] });
      await user.click(screen.getAllByText("#incidents")[0]);
      const senderEl = screen.getByText("trainee", {
        selector: "[data-sender]",
      });
      expect(senderEl.className).toContain("sim-trainee");
    });

    it("empty channel state shown when channel has no messages", async () => {
      const user = userEvent.setup();
      renderChat({ "#incidents": [] });
      await user.click(screen.getAllByText("#incidents")[0]);
      expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
    });
  });

  describe("send message", () => {
    it("Enter key calls handleChatMessage on game loop", async () => {
      const user = userEvent.setup();
      const mockLoop = buildMockGameLoop();
      const handleChat = vi.spyOn(mockLoop, "handleChatMessage");
      const result = renderWithProviders(
        <ChatTabWrapper channels={{ "#incidents": [] }} />,
        { mockLoop },
      );
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({ chatChannels: { "#incidents": [] } }),
        });
      });
      await user.click(screen.getAllByText("#incidents")[0]);
      await user.type(screen.getByPlaceholderText(/message/i), "hello{Enter}");
      await waitFor(() => {
        expect(handleChat).toHaveBeenCalledWith("#incidents", "hello");
      });
      result.unmount();
    });

    it("Shift+Enter inserts newline instead of sending", async () => {
      const user = userEvent.setup();
      const mockLoop = buildMockGameLoop();
      const handleChat = vi.spyOn(mockLoop, "handleChatMessage");
      renderWithProviders(<ChatTabWrapper channels={{ "#incidents": [] }} />, {
        mockLoop,
      });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({ chatChannels: { "#incidents": [] } }),
        });
      });
      await user.click(screen.getAllByText("#incidents")[0]);
      await user.type(
        screen.getByPlaceholderText(/message/i),
        "line1{Shift>}{Enter}{/Shift}line2",
      );
      expect(handleChat).not.toHaveBeenCalled();
    });

    it("message send disabled when text empty", async () => {
      const user = userEvent.setup();
      renderChat({ "#incidents": [] });
      await user.click(screen.getAllByText("#incidents")[0]);
      expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
    });
  });

  describe("@ mention dropdown", () => {
    it("@ character in input shows mention dropdown", async () => {
      const user = userEvent.setup();
      renderChat({ "#incidents": [] });
      await user.click(screen.getAllByText("#incidents")[0]);
      await user.type(screen.getByPlaceholderText(/message/i), "@");
      expect(screen.getByTestId("mention-dropdown")).toBeInTheDocument();
    });

    it("pressing Escape in dropdown closes without inserting", async () => {
      const user = userEvent.setup();
      renderChat({ "#incidents": [] });
      await user.click(screen.getAllByText("#incidents")[0]);
      await user.type(screen.getByPlaceholderText(/message/i), "@");
      await user.keyboard("{Escape}");
      expect(screen.queryByTestId("mention-dropdown")).toBeNull();
    });
  });

  describe("audit actions", () => {
    it("direct_message_persona dispatched on first DM open", async () => {
      const user = userEvent.setup();
      const mockLoop = buildMockGameLoop();
      const handleAction = vi.spyOn(mockLoop, "handleAction");
      renderWithProviders(
        <ChatTabWrapper channels={{ "dm:fixture-persona": [] }} />,
        { mockLoop },
      );
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({
            chatChannels: { "dm:fixture-persona": [] },
          }),
        });
      });
      const personaEl = await screen.findByText("Fixture Persona");
      await user.click(personaEl);
      await waitFor(() => {
        expect(handleAction).toHaveBeenCalledWith(
          "direct_message_persona",
          expect.objectContaining({ personaId: "fixture-persona" }),
        );
      });
    });
  });

  describe("engine events", () => {
    it("new chat_message event appears in channel", async () => {
      const user = userEvent.setup();
      const { mockLoop } = renderChat({ "#incidents": [] });
      await user.click(screen.getAllByText("#incidents")[0]);
      act(() => {
        mockLoop.emit({
          type: "chat_message",
          channel: "#incidents",
          message: buildChatMessage({ text: "live update" }),
        });
      });
      expect(screen.getByText("live update")).toBeInTheDocument();
    });
  });
});
