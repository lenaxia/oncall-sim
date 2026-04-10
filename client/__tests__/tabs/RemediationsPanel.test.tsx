import { describe, it, expect, vi } from "vitest";
import { render, screen, act, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import {
  renderWithProviders,
  buildLoadedScenario,
  buildMockGameLoop,
  buildTestSnapshot,
} from "../../src/testutil/index";
import { RemediationsPanel } from "../../src/components/tabs/RemediationsPanel";

function makeScenarioWithScale(instanceCount = 6) {
  return buildLoadedScenario({
    remediationActions: [
      {
        id: "scale_payment",
        type: "scale_cluster",
        service: "payment-service",
        isCorrectFix: false,
        label: "Scale payment-service",
      },
    ],
    hostGroups: [
      {
        id: "hg-payment",
        label: "payment-service hosts",
        service: "payment-service",
        instanceCount,
      },
    ],
  });
}

function makeScenarioWithThrottle() {
  return buildLoadedScenario({
    serviceType: "api",
    remediationActions: [
      {
        id: "throttle_payment",
        type: "throttle_traffic",
        service: "payment-service",
        isCorrectFix: false,
        label: "Throttle payment-service traffic",
        sideEffect: "Drops inbound RPS by 75%.",
      },
    ],
  });
}

function renderPanel(instanceCount = 6) {
  const mockLoop = buildMockGameLoop();
  const scenario = makeScenarioWithScale(instanceCount);
  const result = renderWithProviders(<RemediationsPanel inactive={false} />, {
    scenario,
    mockLoop,
  });
  act(() => {
    mockLoop.emit({ type: "session_snapshot", snapshot: buildTestSnapshot() });
  });
  return { ...result, mockLoop };
}

// ── ScaleSection ──────────────────────────────────────────────────────────────

describe("ScaleSection — desired hosts UI", () => {
  it('renders "Desired hosts" label (not scale up/down buttons)', () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: /scale up/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /scale down/i })).toBeNull();
    expect(screen.getByText(/desired hosts/i)).toBeInTheDocument();
  });

  it("input is initialised to current host count", () => {
    renderPanel(8);
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveValue(8);
  });

  it("Apply button is present", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /apply/i })).toBeInTheDocument();
  });

  it("Apply with higher value dispatches scale_cluster with direction=up and correct count", async () => {
    const user = userEvent.setup();
    const mockLoop = buildMockGameLoop();
    const handleAction = vi.spyOn(mockLoop, "handleAction");
    const scenario = makeScenarioWithScale(4);

    renderWithProviders(<RemediationsPanel inactive={false} />, {
      scenario,
      mockLoop,
    });
    act(() => {
      mockLoop.emit({
        type: "session_snapshot",
        snapshot: buildTestSnapshot(),
      });
    });

    const input = screen.getByRole("spinbutton");
    fireEvent.input(input, { target: { value: "10" } });

    await user.click(screen.getByRole("button", { name: /apply/i }));
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    expect(handleAction).toHaveBeenCalledWith(
      "scale_cluster",
      expect.objectContaining({
        service: "payment-service",
        direction: "up",
        count: 6,
        desiredCount: 10,
      }),
    );
  });

  it("Apply with lower value dispatches scale_cluster with direction=down and correct count", async () => {
    const user = userEvent.setup();
    const mockLoop = buildMockGameLoop();
    const handleAction = vi.spyOn(mockLoop, "handleAction");
    const scenario = makeScenarioWithScale(8);

    renderWithProviders(<RemediationsPanel inactive={false} />, {
      scenario,
      mockLoop,
    });
    act(() => {
      mockLoop.emit({
        type: "session_snapshot",
        snapshot: buildTestSnapshot(),
      });
    });

    const input = screen.getByRole("spinbutton");
    fireEvent.input(input, { target: { value: "3" } });

    await user.click(screen.getByRole("button", { name: /apply/i }));
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    expect(handleAction).toHaveBeenCalledWith(
      "scale_cluster",
      expect.objectContaining({
        service: "payment-service",
        direction: "down",
        count: 5,
        desiredCount: 3,
      }),
    );
  });

  it("Apply with same value as current — no action dispatched", async () => {
    const user = userEvent.setup();
    const mockLoop = buildMockGameLoop();
    const handleAction = vi.spyOn(mockLoop, "handleAction");
    const scenario = makeScenarioWithScale(6);

    renderWithProviders(<RemediationsPanel inactive={false} />, {
      scenario,
      mockLoop,
    });
    act(() => {
      mockLoop.emit({
        type: "session_snapshot",
        snapshot: buildTestSnapshot(),
      });
    });

    await user.click(screen.getByRole("button", { name: /apply/i }));
    expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
    expect(handleAction).not.toHaveBeenCalled();
  });

  it("input shows updated count after apply", async () => {
    const user = userEvent.setup();
    const { mockLoop } = renderPanel(4);
    const input = screen.getByRole("spinbutton");

    fireEvent.input(input, { target: { value: "9" } });
    await user.click(screen.getByRole("button", { name: /apply/i }));
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    expect(screen.getByText(/9 instances/i)).toBeInTheDocument();
  });
});

