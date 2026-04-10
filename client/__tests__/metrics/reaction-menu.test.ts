/**
 * Tests for Step 5: reaction menu + select_metric_reaction tool
 *
 * Tests buildReactionMenu() from metrics/reaction-menu.ts and the updated
 * metric-reaction-engine behavior with select_metric_reaction.
 */

import { describe, it, expect, vi } from "vitest";
import { buildReactionMenu } from "../../src/metrics/reaction-menu";
import type { AuditEntry } from "@shared/types/events";
import type { LoadedScenario } from "../../src/scenario/types";
import { buildLoadedScenario } from "../../src/testutil/index";
import { generateAllMetrics } from "../../src/metrics/generator";
import { createMetricStore } from "../../src/metrics/metric-store";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeScenario(overrides: Partial<LoadedScenario> = {}): LoadedScenario {
  return buildLoadedScenario(overrides);
}

function makeAuditEntry(action: string): AuditEntry {
  return {
    action: action as AuditEntry["action"],
    params: {},
    simTime: 60,
  };
}

// ── buildReactionMenu — invariants ────────────────────────────────────────────

describe("buildReactionMenu — always returns 4 reactions", () => {
  it("always returns exactly 4 reactions", () => {
    const scenario = makeScenario();
    const { series, resolvedParams } = generateAllMetrics(scenario, "s");
    const store = createMetricStore(series, resolvedParams);
    const entry = makeAuditEntry("trigger_rollback");

    const menu = buildReactionMenu(entry, scenario, store, 60);
    expect(menu.reactions).toHaveLength(4);
  });

  it("reactions have ids: full_recovery, partial_recovery, worsening, no_effect", () => {
    const scenario = makeScenario();
    const { series, resolvedParams } = generateAllMetrics(scenario, "s");
    const store = createMetricStore(series, resolvedParams);
    const entry = makeAuditEntry("trigger_rollback");

    const menu = buildReactionMenu(entry, scenario, store, 60);
    const ids = menu.reactions.map((r) => r.id);
    expect(ids).toContain("full_recovery");
    expect(ids).toContain("partial_recovery");
    expect(ids).toContain("worsening");
    expect(ids).toContain("no_effect");
  });

  it("no_effect always has overlays: []", () => {
    const scenario = makeScenario();
    const { series, resolvedParams } = generateAllMetrics(scenario, "s");
    const store = createMetricStore(series, resolvedParams);
    const entry = makeAuditEntry("trigger_rollback");

    const menu = buildReactionMenu(entry, scenario, store, 60);
    const noEffect = menu.reactions.find((r) => r.id === "no_effect")!;
    expect(noEffect.overlays).toHaveLength(0);
  });

  it("actionType is set to the entry's action", () => {
    const scenario = makeScenario();
    const { series, resolvedParams } = generateAllMetrics(scenario, "s");
    const store = createMetricStore(series, resolvedParams);
    const entry = makeAuditEntry("trigger_rollback");

    const menu = buildReactionMenu(entry, scenario, store, 60);
    expect(menu.actionType).toBe("trigger_rollback");
  });
});

describe("buildReactionMenu — when no incidents are active", () => {
  it("all four reactions have overlays: [] when no incident overlays exist", () => {
    // buildLoadedScenario opsDashboard has an incidentType but incidentResponses=[].
    // After the resolver change, overlayApplications comes from incidentResponses.
    // Use a scenario with no component incidents → all overlayApplications are empty.
    const scenario = makeScenario();
    // Force all resolvedParams to have empty overlayApplications
    const { series, resolvedParams } = generateAllMetrics(scenario, "s");
    // Clear all overlay applications
    for (const svcParams of Object.values(resolvedParams)) {
      for (const rp of Object.values(svcParams)) {
        rp.overlayApplications = [];
      }
    }
    const store = createMetricStore(series, resolvedParams);
    const entry = makeAuditEntry("trigger_rollback");

    const menu = buildReactionMenu(entry, scenario, store, 60);
    // All reactions should have empty overlays
    for (const r of menu.reactions) {
      expect(r.overlays).toHaveLength(0);
    }
  });
});

