import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { ScenarioCanvas } from "../../src/components/ScenarioCanvas";
import type { RawScenarioConfig } from "../../src/scenario/schema";
import type { ScenarioValidationError } from "../../src/scenario/lint";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePersona(id: string, name: string) {
  return {
    id,
    display_name: name,
    job_title: "SRE",
    team: "Platform",
    initiates_contact: false,
    cooldown_seconds: 60,
    silent_until_contacted: false,
    system_prompt: "You are a test persona.",
  };
}

function makeAction(id: string, isCorrect: boolean) {
  return {
    id,
    type: "rollback" as const,
    service: "svc",
    is_correct_fix: isCorrect,
  };
}

// ── Empty state ───────────────────────────────────────────────────────────────

describe("ScenarioCanvas — empty state", () => {
  it("renders empty state prompt when draft is null and not thinking", () => {
    render(
      <ScenarioCanvas
        draft={null}
        assumptions={[]}
        validationErrors={[]}
        thinking={false}
      />,
    );
    expect(
      screen.getByText(/describe your scenario in the chat/i),
    ).toBeInTheDocument();
  });

  it("renders thinking indicator when draft is null and thinking is true", () => {
    render(
      <ScenarioCanvas
        draft={null}
        assumptions={[]}
        validationErrors={[]}
        thinking={true}
      />,
    );
    expect(screen.getByTestId("thinking-dots")).toBeInTheDocument();
  });

  it("does not render thinking indicator when draft is null and thinking is false", () => {
    render(
      <ScenarioCanvas
        draft={null}
        assumptions={[]}
        validationErrors={[]}
        thinking={false}
      />,
    );
    expect(screen.queryByTestId("thinking-dots")).not.toBeInTheDocument();
  });
});

// ── Overview card ─────────────────────────────────────────────────────────────

describe("ScenarioCanvas — Overview card", () => {
  it("renders title from draft", () => {
    const draft: Partial<RawScenarioConfig> = {
      title: "Payment Service Outage",
      difficulty: "hard",
      tags: ["database", "rds"],
    };
    render(
      <ScenarioCanvas
        draft={draft}
        assumptions={[]}
        validationErrors={[]}
        thinking={false}
      />,
    );
    expect(screen.getByText("Payment Service Outage")).toBeInTheDocument();
  });

  it("renders difficulty badge", () => {
    const draft: Partial<RawScenarioConfig> = {
      title: "Test",
      difficulty: "hard",
    };
    render(
      <ScenarioCanvas
        draft={draft}
        assumptions={[]}
        validationErrors={[]}
        thinking={false}
      />,
    );
    expect(screen.getByText("hard")).toBeInTheDocument();
  });

  it("renders tags as pills", () => {
    const draft: Partial<RawScenarioConfig> = {
      title: "Test",
      tags: ["database", "latency"],
    };
    render(
      <ScenarioCanvas
        draft={draft}
        assumptions={[]}
        validationErrors={[]}
        thinking={false}
      />,
    );
    expect(screen.getByText("database")).toBeInTheDocument();
    expect(screen.getByText("latency")).toBeInTheDocument();
  });
});

// ── Personas card ─────────────────────────────────────────────────────────────

describe("ScenarioCanvas — Personas card", () => {
  it("renders one row per persona", () => {
    const draft: Partial<RawScenarioConfig> = {
      personas: [
        makePersona("p1", "Alice Smith"),
        makePersona("p2", "Bob Jones"),
      ],
    };
    render(
      <ScenarioCanvas
        draft={draft}
        assumptions={[]}
        validationErrors={[]}
        thinking={false}
      />,
    );
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
  });

  it("shows placeholder when personas not yet in draft", () => {
    render(
      <ScenarioCanvas
        draft={{ title: "test" }}
        assumptions={[]}
        validationErrors={[]}
        thinking={false}
      />,
    );
    // Personas card should show "Not yet defined" placeholder
    const placeholders = screen.getAllByText(/not yet defined/i);
    expect(placeholders.length).toBeGreaterThan(0);
  });
});

// ── Remediation Actions card ──────────────────────────────────────────────────

describe("ScenarioCanvas — Remediation Actions card", () => {
  it("renders correct-fix indicator for is_correct_fix: true", () => {
    const draft: Partial<RawScenarioConfig> = {
      remediation_actions: [makeAction("r1", true), makeAction("r2", false)],
    };
    render(
      <ScenarioCanvas
        draft={draft}
        assumptions={[]}
        validationErrors={[]}
        thinking={false}
      />,
    );
    // Correct action has a checkmark indicator
    expect(screen.getByTestId("correct-fix-r1")).toBeInTheDocument();
    // Red herring has an x indicator
    expect(screen.getByTestId("red-herring-r2")).toBeInTheDocument();
  });
});

// ── Assumptions card ──────────────────────────────────────────────────────────

describe("ScenarioCanvas — Assumptions card", () => {
  it("renders assumption strings", () => {
    render(
      <ScenarioCanvas
        draft={{ title: "test" }}
        assumptions={[
          "id derived from description",
          "difficulty set to medium",
        ]}
        validationErrors={[]}
        thinking={false}
      />,
    );
    // Assumptions are rendered with a bullet prefix "· text"
    expect(screen.getByText(/id derived from description/)).toBeInTheDocument();
    expect(screen.getByText(/difficulty set to medium/)).toBeInTheDocument();
  });

  it("does not render assumptions card when empty", () => {
    render(
      <ScenarioCanvas
        draft={{ title: "test" }}
        assumptions={[]}
        validationErrors={[]}
        thinking={false}
      />,
    );
    expect(screen.queryByTestId("assumptions-card")).not.toBeInTheDocument();
  });
});

// ── Validation errors bar ─────────────────────────────────────────────────────

describe("ScenarioCanvas — validation errors bar", () => {
  it("renders error bar when validationErrors non-empty", () => {
    const errors: ScenarioValidationError[] = [
      {
        source: "lint",
        rule: "correct_fix_exists",
        path: "remediation_actions",
        message: "At least one action must have is_correct_fix: true",
      },
    ];
    render(
      <ScenarioCanvas
        draft={{ title: "test" }}
        assumptions={[]}
        validationErrors={errors}
        thinking={false}
      />,
    );
    expect(screen.getByTestId("validation-error-bar")).toBeInTheDocument();
    expect(
      screen.getByText(/at least one action must have is_correct_fix/i),
    ).toBeInTheDocument();
  });

  it("does not render error bar when no errors", () => {
    render(
      <ScenarioCanvas
        draft={{ title: "test" }}
        assumptions={[]}
        validationErrors={[]}
        thinking={false}
      />,
    );
    expect(
      screen.queryByTestId("validation-error-bar"),
    ).not.toBeInTheDocument();
  });
});
