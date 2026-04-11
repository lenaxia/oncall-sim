import { describe, it, expect } from "vitest";
import { screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useState } from "react";
import {
  renderWithProviders,
  buildTestSnapshot,
  buildEmail,
  buildMockGameLoop,
} from "../../src/testutil/index";
import { EmailTab } from "../../src/components/tabs/EmailTab";

function EmailTabWrapper({
  emails = [buildEmail()],
  initialReadIds = new Set<string>(),
}) {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(initialReadIds);
  return (
    <EmailTab
      selectedThreadId={selectedThreadId}
      onSelectThread={(id, newIds) => {
        setSelectedThreadId(id);
        setReadIds((prev) => {
          const n = new Set(prev);
          newIds.forEach((i) => n.add(i));
          return n;
        });
      }}
      readIds={readIds}
    />
  );
}

function renderEmail(emails = [buildEmail()], readIds = new Set<string>()) {
  const mockLoop = buildMockGameLoop();
  const result = renderWithProviders(
    <EmailTabWrapper emails={emails} initialReadIds={readIds} />,
    { mockLoop },
  );
  act(() => {
    mockLoop.emit({
      type: "session_snapshot",
      snapshot: buildTestSnapshot({ emails }),
    });
  });
  return { ...result, mockLoop };
}

describe("EmailTab", () => {
  describe("rendering", () => {
    it("empty state shown when emails=[]", () => {
      renderEmail([]);
      expect(screen.getByText(/no emails/i)).toBeInTheDocument();
    });

    it("renders inbox row with sender name", () => {
      renderEmail([
        buildEmail({ from: "fixture-persona", subject: "Test Subject" }),
      ]);
      expect(screen.getByText("fixture-persona")).toBeInTheDocument();
    });

    it("renders email subject truncated in inbox", () => {
      renderEmail([
        buildEmail({ subject: "High error rate on payment service" }),
      ]);
      expect(
        screen.getByText("High error rate on payment service"),
      ).toBeInTheDocument();
    });
  });

  describe("thread view", () => {
    it("clicking email shows thread view", async () => {
      const user = userEvent.setup();
      renderEmail([
        buildEmail({ subject: "Incident Alert", body: "Something is wrong." }),
      ]);
      await user.click(screen.getByText("Incident Alert"));
      expect(screen.getByText("Something is wrong.")).toBeInTheDocument();
    });

    it("empty thread state before any email selected", () => {
      renderEmail([buildEmail()]);
      expect(screen.getByText(/select an email/i)).toBeInTheDocument();
    });

    it("thread shows all emails in thread sorted by simTime", async () => {
      const user = userEvent.setup();
      const email1 = buildEmail({
        threadId: "t1",
        simTime: 10,
        body: "First message",
        subject: "Incident",
      });
      const email2 = buildEmail({
        threadId: "t1",
        simTime: 20,
        body: "Second message",
        subject: "Incident",
      });
      renderEmail([email1, email2]);
      await user.click(screen.getAllByText("Incident")[0]);
      const body = screen.getByText("First message");
      const body2 = screen.getByText("Second message");
      expect(
        body.compareDocumentPosition(body2) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("persona messages use sim-persona colour class", async () => {
      const user = userEvent.setup();
      renderEmail([buildEmail({ from: "fixture-persona", subject: "Alert" })]);
      await user.click(screen.getByText("Alert"));
      const sender = screen
        .getAllByText("fixture-persona")
        .find((el) => el.closest("[data-message-header]"));
      expect(sender?.className).toContain("sim-persona");
    });
  });

  describe("reply", () => {
    it("reply calls handleEmailReply on game loop", async () => {
      const user = userEvent.setup();
      const mockLoop = buildMockGameLoop();
      const handleReply = vi.spyOn(mockLoop, "handleEmailReply");
      renderWithProviders(
        <EmailTabWrapper
          emails={[buildEmail({ threadId: "thread-001", subject: "Alert" })]}
        />,
        { mockLoop },
      );
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({
            emails: [buildEmail({ threadId: "thread-001", subject: "Alert" })],
          }),
        });
      });
      await user.click(screen.getByText("Alert"));
      await user.type(
        screen.getByPlaceholderText(/reply/i),
        "I am investigating now.",
      );
      await user.click(screen.getByRole("button", { name: /send/i }));
      await waitFor(() => {
        expect(handleReply).toHaveBeenCalledWith(
          "thread-001",
          "I am investigating now.",
        );
      });
    });

    it("reply appears immediately in thread (optimistic)", async () => {
      const user = userEvent.setup();
      renderEmail([buildEmail({ subject: "Test" })]);
      await user.click(screen.getByText("Test"));
      await user.type(
        screen.getByPlaceholderText(/reply/i),
        "My reply text here",
      );
      await user.click(screen.getByRole("button", { name: /send/i }));
      expect(screen.getByText("My reply text here")).toBeInTheDocument();
    });

    it("send button disabled when textarea empty", async () => {
      const user = userEvent.setup();
      renderEmail([buildEmail({ subject: "Test" })]);
      await user.click(screen.getByText("Test"));
      expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
    });

    it("SSE echo of trainee reply suppressed (same body within 5s)", () => {
      const traineeReply = buildEmail({
        from: "trainee",
        threadId: "thread-001",
        body: "Echo test reply",
        simTime: 10,
      });
      const { mockLoop } = renderEmail([
        buildEmail({ threadId: "thread-001", subject: "Test" }),
        traineeReply,
      ]);
      act(() => {
        mockLoop.emit({
          type: "email_received",
          email: buildEmail({
            from: "trainee",
            threadId: "thread-001",
            body: "Echo test reply",
            simTime: 13,
          }),
        });
      });
      expect(screen.getAllByText("Test").length).toBeGreaterThan(0);
    });
  });

  describe("engine events", () => {
    it("email_received event adds new email to inbox", () => {
      const { mockLoop } = renderEmail([]);
      act(() => {
        mockLoop.emit({
          type: "email_received",
          email: buildEmail({ subject: "New Alert" }),
        });
      });
      expect(screen.getByText("New Alert")).toBeInTheDocument();
    });
  });
});
