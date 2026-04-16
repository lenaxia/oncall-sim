/**
 * Tests for auto-generated alarm thresholds and AlarmConfig entries.
 *
 * deriveOpsDashboard() must:
 * 1. Set criticalThreshold on each MetricConfig
 * 2. Auto-generate AlarmConfig entries in LoadedScenario.alarms for each metric
 *    that has a criticalThreshold (deduped against author-defined alarms)
 *
 * Written before implementation.
 */

import { describe, it, expect } from "vitest";
import {
  loadScenarioFromText,
  isScenarioLoadError,
} from "../../src/scenario/loader";
import yaml from "js-yaml";

const noopResolve = (_: string): Promise<string> =>
  Promise.reject(new Error("not found"));

function makeScenarioYaml(
  topology: unknown,
  extra: Record<string, unknown> = {},
): string {
  const base: Record<string, unknown> = {
    id: "test",
    title: "Test",
    description: "test",
    difficulty: "easy",
    tags: [],
    timeline: { default_speed: 1, duration_minutes: 15 },
    topology,
    engine: {},
    email: [],
    chat: { channels: [], messages: [] },
    ticketing: [],
    alarms: [],
    wiki: { pages: [{ title: "p", content: "c" }] },
    cicd: {},
    personas: [
      {
        id: "p1",
        display_name: "P1",
        job_title: "SRE",
        team: "Platform",
        initiates_contact: false,
        cooldown_seconds: 30,
        silent_until_contacted: false,
        system_prompt: "test",
      },
    ],
    remediation_actions: [],
    evaluation: {
      root_cause: "test",
      relevant_actions: [],
      red_herrings: [],
      debrief_context: "test",
    },
    ...extra,
  };
  return yaml.dump(base);
}

// ── MetricConfig.criticalThreshold is populated ───────────────────────────────

describe("deriveOpsDashboard — criticalThreshold is set on all metrics", () => {
  const topology = {
    focal_service: {
      name: "svc",
      description: "test",
      typical_rps: 200,
      components: [
        { id: "alb", type: "load_balancer", label: "ALB", inputs: [] },
        {
          id: "ecs",
          type: "ecs_cluster",
          label: "ECS",
          instance_count: 4,
          utilization: 0.55,
          inputs: ["alb"],
        },
        {
          id: "ddb",
          type: "dynamodb",
          label: "DDB",
          write_capacity: 100,
          read_capacity: 500,
          write_utilization: 0.6,
          read_utilization: 0.2,
          billing_mode: "provisioned",
          inputs: ["ecs"],
        },
      ],
      incidents: [],
    },
    upstream: [],
    downstream: [],
  };

  it("every MetricConfig produced by deriveOpsDashboard has criticalThreshold set", async () => {
    const result = await loadScenarioFromText(
      makeScenarioYaml(topology),
      noopResolve,
    );
    expect(isScenarioLoadError(result)).toBe(false);
    if (!isScenarioLoadError(result)) {
      const metrics = result.opsDashboard.focalService.metrics;
      expect(metrics.length).toBeGreaterThan(0);
      for (const m of metrics) {
        expect(
          m.criticalThreshold,
          `${m.archetype} has no criticalThreshold`,
        ).toBeDefined();
        expect(
          typeof m.criticalThreshold,
          `${m.archetype} criticalThreshold is not a number`,
        ).toBe("number");
        expect(
          m.criticalThreshold! > 0,
          `${m.archetype} criticalThreshold should be positive (got ${m.criticalThreshold})`,
        ).toBe(true);
      }
    }
  });

  it("cpu_utilization threshold is 85 (hard cap)", async () => {
    const result = await loadScenarioFromText(
      makeScenarioYaml(topology),
      noopResolve,
    );
    if (!isScenarioLoadError(result)) {
      const cpu = result.opsDashboard.focalService.metrics.find(
        (m) => m.archetype === "cpu_utilization",
      );
      expect(cpu?.criticalThreshold).toBe(85);
    }
  });

  it("write_capacity_used threshold is 85% of write capacity (ceiling × 0.85)", async () => {
    const result = await loadScenarioFromText(
      makeScenarioYaml(topology),
      noopResolve,
    );
    if (!isScenarioLoadError(result)) {
      const wcu = result.opsDashboard.focalService.metrics.find(
        (m) => m.archetype === "write_capacity_used",
      );
      // DDB write_capacity=100, so threshold = 100 × 0.85 = 85
      expect(wcu?.criticalThreshold).toBeCloseTo(85, 1);
    }
  });

  it("error_rate threshold is 3× baseline", async () => {
    const result = await loadScenarioFromText(
      makeScenarioYaml(topology),
      noopResolve,
    );
    if (!isScenarioLoadError(result)) {
      const err = result.opsDashboard.focalService.metrics.find(
        (m) => m.archetype === "error_rate",
      );
      // error_rate baseline = 0.5%, threshold = 3 × 0.5 = 1.5%
      expect(err?.criticalThreshold).toBeCloseTo(1.5, 2);
    }
  });

  it("p99_latency threshold is 3× baseline", async () => {
    const result = await loadScenarioFromText(
      makeScenarioYaml(topology),
      noopResolve,
    );
    if (!isScenarioLoadError(result)) {
      // ALB p99 baseline = 50ms, threshold = 3 × 50 = 150ms
      const p99 = result.opsDashboard.focalService.metrics.find(
        (m) => m.archetype === "p99_latency_ms",
      );
      expect(p99?.criticalThreshold).toBeCloseTo(150, 0);
    }
  });
});

