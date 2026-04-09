import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { DebriefScreen } from "../../src/components/DebriefScreen";
import { buildDebriefResult, buildAuditEntry } from "../../src/testutil/index";

function renderDebrief(
  opts: {
    scenarioId?: string;
    onBack?: () => void;
    onRunAgain?: (id: string) => void;
    debrief?: ReturnType<typeof buildDebriefResult>;
  } = {},
) {
  const debrief = opts.debrief ?? buildDebriefResult();
  return render(
    <DebriefScreen
      debriefResult={debrief}
      scenarioId={opts.scenarioId ?? "_fixture"}
      scenarioTitle="Fixture Scenario"
      onBack={opts.onBack ?? (() => {})}
      onRunAgain={opts.onRunAgain ?? (() => {})}
    />,
  );
}

describe("DebriefScreen", () => {
  describe("header", () => {
    it("shows scenario title", () => {
      renderDebrief();
      expect(screen.getByText("Fixture Scenario")).toBeInTheDocument();
    });

    it("New Scenario button calls onBack", async () => {
      const user = userEvent.setup();
      const onBack = vi.fn();
      renderDebrief({ onBack });
      await user.click(screen.getByRole("button", { name: /new scenario/i }));
      expect(onBack).toHaveBeenCalledOnce();
    });

    it("Run Again button calls onRunAgain with correct scenarioId", async () => {
      const user = userEvent.setup();
      const onRunAgain = vi.fn();
      renderDebrief({ scenarioId: "_fixture", onRunAgain });
      await user.click(screen.getByRole("button", { name: /run again/i }));
      expect(onRunAgain).toHaveBeenCalledWith("_fixture");
    });
  });

  describe("incident timeline", () => {
    it("renders audit log entries with ▶ icon", () => {
      const debrief = buildDebriefResult({
        auditLog: [buildAuditEntry("open_tab", { tab: "email" }, 10)],
      });
      renderDebrief({ debrief });
      expect(screen.getByText("Opened email tab")).toBeInTheDocument();
    });

    it("timeline sorted by simTime ascending", () => {
      const debrief = buildDebriefResult({
        auditLog: [
          buildAuditEntry("open_tab", { tab: "email" }, 30),
          buildAuditEntry("search_logs", { query: "err" }, 10),
        ],
      });
      renderDebrief({ debrief });
      const openTab = screen.getByText("Opened email tab");
      const searchLog = screen.getByText(/searched logs/i);
      expect(
        searchLog.compareDocumentPosition(openTab) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("relevant action entry shows ✓ badge", () => {
      const debrief = buildDebriefResult({
        auditLog: [buildAuditEntry("view_metric", { service: "svc" }, 15)],
        evaluationState: {
          relevantActionsTaken: [
            { action: "view_metric", why: "Core signal", takenAt: 15 },
          ],
          redHerringsTaken: [],
          resolved: false,
        },
      });
      renderDebrief({ debrief });
      expect(screen.getAllByText("✓").length).toBeGreaterThan(0);
    });

    it("red herring entry shows ✗ badge", () => {
      const debrief = buildDebriefResult({
        auditLog: [
          buildAuditEntry(
            "trigger_rollback",
            { service: "svc", version: "v1" },
            20,
          ),
        ],
        evaluationState: {
          relevantActionsTaken: [],
          redHerringsTaken: [
            { action: "trigger_rollback", why: "Was not the fix", takenAt: 20 },
          ],
          resolved: false,
        },
      });
      renderDebrief({ debrief });
      expect(screen.getAllByText("✗").length).toBeGreaterThan(0);
    });
  });

  describe("evaluation panel", () => {
    it("resolved=true shows Incident marked resolved", () => {
      const debrief = buildDebriefResult({
        evaluationState: {
          relevantActionsTaken: [],
          redHerringsTaken: [],
          resolved: true,
        },
      });
      renderDebrief({ debrief });
      expect(screen.getByText(/incident marked resolved/i)).toBeInTheDocument();
    });

    it("resolved=false shows Incident not explicitly resolved", () => {
      const debrief = buildDebriefResult({
        evaluationState: {
          relevantActionsTaken: [],
          redHerringsTaken: [],
          resolved: false,
        },
      });
      renderDebrief({ debrief });
      expect(screen.getByText(/not explicitly resolved/i)).toBeInTheDocument();
    });

    it("shows relevant actions taken", () => {
      const debrief = buildDebriefResult({
        evaluationState: {
          relevantActionsTaken: [
            { action: "view_metric", why: "Checked the spike", takenAt: 15 },
          ],
          redHerringsTaken: [],
          resolved: false,
        },
      });
      renderDebrief({ debrief });
      expect(screen.getByText("Checked the spike")).toBeInTheDocument();
    });

    it("shows red herrings taken", () => {
      const debrief = buildDebriefResult({
        evaluationState: {
          relevantActionsTaken: [],
          redHerringsTaken: [
            {
              action: "restart_service",
              why: "Not the root cause",
              takenAt: 20,
            },
          ],
          resolved: false,
        },
      });
      renderDebrief({ debrief });
      expect(screen.getByText("Not the root cause")).toBeInTheDocument();
    });
  });

  describe("stats panel", () => {
    it("shows resolvedAtSimTime", () => {
      const debrief = buildDebriefResult({ resolvedAtSimTime: 450 });
      renderDebrief({ debrief });
      expect(screen.getByText("T+00:07:30")).toBeInTheDocument();
    });

    it("shows action count", () => {
      const debrief = buildDebriefResult({
        auditLog: [
          buildAuditEntry("open_tab", {}, 5),
          buildAuditEntry("view_metric", {}, 10),
          buildAuditEntry("search_logs", {}, 15),
        ],
      });
      renderDebrief({ debrief });
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });
});
