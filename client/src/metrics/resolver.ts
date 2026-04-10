// resolver.ts — resolves full metric parameters from layered config.

import type {
  MetricConfig,
  FocalServiceConfig,
  CorrelatedServiceConfig,
  LoadedScenario,
  NoiseLevel,
} from "../scenario/types";
import type { ResolvedMetricParams } from "./types";
import { NOISE_LEVEL_MULTIPLIERS, HEALTH_MULTIPLIERS } from "./types";
import { getArchetypeDefaults } from "./archetypes";
import { getIncidentResponse } from "./incident-types";

export { validateIncidentType } from "./incident-types";

function deriveMetricSeed(
  scenarioId: string,
  sessionId: string,
  metricId: string,
): number {
  const str = `${scenarioId}:${sessionId}:${metricId}`;
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function resolveMetricParams(
  metricConfig: MetricConfig,
  serviceConfig: FocalServiceConfig | CorrelatedServiceConfig,
  scenarioConfig: LoadedScenario,
  sessionId: string,
): ResolvedMetricParams {
  const { opsDashboard } = scenarioConfig;
  const archDef = getArchetypeDefaults(metricConfig.archetype);
  const isFocal = serviceConfig === opsDashboard.focalService;
  const focalConfig = serviceConfig as FocalServiceConfig;
  const incidentType = isFocal ? focalConfig.incidentType : null;

  const service = serviceConfig.name;
  const metricId = metricConfig.archetype;
  const label = metricConfig.label ?? archDef.label;
  const unit = metricConfig.unit ?? archDef.unit;

  const fromSecond = -opsDashboard.preIncidentSeconds;
  const toSecond = scenarioConfig.timeline.durationMinutes * 60;
  const resolutionSeconds = scenarioConfig.opsDashboard.resolutionSeconds;

  let baselineValue = metricConfig.baselineValue ?? 0;
  if (
    metricConfig.baselineValue == null &&
    archDef.scaleField &&
    archDef.deriveBaseline
  ) {
    const scale = serviceConfig.scale;
    const scaleVal = scale
      ? ((scale as unknown as Record<string, number>)[archDef.scaleField] ??
        null)
      : null;
    if (scaleVal != null) {
      baselineValue = archDef.deriveBaseline(scaleVal);
    }
  }
  if (baselineValue === 0) {
    if (
      metricConfig.archetype === "error_rate" ||
      metricConfig.archetype === "fault_rate"
    ) {
      baselineValue = 0.5;
    } else if (metricConfig.archetype !== "cert_expiry") {
      baselineValue = 1.0;
    }
  }

  const rhythmProfile = isFocal ? focalConfig.trafficProfile : "none";
  const inheritsRhythm = archDef.inheritsRhythm;

  const noiseLevel: NoiseLevel =
    metricConfig.noise ?? archDef.defaultNoiseLevel;
  const noiseMult = NOISE_LEVEL_MULTIPLIERS[noiseLevel];
  const healthMult = HEALTH_MULTIPLIERS[serviceConfig.health] ?? 1.0;
  const noiseLevelMultiplier = noiseMult * healthMult;
  const noiseType = archDef.noiseType;

  let overlay: ResolvedMetricParams["overlay"] = "none";
  let onsetSecond = 0;
  let peakValue = baselineValue;
  let dropFactor = 1.0;
  let ceiling = baselineValue;
  let saturationDurationSeconds = 60;
  let rampDurationSeconds = 30;

  const ir = metricConfig.incidentResponse;
  if (ir) {
    overlay = ir.overlay as ResolvedMetricParams["overlay"];
    onsetSecond = ir.onsetSecond ?? metricConfig.onsetSecond ?? 0;
    rampDurationSeconds = ir.rampDurationSeconds ?? 30;
    saturationDurationSeconds = ir.saturationDurationSeconds ?? 60;
    if (ir.peakValue != null) {
      peakValue = ir.peakValue;
      dropFactor = ir.peakValue / Math.max(baselineValue, 0.001);
      ceiling = ir.peakValue;
    } else if (ir.dropFactor != null) {
      dropFactor = ir.dropFactor;
      peakValue = baselineValue * ir.dropFactor;
      ceiling = baselineValue;
    }
  } else if (metricConfig.incidentPeak != null && incidentType != null) {
    const regProfile = getIncidentResponse(
      incidentType,
      metricConfig.archetype,
    );
    if (regProfile) {
      overlay = regProfile.overlay;
      onsetSecond = metricConfig.onsetSecond ?? regProfile.defaultOnsetOffset;
      peakValue = metricConfig.incidentPeak;
      dropFactor = metricConfig.incidentPeak / Math.max(baselineValue, 0.001);
      ceiling = metricConfig.incidentPeak;
    }
  } else if (metricConfig.incidentPeak != null) {
    overlay = "spike_and_sustain";
    onsetSecond = metricConfig.onsetSecond ?? 0;
    peakValue = metricConfig.incidentPeak;
    dropFactor = metricConfig.incidentPeak / Math.max(baselineValue, 0.001);
    ceiling = metricConfig.incidentPeak;
  } else if (incidentType != null) {
    const regProfile = getIncidentResponse(
      incidentType,
      metricConfig.archetype,
    );
    if (regProfile) {
      overlay = regProfile.overlay;
      onsetSecond = metricConfig.onsetSecond ?? regProfile.defaultOnsetOffset;
      peakValue = baselineValue * regProfile.defaultPeakFactor;
      dropFactor = regProfile.defaultPeakFactor;
      ceiling = peakValue;
    }
  }

  if (
    "correlation" in serviceConfig &&
    (serviceConfig.correlation === "exonerated" ||
      serviceConfig.correlation === "independent")
  ) {
    overlay = "none";
  }

  const seriesOverride = metricConfig.seriesOverride ?? null;

  const seed = deriveMetricSeed(
    scenarioConfig.id,
    sessionId,
    `${service}:${metricId}`,
  );

  return {
    metricId,
    service,
    archetype: metricConfig.archetype,
    label,
    unit,
    fromSecond,
    toSecond,
    resolutionSeconds,
    baselineValue,
    resolvedValue: metricConfig.resolvedValue ?? baselineValue,
    rhythmProfile,
    inheritsRhythm,
    noiseType,
    noiseLevelMultiplier,
    // New: multi-incident overlay list from component-derived incidentResponses.
    // Falls back to empty when using old registry-based incidentType path.
    overlayApplications: metricConfig.incidentResponses ?? [],
    // Legacy single-overlay fields (kept for old incidentType registry path)
    overlay,
    onsetSecond,
    peakValue,
    dropFactor,
    ceiling,
    saturationDurationSeconds,
    rampDurationSeconds,
    seriesOverride,
    seed,
  };
}

export function deriveMetricSeedExported(
  scenarioId: string,
  sessionId: string,
  metricId: string,
): number {
  return deriveMetricSeed(scenarioId, sessionId, metricId);
}
