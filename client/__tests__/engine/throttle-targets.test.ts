// throttle-targets.test.ts — TDD tests for the full throttle targets feature.
// These cover: schema validation, loader transform, prompt context, and UI behaviour.
// All tests fail until implementation is complete.

import { describe, it, expect, vi } from "vitest";
import yaml from "js-yaml";
import { ScenarioSchema } from "../../src/scenario/schema";
import {
  loadScenarioFromText,
  isScenarioLoadError,
} from "../../src/scenario/loader";
import { createMetricReactionEngine } from "../../src/engine/metric-reaction-engine";
import { createSimStateStore } from "../../src/engine/sim-state-store";
import { createMetricStore } from "../../src/metrics/metric-store";
import type { LLMClient, LLMMessage } from "../../src/llm/llm-client";
import type { StakeholderContext } from "../../src/engine/game-loop";
import type { LoadedScenario } from "../../src/scenario/types";

const noopResolve = (_: string): Promise<string> =>
  Promise.reject(new Error("not found"));

// ── Schema validation ─────────────────────────────────────────────────────────

describe("ThrottleTarget schema validation", () => {
  function makeRawWithThrottle(throttleTargets: unknown[]) {
    return {
      id: "t",
      type: "throttle_traffic",
      service: "svc",
      is_correct_fix: false,
      throttle_targets: throttleTargets,
    };
  }

  it("parses a valid endpoint throttle target", () => {
    const raw = makeRawWithThrottle([
      {
        id: "checkout",
        scope: "endpoint",
        label: "POST /v1/charges",
        description: "Payment checkout endpoint",
        unit: "rps",
        baseline_rate: 120,
      },
    ]);
    const parsed =
      ScenarioSchema.shape.remediation_actions.element.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const targets = parsed.data.throttle_targets ?? [];
      expect(targets.length).toBe(1);
      expect(targets[0].scope).toBe("endpoint");
      expect(targets[0].unit).toBe("rps");
      expect(targets[0].baseline_rate).toBe(120);
    }
  });

  it("parses a customer throttle target (no selectable list — freeform)", () => {
    const raw = makeRawWithThrottle([
      {
        id: "per_customer",
        scope: "customer",
        label: "Per-customer limit",
        description: "Rate-limit a specific customer account",
        unit: "rps",
        baseline_rate: 200,
      },
    ]);
    const parsed =
      ScenarioSchema.shape.remediation_actions.element.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const target = (parsed.data.throttle_targets ?? [])[0];
      expect(target.scope).toBe("customer");
    }
  });

  it("parses a consumer throttle target with msg_per_sec unit", () => {
    const raw = makeRawWithThrottle([
      {
        id: "main_consumer",
        scope: "consumer",
        label: "payment-processor consumer group",
        description: "Main Kafka consumer group",
        unit: "msg_per_sec",
        baseline_rate: 500,
      },
    ]);
    const parsed =
      ScenarioSchema.shape.remediation_actions.element.safeParse(raw);
    expect(parsed.success).toBe(true);
  });

  it("parses a concurrent throttle target", () => {
    const raw = makeRawWithThrottle([
      {
        id: "lambda_concurrency",
        scope: "concurrent",
        label: "process-payment Lambda",
        description: "Async payment processing function",
        unit: "concurrent",
        baseline_rate: 200,
      },
    ]);
    const parsed =
      ScenarioSchema.shape.remediation_actions.element.safeParse(raw);
    expect(parsed.success).toBe(true);
  });

  it("parses a global throttle target", () => {
    const raw = makeRawWithThrottle([
      {
        id: "global",
        scope: "global",
        label: "All traffic",
        description: "Service-wide rate limit",
        unit: "rps",
        baseline_rate: 200,
      },
    ]);
    const parsed =
      ScenarioSchema.shape.remediation_actions.element.safeParse(raw);
    expect(parsed.success).toBe(true);
  });

  it("llm_hint is optional and parsed when present", () => {
    const raw = makeRawWithThrottle([
      {
        id: "checkout",
        scope: "endpoint",
        label: "POST /v1/charges",
        description: "Payment checkout",
        llm_hint: "Accounts for 60% of pool connections.",
        unit: "rps",
        baseline_rate: 120,
      },
    ]);
    const parsed =
      ScenarioSchema.shape.remediation_actions.element.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data.throttle_targets ?? [])[0].llm_hint).toBe(
        "Accounts for 60% of pool connections.",
      );
    }
  });

  it("invalid scope is rejected", () => {
    const raw = makeRawWithThrottle([
      {
        id: "bad",
        scope: "invalid_scope",
        label: "Bad",
        description: "Bad",
        unit: "rps",
        baseline_rate: 100,
      },
    ]);
    const parsed =
      ScenarioSchema.shape.remediation_actions.element.safeParse(raw);
    expect(parsed.success).toBe(false);
  });

  it("throttle_targets absent on non-throttle action is valid", () => {
    const raw = {
      id: "deploy",
      type: "emergency_deploy",
      service: "svc",
      is_correct_fix: true,
      target_version: "v1.2.3",
    };
    const parsed =
      ScenarioSchema.shape.remediation_actions.element.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.throttle_targets).toBeUndefined();
    }
  });
});

