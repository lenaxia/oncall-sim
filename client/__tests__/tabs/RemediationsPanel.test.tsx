import { describe, it, expect, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
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
    const scenario = makeScenarioWithScale(4); // current = 4

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
    fireEvent.input(input, { target: { value: "10" } }); // desired = 10, delta = +6

    await user.click(screen.getByRole("button", { name: /apply/i }));
    // Confirm modal
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
    const scenario = makeScenarioWithScale(8); // current = 8

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
    fireEvent.input(input, { target: { value: "3" } }); // desired = 3, delta = -5

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

    // Input already = 6, click Apply
    await user.click(screen.getByRole("button", { name: /apply/i }));
    // No confirm modal should appear — no change
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

    // After apply the displayed count label should reflect the new value
    expect(screen.getByText(/9 instances/i)).toBeInTheDocument();
  });
});
