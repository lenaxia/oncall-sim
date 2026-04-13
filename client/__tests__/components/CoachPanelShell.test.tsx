import { describe, it, expect, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
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

// ── Render helper ─────────────────────────────────────────────────────────────

interface RenderOptions {
  sendCoachMessage?: (text: string) => Promise<void>;
}

function renderCoach(opts: RenderOptions = {}) {
  const mockLoop = buildMockGameLoop();
  const scenario = buildLoadedScenario();
  const sendCoachMessage =
    opts.sendCoachMessage ?? vi.fn().mockResolvedValue(undefined);

  const result = render(
    <ScenarioProvider scenario={scenario}>
      <SessionProvider
        scenario={scenario}
        _testGameLoop={mockLoop}
        onExpired={() => {}}
        onDebriefReady={() => {}}
        onError={() => {}}
        _testSendCoachMessage={sendCoachMessage}
      >
        <CoachPanelShell />
      </SessionProvider>
    </ScenarioProvider>,
  );
  return { ...result, mockLoop, sendCoachMessage };
}

// ── Toggle ────────────────────────────────────────────────────────────────────

describe("CoachPanelShell — toggle", () => {
  it("starts collapsed", () => {
    const { queryByTestId } = renderCoach();
    expect(queryByTestId("coach-panel")).toBeNull();
  });

  it("opens when toggle button clicked", async () => {
    const user = userEvent.setup();
    const { getByLabelText, getByTestId } = renderCoach();
    await user.click(getByLabelText(/toggle coach panel/i));
    expect(getByTestId("coach-panel")).toBeInTheDocument();
  });

  it("closes when toggle clicked again", async () => {
    const user = userEvent.setup();
    const { getByLabelText, queryByTestId } = renderCoach();
    await user.click(getByLabelText(/toggle coach panel/i));
    await user.click(getByLabelText(/toggle coach panel/i));
    expect(queryByTestId("coach-panel")).toBeNull();
  });
});

// ── Level pill ────────────────────────────────────────────────────────────────

describe("CoachPanelShell — level pill", () => {
  it("shows 'Novice' pill by default", async () => {
    const user = userEvent.setup();
    const { getByLabelText } = renderCoach();
    await user.click(getByLabelText(/toggle coach panel/i));
    expect(screen.getByText("Novice")).toBeInTheDocument();
  });

  it("cycles to Intermediate when pill is clicked once", async () => {
    const user = userEvent.setup();
    const { getByLabelText } = renderCoach();
    await user.click(getByLabelText(/toggle coach panel/i));
    await user.click(screen.getByText("Novice"));
    expect(screen.getByText("Intermediate")).toBeInTheDocument();
  });

  it("cycles to Expert after two pill clicks", async () => {
    const user = userEvent.setup();
    const { getByLabelText } = renderCoach();
    await user.click(getByLabelText(/toggle coach panel/i));
    await user.click(screen.getByText("Novice"));
    await user.click(screen.getByText("Intermediate"));
    expect(screen.getByText("Expert")).toBeInTheDocument();
  });

  it("wraps back to Novice after three pill clicks", async () => {
    const user = userEvent.setup();
    const { getByLabelText } = renderCoach();
    await user.click(getByLabelText(/toggle coach panel/i));
    await user.click(screen.getByText("Novice"));
    await user.click(screen.getByText("Intermediate"));
    await user.click(screen.getByText("Expert"));
    expect(screen.getByText("Novice")).toBeInTheDocument();
  });
});

// ── Welcome message ───────────────────────────────────────────────────────────

describe("CoachPanelShell — welcome message", () => {
  it("shows a welcome message when the panel opens", async () => {
    const user = userEvent.setup();
    const { getByLabelText } = renderCoach();
    await user.click(getByLabelText(/toggle coach panel/i));
    // The welcome message mentions coaching
    expect(screen.getByText(/I'm your coach/i)).toBeInTheDocument();
  });

  it("welcome message changes when level pill is clicked", async () => {
    const user = userEvent.setup();
    const { getByLabelText } = renderCoach();
    await user.click(getByLabelText(/toggle coach panel/i));
    // Novice welcome mentions proactive hints
    expect(screen.getByText(/proactive hints/i)).toBeInTheDocument();
    // Switch to Expert
    await user.click(screen.getByText("Novice"));
    await user.click(screen.getByText("Intermediate"));
    // Expert welcome says it won't interrupt
    expect(screen.getByText(/won't interrupt/i)).toBeInTheDocument();
  });
});

// ── Message rendering ─────────────────────────────────────────────────────────

describe("CoachPanelShell — message rendering", () => {
  it("renders proactive coach messages from session state", async () => {
    const user = userEvent.setup();
    const { mockLoop, getByLabelText } = renderCoach();
    act(() => {
      mockLoop.emit({
        type: "session_snapshot",
        snapshot: buildTestSnapshot({
          coachMessages: [
            buildCoachMessage({
              text: "Check the error rate metric first.",
              proactive: true,
            }),
          ],
        }),
      });
    });
    await user.click(getByLabelText(/toggle coach panel/i));
    expect(
      screen.getByText("Check the error rate metric first."),
    ).toBeInTheDocument();
  });

  it("renders trainee messages (id prefixed with 'trainee:') with testid", async () => {
    const user = userEvent.setup();
    const { mockLoop, getByLabelText } = renderCoach();
    act(() => {
      mockLoop.emit({
        type: "session_snapshot",
        snapshot: buildTestSnapshot({
          coachMessages: [
            buildCoachMessage({
              id: "trainee:abc-123",
              text: "What should I look for?",
              proactive: false,
            }),
          ],
        }),
      });
    });
    await user.click(getByLabelText(/toggle coach panel/i));
    expect(screen.getByText("What should I look for?")).toBeInTheDocument();
    expect(screen.getByTestId("coach-msg-trainee:abc-123")).toBeInTheDocument();
  });

  it("renders coach reply messages", async () => {
    const user = userEvent.setup();
    const { mockLoop, getByLabelText } = renderCoach();
    act(() => {
      mockLoop.emit({
        type: "session_snapshot",
        snapshot: buildTestSnapshot({
          coachMessages: [
            buildCoachMessage({
              id: "coach-reply-1",
              text: "Look at the deployment timestamps.",
              proactive: false,
            }),
          ],
        }),
      });
    });
    await user.click(getByLabelText(/toggle coach panel/i));
    expect(
      screen.getByText("Look at the deployment timestamps."),
    ).toBeInTheDocument();
  });
});

// ── Unread badge ──────────────────────────────────────────────────────────────

describe("CoachPanelShell — unread badge", () => {
  it("shows unread badge dot when a proactive message arrives and panel is closed", () => {
    const { mockLoop, container } = renderCoach();
    act(() => {
      mockLoop.emit({
        type: "session_snapshot",
        snapshot: buildTestSnapshot(),
      });
      mockLoop.emit({
        type: "coach_message",
        message: buildCoachMessage({ proactive: true }),
      });
    });
    expect(container.querySelector("[data-coach-badge]")).not.toBeNull();
  });

  it("clears badge when panel is opened", async () => {
    const user = userEvent.setup();
    const { mockLoop, container, getByLabelText } = renderCoach();
    act(() => {
      mockLoop.emit({
        type: "coach_message",
        message: buildCoachMessage({ proactive: true }),
      });
    });
    await user.click(getByLabelText(/toggle coach panel/i));
    expect(container.querySelector("[data-coach-badge]")).toBeNull();
  });
});

// ── Send input ────────────────────────────────────────────────────────────────

describe("CoachPanelShell — send input", () => {
  it("renders the ask input and send button when panel is open", async () => {
    const user = userEvent.setup();
    const { getByLabelText } = renderCoach();
    await user.click(getByLabelText(/toggle coach panel/i));
    expect(screen.getByPlaceholderText(/ask the coach/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
  });

  it("send button is disabled when input is empty", async () => {
    const user = userEvent.setup();
    const { getByLabelText } = renderCoach();
    await user.click(getByLabelText(/toggle coach panel/i));
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("send button is enabled when input has text", async () => {
    const user = userEvent.setup();
    const { getByLabelText } = renderCoach();
    await user.click(getByLabelText(/toggle coach panel/i));
    await user.type(
      screen.getByPlaceholderText(/ask the coach/i),
      "What should I do?",
    );
    expect(screen.getByRole("button", { name: /send/i })).not.toBeDisabled();
  });

  it("clicking send calls sendCoachMessage with input text", async () => {
    const user = userEvent.setup();
    const sendCoachMessage = vi.fn().mockResolvedValue(undefined);
    const { getByLabelText } = renderCoach({ sendCoachMessage });
    await user.click(getByLabelText(/toggle coach panel/i));
    await user.type(
      screen.getByPlaceholderText(/ask the coach/i),
      "How do I fix this?",
    );
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(sendCoachMessage).toHaveBeenCalledWith("How do I fix this?");
  });

  it("pressing Enter sends the message", async () => {
    const user = userEvent.setup();
    const sendCoachMessage = vi.fn().mockResolvedValue(undefined);
    const { getByLabelText } = renderCoach({ sendCoachMessage });
    await user.click(getByLabelText(/toggle coach panel/i));
    await user.type(
      screen.getByPlaceholderText(/ask the coach/i),
      "Hint please{Enter}",
    );
    expect(sendCoachMessage).toHaveBeenCalledWith("Hint please");
  });

  it("clears input after send", async () => {
    const user = userEvent.setup();
    const { getByLabelText } = renderCoach();
    await user.click(getByLabelText(/toggle coach panel/i));
    const input = screen.getByPlaceholderText(/ask the coach/i);
    await user.type(input, "A question");
    await user.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
  });

  it("disables input and send while waiting for response", async () => {
    const user = userEvent.setup();
    let resolveResponse!: () => void;
    const sendCoachMessage = vi.fn().mockReturnValue(
      new Promise<void>((res) => {
        resolveResponse = res;
      }),
    );
    const { getByLabelText } = renderCoach({ sendCoachMessage });
    await user.click(getByLabelText(/toggle coach panel/i));
    await user.type(screen.getByPlaceholderText(/ask the coach/i), "Question");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(screen.getByPlaceholderText(/ask the coach/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
    act(() => resolveResponse());
  });
});