// ── Auto-generated AlarmConfig entries ────────────────────────────────────────

describe("auto-generated alarms from criticalThreshold", () => {
  const topology = {
    focal_service: {
      name: "svc",
      description: "test",
      typical_rps: 200,
      components: [
        { id: "alb", type: "load_balancer", label: "ALB", inputs: [] },
      ],
      incidents: [],
    },
    upstream: [],
    downstream: [],
  };

  it("auto-generated alarms are present in scenario.alarms", async () => {
    const result = await loadScenarioFromText(
      makeScenarioYaml(topology),
      noopResolve,
    );
    expect(isScenarioLoadError(result)).toBe(false);
    if (!isScenarioLoadError(result)) {
      const metrics = result.opsDashboard.focalService.metrics;
      expect(metrics.length).toBeGreaterThan(0);
      // Every metric with a criticalThreshold should have a matching alarm
      for (const m of metrics) {
        if (m.criticalThreshold == null) continue;
        const alarm = result.alarms.find(
          (a) => a.service === "svc" && a.metricId === m.archetype,
        );
        expect(alarm, `No alarm generated for ${m.archetype}`).toBeDefined();
      }
    }
  });

  it("auto-generated alarms have autoFire=true and correct threshold", async () => {
    const result = await loadScenarioFromText(
      makeScenarioYaml(topology),
      noopResolve,
    );
    if (!isScenarioLoadError(result)) {
      const autoAlarms = result.alarms.filter(
        (a) => a.service === "svc" && a.metricId === "error_rate",
      );
      expect(autoAlarms.length).toBe(1);
      const alarm = autoAlarms[0];
      expect(alarm.autoFire).toBe(true);
      expect(alarm.threshold).toBeDefined();
      // threshold should match MetricConfig.criticalThreshold
      const errorMetric = result.opsDashboard.focalService.metrics.find(
        (m) => m.archetype === "error_rate",
      );
      expect(alarm.threshold).toBe(errorMetric?.criticalThreshold);
    }
  });

  it("auto-generated alarms do not duplicate author-defined alarms for same metric", async () => {
    // Author explicitly defines an alarm for error_rate
    const withAuthorAlarm = makeScenarioYaml(topology, {
      alarms: [
        {
          id: "author-alarm-001",
          service: "svc",
          metric_id: "error_rate",
          condition: "error_rate > 2%",
          severity: "SEV2",
          auto_fire: true,
          threshold: 2.0,
        },
      ],
    });
    const result = await loadScenarioFromText(withAuthorAlarm, noopResolve);
    if (!isScenarioLoadError(result)) {
      const errorAlarms = result.alarms.filter(
        (a) => a.service === "svc" && a.metricId === "error_rate",
      );
      // Should be exactly 1 — the author's alarm, not a duplicate auto-generated one
      expect(errorAlarms).toHaveLength(1);
      expect(errorAlarms[0].id).toBe("author-alarm-001");
    }
  });

  it("auto-generated alarm severity is SEV2", async () => {
    const result = await loadScenarioFromText(
      makeScenarioYaml(topology),
      noopResolve,
    );
    if (!isScenarioLoadError(result)) {
      const autoAlarms = result.alarms.filter((a) => a.service === "svc");
      expect(autoAlarms.length).toBeGreaterThan(0);
      for (const alarm of autoAlarms) {
        expect(alarm.severity).toBe("SEV2");
      }
    }
  });

  it("auto-generated alarm IDs are stable and predictable", async () => {
    const result = await loadScenarioFromText(
      makeScenarioYaml(topology),
      noopResolve,
    );
    if (!isScenarioLoadError(result)) {
      const alarm = result.alarms.find(
        (a) => a.service === "svc" && a.metricId === "error_rate",
      );
      // Auto IDs follow pattern: auto-{service}-{metricId}
      expect(alarm?.id).toBe("auto-svc-error_rate");
    }
  });

  it("auto-generated alarms do not have autoPage set (no pager noise by default)", async () => {
    const result = await loadScenarioFromText(
      makeScenarioYaml(topology),
      noopResolve,
    );
    if (!isScenarioLoadError(result)) {
      const autoAlarms = result.alarms.filter((a) => a.service === "svc");
      for (const alarm of autoAlarms) {
        expect(alarm.autoPage).toBe(false);
      }
    }
  });
});

