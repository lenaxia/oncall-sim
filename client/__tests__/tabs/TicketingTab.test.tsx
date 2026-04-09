import { describe, it, expect, vi } from "vitest";
import { screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  renderWithProviders,
  buildTestSnapshot,
  buildTicket,
  buildTicketComment,
  buildMockGameLoop,
} from "../../src/testutil/index";
import { TicketingTab } from "../../src/components/tabs/TicketingTab";

function renderTickets(
  tickets = [buildTicket()],
  comments: Record<string, ReturnType<typeof buildTicketComment>[]> = {},
) {
  const mockLoop = buildMockGameLoop();
  const result = renderWithProviders(<TicketingTab />, { mockLoop });
  act(() => {
    mockLoop.emit({
      type: "session_snapshot",
      snapshot: buildTestSnapshot({ tickets, ticketComments: comments }),
    });
  });
  return { ...result, mockLoop };
}

describe("TicketingTab", () => {
  describe("rendering", () => {
    it("ticket list rendered from snapshot.tickets", () => {
      renderTickets([buildTicket({ title: "Payment service down" })]);
      expect(screen.getByText("Payment service down")).toBeInTheDocument();
    });

    it("empty list state shown when tickets=[]", () => {
      renderTickets([]);
      expect(screen.getByText(/no tickets/i)).toBeInTheDocument();
    });

    it("no-ticket-selected empty state on initial load", () => {
      renderTickets();
      expect(screen.getByText(/select a ticket/i)).toBeInTheDocument();
    });
  });

  describe("ticket detail", () => {
    it("clicking ticket shows detail view", async () => {
      const user = userEvent.setup();
      renderTickets([
        buildTicket({
          title: "DB Error",
          description: "## Problem\n\nDatabase is down.",
        }),
      ]);
      await user.click(screen.getByText("DB Error"));
      expect(
        screen.getByRole("heading", { name: /problem/i }),
      ).toBeInTheDocument();
    });

    it("description rendered via MarkdownRenderer", async () => {
      const user = userEvent.setup();
      renderTickets([
        buildTicket({
          title: "T1",
          description: "**Bold text** in description",
        }),
      ]);
      await user.click(screen.getByText("T1"));
      expect(screen.getByText("Bold text")).toBeInTheDocument();
    });

    it("comments rendered in order", async () => {
      const user = userEvent.setup();
      const t = buildTicket({ id: "t1", title: "T1" });
      const c1 = buildTicketComment("t1", {
        body: "First comment",
        simTime: 10,
      });
      const c2 = buildTicketComment("t1", {
        body: "Second comment",
        simTime: 20,
      });
      renderTickets([t], { t1: [c1, c2] });
      await user.click(screen.getByText("T1"));
      const first = screen.getByText("First comment");
      const second = screen.getByText("Second comment");
      expect(
        first.compareDocumentPosition(second) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  describe("status via metadata panel", () => {
    it("status dropdown shown in metadata panel when ticket selected", async () => {
      const user = userEvent.setup();
      renderTickets([buildTicket({ title: "T1", status: "open" })]);
      await user.click(screen.getByText("T1"));
      expect(screen.getByTestId("ticket-status-select")).toBeInTheDocument();
    });

    it("status dropdown has correct value", async () => {
      const user = userEvent.setup();
      renderTickets([buildTicket({ title: "T1", status: "in_progress" })]);
      await user.click(screen.getByText("T1"));
      expect(screen.getByTestId("ticket-status-select")).toHaveValue(
        "in_progress",
      );
    });

    it("changing status dispatches update_ticket via game loop", async () => {
      const user = userEvent.setup();
      const mockLoop = buildMockGameLoop();
      const handleAction = vi.spyOn(mockLoop, "handleAction");
      renderWithProviders(<TicketingTab />, { mockLoop });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({
            tickets: [buildTicket({ id: "t1", title: "T1", status: "open" })],
          }),
        });
      });
      await user.click(screen.getByText("T1"));
      await user.selectOptions(
        screen.getByTestId("ticket-status-select"),
        "in_progress",
      );
      await waitFor(() => {
        expect(handleAction).toHaveBeenCalledWith(
          "update_ticket",
          expect.objectContaining({ ticketId: "t1" }),
        );
      });
    });

    it("changing status to resolved dispatches mark_resolved AND update_ticket", async () => {
      const user = userEvent.setup();
      const mockLoop = buildMockGameLoop();
      const handleAction = vi.spyOn(mockLoop, "handleAction");
      renderWithProviders(<TicketingTab />, { mockLoop });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({
            tickets: [
              buildTicket({ id: "t1", title: "T1", status: "in_progress" }),
            ],
          }),
        });
      });
      await user.click(screen.getByText("T1"));
      await user.selectOptions(
        screen.getByTestId("ticket-status-select"),
        "resolved",
      );
      await waitFor(() => {
        const calls = handleAction.mock.calls.map((c) => c[0]);
        expect(calls).toContain("update_ticket");
      });
    });
  });

  describe("add comment", () => {
    it("add comment calls add_ticket_comment via game loop", async () => {
      const user = userEvent.setup();
      const mockLoop = buildMockGameLoop();
      const handleAction = vi.spyOn(mockLoop, "handleAction");
      renderWithProviders(<TicketingTab />, { mockLoop });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({
            tickets: [buildTicket({ id: "t1", title: "T1" })],
          }),
        });
      });
      await user.click(screen.getByText("T1"));
      await user.type(
        screen.getByPlaceholderText(/add a comment/i),
        "Investigating the issue.",
      );
      await user.click(screen.getByRole("button", { name: /comment/i }));
      await waitFor(() => {
        expect(handleAction).toHaveBeenCalledWith(
          "add_ticket_comment",
          expect.objectContaining({ ticketId: "t1" }),
        );
      });
    });
  });

  describe("engine events", () => {
    it("ticket_comment event adds comment to ticket", async () => {
      const user = userEvent.setup();
      const { mockLoop } = renderTickets([
        buildTicket({ id: "t1", title: "T1" }),
      ]);
      await user.click(screen.getByText("T1"));
      act(() => {
        mockLoop.emit({
          type: "ticket_comment",
          ticketId: "t1",
          comment: buildTicketComment("t1", { body: "Engine comment" }),
        });
      });
      expect(screen.getByText("Engine comment")).toBeInTheDocument();
    });

    it("ticket_updated event updates status select value", async () => {
      const user = userEvent.setup();
      const { mockLoop } = renderTickets([
        buildTicket({ id: "t1", title: "T1", status: "open" }),
      ]);
      await user.click(screen.getByText("T1"));
      act(() => {
        mockLoop.emit({
          type: "ticket_updated",
          ticketId: "t1",
          changes: { status: "in_progress" },
        });
      });
      await waitFor(() => {
        expect(screen.getByTestId("ticket-status-select")).toHaveValue(
          "in_progress",
        );
      });
    });
  });

  describe("metadata panel", () => {
    it("shows metadata panel when ticket selected", async () => {
      const user = userEvent.setup();
      renderTickets([buildTicket({ id: "t1", title: "T1" })]);
      await user.click(screen.getByText("T1"));
      expect(screen.getByTestId("ticket-metadata")).toBeInTheDocument();
    });

    it("shows status dropdown in metadata panel", async () => {
      const user = userEvent.setup();
      renderTickets([buildTicket({ id: "t1", title: "T1", status: "open" })]);
      await user.click(screen.getByText("T1"));
      expect(screen.getByTestId("ticket-status-select")).toBeInTheDocument();
    });

    it("shows severity dropdown in metadata panel", async () => {
      const user = userEvent.setup();
      renderTickets([buildTicket({ id: "t1", title: "T1", severity: "SEV2" })]);
      await user.click(screen.getByText("T1"));
      expect(screen.getByTestId("ticket-severity-select")).toBeInTheDocument();
    });

    it("changing severity dispatches update_ticket", async () => {
      const user = userEvent.setup();
      const mockLoop = buildMockGameLoop();
      const handleAction = vi.spyOn(mockLoop, "handleAction");
      renderWithProviders(<TicketingTab />, { mockLoop });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({
            tickets: [buildTicket({ id: "t1", title: "T1", severity: "SEV2" })],
          }),
        });
      });
      await user.click(screen.getByText("T1"));
      await user.selectOptions(
        screen.getByTestId("ticket-severity-select"),
        "SEV3",
      );
      await waitFor(() => {
        expect(handleAction).toHaveBeenCalledWith(
          "update_ticket",
          expect.objectContaining({ ticketId: "t1" }),
        );
      });
    });

    it("shows assignee select with Unassigned option", async () => {
      const user = userEvent.setup();
      renderTickets([buildTicket({ id: "t1", title: "T1" })]);
      await user.click(screen.getByText("T1"));
      expect(screen.getByTestId("ticket-assignee-select")).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: /unassigned/i }),
      ).toBeInTheDocument();
    });

    it("assigning to trainee dispatches update_ticket with assignee", async () => {
      const user = userEvent.setup();
      const mockLoop = buildMockGameLoop();
      const handleAction = vi.spyOn(mockLoop, "handleAction");
      renderWithProviders(<TicketingTab />, { mockLoop });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({
            tickets: [buildTicket({ id: "t1", title: "T1" })],
          }),
        });
      });
      await user.click(screen.getByText("T1"));
      await user.selectOptions(
        screen.getByTestId("ticket-assignee-select"),
        "trainee",
      );
      await waitFor(() => {
        expect(handleAction).toHaveBeenCalledWith(
          "update_ticket",
          expect.objectContaining({ ticketId: "t1" }),
        );
      });
    });

    it("shows created time", async () => {
      const user = userEvent.setup();
      renderTickets([buildTicket({ id: "t1", title: "T1", simTime: 0 })]);
      await user.click(screen.getByText("T1"));
      expect(screen.getByTestId("ticket-created-time")).toBeInTheDocument();
    });

    it("shows elapsed time since ticket creation", async () => {
      const user = userEvent.setup();
      renderTickets([buildTicket({ id: "t1", title: "T1", simTime: -120 })]);
      await user.click(screen.getByText("T1"));
      expect(screen.getByTestId("ticket-elapsed")).toBeInTheDocument();
    });

    it("metadata panel not shown when no ticket selected", () => {
      renderTickets([buildTicket({ id: "t1", title: "T1" })]);
      expect(screen.queryByTestId("ticket-metadata")).toBeNull();
    });
  });
});
