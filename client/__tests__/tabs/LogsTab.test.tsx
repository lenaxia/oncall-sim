import { describe, it, expect, vi } from "vitest";
import { screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  renderWithProviders,
  buildTestSnapshot,
  buildLogEntry,
  buildMockGameLoop,
} from "../../src/testutil/index";
import { LogsTab } from "../../src/components/tabs/LogsTab";

import type { LogLevel } from "@shared/types/events";

const defaultFilter = { query: "", levels: new Set<LogLevel>(), service: "" };

function renderLogs(
  logs = [buildLogEntry()],
  filter: {
    query: string;
    levels: Set<LogLevel>;
    service: string;
  } = defaultFilter,
) {
  const mockLoop = buildMockGameLoop();
  const result = renderWithProviders(
    <LogsTab filterState={filter} onFilterChange={() => {}} />,
    { mockLoop },
  );
  act(() => {
    mockLoop.emit({
      type: "session_snapshot",
      snapshot: buildTestSnapshot({ logs }),
    });
  });
  return { ...result, mockLoop };
}

describe("LogsTab", () => {
  describe("rendering", () => {
    it("renders log entries", () => {
      renderLogs([
        buildLogEntry({ message: "Error connecting to DB", level: "ERROR" }),
      ]);
      expect(screen.getByText("Error connecting to DB")).toBeInTheDocument();
    });

    it("ERROR level shows red styling indicator", () => {
      renderLogs([buildLogEntry({ level: "ERROR", message: "boom" })]);
      const badges = screen.getAllByText("ERROR");
      expect(badges.some((el) => el.closest(".border-b") !== null)).toBe(true);
    });

    it("WARN level entry visible", () => {
      renderLogs([buildLogEntry({ level: "WARN", message: "slow response" })]);
      expect(screen.getByText("slow response")).toBeInTheDocument();
    });

    it("INFO level entry visible", () => {
      renderLogs([buildLogEntry({ level: "INFO", message: "started" })]);
      expect(screen.getByText("started")).toBeInTheDocument();
    });

    it("DEBUG level entry visible", () => {
      renderLogs([buildLogEntry({ level: "DEBUG", message: "debug trace" })]);
      expect(screen.getByText("debug trace")).toBeInTheDocument();
    });

    it("renders service name", () => {
      renderLogs([
        buildLogEntry({ service: "payment-service", message: "err" }),
      ]);
      expect(screen.getAllByText("payment-service").length).toBeGreaterThan(0);
    });
  });

  describe("filtering", () => {
    it("text search filters by message content", () => {
      renderLogs(
        [
          buildLogEntry({ message: "DB timeout error", level: "ERROR" }),
          buildLogEntry({ message: "request handled OK", level: "INFO" }),
        ],
        { query: "timeout", levels: new Set(), service: "" },
      );
      expect(screen.getByText("DB timeout error")).toBeInTheDocument();
      expect(screen.queryByText("request handled OK")).toBeNull();
    });

    it("level filter shows only matching level", () => {
      renderLogs(
        [
          buildLogEntry({ message: "error msg", level: "ERROR" }),
          buildLogEntry({ message: "info msg", level: "INFO" }),
        ],
        { query: "", levels: new Set<LogLevel>(["ERROR"]), service: "" },
      );
      expect(screen.getByText("error msg")).toBeInTheDocument();
      expect(screen.queryByText("info msg")).toBeNull();
    });

    it("service selector filters by service", () => {
      renderLogs(
        [
          buildLogEntry({ service: "svc-a", message: "from a" }),
          buildLogEntry({ service: "svc-b", message: "from b" }),
        ],
        { query: "", levels: new Set(), service: "svc-a" },
      );
      expect(screen.getByText("from a")).toBeInTheDocument();
      expect(screen.queryByText("from b")).toBeNull();
    });

    it("clear filter shows all entries", () => {
      renderLogs([
        buildLogEntry({ message: "visible", level: "ERROR" }),
        buildLogEntry({ message: "also visible", level: "INFO" }),
      ]);
      expect(screen.getByText("visible")).toBeInTheDocument();
      expect(screen.getByText("also visible")).toBeInTheDocument();
    });
  });

  describe("engine events", () => {
    it("new log_entry event appends to visible list", () => {
      const { mockLoop } = renderLogs([]);
      act(() => {
        mockLoop.emit({
          type: "log_entry",
          entry: buildLogEntry({ message: "new entry arrived" }),
        });
      });
      expect(screen.getByText("new entry arrived")).toBeInTheDocument();
    });
  });

  describe("audit actions", () => {
    it("search_logs dispatched on Enter keypress in search input", async () => {
      const user = userEvent.setup();
      const mockLoop = buildMockGameLoop();
      const handleAction = vi.spyOn(mockLoop, "handleAction");
      const onFilterChange = vi.fn();
      renderWithProviders(
        <LogsTab filterState={defaultFilter} onFilterChange={onFilterChange} />,
        { mockLoop },
      );
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });

      const input = screen.getByPlaceholderText(/search logs/i);
      await user.type(input, "error");
      await user.keyboard("{Enter}");
      await waitFor(() => {
        expect(handleAction).toHaveBeenCalledWith(
          "search_logs",
          expect.any(Object),
        );
      });
    });

    it("search_logs NOT dispatched on every keystroke", async () => {
      const user = userEvent.setup();
      const mockLoop = buildMockGameLoop();
      const handleAction = vi.spyOn(mockLoop, "handleAction");
      renderWithProviders(
        <LogsTab filterState={defaultFilter} onFilterChange={() => {}} />,
        { mockLoop },
      );
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
      });
      await user.type(screen.getByPlaceholderText(/search logs/i), "err");
      expect(handleAction).not.toHaveBeenCalled();
    });
  });
});
