import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { CoachPanelShell } from "../../src/components/CoachPanelShell";
import {
  buildMockGameLoop,
  buildTestSnapshot,
  buildCoachMessage,
  buildLoadedScenario,
} from "../../src/testutil/index";
import { SessionProvider } from "../../src/context/SessionContext";
import { ScenarioProvider } from "../../src/context/ScenarioContext";

function renderCoach(_opts = {}) {
  const mockLoop = buildMockGameLoop();
  const scenario = buildLoadedScenario();
  const result = render(
    <ScenarioProvider scenario={scenario}>
      <SessionProvider
        scenario={scenario}
        _testGameLoop={mockLoop}
        onExpired={() => {}}
        onDebriefReady={() => {}}
        onError={() => {}}
      >
        <CoachPanelShell />
      </SessionProvider>
    </ScenarioProvider>,
  );
  return { ...result, mockLoop };
}

describe("CoachPanelShell", () => {
  describe("toggle", () => {
    it("starts collapsed", () => {
      const { queryByTestId } = renderCoach();
      expect(queryByTestId("coach-panel")).toBeNull();
    });

    it("opens when toggle button clicked", async () => {
      const user = userEvent.setup();
      const { getByLabelText, getByTestId } = renderCoach();
      await user.click(getByLabelText(/coach/i));
      expect(getByTestId("coach-panel")).toBeInTheDocument();
    });

    it("closes when toggle clicked again", async () => {
      const user = userEvent.setup();
      const { getByLabelText, queryByTestId } = renderCoach();
      await user.click(getByLabelText(/coach/i));
      await user.click(getByLabelText(/coach/i));
      expect(queryByTestId("coach-panel")).toBeNull();
    });
  });

  describe("coach messages", () => {
    it("renders coach messages from session state", () => {
      const { mockLoop, getByLabelText } = renderCoach();
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot({
            coachMessages: [
              buildCoachMessage({ text: "Check the error rate metric first." }),
            ],
          }),
        });
      });
      act(() => {
        getByLabelText(/coach/i).click();
      });
      expect(
        screen.getByText("Check the error rate metric first."),
      ).toBeInTheDocument();
    });

    it("shows unread badge dot when new message arrives and panel is closed", () => {
      const { mockLoop, container } = renderCoach();
      act(() => {
        mockLoop.emit({
          type: "session_snapshot",
          snapshot: buildTestSnapshot(),
        });
        mockLoop.emit({ type: "coach_message", message: buildCoachMessage() });
      });
      expect(container.querySelector("[data-coach-badge]")).not.toBeNull();
    });
  });
});
