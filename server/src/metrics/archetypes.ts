// Archetype registry — defaults for every built-in metric archetype.
// HLD §8.4 defines the full list.

import type { NoiseLevel } from '../scenario/types'
import type { NoiseType } from './types'

export interface ArchetypeDefaults {
  label:             string
  unit:              string
  noiseType:         NoiseType
  inheritsRhythm:    boolean
  defaultNoiseLevel: NoiseLevel
  // Which scale field drives baseline derivation, or null if author must supply baseline_value
  scaleField: 'typicalRps' | 'instanceCount' | 'maxConnections' | null
  // Derives baseline from scale value. null means no scale derivation.
  deriveBaseline: ((scaleValue: number) => number) | null
  // Archetype-level max value for clamping (e.g. 100 for percentages)
  maxValue: number
  // Archetype-level min value for clamping
  minValue: number
}

const ARCHETYPES: Record<string, ArchetypeDefaults> = {
  // ── Traffic and throughput ────────────────────────────────────────────────
  request_rate: {
    label: 'Request Rate', unit: 'rps',
    noiseType: 'gaussian', inheritsRhythm: true, defaultNoiseLevel: 'medium',
    scaleField: 'typicalRps', deriveBaseline: (rps) => rps,
    minValue: 0, maxValue: Infinity,
  },
  error_rate: {
    label: 'Error Rate', unit: 'percent',
    noiseType: 'sporadic_spikes', inheritsRhythm: false, defaultNoiseLevel: 'low',
    scaleField: null, deriveBaseline: null,
    minValue: 0, maxValue: 100,
  },
  fault_rate: {
    label: 'Fault Rate', unit: 'percent',
    noiseType: 'sporadic_spikes', inheritsRhythm: false, defaultNoiseLevel: 'low',
    scaleField: null, deriveBaseline: null,
    minValue: 0, maxValue: 100,
  },
  availability: {
    label: 'Availability', unit: 'percent',
    noiseType: 'gaussian', inheritsRhythm: false, defaultNoiseLevel: 'low',
    scaleField: null, deriveBaseline: null,
    minValue: 0, maxValue: 100,
  },
  throughput_bytes: {
    label: 'Throughput', unit: 'bytes/s',
    noiseType: 'gaussian', inheritsRhythm: true, defaultNoiseLevel: 'medium',
    // approximate avg payload of 2 KB
    scaleField: 'typicalRps', deriveBaseline: (rps) => rps * 2048,
    minValue: 0, maxValue: Infinity,
  },

  // ── Latency ───────────────────────────────────────────────────────────────
  p50_latency_ms: {
    label: 'p50 Latency', unit: 'ms',
    noiseType: 'gaussian', inheritsRhythm: false, defaultNoiseLevel: 'medium',
    scaleField: null, deriveBaseline: null,
    minValue: 0, maxValue: Infinity,
  },
  p99_latency_ms: {
    label: 'p99 Latency', unit: 'ms',
    noiseType: 'gaussian', inheritsRhythm: false, defaultNoiseLevel: 'medium',
    scaleField: null, deriveBaseline: null,
    minValue: 0, maxValue: Infinity,
  },
  p999_latency_ms: {
    label: 'p999 Latency', unit: 'ms',
    noiseType: 'gaussian', inheritsRhythm: false, defaultNoiseLevel: 'low',
    scaleField: null, deriveBaseline: null,
    minValue: 0, maxValue: Infinity,
  },

  // ── Infrastructure — compute ──────────────────────────────────────────────
  cpu_utilization: {
    label: 'CPU Utilization', unit: 'percent',
    noiseType: 'random_walk', inheritsRhythm: true, defaultNoiseLevel: 'medium',
    scaleField: null, deriveBaseline: null,
    minValue: 0, maxValue: 100,
  },
  memory_heap: {
    label: 'Heap Memory', unit: 'mb',
    noiseType: 'random_walk', inheritsRhythm: false, defaultNoiseLevel: 'low',
    scaleField: 'instanceCount', deriveBaseline: (count) => count * 512,
    minValue: 0, maxValue: Infinity,
  },
  memory_jvm: {
    label: 'JVM Memory', unit: 'mb',
    noiseType: 'sawtooth_gc', inheritsRhythm: false, defaultNoiseLevel: 'low',
    scaleField: 'instanceCount', deriveBaseline: (count) => count * 768,
    minValue: 0, maxValue: Infinity,
  },
  memory_system: {
    label: 'System Memory', unit: 'mb',
    noiseType: 'random_walk', inheritsRhythm: false, defaultNoiseLevel: 'low',
    scaleField: 'instanceCount', deriveBaseline: (count) => count * 1024,
    minValue: 0, maxValue: Infinity,
  },
  thread_count: {
    label: 'Thread Count', unit: 'count',
    noiseType: 'random_walk', inheritsRhythm: true, defaultNoiseLevel: 'low',
    scaleField: 'instanceCount', deriveBaseline: (count) => count * 50,
    minValue: 0, maxValue: Infinity,
  },

  // ── Infrastructure — storage and network ──────────────────────────────────
  disk_usage: {
    label: 'Disk Usage', unit: 'percent',
    noiseType: 'gaussian', inheritsRhythm: false, defaultNoiseLevel: 'low',
    scaleField: null, deriveBaseline: null,
    minValue: 0, maxValue: 100,
  },
  disk_iops: {
    label: 'Disk IOPS', unit: 'iops',
    noiseType: 'gaussian', inheritsRhythm: true, defaultNoiseLevel: 'medium',
    scaleField: 'typicalRps', deriveBaseline: (rps) => rps * 0.5,
    minValue: 0, maxValue: Infinity,
  },
  network_in_bytes: {
    label: 'Network In', unit: 'bytes/s',
    noiseType: 'gaussian', inheritsRhythm: true, defaultNoiseLevel: 'medium',
    scaleField: 'typicalRps', deriveBaseline: (rps) => rps * 1500,
    minValue: 0, maxValue: Infinity,
  },
  network_out_bytes: {
    label: 'Network Out', unit: 'bytes/s',
    noiseType: 'gaussian', inheritsRhythm: true, defaultNoiseLevel: 'medium',
    scaleField: 'typicalRps', deriveBaseline: (rps) => rps * 3000,
    minValue: 0, maxValue: Infinity,
  },

  // ── Connections and queues ────────────────────────────────────────────────
  connection_pool_used: {
    label: 'Connection Pool Used', unit: 'count',
    noiseType: 'gaussian', inheritsRhythm: true, defaultNoiseLevel: 'low',
    scaleField: 'maxConnections', deriveBaseline: (max) => max * 0.4,
    minValue: 0, maxValue: Infinity,
  },
  queue_depth: {
    label: 'Queue Depth', unit: 'count',
    noiseType: 'gaussian', inheritsRhythm: true, defaultNoiseLevel: 'medium',
    scaleField: 'typicalRps', deriveBaseline: (rps) => rps * 0.1,
    minValue: 0, maxValue: Infinity,
  },
  queue_age_ms: {
    label: 'Queue Age', unit: 'ms',
    noiseType: 'gaussian', inheritsRhythm: false, defaultNoiseLevel: 'medium',
    scaleField: null, deriveBaseline: null,
    minValue: 0, maxValue: Infinity,
  },

  // ── Business metrics ──────────────────────────────────────────────────────
  conversion_rate: {
    label: 'Conversion Rate', unit: 'percent',
    noiseType: 'gaussian', inheritsRhythm: true, defaultNoiseLevel: 'low',
    scaleField: null, deriveBaseline: null,
    minValue: 0, maxValue: 100,
  },
  active_users: {
    label: 'Active Users', unit: 'count',
    noiseType: 'gaussian', inheritsRhythm: true, defaultNoiseLevel: 'medium',
    scaleField: 'typicalRps', deriveBaseline: (rps) => rps * 10,
    minValue: 0, maxValue: Infinity,
  },

  // ── Special ───────────────────────────────────────────────────────────────
  cert_expiry: {
    label: 'TLS Cert Days Remaining', unit: 'days',
    noiseType: 'none', inheritsRhythm: false, defaultNoiseLevel: 'low',
    scaleField: null, deriveBaseline: null,
    minValue: 0, maxValue: Infinity,
  },
  custom: {
    label: 'Custom Metric', unit: '',
    noiseType: 'gaussian', inheritsRhythm: false, defaultNoiseLevel: 'medium',
    scaleField: null, deriveBaseline: null,
    minValue: 0, maxValue: Infinity,
  },
}

/**
 * Returns archetype defaults for a given archetype name.
 * Throws if archetype is not registered — schema cross-reference validation
 * (Phase 3 validator.ts) should catch this before generation runs.
 */
export function getArchetypeDefaults(archetype: string): ArchetypeDefaults {
  const defaults = ARCHETYPES[archetype]
  if (!defaults) {
    throw new Error(`Unknown archetype: '${archetype}'. Register it in metrics/archetypes.ts or use 'custom'.`)
  }
  return defaults
}

/** Returns all valid archetype names. Used by Phase 3 schema cross-reference validation. */
export function getValidArchetypes(): string[] {
  return Object.keys(ARCHETYPES)
}