// ── Loader transform ──────────────────────────────────────────────────────────

describe("loader — throttle_targets transform", () => {
  async function loadWithThrottleTargets() {
    const base = yaml.load(`
id: test-scenario
title: Test
description: Test scenario
difficulty: easy
tags: []
timeline:
  default_speed: 1
  duration_minutes: 15
topology:
  focal_service:
    name: svc
    description: Test service
    typical_rps: 200
    components:
      - id: alb
        type: load_balancer
        label: ALB
        inputs: []
    incidents: []
  upstream: []
  downstream: []
engine:
  default_tab: wiki
email: []
chat:
  channels:
    - id: "#incidents"
      name: "#incidents"
ticketing: []
alarms: []
wiki:
  pages:
    - title: Architecture
      content: "# Arch"
cicd: {}
personas:
  - id: persona-1
    display_name: Test Persona
    job_title: SRE
    team: Platform
    initiates_contact: false
    cooldown_seconds: 30
    silent_until_contacted: false
    system_prompt: You are a test persona.
remediation_actions:
  - id: throttle_svc
    type: throttle_traffic
    service: svc
    is_correct_fix: false
    label: Throttle svc
    throttle_targets:
      - id: checkout
        scope: endpoint
        label: "POST /v1/charges"
        description: Payment checkout
        llm_hint: "Accounts for 60% of pool connections."
        unit: rps
        baseline_rate: 120
      - id: per_customer
        scope: customer
        label: Per-customer limit
        description: Rate-limit a specific customer
        unit: rps
        baseline_rate: 200
feature_flags: []
host_groups: []
evaluation:
  root_cause: test
  relevant_actions: []
  red_herrings: []
  debrief_context: test
`) as string;

    return loadScenarioFromText(
      yaml.dump(base as unknown as Record<string, unknown>),
      noopResolve,
    );
  }

  it("throttle_targets are present on loaded RemediationActionConfig", async () => {
    const result = await loadWithThrottleTargets();
    expect(isScenarioLoadError(result)).toBe(false);
    if (!isScenarioLoadError(result)) {
      const ra = result.remediationActions.find((r) => r.id === "throttle_svc");
      expect(ra).toBeDefined();
      expect(ra!.throttleTargets).toBeDefined();
      expect(ra!.throttleTargets!.length).toBe(2);
    }
  });

  it("throttle target fields are camelCased correctly", async () => {
    const result = await loadWithThrottleTargets();
    if (!isScenarioLoadError(result)) {
      const ra = result.remediationActions.find(
        (r) => r.id === "throttle_svc",
      )!;
      const t = ra.throttleTargets![0];
      expect(t.id).toBe("checkout");
      expect(t.scope).toBe("endpoint");
      expect(t.label).toBe("POST /v1/charges");
      expect(t.description).toBe("Payment checkout");
      expect(t.llmHint).toBe("Accounts for 60% of pool connections.");
      expect(t.unit).toBe("rps");
      expect(t.baselineRate).toBe(120);
    }
  });

  it("customer scope target has no selectableTargets field", async () => {
    const result = await loadWithThrottleTargets();
    if (!isScenarioLoadError(result)) {
      const ra = result.remediationActions.find(
        (r) => r.id === "throttle_svc",
      )!;
      const customerTarget = ra.throttleTargets!.find(
        (t) => t.scope === "customer",
      );
      expect(customerTarget).toBeDefined();
      // customer scope has no nested list — freeform input in UI
      expect(
        (customerTarget as unknown as Record<string, unknown>)[
          "selectableTargets"
        ],
      ).toBeUndefined();
    }
  });
});