describe("buildReactionMenu — with active incidents", () => {
  it("full_recovery, partial_recovery, worsening have non-empty overlays when incidents exist", () => {
    const scenario = makeScenario();
    // Inject an active incident overlay into the store
    const { series, resolvedParams } = generateAllMetrics(scenario, "s");
    // Set up error_rate to have an active overlay application
    const errRp = resolvedParams["fixture-service"]?.["error_rate"];
    if (errRp) {
      errRp.overlayApplications = [
        {
          overlay: "spike_and_sustain",
          onsetSecond: 0,
          peakValue: errRp.baselineValue * 10,
          dropFactor: 10,
          ceiling: errRp.baselineValue * 10,
          rampDurationSeconds: 0,
          saturationDurationSeconds: 60,
        },
      ];
    }
    const store = createMetricStore(series, resolvedParams);
    const entry = makeAuditEntry("trigger_rollback");

    const menu = buildReactionMenu(entry, scenario, store, 60);
    const active = menu.reactions.filter((r) => r.id !== "no_effect");
    // At least one should have overlays when an incident is active
    const anyHasOverlay = active.some((r) => r.overlays.length > 0);
    expect(anyHasOverlay).toBe(true);
  });
});

// ── select_metric_reaction tool definition ────────────────────────────────────

describe("getMetricReactionTools — select_metric_reaction", () => {
  it("returns select_metric_reaction when enabled in scenario", async () => {
    const { getMetricReactionTools } =
      await import("../../src/llm/tool-definitions");
    const scenario = makeScenario({
      engine: {
        tickIntervalSeconds: 15,
        defaultTab: "email",
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
    });
    const tools = getMetricReactionTools(scenario);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("select_metric_reaction");
  });

  it("returns [] when select_metric_reaction is not in llmEventTools", async () => {
    const { getMetricReactionTools } =
      await import("../../src/llm/tool-definitions");
    const scenario = makeScenario({
      engine: {
        tickIntervalSeconds: 15,
        defaultTab: "email",
        llmEventTools: [
          {
            tool: "fire_alarm",
            max_calls: 1,
          } as import("../../src/scenario/types").LLMEventToolConfig,
        ],
      },
    });
    const tools = getMetricReactionTools(scenario);
    expect(tools).toHaveLength(0);
  });

  it("reaction_id enum has all four values", async () => {
    const { getMetricReactionTools } =
      await import("../../src/llm/tool-definitions");
    const scenario = makeScenario({
      engine: {
        tickIntervalSeconds: 15,
        defaultTab: "email",
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
    });
    const tools = getMetricReactionTools(scenario);
    const params = tools[0].parameters as {
      properties: { reaction_id: { enum: string[] } };
    };
    expect(params.properties.reaction_id.enum).toContain("full_recovery");
    expect(params.properties.reaction_id.enum).toContain("partial_recovery");
    expect(params.properties.reaction_id.enum).toContain("worsening");
    expect(params.properties.reaction_id.enum).toContain("no_effect");
  });
});

// ── metric-reaction-engine — select_metric_reaction ──────────────────────────

describe("metric-reaction-engine — select_metric_reaction", () => {
  it("LLM is not called when all non-no_effect reactions have empty overlays", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const scenario = makeScenario({
      engine: {
        tickIntervalSeconds: 15,
        defaultTab: "email",
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
    });
    const { series, resolvedParams } = generateAllMetrics(scenario, "s");
    // Empty all overlays
    for (const svcParams of Object.values(resolvedParams)) {
      for (const rp of Object.values(svcParams)) {
        rp.overlayApplications = [];
      }
    }
    const store = createMetricStore(series, resolvedParams);
    const mockLLM = { call: vi.fn() };

    const engine = createMetricReactionEngine(
      () => mockLLM,
      scenario,
      store,
      () => 60,
    );
    await engine.react({
      sessionId: "s",
      scenario,
      simTime: 60,
      auditLog: [makeAuditEntry("trigger_rollback")],
      simState: {
        emails: [],
        chatChannels: {},
        tickets: [],
        ticketComments: {},
        logs: [],
        alarms: [],
        deployments: {},
        pipelines: [],
        pages: [],
        throttles: [],
      },
      personaCooldowns: {},
      directlyAddressed: new Set(),
      metricSummary: { simTime: 60, narratives: [] },
      triggeredByAction: true,
    });
    // LLM should not be called — no-op menu
    expect(mockLLM.call).not.toHaveBeenCalled();
  });

  it("_applySelectedReaction applies overlay specs from the selected reaction", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const scenario = makeScenario({
      engine: {
        tickIntervalSeconds: 15,
        defaultTab: "email",
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
    });
    const { series, resolvedParams } = generateAllMetrics(scenario, "s");
    const errRp = resolvedParams["fixture-service"]?.["error_rate"];
    if (errRp) {
      errRp.overlayApplications = [
        {
          overlay: "spike_and_sustain",
          onsetSecond: 0,
          peakValue: errRp.baselineValue * 10,
          dropFactor: 10,
          ceiling: errRp.baselineValue * 10,
          rampDurationSeconds: 0,
          saturationDurationSeconds: 60,
        },
      ];
    }
    const store = createMetricStore(series, resolvedParams);
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const mockLLM = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: { reaction_id: "full_recovery" },
          },
        ],
      }),
    };

    const engine = createMetricReactionEngine(
      () => mockLLM,
      scenario,
      store,
      () => 60,
    );
    await engine.react({
      sessionId: "s",
      scenario,
      simTime: 60,
      auditLog: [makeAuditEntry("trigger_rollback")],
      simState: {
        emails: [],
        chatChannels: {},
        tickets: [],
        ticketComments: {},
        logs: [],
        alarms: [],
        deployments: {},
        pipelines: [],
        pages: [],
        throttles: [],
      },
      personaCooldowns: {},
      directlyAddressed: new Set(),
      metricSummary: { simTime: 60, narratives: [] },
      triggeredByAction: true,
    });

    // applyActiveOverlay should have been called for each overlay spec in full_recovery
    expect(applySpy).toHaveBeenCalled();
  });

  it("unknown reaction_id is a no-op (does not throw)", async () => {
    const { createMetricReactionEngine } =
      await import("../../src/engine/metric-reaction-engine");
    const scenario = makeScenario({
      engine: {
        tickIntervalSeconds: 15,
        defaultTab: "email",
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
    });
    const { series, resolvedParams } = generateAllMetrics(scenario, "s");
    const errRp = resolvedParams["fixture-service"]?.["error_rate"];
    if (errRp) {
      errRp.overlayApplications = [
        {
          overlay: "spike_and_sustain",
          onsetSecond: 0,
          peakValue: 10,
          dropFactor: 10,
          ceiling: 10,
          rampDurationSeconds: 0,
          saturationDurationSeconds: 60,
        },
      ];
    }
    const store = createMetricStore(series, resolvedParams);
    const applySpy = vi.spyOn(store, "applyActiveOverlay");

    const mockLLM = {
      call: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            tool: "select_metric_reaction",
            params: { reaction_id: "invalid_reaction_id" },
          },
        ],
      }),
    };

    const engine = createMetricReactionEngine(
      () => mockLLM,
      scenario,
      store,
      () => 60,
    );
    await expect(
      engine.react({
        sessionId: "s",
        scenario,
        simTime: 60,
        auditLog: [makeAuditEntry("trigger_rollback")],
        simState: {
          emails: [],
          chatChannels: {},
          tickets: [],
          ticketComments: {},
          logs: [],
          alarms: [],
          deployments: {},
          pipelines: [],
          pages: [],
          throttles: [],
        },
        personaCooldowns: {},
        directlyAddressed: new Set(),
        metricSummary: { simTime: 60, narratives: [] },
        triggeredByAction: true,
      }),
    ).resolves.not.toThrow();

    // No overlay applied for unknown reaction
    expect(applySpy).not.toHaveBeenCalled();
  });
});
