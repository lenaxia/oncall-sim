import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";
import {
  ScenarioProvider,
  useScenario,
} from "../../src/context/ScenarioContext";
import { buildLoadedScenario } from "../../src/testutil/index";

function makeWrapper(scenario = buildLoadedScenario()) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <ScenarioProvider scenario={scenario}>{children}</ScenarioProvider>;
  };
}

describe("ScenarioContext", () => {
  describe("initial state — scenario provided synchronously", () => {
    it("scenario is immediately available (no fetch)", () => {
      const { result } = renderHook(() => useScenario(), {
        wrapper: makeWrapper(),
      });
      expect(result.current.scenario).not.toBeNull();
    });

    it("scenario title matches loaded scenario", () => {
      const { result } = renderHook(() => useScenario(), {
        wrapper: makeWrapper(),
      });
      expect(result.current.scenario!.title).toBe("Fixture Scenario");
    });

    it("scenario has personas with jobTitle and team", () => {
      const { result } = renderHook(() => useScenario(), {
        wrapper: makeWrapper(),
      });
      const persona = result.current.scenario!.personas[0];
      expect(persona.displayName).toBe("Fixture Persona");
      expect(persona.jobTitle).toBe("Senior SRE");
      expect(persona.team).toBe("Platform");
    });

    it("scenario has wikiPages array from wiki.pages", () => {
      const { result } = renderHook(() => useScenario(), {
        wrapper: makeWrapper(),
      });
      expect(result.current.scenario!.wikiPages).toHaveLength(1);
      expect(result.current.scenario!.wikiPages[0].title).toBe("Architecture");
    });

    it("scenario.engine.defaultTab is populated", () => {
      const { result } = renderHook(() => useScenario(), {
        wrapper: makeWrapper(),
      });
      expect(result.current.scenario!.engine.defaultTab).toBe("email");
    });

    it("scenario.engine.hasFeatureFlags is false for fixture", () => {
      const { result } = renderHook(() => useScenario(), {
        wrapper: makeWrapper(),
      });
      expect(result.current.scenario!.engine.hasFeatureFlags).toBe(false);
    });

    it("scenario.engine.timelineDurationSeconds equals durationMinutes * 60", () => {
      const scenario = buildLoadedScenario({
        timeline: {
          defaultSpeed: 1,
          durationMinutes: 15,
          preIncidentSeconds: 300,
          resolutionSeconds: 15,
        },
      });
      const { result } = renderHook(() => useScenario(), {
        wrapper: makeWrapper(scenario),
      });
      expect(result.current.scenario!.engine.timelineDurationSeconds).toBe(
        15 * 60,
      );
    });
  });

  describe("hostGroupCounts", () => {
    it("initialised from scenario hostGroups", () => {
      const scenario = buildLoadedScenario({
        hostGroups: [
          { id: "g1", label: "Group 1", service: "svc", instanceCount: 4 },
        ],
      });
      const { result } = renderHook(() => useScenario(), {
        wrapper: makeWrapper(scenario),
      });
      expect(result.current.hostGroupCounts["g1"]).toBe(4);
    });

    it("adjustHostGroup delta updates count", () => {
      const scenario = buildLoadedScenario({
        hostGroups: [
          { id: "g1", label: "G1", service: "svc", instanceCount: 2 },
        ],
      });
      const { result } = renderHook(() => useScenario(), {
        wrapper: makeWrapper(scenario),
      });
      const { act } = require("@testing-library/react");
      act(() => {
        result.current.adjustHostGroup("g1", 3);
      });
      expect(result.current.hostGroupCounts["g1"]).toBe(5);
    });

    it("adjustHostGroup clamps at 0", () => {
      const scenario = buildLoadedScenario({
        hostGroups: [
          { id: "g1", label: "G1", service: "svc", instanceCount: 1 },
        ],
      });
      const { result } = renderHook(() => useScenario(), {
        wrapper: makeWrapper(scenario),
      });
      const { act } = require("@testing-library/react");
      act(() => {
        result.current.adjustHostGroup("g1", -999);
      });
      expect(result.current.hostGroupCounts["g1"]).toBe(0);
    });
  });

  describe("useScenario hook", () => {
    it("throws when used outside ScenarioProvider", () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      expect(() => renderHook(() => useScenario())).toThrow();
      consoleSpy.mockRestore();
    });
  });
});
