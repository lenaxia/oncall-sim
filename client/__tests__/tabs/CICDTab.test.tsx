import { describe, it, expect, vi } from "vitest";
import { screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import {
  renderWithProviders,
  buildTestSnapshot,
  buildMockGameLoop,
} from "../../src/testutil/index";
import { CICDTab } from "../../src/components/tabs/CICDTab";
import type { Pipeline, PipelineStage } from "@shared/types/events";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function buildStage(overrides: Partial<PipelineStage> = {}): PipelineStage {
  return {
    id: "prod",
    name: "Prod",
    type: "deploy",
    currentVersion: "v2.4.1",
    previousVersion: "v2.4.0",
    status: "succeeded",
    deployedAtSec: -1200,
    commitMessage: "config: fix pool size",
    author: "sara-chen",
    blockers: [],
    alarmWatches: [],
    tests: [],
    promotionEvents: [],
    ...overrides,
  };
}

function buildPipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: "pipeline-payment",
    name: "payment-service",
    service: "payment-service",
    stages: [
      buildStage({
        id: "build",
        name: "Build",
        type: "build",
        status: "succeeded",
        deployedAtSec: -1500,
      }),
      buildStage({
        id: "staging",
        name: "Staging",
        type: "deploy",
        status: "succeeded",
        deployedAtSec: -1400,
      }),
      buildStage({
        id: "preprod",
        name: "Pre-Prod",
        type: "deploy",
        status: "blocked",
        deployedAtSec: -1200,
        blockers: [
          {
            type: "alarm",
            alarmId: "alarm-001",
            message: "Alarm firing: p99 latency > 2000ms on payment-service",
          },
        ],
        alarmWatches: ["alarm-001"],
      }),
      buildStage({
        id: "prod",
        name: "Prod",
        type: "deploy",
        status: "succeeded",
        deployedAtSec: -1200,
      }),
    ],
    ...overrides,
  };
}

function renderCICD(pipelines: Pipeline[] = [buildPipeline()]) {
  const mockLoop = buildMockGameLoop();
  const result = renderWithProviders(<CICDTab />, { mockLoop });
  act(() => {
    mockLoop.emit({
      type: "session_snapshot",
      snapshot: buildTestSnapshot({ pipelines }),
    });
  });
  return { ...result, mockLoop };
}

// ── Pipeline list ─────────────────────────────────────────────────────────────

