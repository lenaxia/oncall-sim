import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScenarioPicker } from "../../src/components/ScenarioPicker";
import type { LoadedScenario } from "../../src/scenario/types";

// vi.mock factory is hoisted before imports — all values must be inlined or created inline
vi.mock("../../src/scenario/loader", () => {
  // Build a minimal LoadedScenario inline (cannot use imported helpers here)
  const fixture: LoadedScenario = {
    id: "_fixture",
    title: "Fixture Scenario",
    description: "A minimal test scenario.",
    difficulty: "medium",
    tags: ["fixture"],
    timeline: {
      defaultSpeed: 1,
      durationMinutes: 10,
      preIncidentSeconds: 300,
      resolutionSeconds: 15,
    },
    topology: {
      focalService: {
        name: "fixture-service",
        description: "test",
        components: [],
        incidents: [],
      },
      upstream: [],
      downstream: [],
    },
    engine: { tickIntervalSeconds: 15, defaultTab: "email", llmEventTools: [] },
    personas: [
      {
        id: "fp",
        displayName: "Fixture Persona",
        jobTitle: "Senior SRE",
        team: "Platform",
        initiatesContact: false,
        cooldownSeconds: 30,
        silentUntilContacted: false,
        systemPrompt: "test",
      },
    ],
    emails: [],
    chat: { channels: [], messages: [] },
    tickets: [],
    opsDashboard: {
      preIncidentSeconds: 300,
      resolutionSeconds: 15,
      focalService: {
        name: "fixture-service",
        scale: { typicalRps: 100 },
        trafficProfile: "always_on_api",
        health: "healthy",
        incidentType: "connection_pool_exhaustion",
        metrics: [
          {
            archetype: "error_rate",
            baselineValue: 0.5,
            incidentPeak: 15,
            criticalThreshold: 10,
          },
        ],
      },
      correlatedServices: [],
    },
    alarms: [],
    logs: [],
    wiki: { pages: [{ title: "Architecture", content: "# Architecture" }] },
    cicd: { pipelines: [], deployments: [] },
    remediationActions: [],
    featureFlags: [],
    hostGroups: [],
    evaluation: {
      rootCause: "",
      relevantActions: [],
      redHerrings: [],
      debriefContext: "",
    },
  };
  return {
    loadBundledScenarios: vi.fn().mockResolvedValue([fixture]),
    loadRemoteScenario: vi.fn().mockResolvedValue({
      scenarioId: "r",
      errors: [{ scenarioId: "r", field: "x", message: "x" }],
    }),
    isScenarioLoadError: (r: unknown) =>
      "errors" in (r as object) &&
      Array.isArray((r as { errors: unknown }).errors),
    toScenarioSummary: (s: LoadedScenario) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      difficulty: s.difficulty,
      tags: s.tags,
    }),
  };
});

describe("ScenarioPicker", () => {
  describe("loading", () => {
    it("shows loading spinner while loading scenarios", () => {
      const { container } = render(<ScenarioPicker onStart={() => {}} />);
      expect(container.querySelector("svg.animate-spin")).not.toBeNull();
    });
  });

  describe("after bundled scenarios load", () => {
    it("renders scenario title", async () => {
      render(<ScenarioPicker onStart={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("Fixture Scenario")).toBeInTheDocument();
      });
    });

    it("renders scenario difficulty", async () => {
      render(<ScenarioPicker onStart={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText(/medium/i)).toBeInTheDocument();
      });
    });

    it("renders scenario tags", async () => {
      render(<ScenarioPicker onStart={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("fixture")).toBeInTheDocument();
      });
    });

    it("Start button calls onStart with the LoadedScenario", async () => {
      const user = userEvent.setup();
      let startedScenario: LoadedScenario | null = null;
      render(
        <ScenarioPicker
          onStart={(s) => {
            startedScenario = s;
          }}
        />,
      );
      const btn = await screen.findByRole("button", { name: /start/i });
      await user.click(btn);
      expect(startedScenario).not.toBeNull();
      expect(startedScenario!.id).toBe("_fixture");
    });

    it("Start button shows loading (disabled) while starting", async () => {
      const user = userEvent.setup();
      render(<ScenarioPicker onStart={() => {}} />);
      const btn = await screen.findByRole("button", { name: /start/i });
      await user.click(btn);
      expect(btn).toBeDisabled();
    });
  });
});
