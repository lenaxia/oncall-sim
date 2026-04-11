import type { NoiseType } from "../types";

export interface SeededPRNG {
  next(): number;
}

export function createSeededPRNG(seed: number): SeededPRNG {
  let s = seed >>> 0;
  return {
    next(): number {
      s += 0x6d2b79f5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
    },
  };
}

interface NoiseTypeParams {
  stdDevFactor?: number;
  walkStdDev?: number;
  reversionStrength?: number;
  baseSdFactor?: number;
  spikeProbability?: number;
  spikeMagnitudeFactor?: number;
  gcPeriodSeconds?: number;
  gcDropFactor?: number;
  interGcGrowthRate?: number;
}

export const NOISE_TYPE_DEFAULTS: Record<NoiseType, NoiseTypeParams> = {
  gaussian: { stdDevFactor: 0.04 },
  random_walk: { walkStdDev: 0.015, reversionStrength: 0.05 },
  sporadic_spikes: {
    baseSdFactor: 0.02,
    spikeProbability: 0.05,
    spikeMagnitudeFactor: 0.5,
  },
  sawtooth_gc: {
    gcPeriodSeconds: 120,
    gcDropFactor: 0.6,
    interGcGrowthRate: 0.003,
  },
  none: {},
};

function gaussianSample(
  prng: SeededPRNG,
  mean: number,
  stdDev: number,
): number {
  const u1 = Math.max(prng.next(), 1e-10);
  const u2 = prng.next();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

function gaussianNoise(
  baselineValue: number,
  multiplier: number,
  tAxis: number[],
  prng: SeededPRNG,
): number[] {
  const p = NOISE_TYPE_DEFAULTS.gaussian;
  const stdDev = baselineValue * (p.stdDevFactor ?? 0.04) * multiplier;
  return tAxis.map(() => gaussianSample(prng, 0, stdDev));
}

function randomWalkNoise(
  baselineValue: number,
  multiplier: number,
  tAxis: number[],
  prng: SeededPRNG,
): number[] {
  const p = NOISE_TYPE_DEFAULTS.random_walk;
  const stepSd = baselineValue * (p.walkStdDev ?? 0.015) * multiplier;
  const reversion = p.reversionStrength ?? 0.05;
  const deltas: number[] = [];
  let walk = 0;
  for (let i = 0; i < tAxis.length; i++) {
    walk += gaussianSample(prng, 0, stepSd);
    walk -= walk * reversion;
    deltas.push(walk);
  }
  return deltas;
}

function sporadicSpikesNoise(
  baselineValue: number,
  multiplier: number,
  tAxis: number[],
  prng: SeededPRNG,
): number[] {
  const p = NOISE_TYPE_DEFAULTS.sporadic_spikes;
  const baseSd = baselineValue * (p.baseSdFactor ?? 0.02) * multiplier;
  const spikeProb = p.spikeProbability ?? 0.05;
  const spikeMag = baselineValue * (p.spikeMagnitudeFactor ?? 0.5) * multiplier;
  return tAxis.map(() => {
    const base = gaussianSample(prng, 0, baseSd);
    const isSpike = prng.next() < spikeProb;
    return isSpike
      ? base + Math.abs(gaussianSample(prng, spikeMag, spikeMag * 0.3))
      : base;
  });
}

function sawtoothGcNoise(
  baselineValue: number,
  multiplier: number,
  tAxis: number[],
  prng: SeededPRNG,
): number[] {
  const p = NOISE_TYPE_DEFAULTS.sawtooth_gc;
  const gcPeriod = p.gcPeriodSeconds ?? 120;
  const gcDrop = p.gcDropFactor ?? 0.6;
  const growthRate = (p.interGcGrowthRate ?? 0.003) * multiplier;
  const deltas: number[] = [];
  let accumulated = 0;
  let lastGcT = tAxis[0] ?? 0;

  for (let i = 0; i < tAxis.length; i++) {
    const t = tAxis[i];
    const elapsed = t - lastGcT;
    if (elapsed >= gcPeriod) {
      accumulated *= 1 - gcDrop;
      lastGcT = t;
    }
    accumulated +=
      baselineValue * growthRate * (i > 0 ? tAxis[i] - tAxis[i - 1] : 0);
    deltas.push(accumulated + gaussianSample(prng, 0, baselineValue * 0.01));
  }
  return deltas;
}

export function generateNoise(
  noiseType: NoiseType,
  baselineValue: number,
  noiseLevelMultiplier: number,
  tAxis: number[],
  prng: SeededPRNG,
): number[] {
  if (tAxis.length === 0) return [];
  switch (noiseType) {
    case "gaussian":
      return gaussianNoise(baselineValue, noiseLevelMultiplier, tAxis, prng);
    case "random_walk":
      return randomWalkNoise(baselineValue, noiseLevelMultiplier, tAxis, prng);
    case "sporadic_spikes":
      return sporadicSpikesNoise(
        baselineValue,
        noiseLevelMultiplier,
        tAxis,
        prng,
      );
    case "sawtooth_gc":
      return sawtoothGcNoise(baselineValue, noiseLevelMultiplier, tAxis, prng);
    case "none":
      return tAxis.map(() => 0);
  }
}
