import { describe, it, expect } from 'vitest'
import {
  getIncidentResponse, validateIncidentType, INCIDENT_TYPE_REGISTRY,
} from '../../src/metrics/incident-types'

describe('getIncidentResponse', () => {
  it('returns profile for all five incident types with their key archetypes', () => {
    const pairs: [string, string][] = [
      ['connection_pool_exhaustion', 'error_rate'],
      ['connection_pool_exhaustion', 'p99_latency_ms'],
      ['bad_deploy_latency',         'p99_latency_ms'],
      ['bad_deploy_latency',         'error_rate'],
      ['traffic_spike',              'request_rate'],
      ['traffic_spike',              'cpu_utilization'],
      ['memory_leak',                'memory_jvm'],
      ['memory_leak',                'error_rate'],
      ['dependency_outage',          'error_rate'],
      ['dependency_outage',          'fault_rate'],
    ]
    pairs.forEach(([it, arch]) => {
      const profile = getIncidentResponse(it, arch)
      expect(profile).not.toBeNull()
      expect(profile!.overlay).toBeTruthy()
      expect(profile!.defaultPeakFactor).toBeGreaterThan(0)
    })
  })

  it('returns null for unregistered incident type', () => {
    expect(getIncidentResponse('unknown_type', 'error_rate')).toBeNull()
  })

  it('returns null for unregistered archetype within known incident type', () => {
    expect(getIncidentResponse('bad_deploy_latency', 'disk_iops')).toBeNull()
  })

  it('all five incident types are registered', () => {
    const types = [
      'connection_pool_exhaustion', 'bad_deploy_latency', 'traffic_spike',
      'memory_leak', 'dependency_outage',
    ]
    types.forEach(t => expect(INCIDENT_TYPE_REGISTRY[t]).toBeDefined())
  })

  it('connection_pool_exhaustion connection_pool_used uses saturation overlay', () => {
    const p = getIncidentResponse('connection_pool_exhaustion', 'connection_pool_used')
    expect(p!.overlay).toBe('saturation')
  })

  it('bad_deploy_latency p99_latency_ms uses spike_and_sustain', () => {
    const p = getIncidentResponse('bad_deploy_latency', 'p99_latency_ms')
    expect(p!.overlay).toBe('spike_and_sustain')
  })

  it('memory_leak memory_jvm uses gradual_degradation', () => {
    const p = getIncidentResponse('memory_leak', 'memory_jvm')
    expect(p!.overlay).toBe('gradual_degradation')
    expect(p!.defaultOnsetOffset).toBeLessThan(0)  // precursor
  })

  it('dependency_outage error_rate has high peak factor (20x)', () => {
    const p = getIncidentResponse('dependency_outage', 'error_rate')
    expect(p!.defaultPeakFactor).toBeGreaterThanOrEqual(15)
  })
})

describe('validateIncidentType', () => {
  it('returns true for registered incident types', () => {
    expect(validateIncidentType('bad_deploy_latency')).toBe(true)
    expect(validateIncidentType('traffic_spike')).toBe(true)
  })

  it('returns false for unregistered incident type', () => {
    expect(validateIncidentType('nonexistent_incident')).toBe(false)
  })
})