// ── Prompt context ────────────────────────────────────────────────────────────

describe("metric-reaction-engine prompt — throttle context", () => {
  function makeScenarioWithThrottleTargets(): LoadedScenario {
    return {
      id: "test",
      title: "Test",
      description: "",
      difficulty: "easy",
      tags: [],
      timeline: {
        defaultSpeed: 1,
        durationMinutes: 15,
        preIncidentSeconds: 300,
      },
      topology: {
        focalService: {
          name: "svc",
          description: "test",
          components: [],
          incidents: [],
        },
        upstream: [],
        downstream: [],
      },
      engine: {
        defaultTab: "email",
        llmEventTools: [{ tool: "select_metric_reaction", enabled: true }],
      },
      personas: [],
      emails: [],
      chat: { channels: [], messages: [] },
      tickets: [],
      opsDashboard: {
        preIncidentSeconds: 300,
        focalService: {
          name: "svc",
          scale: { typicalRps: 200 },
          trafficProfile: "always_on_api",
          health: "healthy",
          incidentType: "connection_pool_exhaustion",
          metrics: [{ archetype: "error_rate", baselineValue: 0.5 }],
        },
        correlatedServices: [],
      },
      alarms: [],
      logs: [],
      wiki: { pages: [] },
      cicd: { pipelines: [], deployments: [] },
      remediationActions: [
        {
          id: "throttle_svc",
          type: "throttle_traffic",
          service: "svc",
          isCorrectFix: false,
          throttleTargets: [
            {
              id: "checkout",
              scope: "endpoint",
              label: "POST /v1/charges",
              description: "Payment checkout endpoint",
              llmHint:
                "Accounts for 60% of pool connections. Throttling provides partial relief.",
              unit: "rps",
              baselineRate: 120,
            },
          ],
        },
      ],
      featureFlags: [],
      hostGroups: [],
      evaluation: {
        rootCause: "",
        relevantActions: [],
        redHerrings: [],
        debriefContext: "",
      },
    };
  }

  function makeContext(
    scenario: LoadedScenario,
    throttles: import("@shared/types/events").ActiveThrottle[] = [],
  ): StakeholderContext {
    const store = createSimStateStore();
    for (const t of throttles) store.applyThrottle(t);
    return {
      sessionId: "test",
      scenario,
      simTime: 120,
      auditLog: [
        {
          action: "throttle_traffic",
          params: {
            targetId: "checkout",
            scope: "endpoint",
            label: "POST /v1/charges",
            limitRate: 80,
            unit: "rps",
            throttle: true,
          },
          simTime: 120,
        },
      ],
      simState: store.snapshot(),
      personaCooldowns: {},
      directlyAddressed: new Set(),
      metricSummary: { simTime: 120, narratives: [] },
      triggeredByAction: true,
    };
  }

  it("prompt user content includes active throttles section when throttles are active", async () => {
    const scenario = makeScenarioWithThrottleTargets();
    const { series, resolvedParams } = (
      await import("../../src/metrics/generator")
    ).generateAllMetrics(scenario, "s");
    // Inject an active incident overlay so hasEffect=true and LLM is called
    const errRp = resolvedParams["svc"]?.["error_rate"];
    if (errRp) {
      errRp.overlayApplications = [
        {
          overlay:
            "spike_and_sustain" as import("../../src/metrics/types").OverlayType,
          onsetSecond: 0,
          peakValue: 10,
          dropFactor: 10,
          ceiling: 10,
          rampDurationSeconds: 0,
          saturationDurationSeconds: 60,
        },
      ];
    }
    const metricStore = createMetricStore(series, resolvedParams);
    const simStateStore = createSimStateStore();
    simStateStore.applyThrottle({
      remediationActionId: "throttle_svc",
      targetId: "checkout",
      scope: "endpoint",
      label: "POST /v1/charges",
      unit: "rps",
      limitRate: 80,
      appliedAtSimTime: 120,
    });

    let capturedMessages: LLMMessage[] = [];
    const llm: LLMClient = {
      call: vi.fn().mockImplementation(async (req) => {
        capturedMessages = req.messages;
        return { toolCalls: [] };
      }),
    };

    const context: StakeholderContext = {
      sessionId: "test",
      scenario,
      simTime: 120,
      auditLog: [
        {
          action: "throttle_traffic",
          params: {
            targetId: "checkout",
            limitRate: 80,
            unit: "rps",
            throttle: true,
          },
          simTime: 120,
        },
      ],
      simState: simStateStore.snapshot(),
      personaCooldowns: {},
      directlyAddressed: new Set(),
      metricSummary: { simTime: 120, narratives: [] },
      triggeredByAction: true,
    };

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      metricStore,
      () => 120,
    );
    await engine.react(context);

    const userMsg =
      capturedMessages.find((m) => m.role === "user")?.content ?? "";
    expect(userMsg).toContain("Active Throttles");
    expect(userMsg).toContain("POST /v1/charges");
    expect(userMsg).toContain("80");
  });

  it("prompt includes llm_hint for the throttled target (not shown to trainee)", async () => {
    const scenario = makeScenarioWithThrottleTargets();
    const { series, resolvedParams } = (
      await import("../../src/metrics/generator")
    ).generateAllMetrics(scenario, "s");
    // Inject incident overlay so LLM is called
    const errRp = resolvedParams["svc"]?.["error_rate"];
    if (errRp) {
      errRp.overlayApplications = [
        {
          overlay:
            "spike_and_sustain" as import("../../src/metrics/types").OverlayType,
          onsetSecond: 0,
          peakValue: 10,
          dropFactor: 10,
          ceiling: 10,
          rampDurationSeconds: 0,
          saturationDurationSeconds: 60,
        },
      ];
    }
    const metricStore = createMetricStore(series, resolvedParams);
    const simStateStore = createSimStateStore();
    simStateStore.applyThrottle({
      remediationActionId: "throttle_svc",
      targetId: "checkout",
      scope: "endpoint",
      label: "POST /v1/charges",
      unit: "rps",
      limitRate: 80,
      appliedAtSimTime: 120,
    });

    let capturedMessages: LLMMessage[] = [];
    const llm: LLMClient = {
      call: vi.fn().mockImplementation(async (req) => {
        capturedMessages = req.messages;
        return { toolCalls: [] };
      }),
    };

    const context: StakeholderContext = {
      sessionId: "test",
      scenario,
      simTime: 120,
      auditLog: [
        {
          action: "throttle_traffic",
          params: { targetId: "checkout", limitRate: 80, throttle: true },
          simTime: 120,
        },
      ],
      simState: simStateStore.snapshot(),
      personaCooldowns: {},
      directlyAddressed: new Set(),
      metricSummary: { simTime: 120, narratives: [] },
      triggeredByAction: true,
    };

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      metricStore,
      () => 120,
    );
    await engine.react(context);

    const userMsg =
      capturedMessages.find((m) => m.role === "user")?.content ?? "";
    expect(userMsg).toContain("60% of pool connections");
  });

  it("prompt shows no throttles section when none are active", async () => {
    const scenario = makeScenarioWithThrottleTargets();
    const { series, resolvedParams } = (
      await import("../../src/metrics/generator")
    ).generateAllMetrics(scenario, "s");
    const metricStore = createMetricStore(series, resolvedParams);

    let capturedMessages: LLMMessage[] = [];
    const llm: LLMClient = {
      call: vi.fn().mockImplementation(async (req) => {
        capturedMessages = req.messages;
        return { toolCalls: [] };
      }),
    };

    const context: StakeholderContext = {
      sessionId: "test",
      scenario,
      simTime: 120,
      auditLog: [
        {
          action: "throttle_traffic",
          params: { targetId: "checkout", limitRate: 80, throttle: true },
          simTime: 120,
        },
      ],
      simState: createSimStateStore().snapshot(),
      personaCooldowns: {},
      directlyAddressed: new Set(),
      metricSummary: { simTime: 120, narratives: [] },
      triggeredByAction: true,
    };

    const engine = createMetricReactionEngine(
      () => llm,
      scenario,
      metricStore,
      () => 120,
    );
    await engine.react(context);

    const userMsg =
      capturedMessages.find((m) => m.role === "user")?.content ?? "";
    expect(userMsg).not.toContain("Active Throttles");
  });
});
