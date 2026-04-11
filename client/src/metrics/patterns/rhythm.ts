import type { TrafficProfile } from "../../scenario/types";

export interface TrafficProfileParams {
  pattern:
    | "sinusoidal_weekly"
    | "sinusoidal_daily"
    | "sawtooth_daily"
    | "sawtooth_weekly"
    | "flat_ripple"
    | "flat";
  dailyPeakFactor: number;
  dailyTroughFactor: number;
  peakHourUTC: number;
  weekendFactor: number;
  batchWindowHourUTC?: number;
  batchDurationHours?: number;
}

export const TRAFFIC_PROFILES: Record<TrafficProfile, TrafficProfileParams> = {
  business_hours_web: {
    pattern: "sinusoidal_weekly",
    dailyPeakFactor: 1.35,
    dailyTroughFactor: 0.45,
    peakHourUTC: 19,
    weekendFactor: 0.55,
  },
  business_hours_b2b: {
    pattern: "sinusoidal_weekly",
    dailyPeakFactor: 1.3,
    dailyTroughFactor: 0.2,
    peakHourUTC: 16,
    weekendFactor: 0.15,
  },
  always_on_api: {
    pattern: "flat_ripple",
    dailyPeakFactor: 1.08,
    dailyTroughFactor: 0.92,
    peakHourUTC: 14,
    weekendFactor: 0.95,
  },
  batch_nightly: {
    pattern: "sawtooth_daily",
    dailyPeakFactor: 3.5,
    dailyTroughFactor: 0.05,
    peakHourUTC: 5,
    weekendFactor: 1.0,
    batchWindowHourUTC: 3,
    batchDurationHours: 4,
  },
  batch_weekly: {
    pattern: "sawtooth_weekly",
    dailyPeakFactor: 4.0,
    dailyTroughFactor: 0.05,
    peakHourUTC: 5,
    weekendFactor: 0.1,
    batchWindowHourUTC: 3,
    batchDurationHours: 8,
  },
  none: {
    pattern: "flat",
    dailyPeakFactor: 1.0,
    dailyTroughFactor: 1.0,
    peakHourUTC: 0,
    weekendFactor: 1.0,
  },
};

const SECONDS_PER_DAY = 86400;
const SECONDS_PER_WEEK = 604800;

function rhythmMultiplier(t: number, params: TrafficProfileParams): number {
  const {
    pattern,
    dailyPeakFactor,
    dailyTroughFactor,
    peakHourUTC,
    weekendFactor,
    batchWindowHourUTC,
    batchDurationHours,
  } = params;

  const MON_MIDNIGHT_UTC = 0;
  const absT = t - MON_MIDNIGHT_UTC;
  const dayOfWeek = Math.floor(
    (((absT % SECONDS_PER_WEEK) + SECONDS_PER_WEEK) % SECONDS_PER_WEEK) /
      SECONDS_PER_DAY,
  );
  const secOfDay =
    ((absT % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  const hourOfDay = secOfDay / 3600;
  const isWeekend = dayOfWeek >= 5;

  if (pattern === "flat") return 1.0;

  const amplitude = (dailyPeakFactor - dailyTroughFactor) / 2;
  const midpoint = (dailyPeakFactor + dailyTroughFactor) / 2;

  if (
    pattern === "sinusoidal_weekly" ||
    pattern === "sinusoidal_daily" ||
    pattern === "flat_ripple"
  ) {
    const phaseRad = ((hourOfDay - peakHourUTC) / 24) * 2 * Math.PI;
    const daily = midpoint + amplitude * Math.cos(phaseRad);
    const wkFactor = isWeekend ? weekendFactor : 1.0;
    return daily * wkFactor;
  }

  if (pattern === "sawtooth_daily" || pattern === "sawtooth_weekly") {
    const bwStart = batchWindowHourUTC ?? 3;
    const bwDuration = batchDurationHours ?? 4;
    const bwEnd = bwStart + bwDuration;
    const inBatch = hourOfDay >= bwStart && hourOfDay < bwEnd;

    if (inBatch) {
      const progress = (hourOfDay - bwStart) / bwDuration;
      const rampUp = Math.min(progress * 3, 1.0);
      return dailyTroughFactor + rampUp * (dailyPeakFactor - dailyTroughFactor);
    }
    const wkFactor =
      pattern === "sawtooth_weekly" && isWeekend ? weekendFactor : 1.0;
    return dailyTroughFactor * wkFactor;
  }

  return 1.0;
}

export function generateRhythm(
  profile: TrafficProfile,
  baselineValue: number,
  tAxis: number[],
): number[] {
  if (profile === "none") return tAxis.map(() => 0);
  const params = TRAFFIC_PROFILES[profile];
  return tAxis.map((t) => {
    const multiplier = rhythmMultiplier(t, params);
    return baselineValue * (multiplier - 1.0);
  });
}