// ── Fixture scenario end-to-end ───────────────────────────────────────────────

describe("fixture scenario — auto-alarms end-to-end", () => {
  it("fixture scenario has auto-generated alarms for its components", async () => {
    const fixtureYaml =
      await import("../../../scenarios/_fixture/scenario.yaml?raw").then(
        (m) => m.default,
      );
    const result = await loadScenarioFromText(fixtureYaml, noopResolve);
    expect(isScenarioLoadError(result)).toBe(false);
    if (!isScenarioLoadError(result)) {
      // Fixture has alb (load_balancer) and app (ecs_cluster)
      // Both generate metrics → both should have auto-alarms
      const autoAlarms = result.alarms.filter((a) => a.id.startsWith("auto-"));
      expect(autoAlarms.length).toBeGreaterThan(0);
      // All auto-alarms should be for fixture-service
      for (const alarm of autoAlarms) {
        expect(alarm.service).toBe("fixture-service");
        expect(alarm.autoFire).toBe(true);
        expect(alarm.threshold).toBeDefined();
        expect(alarm.threshold!).toBeGreaterThan(0);
      }
    }
  });

  it("criticalThreshold is set on every opsDashboard metric (proves metricsMeta will have it)", async () => {
    const fixtureYaml =
      await import("../../../scenarios/_fixture/scenario.yaml?raw").then(
        (m) => m.default,
      );
    const result = await loadScenarioFromText(fixtureYaml, noopResolve);
    expect(isScenarioLoadError(result)).toBe(false);
    if (!isScenarioLoadError(result)) {
      const metrics = result.opsDashboard.focalService.metrics;
      expect(metrics.length).toBeGreaterThan(0);
      for (const m of metrics) {
        expect(
          m.criticalThreshold,
          `fixture metric '${m.archetype}' has no criticalThreshold — metricsMeta will pass undefined to MetricChart`,
        ).toBeDefined();
        expect(m.criticalThreshold!).toBeGreaterThan(0);
      }
    }
  });
});