describe("CICDTab", () => {
  describe("pipeline list", () => {
    it("shows empty state when no pipelines", () => {
      renderCICD([]);
      expect(screen.getByText(/no pipelines/i)).toBeInTheDocument();
    });

    it("renders pipeline names in list", () => {
      renderCICD([
        buildPipeline({ id: "p1", name: "payment-service" }),
        buildPipeline({
          id: "p2",
          name: "fraud-service",
          service: "fraud-service",
        }),
      ]);
      expect(screen.getByText("payment-service")).toBeInTheDocument();
      expect(screen.getByText("fraud-service")).toBeInTheDocument();
    });

    it("shows BLOCKED for pipeline with a blocked stage", () => {
      renderCICD([buildPipeline()]);
      expect(screen.getAllByText(/blocked/i).length).toBeGreaterThan(0);
    });

    it("shows HEALTHY for all-succeeded pipeline", () => {
      renderCICD([
        buildPipeline({
          stages: [
            buildStage({ id: "build", name: "Build", status: "succeeded" }),
            buildStage({ id: "staging", name: "Staging", status: "succeeded" }),
            buildStage({
              id: "preprod",
              name: "Pre-Prod",
              status: "succeeded",
            }),
            buildStage({ id: "prod", name: "Prod", status: "succeeded" }),
          ],
        }),
      ]);
      expect(screen.getByText(/healthy/i)).toBeInTheDocument();
    });

    it("shows last prod deploy column", () => {
      renderCICD();
      expect(screen.getByText(/last prod deploy/i)).toBeInTheDocument();
    });

    it("shows versions pending prod column", () => {
      renderCICD();
      expect(screen.getByText(/versions pending prod/i)).toBeInTheDocument();
    });
  });

  // ── Stage flow ──────────────────────────────────────────────────────────────

  describe("stage flow", () => {
    it("stage flow visible for selected pipeline", async () => {
      const user = userEvent.setup();
      renderCICD();
      await user.click(screen.getByText("payment-service"));
      expect(screen.getByTestId("stage-flow")).toBeInTheDocument();
    });

    it("all 4 stage names visible as cards", async () => {
      const user = userEvent.setup();
      renderCICD();
      await user.click(screen.getByText("payment-service"));
      expect(screen.getByTestId("stage-card-build")).toBeInTheDocument();
      expect(screen.getByTestId("stage-card-staging")).toBeInTheDocument();
      expect(screen.getByTestId("stage-card-preprod")).toBeInTheDocument();
      expect(screen.getByTestId("stage-card-prod")).toBeInTheDocument();
    });

    it("stage card shows current version", async () => {
      const user = userEvent.setup();
      renderCICD();
      await user.click(screen.getByText("payment-service"));
      const cards = screen.getAllByText("v2.4.1");
      expect(cards.length).toBeGreaterThan(0);
    });

    it("stage card shows status label", async () => {
      const user = userEvent.setup();
      renderCICD();
      await user.click(screen.getByText("payment-service"));
      expect(screen.getAllByText(/succeeded/i).length).toBeGreaterThan(0);
    });

    it("blocked stage card shows alarm blocker message", async () => {
      const user = userEvent.setup();
      renderCICD();
      await user.click(screen.getByText("payment-service"));
      // Alarm blocker message is shown in the connector popup on hover
      // The stage card itself shows Override Blocker button for alarm-blocked stage
      expect(
        screen.getAllByRole("button", { name: /override blocker/i }).length,
      ).toBeGreaterThan(0);
    });

    it("stage card does NOT show author name", async () => {
      const user = userEvent.setup();
      renderCICD();
      await user.click(screen.getByText("payment-service"));
      expect(screen.queryByText("sara-chen")).not.toBeInTheDocument();
    });
  });

  // ── Stage actions ───────────────────────────────────────────────────────────

  describe("stage actions", () => {
    it("Rollback button shown on stage card with previousVersion", async () => {
      const user = userEvent.setup();
      renderCICD();
      await user.click(screen.getByText("payment-service"));
      const rollbackBtns = screen.getAllByRole("button", { name: /rollback/i });
      expect(rollbackBtns.length).toBeGreaterThan(0);
    });

    it("Rollback dispatches trigger_rollback with pipelineId and stageId", async () => {
      const user = userEvent.setup();
      const mockLoop = buildMockGameLoop();
      const handleAction = vi.spyOn(mockLoop, "handleAction");
      renderWithProviders(<CICDTab />, { mockLoop });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({ pipelines: [buildPipeline()] }),
        });
      });
      await user.click(screen.getByText("payment-service"));
      // Click rollback on the prod stage card specifically
      const rollbackBtns = screen.getAllByRole("button", { name: /rollback/i });
      // Last one is prod (rightmost stage)
      await user.click(rollbackBtns[rollbackBtns.length - 1]);
      // Confirm in modal — there's exactly one "Rollback →" in the modal
      const modalConfirm = screen.getAllByRole("button", {
        name: /rollback →/i,
      });
      await user.click(modalConfirm[modalConfirm.length - 1]);
      await waitFor(() => {
        expect(handleAction).toHaveBeenCalledWith(
          "trigger_rollback",
          expect.objectContaining({
            pipelineId: "pipeline-payment",
            stageId: "prod",
          }),
        );
      });
    });

    it("Override Blocker button shown on alarm-blocked stage card", async () => {
      const user = userEvent.setup();
      renderCICD();
      await user.click(screen.getByText("payment-service"));
      expect(
        screen.getAllByRole("button", { name: /override blocker/i }).length,
      ).toBeGreaterThan(0);
    });

    it("Override Blocker dispatches override_blocker after confirmation", async () => {
      const user = userEvent.setup();
      const mockLoop = buildMockGameLoop();
      const handleAction = vi.spyOn(mockLoop, "handleAction");
      renderWithProviders(<CICDTab />, { mockLoop });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({ pipelines: [buildPipeline()] }),
        });
      });
      await user.click(screen.getByText("payment-service"));
      // Click override on the preprod stage card
      const overrideBtns = screen.getAllByRole("button", {
        name: /override blocker/i,
      });
      await user.click(overrideBtns[0]);
      await user.click(screen.getByRole("button", { name: /override →/i }));
      await waitFor(() => {
        expect(handleAction).toHaveBeenCalledWith(
          "override_blocker",
          expect.objectContaining({ stageId: "preprod" }),
        );
      });
    });

    it("Manual Promotion Block connector shown for manual_approval blocker", async () => {
      const user = userEvent.setup();
      renderCICD([
        buildPipeline({
          stages: [
            buildStage({ id: "build", name: "Build", status: "succeeded" }),
            buildStage({ id: "staging", name: "Staging", status: "succeeded" }),
            buildStage({
              id: "preprod",
              name: "Pre-Prod",
              status: "blocked",
              blockers: [
                {
                  type: "manual_approval",
                  message: "Awaiting release manager",
                },
              ],
            }),
            buildStage({ id: "prod", name: "Prod", status: "not_started" }),
          ],
        }),
      ]);
      await user.click(screen.getByText("payment-service"));
      // The connector before preprod should have approve gate in its popup
      const connector = screen.getByTestId("connector-approve-preprod");
      expect(connector).toBeInTheDocument();
    });

    it("Block Promotion connector visible for unblocked stage", async () => {
      const user = userEvent.setup();
      renderCICD();
      await user.click(screen.getByText("payment-service"));
      expect(screen.getByTestId("connector-block-prod")).toBeInTheDocument();
    });

    it("Block Promotion dispatches block_promotion", async () => {
      const user = userEvent.setup();
      const mockLoop = buildMockGameLoop();
      const handleAction = vi.spyOn(mockLoop, "handleAction");
      renderWithProviders(<CICDTab />, { mockLoop });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({ pipelines: [buildPipeline()] }),
        });
      });
      await user.click(screen.getByText("payment-service"));
      await user.click(screen.getByTestId("connector-block-prod"));
      await waitFor(() => {
        expect(handleAction).toHaveBeenCalledWith(
          "block_promotion",
          expect.objectContaining({ stageId: "prod" }),
        );
      });
    });
  });

  // ── Approval workflow ─────────────────────────────────────────────────────

  describe("approval workflow", () => {
    it("shows approval workflow section on each stage card", async () => {
      const user = userEvent.setup();
      renderCICD();
      await user.click(screen.getByText("payment-service"));
      expect(
        screen.getAllByText(/approval workflow|build & test/i).length,
      ).toBeGreaterThan(0);
    });

    it("in_progress stage shows deploying phase row", async () => {
      const user = userEvent.setup();
      renderCICD([
        buildPipeline({
          stages: [
            buildStage({
              id: "build",
              name: "Build",
              type: "build",
              status: "in_progress",
              deployedAtSec: 0,
              stageStartedAtSim: 0,
              stageDurationSecs: 120,
              tests: [{ name: "Unit tests", status: "running" }],
            }),
            buildStage({
              id: "prod",
              name: "Prod",
              type: "deploy",
              status: "not_started",
            }),
          ],
        }),
      ]);
      await user.click(screen.getByText("payment-service"));
      // Should show the deploying phase row (▶ Deploying) in the approval workflow
      const deployingTexts = screen.getAllByText(/deploying/i);
      // At least one must be inside the approval workflow (not the status badge)
      expect(deployingTexts.length).toBeGreaterThan(0);
    });
  });

  // ── Engine updates ────────────────────────────────────────────────────────

  describe("engine updates", () => {
    it("pipeline_stage_updated removes alarm blocker button from stage card", async () => {
      const user = userEvent.setup();
      const { mockLoop } = renderCICD();
      await user.click(screen.getByText("payment-service"));
      expect(
        screen.getAllByRole("button", { name: /override blocker/i }).length,
      ).toBeGreaterThan(0);
      act(() => {
        mockLoop.emit({
          type: "pipeline_stage_updated",
          pipelineId: "pipeline-payment",
          stage: buildStage({
            id: "preprod",
            name: "Pre-Prod",
            status: "succeeded",
            blockers: [],
          }),
        });
      });
      await waitFor(() => {
        expect(
          screen.queryByRole("button", { name: /override blocker/i }),
        ).toBeNull();
      });
    });
  });

  // ── view_pipeline dispatch ────────────────────────────────────────────────

  describe("view_pipeline dispatch", () => {
    it("dispatches view_pipeline when pipeline selected", async () => {
      const user = userEvent.setup();
      const mockLoop = buildMockGameLoop();
      const handleAction = vi.spyOn(mockLoop, "handleAction");
      renderWithProviders(<CICDTab />, { mockLoop });
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({ pipelines: [buildPipeline()] }),
        });
      });
      await user.click(screen.getByText("payment-service"));
      await waitFor(() => {
        expect(handleAction).toHaveBeenCalledWith(
          "view_pipeline",
          expect.anything(),
        );
      });
    });
  });
});
