/**
 * ApprovalWorkflow unit tests.
 *
 * ApprovalWorkflow derives phases from stage.type and stage.tests:
 *   - type="build": Building + Tests (if any) — no bake phase
 *   - type="deploy": Deploying + Tests (if any) + Bake time
 *
 * Phase boundaries for a stage with stageDurationSecs=D and all three phases:
 *   Phase 1 (build/deploy):  elapsed  <  D * 0.10
 *   Phase 2 (tests):         elapsed  >= D * 0.10  &&  elapsed < D * 0.50
 *   Phase 3 (bake):          elapsed  >= D * 0.50
 *
 * For D=120s:
 *   Phase 1:   0–12s
 *   Phase 2:  12–60s
 *   Phase 3:  60–120s
 *
 * Active phase label prefix: "▶ "
 * Complete phase label prefix: "✓ "
 * Pending phase label prefix: "○ "
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { ApprovalWorkflow } from "../../src/components/tabs/CICDTab";
import type { PipelineStage } from "@shared/types/events";

const D = 120; // stageDurationSecs for all tests
const T = 1000; // arbitrary stageStartedAtSim

function makeStage(overrides: Partial<PipelineStage> = {}): PipelineStage {
  return {
    id: "staging",
    name: "Staging",
    type: "deploy",
    currentVersion: "v1.0.0",
    previousVersion: null,
    status: "in_progress",
    deployedAtSec: -9999,
    stageStartedAtSim: T,
    stageDurationSecs: D,
    commitMessage: "test",
    author: "tester",
    blockers: [],
    alarmWatches: [],
    tests: [
      { name: "Alpha test", status: "running" },
      { name: "Beta test", status: "running" },
    ],
    promotionEvents: [],
    ...overrides,
  };
}

// Render at T (seeds the startRef), then rerender at T+elapsed.
// This mirrors real usage where the component first mounts when the stage
// becomes in_progress (simTime ≈ T) and then receives advancing simTime.
function renderAtElapsed(stage: PipelineStage, elapsed: number) {
  const { rerender } = render(<ApprovalWorkflow stage={stage} simTime={T} />);
  if (elapsed > 0) {
    rerender(<ApprovalWorkflow stage={stage} simTime={T + elapsed} />);
  }
}

// Helper: find a PhaseRow span containing the expected prefix + keyword
function findPhaseRow(prefix: "▶" | "✓" | "○", keyword: RegExp) {
  return screen
    .queryAllByText(keyword)
    .find((el) => el.tagName === "SPAN" && el.textContent?.startsWith(prefix));
}

// Helper: get all progress bar fill divs (have inline style width)
function progressBarWidths(): number[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[style*='width']"))
    .map((el) => parseFloat(el.style.width))
    .filter((w) => !isNaN(w));
}

// ── deploy stage phase detection ──────────────────────────────────────────────

describe("ApprovalWorkflow — deploy stage phase detection", () => {
  it("deploying phase active at elapsed=0", () => {
    renderAtElapsed(makeStage(), 0);
    expect(findPhaseRow("▶", /deploying/i)).toBeDefined();
    expect(findPhaseRow("○", /tests/i)).toBeDefined();
    expect(findPhaseRow("○", /bake time/i)).toBeDefined();
  });

  it("deploying phase active midway (elapsed=6s)", () => {
    renderAtElapsed(makeStage(), 6);
    expect(findPhaseRow("▶", /deploying/i)).toBeDefined();
    expect(findPhaseRow("○", /tests/i)).toBeDefined();
  });

  it("deploying phase active at last moment before boundary (elapsed=11.9s)", () => {
    renderAtElapsed(makeStage(), 11.9);
    expect(findPhaseRow("▶", /deploying/i)).toBeDefined();
  });

  it("tests phase active just after deploy boundary (elapsed=12s)", () => {
    renderAtElapsed(makeStage(), 12);
    expect(findPhaseRow("✓", /deploying/i)).toBeDefined();
    expect(findPhaseRow("▶", /tests/i)).toBeDefined();
    expect(findPhaseRow("○", /bake time/i)).toBeDefined();
  });

  it("tests phase active midway (elapsed=36s)", () => {
    renderAtElapsed(makeStage(), 36);
    expect(findPhaseRow("✓", /deploying/i)).toBeDefined();
    expect(findPhaseRow("▶", /tests/i)).toBeDefined();
    expect(findPhaseRow("○", /bake time/i)).toBeDefined();
  });

  it("bake phase active just after tests boundary (elapsed=60s)", () => {
    renderAtElapsed(makeStage(), 60);
    expect(findPhaseRow("✓", /deploying/i)).toBeDefined();
    expect(findPhaseRow("✓", /tests/i)).toBeDefined();
    expect(findPhaseRow("▶", /bake time/i)).toBeDefined();
  });

  it("bake phase active midway (elapsed=90s)", () => {
    renderAtElapsed(makeStage(), 90);
    expect(findPhaseRow("▶", /bake time/i)).toBeDefined();
  });

  it("deployedAtSec does NOT affect phase — only startRef matters", () => {
    renderAtElapsed(makeStage(), 6);
    expect(findPhaseRow("▶", /deploying/i)).toBeDefined();
    expect(findPhaseRow("○", /bake time/i)).toBeDefined();
  });
});

// ── build stage phase detection ───────────────────────────────────────────────

describe("ApprovalWorkflow — build stage phase detection", () => {
  it("shows 'Building' not 'Deploying' for build stage", () => {
    renderAtElapsed(makeStage({ type: "build" }), 0);
    expect(findPhaseRow("▶", /building/i)).toBeDefined();
    expect(findPhaseRow("▶", /deploying/i)).toBeUndefined();
  });

  it("build stage has no bake phase", () => {
    renderAtElapsed(makeStage({ type: "build" }), 0);
    expect(screen.queryByText(/bake time/i)).toBeNull();
  });

  it("build stage with no tests has only the building phase", () => {
    renderAtElapsed(makeStage({ type: "build", tests: [] }), 0);
    expect(findPhaseRow("▶", /building/i)).toBeDefined();
    expect(screen.queryByText(/tests/i)).toBeNull();
    expect(screen.queryByText(/bake time/i)).toBeNull();
  });
});

// ── no-tests deploy stage ─────────────────────────────────────────────────────

describe("ApprovalWorkflow — deploy stage without tests", () => {
  it("no test phase rendered when stage has no tests", () => {
    renderAtElapsed(makeStage({ tests: [] }), 0);
    expect(screen.queryByText(/tests/i)).toBeNull();
  });

  it("still shows bake phase for deploy stage with no tests", () => {
    renderAtElapsed(makeStage({ tests: [] }), 0);
    expect(findPhaseRow("○", /bake time/i)).toBeDefined();
  });
});

// ── Progress bar values ───────────────────────────────────────────────────────

describe("ApprovalWorkflow — progress bar widths", () => {
  it("deploy bar at 0% at start", () => {
    renderAtElapsed(makeStage(), 0);
    const widths = progressBarWidths();
    expect(widths.some((w) => w === 0)).toBe(true);
  });

  it("deploy bar at ~50% at elapsed=6s (midpoint of 12s deploy phase)", () => {
    renderAtElapsed(makeStage(), 6);
    const widths = progressBarWidths();
    expect(widths.some((w) => w > 45 && w < 55)).toBe(true);
  });

  it("only the active tests bar is shown once deploy phase completes", () => {
    renderAtElapsed(makeStage(), 12);
    const widths = progressBarWidths();
    expect(widths.length).toBe(1);
    expect(widths[0]).toBe(0);
  });

  it("tests bar at ~50% at elapsed=36s (midpoint of 12–60s tests phase)", () => {
    renderAtElapsed(makeStage(), 36);
    const widths = progressBarWidths();
    expect(widths.some((w) => w > 45 && w < 55)).toBe(true);
  });

  it("bake bar at ~50% at elapsed=90s (midpoint of 60–120s bake phase)", () => {
    renderAtElapsed(makeStage(), 90);
    const widths = progressBarWidths();
    expect(widths.some((w) => w > 45 && w < 55)).toBe(true);
  });
});

// ── Static states ─────────────────────────────────────────────────────────────

describe("ApprovalWorkflow — static (not in_progress)", () => {
  it("all phases show ✓ when succeeded (deploy stage)", () => {
    render(
      <ApprovalWorkflow
        stage={makeStage({
          status: "succeeded",
          stageStartedAtSim: undefined,
          stageDurationSecs: undefined,
        })}
        simTime={T + 9999}
      />,
    );
    expect(findPhaseRow("✓", /deploying/i)).toBeDefined();
    expect(findPhaseRow("✓", /tests/i)).toBeDefined();
    expect(findPhaseRow("✓", /bake time/i)).toBeDefined();
  });

  it("no ▶ active phase when succeeded", () => {
    render(
      <ApprovalWorkflow
        stage={makeStage({
          status: "succeeded",
          stageStartedAtSim: undefined,
          stageDurationSecs: undefined,
        })}
        simTime={T}
      />,
    );
    expect(findPhaseRow("▶", /deploying/i)).toBeUndefined();
    expect(findPhaseRow("▶", /tests/i)).toBeUndefined();
    expect(findPhaseRow("▶", /bake time/i)).toBeUndefined();
  });

  it("shows 'Not yet started' for not_started stage", () => {
    render(
      <ApprovalWorkflow
        stage={makeStage({
          status: "not_started",
          stageStartedAtSim: undefined,
          stageDurationSecs: undefined,
        })}
        simTime={T}
      />,
    );
    expect(screen.getByText(/not yet started/i)).toBeInTheDocument();
  });

  it("simTime far in future doesn't affect static succeeded display", () => {
    render(
      <ApprovalWorkflow
        stage={makeStage({
          status: "succeeded",
          stageStartedAtSim: undefined,
          stageDurationSecs: undefined,
        })}
        simTime={999999}
      />,
    );
    expect(findPhaseRow("✓", /deploying/i)).toBeDefined();
  });
});

// ── Test count display ────────────────────────────────────────────────────────

describe("ApprovalWorkflow — test count in label", () => {
  it("shows 0/N during deploy phase", () => {
    renderAtElapsed(makeStage(), 6);
    expect(screen.getByText(/0\/2/)).toBeInTheDocument();
  });

  it("shows estimated progress count during tests phase", () => {
    renderAtElapsed(makeStage(), 36);
    expect(screen.getByText(/1\/2/)).toBeInTheDocument();
  });

  it("shows N/N during bake phase", () => {
    renderAtElapsed(makeStage(), 60);
    expect(screen.getByText(/2\/2/)).toBeInTheDocument();
  });
});
