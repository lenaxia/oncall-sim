// resolver.ts — resolves full metric parameters from layered config.
// Precedence: author config → incident type registry → archetype defaults → scale derivation.

import type {
  MetricConfig, FocalServiceConfig, CorrelatedServiceConfig,
  LoadedScenario, NoiseLevel,
} from '../scenario/types'
import type { ResolvedMetricParams } from './types'
import { NOISE_LEVEL_MULTIPLIERS, HEALTH_MULTIPLIERS } from './types'
import { getArchetypeDefaults } from './archetypes'
import { getIncidentResponse } from './incident-types'

// Re-exported here per LLD §2 public API contract
export { validateIncidentType } from './incident-types'

// djb2 hash — matches LLD §5 spec exactly
function deriveMetricSeed(scenarioId: string, sessionId: string, metricId: string): number {
  const str = `${scenarioId}:${sessionId}:${metricId}`
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i)
    hash |= 0   // force 32-bit integer
  }
  return Math.abs(hash)
}

/**
 * Resolves full parameters for a single metric config entry.
 * Precedence: author config → incident type registry → archetype defaults → scale derivation.
 */
export function resolveMetricParams(
  metricConfig: MetricConfig,
  serviceConfig: FocalServiceConfig | CorrelatedServiceConfig,
  scenarioConfig: LoadedScenario,
  sessionId: string
): ResolvedMetricParams {
  const { opsDashboard } = scenarioConfig
  const archDef    = getArchetypeDefaults(metricConfig.archetype)
  const isFocal = serviceConfig === opsDashboard.focalService
  // serviceConfig is FocalServiceConfig when isFocal — reference-equality guard established above
  const focalConfig  = serviceConfig as FocalServiceConfig
  const incidentType = isFocal ? focalConfig.incidentType : null

  // ── Identity ───────────────────────────────────────────────────────────────
  const service   = serviceConfig.name
  // metricId = archetype (uniqueness within a service is author's responsibility)
  const metricId  = metricConfig.archetype
  const label     = metricConfig.label ?? archDef.label
  const unit      = metricConfig.unit  ?? archDef.unit

  // ── Generation window ──────────────────────────────────────────────────────
  const fromSecond        = -opsDashboard.preIncidentSeconds
  const toSecond          = scenarioConfig.timeline.durationMinutes * 60
  const resolutionSeconds = scenarioConfig.opsDashboard.resolutionSeconds

  // ── Baseline ───────────────────────────────────────────────────────────────
  let baselineValue = metricConfig.baselineValue ?? 0
  if (metricConfig.baselineValue == null && archDef.scaleField && archDef.deriveBaseline) {
    const scale    = serviceConfig.scale
    const scaleVal = scale ? (scale as unknown as Record<string, number>)[archDef.scaleField] ?? null : null
    if (scaleVal != null) {
      baselineValue = archDef.deriveBaseline(scaleVal)
    }
  }
  // Fallback: archetypes with no derivation and no author value get a small non-zero default
  // so noise functions produce visible variation. Error/fault rate: 0.5% is a realistic idle value.
  if (baselineValue === 0) {
    if (metricConfig.archetype === 'error_rate' || metricConfig.archetype === 'fault_rate') {
      baselineValue = 0.5
    } else if (metricConfig.archetype !== 'cert_expiry') {
      baselineValue = 1.0
    }
  }

  // ── Rhythm ─────────────────────────────────────────────────────────────────
  const rhythmProfile  = isFocal
    ? focalConfig.trafficProfile
    : 'none'
  const inheritsRhythm = archDef.inheritsRhythm

  // ── Noise ──────────────────────────────────────────────────────────────────
  const noiseLevel: NoiseLevel  = metricConfig.noise ?? archDef.defaultNoiseLevel
  const noiseMult               = NOISE_LEVEL_MULTIPLIERS[noiseLevel]
  const healthMult              = HEALTH_MULTIPLIERS[serviceConfig.health] ?? 1.0
  const noiseLevelMultiplier    = noiseMult * healthMult
  const noiseType               = archDef.noiseType

  // ── Incident overlay ───────────────────────────────────────────────────────
  // Priority: author Tier 3 (incident_response) → author Tier 2 (incident_peak) →
  //           incident type registry → no overlay

  let overlay:                   ResolvedMetricParams['overlay'] = 'none'
  let onsetSecond                = 0
  let peakValue                  = baselineValue
  let dropFactor                 = 1.0
  let ceiling                    = baselineValue
  let saturationDurationSeconds  = 60
  let rampDurationSeconds        = 30

  const ir = metricConfig.incidentResponse
  if (ir) {
    // Tier 3 — author supplied full incident_response block
    overlay                  = ir.overlay as ResolvedMetricParams['overlay']
    onsetSecond              = ir.onsetSecond              ?? metricConfig.onsetSecond ?? 0
    rampDurationSeconds      = ir.rampDurationSeconds      ?? 30
    saturationDurationSeconds = ir.saturationDurationSeconds ?? 60

    if (ir.peakValue != null) {
      peakValue  = ir.peakValue
      dropFactor = ir.peakValue / Math.max(baselineValue, 0.001)
      ceiling    = ir.peakValue
    } else if (ir.dropFactor != null) {
      dropFactor = ir.dropFactor
      peakValue  = baselineValue * ir.dropFactor
      ceiling    = baselineValue
    }
  } else if (metricConfig.incidentPeak != null && incidentType != null) {
    // Tier 2 — author knows incident_peak; get overlay shape from registry
    const regProfile = getIncidentResponse(incidentType, metricConfig.archetype)
    if (regProfile) {
      overlay     = regProfile.overlay
      onsetSecond = metricConfig.onsetSecond ?? regProfile.defaultOnsetOffset
      peakValue   = metricConfig.incidentPeak
      dropFactor  = metricConfig.incidentPeak / Math.max(baselineValue, 0.001)
      ceiling     = metricConfig.incidentPeak
    }
  } else if (metricConfig.incidentPeak != null) {
    // Tier 2 without a registry match — spike_and_sustain by convention
    overlay     = 'spike_and_sustain'
    onsetSecond = metricConfig.onsetSecond ?? 0
    peakValue   = metricConfig.incidentPeak
    dropFactor  = metricConfig.incidentPeak / Math.max(baselineValue, 0.001)
    ceiling     = metricConfig.incidentPeak
  } else if (incidentType != null) {
    // Tier 1 — no author values, fully driven by registry
    const regProfile = getIncidentResponse(incidentType, metricConfig.archetype)
    if (regProfile) {
      overlay     = regProfile.overlay
      onsetSecond = metricConfig.onsetSecond ?? regProfile.defaultOnsetOffset
      peakValue   = baselineValue * regProfile.defaultPeakFactor
      dropFactor  = regProfile.defaultPeakFactor
      ceiling     = peakValue
    }
  }

  // Exonerated / independent services — overlay always none regardless of any config
  if ('correlation' in serviceConfig &&
      (serviceConfig.correlation === 'exonerated' || serviceConfig.correlation === 'independent')) {
    overlay = 'none'
  }

  // ── Series override ────────────────────────────────────────────────────────
  const seriesOverride = metricConfig.seriesOverride ?? null

  // ── PRNG seed ──────────────────────────────────────────────────────────────
  const seed = deriveMetricSeed(scenarioConfig.id, sessionId, `${service}:${metricId}`)

  return {
    metricId, service, archetype: metricConfig.archetype, label, unit,
    fromSecond, toSecond, resolutionSeconds,
    baselineValue,
    rhythmProfile, inheritsRhythm,
    noiseType, noiseLevelMultiplier,
    overlay, onsetSecond, peakValue, dropFactor,
    ceiling, saturationDurationSeconds, rampDurationSeconds,
    seriesOverride,
    seed,
  }
}

/** Exposed for testing seed derivation independently. */
export function deriveMetricSeedExported(
  scenarioId: string, sessionId: string, metricId: string
): number {
  return deriveMetricSeed(scenarioId, sessionId, metricId)
}
