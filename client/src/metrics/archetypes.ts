// Archetype registry — defaults for every built-in metric archetype.

import type { NoiseLevel } from "../scenario/types";
import type { NoiseType } from "./types";

export interface ArchetypeDefaults {
  label: string;
  unit: string;
  noiseType: NoiseType;
  inheritsRhythm: boolean;
  defaultNoiseLevel: NoiseLevel;
  scaleField: "typicalRps" | "instanceCount" | "maxConnections" | null;
  deriveBaseline: ((scaleValue: number) => number) | null;
  maxValue: number;
  minValue: number;
  /**
   * Direction the metric is "bad" in — determines alarm firing and chart rendering.
   *   "high" — bad when high (fire when value >= threshold). Default. Most metrics.
   *   "low"  — bad when low  (fire when value <= threshold). cert_expiry, cache_hit_rate,
   *            availability, conversion_rate.
   */
  thresholdDirection: "high" | "low";
}

const ARCHETYPES: Record<string, ArchetypeDefaults> = {
  request_rate: {
    label: "Request Rate",
    unit: "rps",
    noiseType: "gaussian",
    inheritsRhythm: true,
    defaultNoiseLevel: "medium",
    scaleField: "typicalRps",
    deriveBaseline: (rps) => rps,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  error_rate: {
    label: "Error Rate",
    unit: "percent",
    noiseType: "sporadic_spikes",
    inheritsRhythm: false,
    defaultNoiseLevel: "high",   // bad actors, misconfigured clients, transient failures
    scaleField: null,
    deriveBaseline: null,
    minValue: 0,
    maxValue: 100,
    thresholdDirection: "high",
  },
  fault_rate: {
    label: "Fault Rate",
    unit: "percent",
    noiseType: "sporadic_spikes",
    inheritsRhythm: false,
    defaultNoiseLevel: "high",   // faults are inherently spiky
    scaleField: null,
    deriveBaseline: null,
    minValue: 0,
    maxValue: 100,
    thresholdDirection: "high",
  },
  availability: {
    label: "Availability",
    unit: "percent",
    noiseType: "gaussian",
    inheritsRhythm: false,
    defaultNoiseLevel: "low",
    scaleField: null,
    deriveBaseline: null,
    minValue: 0,
    maxValue: 100,
    thresholdDirection: "low",   // bad when availability drops
  },
  throughput_bytes: {
    label: "Throughput",
    unit: "bytes/s",
    noiseType: "gaussian",
    inheritsRhythm: true,
    defaultNoiseLevel: "medium",
    scaleField: "typicalRps",
    deriveBaseline: (rps) => rps * 2048,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  p50_latency_ms: {
    label: "p50 Latency",
    unit: "ms",
    noiseType: "random_walk",    // correlated variation — busy periods show as sustained rises
    inheritsRhythm: false,
    defaultNoiseLevel: "medium",
    scaleField: null,
    deriveBaseline: null,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  p95_latency_ms: {
    label: "p95 Latency",
    unit: "ms",
    noiseType: "random_walk",    // p95 drifts more than p50
    inheritsRhythm: false,
    defaultNoiseLevel: "high",
    scaleField: null,
    deriveBaseline: null,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  p99_latency_ms: {
    label: "p99 Latency",
    unit: "ms",
    noiseType: "random_walk",    // p99 tail latency is inherently noisy
    inheritsRhythm: false,
    defaultNoiseLevel: "high",
    scaleField: null,
    deriveBaseline: null,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  cpu_utilization: {
    label: "CPU Utilization",
    unit: "percent",
    noiseType: "random_walk",
    inheritsRhythm: true,
    defaultNoiseLevel: "medium",
    scaleField: null,
    deriveBaseline: null,
    minValue: 0,
    maxValue: 100,
    thresholdDirection: "high",
  },
  memory_heap: {
    label: "Heap Memory",
    unit: "mb",
    noiseType: "random_walk",
    inheritsRhythm: false,
    defaultNoiseLevel: "low",
    scaleField: "instanceCount",
    deriveBaseline: (count) => count * 512,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  memory_jvm: {
    label: "JVM Memory",
    unit: "mb",
    noiseType: "sawtooth_gc",
    inheritsRhythm: false,
    defaultNoiseLevel: "medium",  // medium makes the GC sawtooth clearly visible
    scaleField: "instanceCount",
    deriveBaseline: (count) => count * 768,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  memory_system: {
    label: "System Memory",
    unit: "mb",
    noiseType: "random_walk",
    inheritsRhythm: false,
    defaultNoiseLevel: "low",
    scaleField: "instanceCount",
    deriveBaseline: (count) => count * 1024,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  thread_count: {
    label: "Thread Count",
    unit: "count",
    noiseType: "random_walk",
    inheritsRhythm: true,
    defaultNoiseLevel: "low",
    scaleField: "instanceCount",
    deriveBaseline: (count) => count * 50,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  disk_usage: {
    label: "Disk Usage",
    unit: "percent",
    noiseType: "gaussian",
    inheritsRhythm: false,
    defaultNoiseLevel: "low",
    scaleField: null,
    deriveBaseline: null,
    minValue: 0,
    maxValue: 100,
    thresholdDirection: "high",
  },
  disk_iops: {
    label: "Disk IOPS",
    unit: "iops",
    noiseType: "gaussian",
    inheritsRhythm: true,
    defaultNoiseLevel: "medium",
    scaleField: "typicalRps",
    deriveBaseline: (rps) => rps * 0.5,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  network_in_bytes: {
    label: "Network In",
    unit: "bytes/s",
    noiseType: "gaussian",
    inheritsRhythm: true,
    defaultNoiseLevel: "medium",
    scaleField: "typicalRps",
    deriveBaseline: (rps) => rps * 1500,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  network_out_bytes: {
    label: "Network Out",
    unit: "bytes/s",
    noiseType: "gaussian",
    inheritsRhythm: true,
    defaultNoiseLevel: "medium",
    scaleField: "typicalRps",
    deriveBaseline: (rps) => rps * 3000,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  connection_pool_used: {
    label: "Connection Pool Used",
    unit: "count",
    noiseType: "gaussian",
    inheritsRhythm: true,
    defaultNoiseLevel: "low",
    scaleField: "maxConnections",
    deriveBaseline: (max) => max * 0.4,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  write_capacity_used: {
    label: "Write Capacity Used",
    unit: "wcu",
    noiseType: "gaussian",
    inheritsRhythm: true,
    defaultNoiseLevel: "low",
    scaleField: null,
    deriveBaseline: null,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  write_throttles: {
    label: "Write Throttle Events",
    unit: "count",
    noiseType: "sporadic_spikes",
    inheritsRhythm: false,
    defaultNoiseLevel: "low",
    scaleField: null,
    deriveBaseline: null,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  read_capacity_used: {
    label: "Read Capacity Used",
    unit: "rcu",
    noiseType: "gaussian",
    inheritsRhythm: true,
    defaultNoiseLevel: "low",
    scaleField: null,
    deriveBaseline: null,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  concurrent_executions: {
    label: "Concurrent Executions",
    unit: "count",
    noiseType: "gaussian",
    inheritsRhythm: true,
    defaultNoiseLevel: "medium",
    scaleField: null,
    deriveBaseline: null,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  queue_depth: {
    label: "Queue Depth",
    unit: "count",
    noiseType: "gaussian",
    inheritsRhythm: true,
    defaultNoiseLevel: "medium",
    scaleField: "typicalRps",
    deriveBaseline: (rps) => rps * 0.1,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  queue_age_ms: {
    label: "Queue Age",
    unit: "ms",
    noiseType: "gaussian",
    inheritsRhythm: false,
    defaultNoiseLevel: "medium",
    scaleField: null,
    deriveBaseline: null,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  conversion_rate: {
    label: "Conversion Rate",
    unit: "percent",
    noiseType: "gaussian",
    inheritsRhythm: true,
    defaultNoiseLevel: "low",
    scaleField: null,
    deriveBaseline: null,
    minValue: 0,
    maxValue: 100,
    thresholdDirection: "low",   // bad when conversion drops
  },
  active_users: {
    label: "Active Users",
    unit: "count",
    noiseType: "gaussian",
    inheritsRhythm: true,
    defaultNoiseLevel: "medium",
    scaleField: "typicalRps",
    deriveBaseline: (rps) => rps * 10,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
  cert_expiry: {
    label: "TLS Cert Days Remaining",
    unit: "days",
    noiseType: "none",
    inheritsRhythm: false,
    defaultNoiseLevel: "low",
    scaleField: null,
    deriveBaseline: null,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "low",   // bad when days remaining drops — alarm at ≤ 30 days
  },
  cache_hit_rate: {
    label: "Cache Hit Rate",
    unit: "percent",
    noiseType: "gaussian",
    inheritsRhythm: false,
    defaultNoiseLevel: "low",
    scaleField: null,
    deriveBaseline: null,
    minValue: 0,
    maxValue: 100,
    thresholdDirection: "low",   // bad when hit rate drops
  },
  custom: {
    label: "Custom Metric",
    unit: "",
    noiseType: "gaussian",
    inheritsRhythm: false,
    defaultNoiseLevel: "medium",
    scaleField: null,
    deriveBaseline: null,
    minValue: 0,
    maxValue: Infinity,
    thresholdDirection: "high",
  },
};

export function getArchetypeDefaults(archetype: string): ArchetypeDefaults {
  const defaults = ARCHETYPES[archetype];
  if (!defaults) {
    throw new Error(
      `Unknown archetype: '${archetype}'. Register it in metrics/archetypes.ts or use 'custom'.`,
    );
  }
  return defaults;
}

export function getValidArchetypes(): string[] {
  return Object.keys(ARCHETYPES);
}
