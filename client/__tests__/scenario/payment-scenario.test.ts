import { describe, it, expect } from "vitest";
import {
  loadScenarioFromText,
  isScenarioLoadError,
} from "../../src/scenario/loader";
import paymentYaml from "../../../scenarios/payment-db-pool-exhaustion/scenario.yaml?raw";

const noopResolve = (_: string): Promise<string> =>
  Promise.reject(new Error("not found"));

describe("payment-db-pool-exhaustion — schema validation", () => {
  it("loads without errors", async () => {
    const result = await loadScenarioFromText(paymentYaml, noopResolve);
    if (isScenarioLoadError(result)) {
      console.error("Validation errors:", result.errors);
    }
    expect(isScenarioLoadError(result)).toBe(false);
  });

  it("derives metrics from component topology (not authored)", async () => {
    const result = await loadScenarioFromText(paymentYaml, noopResolve);
    if (!isScenarioLoadError(result)) {
      const archetypes = result.opsDashboard.focalService.metrics.map(
        (m) => m.archetype,
      );
      // load_balancer → request_rate, error_rate, fault_rate, p50, p95, p99
      // ecs_cluster → cpu, memory_jvm, error_rate, fault_rate, p50, p95, p99
      // rds → connection_pool_used, cpu_utilization, p50, p99
      expect(archetypes).toContain("request_rate");
      expect(archetypes).toContain("connection_pool_used");
      expect(archetypes).toContain("cpu_utilization");
      expect(archetypes).toContain("p99_latency_ms");
      expect(archetypes.length).toBeGreaterThan(5);
    }
  });

  it("RDS connection pool saturation incident produces connection_pool_used overlay", async () => {
    const result = await loadScenarioFromText(paymentYaml, noopResolve);
    if (!isScenarioLoadError(result)) {
      const cp = result.opsDashboard.focalService.metrics.find(
        (m) => m.archetype === "connection_pool_used",
      );
      expect(cp).toBeDefined();
      expect(cp!.incidentResponses).toBeDefined();
      expect(cp!.incidentResponses!.length).toBeGreaterThan(0);
      expect(cp!.incidentResponses![0].overlay).toBe("saturation");
      // ceiling = max_connections = 5 (misconfigured value)
      expect(cp!.incidentResponses![0].ceiling).toBe(5);
    }
  });

  it("auto-generated alarms are present", async () => {
    const result = await loadScenarioFromText(paymentYaml, noopResolve);
    if (!isScenarioLoadError(result)) {
      const autoAlarms = result.alarms.filter((a) => a.id.startsWith("auto-"));
      expect(autoAlarms.length).toBeGreaterThan(0);
      for (const a of autoAlarms) {
        expect(a.autoFire).toBe(true);
        expect(a.threshold).toBeDefined();
        expect(a.threshold!).toBeGreaterThan(0);
      }
    }
  });

  it("authored alarms are NOT duplicated by auto-generation", async () => {
    const result = await loadScenarioFromText(paymentYaml, noopResolve);
    if (!isScenarioLoadError(result)) {
      // alarm-latency-001 and alarm-error-001 are authored
      const latencyAlarms = result.alarms.filter(
        (a) =>
          a.metricId === "p99_latency_ms" && a.service === "payment-service",
      );
      const errorAlarms = result.alarms.filter(
        (a) => a.metricId === "error_rate" && a.service === "payment-service",
      );
      // Exactly one of each — authored one wins, auto skipped
      expect(latencyAlarms).toHaveLength(1);
      expect(errorAlarms).toHaveLength(1);
      expect(latencyAlarms[0].id).toBe("alarm-latency-001");
      expect(errorAlarms[0].id).toBe("alarm-error-001");
    }
  });

  it("topology has correct service names and correlation types", async () => {
    const result = await loadScenarioFromText(paymentYaml, noopResolve);
    if (!isScenarioLoadError(result)) {
      expect(result.topology.focalService.name).toBe("payment-service");
      expect(result.topology.upstream[0].name).toBe("api-gateway");
      expect(result.topology.downstream[0].name).toBe("postgres-primary");
      expect(result.topology.downstream[0].correlation).toBe("exonerated");
    }
  });

  it("timeline values are correct", async () => {
    const result = await loadScenarioFromText(paymentYaml, noopResolve);
    if (!isScenarioLoadError(result)) {
      expect(result.timeline.preIncidentSeconds).toBe(43200);
      expect(result.timeline.resolutionSeconds).toBe(60);
      expect(result.timeline.defaultSpeed).toBe(2);
    }
  });

  it("component topology entrypoint is the load_balancer (alb)", async () => {
    const result = await loadScenarioFromText(paymentYaml, noopResolve);
    if (!isScenarioLoadError(result)) {
      const entrypoints = result.topology.focalService.components.filter(
        (c) => c.inputs.length === 0,
      );
      expect(entrypoints).toHaveLength(1);
      expect(entrypoints[0].id).toBe("alb");
      expect(entrypoints[0].type).toBe("load_balancer");
    }
  });
});
