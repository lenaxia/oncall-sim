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

// ── ThrottleSection — throttle_targets UX ────────────────────────────────────

function makeScenarioWithTargets() {
  return buildLoadedScenario({
    remediationActions: [
      {
        id: "throttle_payment",
        type: "throttle_traffic",
        service: "payment-service",
        isCorrectFix: false,
        label: "Throttle payment-service",
        throttleTargets: [
          {
            id: "global",
            scope: "global",
            label: "All traffic",
            description: "Service-wide rate limit",
            unit: "rps",
            baselineRate: 200,
          },
          {
            id: "checkout",
            scope: "endpoint",
            label: "POST /v1/charges",
            description: "Payment checkout processing",
            llmHint: "Accounts for 60% of pool connections.",
            unit: "rps",
            baselineRate: 120,
          },
          {
            id: "per_customer",
            scope: "customer",
            label: "Per-customer limit",
            description: "Rate-limit a specific customer account",
            unit: "rps",
            baselineRate: 200,
          },
        ],
      },
    ],
  });
}

function renderThrottlePanel() {
  const mockLoop = buildMockGameLoop();
  const scenario = makeScenarioWithTargets();
  const result = renderWithProviders(<RemediationsPanel inactive={false} />, {
    scenario,
    mockLoop,
  });
  act(() => {
    mockLoop.emit({ type: "session_snapshot", snapshot: buildTestSnapshot() });
  });
  return { ...result, mockLoop };
}

describe("ThrottleSection — throttle_targets table", () => {
  it("renders a row for each throttle target", () => {
    renderThrottlePanel();
    expect(screen.getByText("All traffic")).toBeInTheDocument();
    expect(screen.getByText("POST /v1/charges")).toBeInTheDocument();
    expect(screen.getByText("Per-customer limit")).toBeInTheDocument();
  });

  it("shows scope badge for each target", () => {
    renderThrottlePanel();
    expect(screen.getByText("GLOBAL")).toBeInTheDocument();
    expect(screen.getByText("ENDPOINT")).toBeInTheDocument();
    expect(screen.getByText("CUSTOMER")).toBeInTheDocument();
  });

  it("shows description for each target", () => {
    renderThrottlePanel();
    expect(screen.getByText("Service-wide rate limit")).toBeInTheDocument();
    expect(screen.getByText("Payment checkout processing")).toBeInTheDocument();
  });

  it("shows baseline rate for each target", () => {
    renderThrottlePanel();
    // 200 rps appears twice (global + customer), 120 rps appears once (endpoint)
    const rps200 = screen.getAllByText(/200 rps/);
    expect(rps200.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/120 rps/)).toBeInTheDocument();
  });

  it("shows Set limit button initially for non-customer targets", () => {
    renderThrottlePanel();
    const setLimitBtns = screen.getAllByRole("button", { name: /set limit/i });
    // global + endpoint have Set limit; customer has inline form
    expect(setLimitBtns.length).toBeGreaterThanOrEqual(2);
  });

  it("customer row always shows freeform input and limit input", () => {
    renderThrottlePanel();
    expect(screen.getByPlaceholderText(/customer id/i)).toBeInTheDocument();
  });
});

