// Incident type registry — maps (incident_type × archetype) → response profile.
// HLD §8.3 defines all five incident types and their archetype response tables.

import type { OverlayType } from './types'

export interface IncidentResponseProfile {
  overlay:            OverlayType
  defaultPeakFactor:  number   // multiplier on baseline
  defaultOnsetOffset: number   // seconds relative to t=0
}

// Full registry keyed as INCIDENT_TYPE_REGISTRY[incident_type][archetype]
export const INCIDENT_TYPE_REGISTRY: Record<string, Record<string, IncidentResponseProfile>> = {
  connection_pool_exhaustion: {
    connection_pool_used: { overlay: 'saturation',         defaultPeakFactor: 1.0,  defaultOnsetOffset: -90 },
    p99_latency_ms:       { overlay: 'spike_and_sustain',  defaultPeakFactor: 40,   defaultOnsetOffset: 0   },
    p50_latency_ms:       { overlay: 'spike_and_sustain',  defaultPeakFactor: 12,   defaultOnsetOffset: 0   },
    error_rate:           { overlay: 'spike_and_sustain',  defaultPeakFactor: 15,   defaultOnsetOffset: 30  },
    fault_rate:           { overlay: 'spike_and_sustain',  defaultPeakFactor: 10,   defaultOnsetOffset: 30  },
    request_rate:         { overlay: 'sudden_drop',        defaultPeakFactor: 0.6,  defaultOnsetOffset: 30  },
    cpu_utilization:      { overlay: 'spike_and_sustain',  defaultPeakFactor: 1.8,  defaultOnsetOffset: 15  },
    availability:         { overlay: 'sudden_drop',        defaultPeakFactor: 0.85, defaultOnsetOffset: 30  },
  },

  bad_deploy_latency: {
    p99_latency_ms:       { overlay: 'spike_and_sustain',   defaultPeakFactor: 25,   defaultOnsetOffset: 0   },
    p50_latency_ms:       { overlay: 'spike_and_sustain',   defaultPeakFactor: 8,    defaultOnsetOffset: 0   },
    error_rate:           { overlay: 'spike_and_sustain',   defaultPeakFactor: 8,    defaultOnsetOffset: 60  },
    cpu_utilization:      { overlay: 'spike_and_sustain',   defaultPeakFactor: 1.5,  defaultOnsetOffset: 0   },
    request_rate:         { overlay: 'sudden_drop',         defaultPeakFactor: 0.75, defaultOnsetOffset: 60  },
    connection_pool_used: { overlay: 'gradual_degradation', defaultPeakFactor: 0.7,  defaultOnsetOffset: 0   },
  },

  traffic_spike: {
    request_rate:         { overlay: 'spike_and_sustain', defaultPeakFactor: 3.5, defaultOnsetOffset: 0  },
    cpu_utilization:      { overlay: 'spike_and_sustain', defaultPeakFactor: 2.2, defaultOnsetOffset: 0  },
    p99_latency_ms:       { overlay: 'spike_and_sustain', defaultPeakFactor: 4,   defaultOnsetOffset: 15 },
    p50_latency_ms:       { overlay: 'spike_and_sustain', defaultPeakFactor: 2,   defaultOnsetOffset: 15 },
    error_rate:           { overlay: 'spike_and_sustain', defaultPeakFactor: 5,   defaultOnsetOffset: 30 },
    connection_pool_used: { overlay: 'saturation',        defaultPeakFactor: 1.0, defaultOnsetOffset: 15 },
    memory_jvm:           { overlay: 'spike_and_sustain', defaultPeakFactor: 1.4, defaultOnsetOffset: 30 },
  },

  memory_leak: {
    memory_jvm:      { overlay: 'gradual_degradation', defaultPeakFactor: 2.5, defaultOnsetOffset: -300 },
    memory_heap:     { overlay: 'gradual_degradation', defaultPeakFactor: 2.8, defaultOnsetOffset: -300 },
    p99_latency_ms:  { overlay: 'gradual_degradation', defaultPeakFactor: 6,   defaultOnsetOffset: -120 },
    cpu_utilization: { overlay: 'gradual_degradation', defaultPeakFactor: 1.6, defaultOnsetOffset: -120 },
    error_rate:      { overlay: 'spike_and_sustain',   defaultPeakFactor: 6,   defaultOnsetOffset: 0    },
    request_rate:    { overlay: 'sudden_drop',         defaultPeakFactor: 0.7, defaultOnsetOffset: 30   },
  },

  dependency_outage: {
    error_rate:      { overlay: 'spike_and_sustain', defaultPeakFactor: 20,  defaultOnsetOffset: 0 },
    fault_rate:      { overlay: 'spike_and_sustain', defaultPeakFactor: 18,  defaultOnsetOffset: 0 },
    p99_latency_ms:  { overlay: 'spike_and_sustain', defaultPeakFactor: 50,  defaultOnsetOffset: 0 },
    request_rate:    { overlay: 'sudden_drop',        defaultPeakFactor: 0.5, defaultOnsetOffset: 0 },
    availability:    { overlay: 'sudden_drop',        defaultPeakFactor: 0.6, defaultOnsetOffset: 0 },
  },
}

/**
 * Returns the incident response profile for a (incident_type, archetype) pair,
 * or null if the pair is not registered.
 */
export function getIncidentResponse(
  incidentType: string,
  archetype: string
): IncidentResponseProfile | null {
  return INCIDENT_TYPE_REGISTRY[incidentType]?.[archetype] ?? null
}

/**
 * Validates that an incident_type exists in the registry.
 * Returns true if known, logs a warning and returns false if not.
 */
export function validateIncidentType(incidentType: string): boolean {
  if (INCIDENT_TYPE_REGISTRY[incidentType]) return true
  console.warn(`[metrics] Unknown incident_type '${incidentType}'. Tier 1 metrics will have no incident overlay. Use Tier 2 (incident_peak) for explicit control.`)
  return false
}
