import type { ResolvedMetricParams } from "../types";

export function applyIncidentOverlay(
  series: number[],
  params: ResolvedMetricParams,
  tAxis: number[],
): number[] {
  if (params.overlay === "none") return [...series];

  const result = [...series];
  const {
    overlay,
    onsetSecond,
    peakValue,
    dropFactor,
    ceiling,
    saturationDurationSeconds,
    rampDurationSeconds,
    baselineValue,
  } = params;

  for (let i = 0; i < tAxis.length; i++) {
    const t = tAxis[i];
    if (t < onsetSecond) continue;

    const elapsed = t - onsetSecond;
    const current = result[i];

    switch (overlay) {
      case "spike_and_sustain": {
        const rampFraction =
          rampDurationSeconds > 0
            ? Math.min(elapsed / rampDurationSeconds, 1.0)
            : 1.0;
        const incidentDelta = (peakValue - baselineValue) * rampFraction;
        result[i] = current + incidentDelta;
        break;
      }

      case "sudden_drop": {
        result[i] = current * dropFactor;
        break;
      }

      case "saturation": {
        const satFraction =
          saturationDurationSeconds > 0
            ? Math.min(elapsed / saturationDurationSeconds, 1.0)
            : 1.0;
        const targetValue =
          baselineValue + (ceiling - baselineValue) * satFraction;
        const noiseComponent = current - baselineValue;
        result[i] = targetValue + noiseComponent * (1 - satFraction);
        break;
      }

      case "gradual_degradation": {
        const scenarioDuration = tAxis[tAxis.length - 1] - onsetSecond;
        const fraction =
          scenarioDuration > 0
            ? Math.min(elapsed / scenarioDuration, 1.0)
            : 1.0;
        const incidentDelta = (peakValue - baselineValue) * fraction;
        result[i] = current + incidentDelta;
        break;
      }
    }
  }

  return result;
}

export function clampSeries(
  series: number[],
  minValue: number,
  maxValue: number,
): number[] {
  return series.map((v) => Math.max(minValue, Math.min(maxValue, v)));
}
