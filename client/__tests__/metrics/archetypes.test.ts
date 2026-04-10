import { describe, it, expect } from "vitest";
import {
  getArchetypeDefaults,
  getValidArchetypes,
} from "../../src/metrics/archetypes";

describe("getArchetypeDefaults", () => {
  it("returns defaults for all current archetypes without throwing", () => {
    const expected = [
      "request_rate",
      "error_rate",
      "fault_rate",
      "availability",
      "throughput_bytes",
      "p50_latency_ms",
      "p95_latency_ms",
      "p99_latency_ms",
      "cpu_utilization",
      "memory_heap",
      "memory_jvm",
      "memory_system",
      "thread_count",
      "disk_usage",
      "disk_iops",
      "network_in_bytes",
      "network_out_bytes",
      "connection_pool_used",
      "queue_depth",
      "queue_age_ms",
      "conversion_rate",
      "active_users",
      "cert_expiry",
      "custom",
    ];
    expected.forEach((archetype) => {
      expect(() => getArchetypeDefaults(archetype)).not.toThrow();
    });
  });

  it("throws for unknown archetype", () => {
    expect(() => getArchetypeDefaults("nonexistent_metric")).toThrow(
      /Unknown archetype/,
    );
  });

  it("error_rate has sporadic_spikes noise type", () => {
    expect(getArchetypeDefaults("error_rate").noiseType).toBe(
      "sporadic_spikes",
    );
  });

  it("memory_jvm has sawtooth_gc noise type", () => {
    expect(getArchetypeDefaults("memory_jvm").noiseType).toBe("sawtooth_gc");
  });

  it("cpu_utilization has random_walk noise type", () => {
    expect(getArchetypeDefaults("cpu_utilization").noiseType).toBe(
      "random_walk",
    );
  });

  it("cert_expiry has none noise type", () => {
    expect(getArchetypeDefaults("cert_expiry").noiseType).toBe("none");
  });

  it("request_rate inherits rhythm", () => {
    expect(getArchetypeDefaults("request_rate").inheritsRhythm).toBe(true);
  });

  it("error_rate does not inherit rhythm", () => {
    expect(getArchetypeDefaults("error_rate").inheritsRhythm).toBe(false);
  });

  it("request_rate derives baseline from typical_rps", () => {
    const d = getArchetypeDefaults("request_rate");
    expect(d.scaleField).toBe("typicalRps");
    expect(d.deriveBaseline!(100)).toBe(100);
  });

  it("memory_heap derives baseline from instance_count", () => {
    const d = getArchetypeDefaults("memory_heap");
    expect(d.scaleField).toBe("instanceCount");
    expect(d.deriveBaseline!(4)).toBeGreaterThan(0);
  });

  it("error_rate has no scale derivation (absolute metric)", () => {
    const d = getArchetypeDefaults("error_rate");
    expect(d.scaleField).toBeNull();
    expect(d.deriveBaseline).toBeNull();
  });

  it("percentage archetypes have maxValue of 100", () => {
    [
      "error_rate",
      "fault_rate",
      "availability",
      "cpu_utilization",
      "disk_usage",
      "conversion_rate",
    ].forEach((a) => {
      expect(getArchetypeDefaults(a).maxValue).toBe(100);
    });
  });

  it("non-percentage archetypes have maxValue of Infinity", () => {
    ["request_rate", "p99_latency_ms", "memory_heap"].forEach((a) => {
      expect(getArchetypeDefaults(a).maxValue).toBe(Infinity);
    });
  });

  it("all archetypes have minValue of 0", () => {
    getValidArchetypes().forEach((a) => {
      expect(getArchetypeDefaults(a).minValue).toBe(0);
    });
  });
});

describe("getValidArchetypes", () => {
  it("returns at least 24 archetypes", () => {
    expect(getValidArchetypes().length).toBeGreaterThanOrEqual(24);
  });

  it("includes all required archetypes", () => {
    const valid = new Set(getValidArchetypes());
    const required = [
      "request_rate",
      "error_rate",
      "fault_rate",
      "availability",
      "throughput_bytes",
      "p50_latency_ms",
      "p95_latency_ms",
      "p99_latency_ms",
      "cpu_utilization",
      "memory_heap",
      "memory_jvm",
      "memory_system",
      "thread_count",
      "disk_usage",
      "disk_iops",
      "network_in_bytes",
      "network_out_bytes",
      "connection_pool_used",
      "queue_depth",
      "queue_age_ms",
      "conversion_rate",
      "active_users",
      "cert_expiry",
      "custom",
    ];
    required.forEach((a) => expect(valid.has(a)).toBe(true));
  });

  it("does not include removed p999_latency_ms", () => {
    const valid = new Set(getValidArchetypes());
    expect(valid.has("p999_latency_ms")).toBe(false);
  });
});
