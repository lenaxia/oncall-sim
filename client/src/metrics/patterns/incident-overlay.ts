import type { OverlayApplication } from "../types";

/**
 * Applies a single OverlayApplication to a series in-place and returns a new array.
 * Handles onsetSecond (skips points before onset) and endSecond (skips points at/after endSecond).
 * Does not mutate the input series.
 */
export function applyIncidentOverlay(
  series: number[],
  baselineValue: number,
  app: OverlayApplication,
  tAxis: number[],
): number[] {
  if (app.overlay === "none") return [...series];

  const result = [...series];
  const {
    overlay,
    onsetSecond,
    endSecond,
    peakValue,
    dropFactor,
    ceiling,
    saturationDurationSeconds,
    rampDurationSeconds,
  } = app;

  for (let i = 0; i < tAxis.length; i++) {
    const t = tAxis[i];
    if (t < onsetSecond) continue;
    if (endSecond != null && t >= endSecond) continue;

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
