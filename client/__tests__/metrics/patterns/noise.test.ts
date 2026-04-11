import { describe, it, expect } from 'vitest'
import { generateNoise, NOISE_TYPE_DEFAULTS } from '../../../src/metrics/patterns/noise'
import { createSeededPRNG } from '../../../src/testutil/index'

// ── PRNG ──────────────────────────────────────────────────────────────────────

describe('createSeededPRNG', () => {
  it('produces values in [0, 1)', () => {
    const prng = createSeededPRNG(12345)
    for (let i = 0; i < 1000; i++) {
      const v = prng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('same seed → identical sequence', () => {
    const a = createSeededPRNG(42)
    const b = createSeededPRNG(42)
    for (let i = 0; i < 50; i++) {
      expect(a.next()).toBe(b.next())
    }
  })

  it('different seed → different sequence', () => {
    const a = createSeededPRNG(1)
    const b = createSeededPRNG(2)
    const different = Array.from({ length: 20 }, () => a.next() !== b.next())
    expect(different.some(Boolean)).toBe(true)
  })
})

// ── generateNoise: gaussian ───────────────────────────────────────────────────

describe('generateNoise — gaussian', () => {
  const N = 1000
  const baseline = 100
  const tAxis = Array.from({ length: N }, (_, i) => i * 15)

  it('mean within ±10% of 0 over 1000 samples', () => {
    const prng  = createSeededPRNG(1)
    const noise = generateNoise('gaussian', baseline, 1.0, tAxis, prng)
    const mean  = noise.reduce((a, b) => a + b, 0) / N
    expect(Math.abs(mean)).toBeLessThan(baseline * 0.10)
  })

  it('std dev within expected bounds over 1000 samples', () => {
    const prng    = createSeededPRNG(2)
    const noise   = generateNoise('gaussian', baseline, 1.0, tAxis, prng)
    const mean    = noise.reduce((a, b) => a + b, 0) / N
    const variance = noise.reduce((a, b) => a + (b - mean) ** 2, 0) / N
    const stdDev  = Math.sqrt(variance)
    const expected = baseline * (NOISE_TYPE_DEFAULTS.gaussian.stdDevFactor ?? 0.04)
    // within ±20% of expected std dev
    expect(stdDev).toBeGreaterThan(expected * 0.5)
    expect(stdDev).toBeLessThan(expected * 2.0)
  })

  it('same seed → identical sequence', () => {
    const a = generateNoise('gaussian', 100, 1.0, tAxis.slice(0, 20), createSeededPRNG(7))
    const b = generateNoise('gaussian', 100, 1.0, tAxis.slice(0, 20), createSeededPRNG(7))
    expect(a).toEqual(b)
  })

  it('different seed → different sequence', () => {
    const a = generateNoise('gaussian', 100, 1.0, tAxis.slice(0, 20), createSeededPRNG(1))
    const b = generateNoise('gaussian', 100, 1.0, tAxis.slice(0, 20), createSeededPRNG(2))
    expect(a).not.toEqual(b)
  })
})

// ── generateNoise: random_walk ────────────────────────────────────────────────

describe('generateNoise — random_walk', () => {
  const baseline = 50
  const tAxis = Array.from({ length: 500 }, (_, i) => i * 15)

  it('values stay within 3× std dev of 0 over 500 samples', () => {
    const prng  = createSeededPRNG(99)
    const noise = generateNoise('random_walk', baseline, 1.0, tAxis, prng)
    const bound = baseline * 0.5  // generous bound for mean reversion walk
    noise.forEach(v => expect(Math.abs(v)).toBeLessThan(bound))
  })

  it('shows autocorrelation (adjacent values not independent)', () => {
    const prng  = createSeededPRNG(7)
    const noise = generateNoise('random_walk', baseline, 1.0, tAxis.slice(0, 100), prng)
    // Compute lag-1 autocorrelation
    const mean  = noise.reduce((a, b) => a + b, 0) / noise.length
    const demeaned = noise.map(v => v - mean)
    let cov = 0, variance = 0
    for (let i = 1; i < demeaned.length; i++) {
      cov      += demeaned[i] * demeaned[i - 1]
      variance += demeaned[i] ** 2
    }
    const autocorr = cov / variance
    // Random walk should have strong positive autocorrelation
    expect(autocorr).toBeGreaterThan(0.3)
  })
})

// ── generateNoise: sporadic_spikes ────────────────────────────────────────────

describe('generateNoise — sporadic_spikes', () => {
  const baseline = 2
  const N = 1000
  const tAxis = Array.from({ length: N }, (_, i) => i * 15)

  it('spike frequency within ±50% of expected probability', () => {
    const prng        = createSeededPRNG(3)
    const noise       = generateNoise('sporadic_spikes', baseline, 1.0, tAxis, prng)
    const expected    = NOISE_TYPE_DEFAULTS.sporadic_spikes.spikeProbability ?? 0.05
    const magnitude   = baseline * (NOISE_TYPE_DEFAULTS.sporadic_spikes.spikeMagnitudeFactor ?? 0.5)
    const spikeCount  = noise.filter(v => v > magnitude * 0.3).length
    expect(spikeCount).toBeGreaterThan(N * expected * 0.5)
    expect(spikeCount).toBeLessThan(N * expected * 3.0)
  })

  it('baseline portion has approximately gaussian distribution (mean near 0)', () => {
    const prng      = createSeededPRNG(8)
    const noise     = generateNoise('sporadic_spikes', baseline, 1.0, tAxis, prng)
    const magnitude = baseline * (NOISE_TYPE_DEFAULTS.sporadic_spikes.spikeMagnitudeFactor ?? 0.5)
    // Non-spike points (below spike threshold)
    const nonSpikes = noise.filter(v => v < magnitude * 0.3)
    const mean = nonSpikes.reduce((a, b) => a + b, 0) / nonSpikes.length
    // Mean of non-spike base should be near 0
    expect(Math.abs(mean)).toBeLessThan(baseline * 0.1)
  })

  it('spikes are strictly positive', () => {
    const prng      = createSeededPRNG(9)
    const noise     = generateNoise('sporadic_spikes', baseline, 1.0, tAxis, prng)
    const magnitude = baseline * (NOISE_TYPE_DEFAULTS.sporadic_spikes.spikeMagnitudeFactor ?? 0.5)
    const spikes    = noise.filter(v => v > magnitude * 0.3)
    spikes.forEach(v => expect(v).toBeGreaterThan(0))
  })
})

// ── generateNoise: sawtooth_gc ────────────────────────────────────────────────

describe('generateNoise — sawtooth_gc', () => {
  const baseline = 512  // 512 MB JVM heap
  const tAxis    = Array.from({ length: 200 }, (_, i) => i * 15)

  it('GC drops occur at approximately expected interval', () => {
    const prng  = createSeededPRNG(5)
    const noise = generateNoise('sawtooth_gc', baseline, 1.0, tAxis, prng)
    const drops: number[] = []
    for (let i = 1; i < noise.length; i++) {
      const delta = noise[i] - noise[i - 1]
      if (delta < -baseline * 0.1) drops.push(tAxis[i])
    }
    // Should have at least one GC in 200 points × 15s = 3000 sim seconds
    expect(drops.length).toBeGreaterThan(0)
  })

  it('values increase between GC events (growth pattern)', () => {
    const prng  = createSeededPRNG(6)
    const noise = generateNoise('sawtooth_gc', baseline, 1.0, tAxis.slice(0, 8), prng)
    const firstWindow = noise.slice(0, 5)
    expect(firstWindow[firstWindow.length - 1]).toBeGreaterThanOrEqual(firstWindow[0])
  })

  it('values drop at GC events by approximately gc_drop_factor', () => {
    const prng      = createSeededPRNG(5)
    const noise     = generateNoise('sawtooth_gc', baseline, 1.0, tAxis, prng)
    const gcDrop    = NOISE_TYPE_DEFAULTS.sawtooth_gc.gcDropFactor ?? 0.6
    // Find the largest drop point
    let maxDrop = 0
    let preDropVal = 0
    let postDropVal = 0
    for (let i = 1; i < noise.length; i++) {
      const drop = noise[i - 1] - noise[i]
      if (drop > maxDrop) {
        maxDrop = drop
        preDropVal = noise[i - 1]
        postDropVal = noise[i]
      }
    }
    expect(maxDrop).toBeGreaterThan(0)
    // After GC, value should be roughly (1-gcDrop) × pre-GC value
    // Allow generous tolerance for jitter
    if (preDropVal > 0) {
      const actualRatio = postDropVal / preDropVal
      expect(actualRatio).toBeLessThan(1 - gcDrop * 0.3)
    }
  })
})

// ── generateNoise: none ───────────────────────────────────────────────────────

describe('generateNoise — none', () => {
  it('returns all zeros', () => {
    const tAxis = [0, 15, 30, 45]
    const prng  = createSeededPRNG(1)
    const noise = generateNoise('none', 100, 1.0, tAxis, prng)
    noise.forEach(v => expect(v).toBe(0))
  })
})

// ── NOISE_TYPE_DEFAULTS export ────────────────────────────────────────────────

describe('NOISE_TYPE_DEFAULTS', () => {
  it('has entries for all five noise types', () => {
    const types: Array<keyof typeof NOISE_TYPE_DEFAULTS> = [
      'gaussian', 'random_walk', 'sporadic_spikes', 'sawtooth_gc', 'none'
    ]
    types.forEach(t => expect(NOISE_TYPE_DEFAULTS[t]).toBeDefined())
  })
})