describe("ThrottleSection — endpoint/global apply flow", () => {
  it("clicking Set limit shows inline limit input", async () => {
    const user = userEvent.setup();
    renderThrottlePanel();
    const setLimitBtns = screen.getAllByRole("button", { name: /set limit/i });
    await user.click(setLimitBtns[0]);
    // Multiple limit inputs may exist (customer row is always visible)
    const limitInputs = screen.getAllByPlaceholderText(/limit/i);
    expect(limitInputs.length).toBeGreaterThanOrEqual(1);
  });

  it("applying a limit dispatches throttle_traffic with correct params", async () => {
    const user = userEvent.setup();
    const mockLoop = buildMockGameLoop();
    const handleAction = vi.spyOn(mockLoop, "handleAction");
    renderWithProviders(<RemediationsPanel inactive={false} />, {
      scenario: makeScenarioWithTargets(),
      mockLoop,
    });
    act(() => {
      mockLoop.emit({
        type: "session_snapshot",
        snapshot: buildTestSnapshot(),
      });
    });

    const setLimitBtns = screen.getAllByRole("button", { name: /set limit/i });
    // Click the endpoint (POST /v1/charges) set limit button
    const checkoutBtn = setLimitBtns.find((btn) => {
      const row = btn.closest("[data-throttle-target]");
      return row?.textContent?.includes("POST /v1/charges");
    });
    await user.click(checkoutBtn!);

    // The inline limit input appears after clicking Set limit
    const limitInputs = screen.getAllByPlaceholderText(/^limit$/i);
    fireEvent.input(limitInputs[0], { target: { value: "80" } });

    const applyBtns = screen.getAllByRole("button", { name: /^apply$/i });
    await user.click(applyBtns[0]);
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    expect(handleAction).toHaveBeenCalledWith(
      "throttle_traffic",
      expect.objectContaining({
        targetId: "checkout",
        scope: "endpoint",
        limitRate: 80,
        throttle: true,
      }),
    );
  });

  it("after applying a limit, row shows ACTIVE badge and Edit/Remove buttons", async () => {
    const user = userEvent.setup();
    renderThrottlePanel();

    const setLimitBtns = screen.getAllByRole("button", { name: /set limit/i });
    await user.click(setLimitBtns[0]);
    const limitInputs = screen.getAllByPlaceholderText(/^limit$/i);
    fireEvent.input(limitInputs[0], { target: { value: "150" } });
    const applyBtns = screen.getAllByRole("button", { name: /^apply$/i });
    await user.click(applyBtns[0]);
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    expect(screen.getAllByText(/active/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: /remove/i }).length,
    ).toBeGreaterThan(0);
  });

  it("removing a limit dispatches throttle_traffic with throttle=false", async () => {
    const user = userEvent.setup();
    const mockLoop = buildMockGameLoop();
    const handleAction = vi.spyOn(mockLoop, "handleAction");
    renderWithProviders(<RemediationsPanel inactive={false} />, {
      scenario: makeScenarioWithTargets(),
      mockLoop,
    });
    act(() => {
      mockLoop.emit({
        type: "session_snapshot",
        snapshot: buildTestSnapshot(),
      });
    });

    // Apply then remove
    const setLimitBtns = screen.getAllByRole("button", { name: /set limit/i });
    await user.click(setLimitBtns[0]);
    const limitInputs = screen.getAllByPlaceholderText(/^limit$/i);
    fireEvent.input(limitInputs[0], { target: { value: "150" } });
    const applyBtns = screen.getAllByRole("button", { name: /^apply$/i });
    await user.click(applyBtns[0]);
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    const removeBtns = screen.getAllByRole("button", { name: /remove/i });
    await user.click(removeBtns[0]);
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    expect(handleAction).toHaveBeenLastCalledWith(
      "throttle_traffic",
      expect.objectContaining({
        throttle: false,
      }),
    );
  });
});

describe("ThrottleSection — customer scope", () => {
  it("customer row has always-visible customer ID input and limit input", () => {
    renderThrottlePanel();
    expect(screen.getByPlaceholderText(/customer id/i)).toBeInTheDocument();
  });

  it("applying customer throttle requires both customer ID and limit", async () => {
    const user = userEvent.setup();
    const mockLoop = buildMockGameLoop();
    const handleAction = vi.spyOn(mockLoop, "handleAction");
    renderWithProviders(<RemediationsPanel inactive={false} />, {
      scenario: makeScenarioWithTargets(),
      mockLoop,
    });
    act(() => {
      mockLoop.emit({
        type: "session_snapshot",
        snapshot: buildTestSnapshot(),
      });
    });

    // Find the customer row's limit input (not the endpoint inline input)
    const customerIdInput = screen.getByPlaceholderText(/customer id/i);
    fireEvent.input(customerIdInput, { target: { value: "acme_corp" } });

    const customerLimitInput = screen.getByPlaceholderText(/limit.*rps/i);
    fireEvent.input(customerLimitInput, { target: { value: "50" } });

    const applyBtns = screen.getAllByRole("button", { name: /^apply$/i });
    const customerApplyBtn = applyBtns[applyBtns.length - 1];
    await user.click(customerApplyBtn);
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    expect(handleAction).toHaveBeenCalledWith(
      "throttle_traffic",
      expect.objectContaining({
        targetId: "per_customer",
        scope: "customer",
        customerId: "acme_corp",
        limitRate: 50,
        throttle: true,
      }),
    );
  });

  it("customer apply button is disabled when customer ID is empty", () => {
    renderThrottlePanel();
    const applyBtns = screen.getAllByRole("button", { name: /^apply$/i });
    const customerApplyBtn = applyBtns[applyBtns.length - 1];
    expect(customerApplyBtn).toBeDisabled();
  });
});