// ── ThrottleSection ───────────────────────────────────────────────────────────

describe("ThrottleSection — toggle UI", () => {
  it('shows "Apply throttle" button when throttle is OFF', () => {
    const mockLoop = buildMockGameLoop();
    renderWithProviders(<RemediationsPanel inactive={false} />, {
      scenario: makeScenarioWithThrottle(),
      mockLoop,
    });
    act(() => {
      mockLoop.emit({
        type: "session_snapshot",
        snapshot: buildTestSnapshot(),
      });
    });

    expect(
      screen.getByRole("button", { name: /apply throttle/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /remove throttle/i }),
    ).toBeNull();
  });

  it('after apply, shows "Remove throttle" button and active badge', async () => {
    const user = userEvent.setup();
    const mockLoop = buildMockGameLoop();
    renderWithProviders(<RemediationsPanel inactive={false} />, {
      scenario: makeScenarioWithThrottle(),
      mockLoop,
    });
    act(() => {
      mockLoop.emit({
        type: "session_snapshot",
        snapshot: buildTestSnapshot(),
      });
    });

    await user.click(screen.getByRole("button", { name: /apply throttle/i }));
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    expect(
      screen.getByRole("button", { name: /remove throttle/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /apply throttle/i }),
    ).toBeNull();
    expect(screen.getByText(/active/i)).toBeInTheDocument();
  });

  it("apply dispatches throttle_traffic with throttle=true", async () => {
    const user = userEvent.setup();
    const mockLoop = buildMockGameLoop();
    const handleAction = vi.spyOn(mockLoop, "handleAction");
    renderWithProviders(<RemediationsPanel inactive={false} />, {
      scenario: makeScenarioWithThrottle(),
      mockLoop,
    });
    act(() => {
      mockLoop.emit({
        type: "session_snapshot",
        snapshot: buildTestSnapshot(),
      });
    });

    await user.click(screen.getByRole("button", { name: /apply throttle/i }));
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    expect(handleAction).toHaveBeenCalledWith(
      "throttle_traffic",
      expect.objectContaining({
        remediationActionId: "throttle_payment",
        service: "payment-service",
        throttle: true,
      }),
    );
  });

  it("remove dispatches throttle_traffic with throttle=false", async () => {
    const user = userEvent.setup();
    const mockLoop = buildMockGameLoop();
    const handleAction = vi.spyOn(mockLoop, "handleAction");
    renderWithProviders(<RemediationsPanel inactive={false} />, {
      scenario: makeScenarioWithThrottle(),
      mockLoop,
    });
    act(() => {
      mockLoop.emit({
        type: "session_snapshot",
        snapshot: buildTestSnapshot(),
      });
    });

    // Apply first
    await user.click(screen.getByRole("button", { name: /apply throttle/i }));
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    // Then remove
    await user.click(screen.getByRole("button", { name: /remove throttle/i }));
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    expect(handleAction).toHaveBeenLastCalledWith(
      "throttle_traffic",
      expect.objectContaining({
        remediationActionId: "throttle_payment",
        service: "payment-service",
        throttle: false,
      }),
    );
  });

  it("label shows the action description from the scenario", () => {
    const mockLoop = buildMockGameLoop();
    renderWithProviders(<RemediationsPanel inactive={false} />, {
      scenario: makeScenarioWithThrottle(),
      mockLoop,
    });
    act(() => {
      mockLoop.emit({
        type: "session_snapshot",
        snapshot: buildTestSnapshot(),
      });
    });

    expect(
      screen.getByText(/Throttle payment-service traffic/i),
    ).toBeInTheDocument();
  });
});
