import { describe, it, expect, beforeAll } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { loadScenario, isScenarioLoadError } from '../../src/scenario/loader'
import { mulberry32, makeRng, LOG_PROFILES, getDensityMultiplier } from '../../src/scenario/log-profiles'
import { getFixtureScenarioDir } from '../../src/testutil/index'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadWithOverrides(overrides: Record<string, unknown>) {
  const fixtureDir = getFixtureScenarioDir()
  const fixtureSrc = fs.readFileSync(path.join(fixtureDir, 'scenario.yaml'), 'utf8')
  const fixtureObj = ((await import('js-yaml')).load(fixtureSrc)) as Record<string, unknown>
  Object.assign(fixtureObj, overrides)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oncall-log-test-'))
  fs.writeFileSync(path.join(tmpDir, 'scenario.yaml'), (await import('js-yaml')).dump(fixtureObj))
  return loadScenario(tmpDir)
}

// ── mulberry32 RNG ────────────────────────────────────────────────────────────

describe('mulberry32', () => {
  it('produces values in [0, 1)', () => {
    const rng = mulberry32(42)
    for (let i = 0; i < 100; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('is deterministic — same seed gives identical sequence', () => {
    const a = mulberry32(99)
    const b = mulberry32(99)
    for (let i = 0; i < 20; i++) {
      expect(a()).toBe(b())
    }
  })

  it('different seeds produce different sequences', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    const seqA = Array.from({ length: 10 }, () => a())
    const seqB = Array.from({ length: 10 }, () => b())
    expect(seqA).not.toEqual(seqB)
  })
})

describe('makeRng', () => {
  it('returns Math.random when seed is undefined', () => {
    // Can't identity-check Math.random directly — just confirm it returns values in [0,1)
    const rng = makeRng(undefined)
    const v = rng()
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThan(1)
  })

  it('returns a seeded RNG when seed is provided', () => {
    const a = makeRng(7)
    const b = makeRng(7)
    expect(a()).toBe(b())
  })

  it('unseeded calls produce non-identical results across two samples (statistical)', () => {
    // Probability of 20 consecutive identical values from Math.random is astronomically small
    const a = makeRng(undefined)
    const b = makeRng(undefined)
    const seqA = Array.from({ length: 20 }, () => a())
    const seqB = Array.from({ length: 20 }, () => b())
    expect(seqA).not.toEqual(seqB)
  })
})

// ── log_patterns expansion ────────────────────────────────────────────────────

describe('log_patterns — basic expansion', () => {
  it('expands a pattern into the correct number of entries', async () => {
    // from=0, to=60, interval=10 → 7 entries (0,10,20,30,40,50,60)
    const result = await loadWithOverrides({
      log_patterns: [{
        id: 'pat-a', level: 'WARN', service: 'svc', message: 'tick',
        interval_seconds: 10, from_second: 0, to_second: 60,
      }],
    })
    expect(isScenarioLoadError(result)).toBe(false)
    if (!isScenarioLoadError(result)) {
      const pat = result.logs.filter(l => l.id.startsWith('pat-a'))
      expect(pat.length).toBe(7)
    }
  })

  it('respects count cap', async () => {
    const result = await loadWithOverrides({
      log_patterns: [{
        id: 'pat-b', level: 'INFO', service: 'svc', message: 'tick',
        interval_seconds: 5, from_second: 0, to_second: 120, count: 4,
      }],
    })
    expect(isScenarioLoadError(result)).toBe(false)
    if (!isScenarioLoadError(result)) {
      const pat = result.logs.filter(l => l.id.startsWith('pat-b'))
      expect(pat.length).toBe(4)
    }
  })

  it('substitutes {n} in message with 1-based counter', async () => {
    const result = await loadWithOverrides({
      log_patterns: [{
        id: 'pat-c', level: 'ERROR', service: 'svc', message: 'attempt {n} failed',
        interval_seconds: 10, from_second: 0, to_second: 20,
      }],
    })
    expect(isScenarioLoadError(result)).toBe(false)
    if (!isScenarioLoadError(result)) {
      const pat = result.logs.filter(l => l.id.startsWith('pat-c'))
      expect(pat[0].message).toBe('attempt 1 failed')
      expect(pat[1].message).toBe('attempt 2 failed')
      expect(pat[2].message).toBe('attempt 3 failed')
    }
  })

  it('assigns sequential ids prefixed by pattern id', async () => {
    const result = await loadWithOverrides({
      log_patterns: [{
        id: 'my-pat', level: 'DEBUG', service: 'svc', message: 'msg',
        interval_seconds: 30, from_second: 0, to_second: 60,
      }],
    })
    expect(isScenarioLoadError(result)).toBe(false)
    if (!isScenarioLoadError(result)) {
      const pat = result.logs.filter(l => l.id.startsWith('my-pat'))
      expect(pat[0].id).toBe('my-pat-1')
      expect(pat[1].id).toBe('my-pat-2')
      expect(pat[2].id).toBe('my-pat-3')
    }
  })

  it('all entries have atSecond inside [from_second, to_second]', async () => {
    const result = await loadWithOverrides({
      log_patterns: [{
        id: 'pat-d', level: 'INFO', service: 'svc', message: 'msg',
        interval_seconds: 7, from_second: 10, to_second: 50,
      }],
    })
    expect(isScenarioLoadError(result)).toBe(false)
    if (!isScenarioLoadError(result)) {
      const pat = result.logs.filter(l => l.id.startsWith('pat-d'))
      for (const e of pat) {
        expect(e.atSecond).toBeGreaterThanOrEqual(10)
        expect(e.atSecond).toBeLessThanOrEqual(50)
      }
    }
  })
})

describe('log_patterns — jitter', () => {
  it('without jitter all timestamps are on exact interval multiples', async () => {
    const result = await loadWithOverrides({
      log_patterns: [{
        id: 'pat-exact', level: 'INFO', service: 'svc', message: 'msg',
        interval_seconds: 10, from_second: 0, to_second: 40,
      }],
    })
    expect(isScenarioLoadError(result)).toBe(false)
    if (!isScenarioLoadError(result)) {
      const pat = result.logs.filter(l => l.id.startsWith('pat-exact'))
      const times = pat.map(e => e.atSecond)
      expect(times).toEqual([0, 10, 20, 30, 40])
    }
  })

  it('with jitter timestamps are NOT all on exact multiples (statistical)', async () => {
    // With jitter=5 and interval=10, the chance every entry falls exactly on the
    // nominal time is astronomically small.
    const result = await loadWithOverrides({
      log_patterns: [{
        id: 'pat-jitter', level: 'INFO', service: 'svc', message: 'msg',
        interval_seconds: 10, from_second: 0, to_second: 100,
        jitter_seconds: 5, seed: 42,
      }],
    })
    expect(isScenarioLoadError(result)).toBe(false)
    if (!isScenarioLoadError(result)) {
      const pat = result.logs.filter(l => l.id.startsWith('pat-jitter'))
      const nominals = pat.map((_, i) => i * 10)
      const allExact = pat.every((e, i) => e.atSecond === nominals[i])
      expect(allExact).toBe(false)
    }
  })

  it('with jitter all entries still stay within [from_second, to_second]', async () => {
    const result = await loadWithOverrides({
      log_patterns: [{
        id: 'pat-j2', level: 'WARN', service: 'svc', message: 'msg',
        interval_seconds: 8, from_second: 5, to_second: 45,
        jitter_seconds: 6, seed: 1337,
      }],
    })
    expect(isScenarioLoadError(result)).toBe(false)
    if (!isScenarioLoadError(result)) {
      const pat = result.logs.filter(l => l.id.startsWith('pat-j2'))
      for (const e of pat) {
        expect(e.atSecond).toBeGreaterThanOrEqual(5)
        expect(e.atSecond).toBeLessThanOrEqual(45)
      }
    }
  })

  it('seeded jitter is deterministic across two loads', async () => {
    const opts = {
      log_patterns: [{
        id: 'pat-seed', level: 'DEBUG', service: 'svc', message: 'msg',
        interval_seconds: 5, from_second: 0, to_second: 50,
        jitter_seconds: 3, seed: 999,
      }],
    }
    const r1 = await loadWithOverrides(opts)
    const r2 = await loadWithOverrides(opts)
    expect(isScenarioLoadError(r1)).toBe(false)
    expect(isScenarioLoadError(r2)).toBe(false)
    if (!isScenarioLoadError(r1) && !isScenarioLoadError(r2)) {
      const a = r1.logs.filter(l => l.id.startsWith('pat-seed')).map(l => l.atSecond)
      const b = r2.logs.filter(l => l.id.startsWith('pat-seed')).map(l => l.atSecond)
      expect(a).toEqual(b)
    }
  })

  it('unseeded jitter produces different timestamps on two loads (statistical)', async () => {
    const opts = {
      log_patterns: [{
        id: 'pat-unseeded', level: 'INFO', service: 'svc', message: 'msg',
        interval_seconds: 5, from_second: 0, to_second: 100,
        jitter_seconds: 4,
        // no seed — live randomness
      }],
    }
    const r1 = await loadWithOverrides(opts)
    const r2 = await loadWithOverrides(opts)
    expect(isScenarioLoadError(r1)).toBe(false)
    expect(isScenarioLoadError(r2)).toBe(false)
    if (!isScenarioLoadError(r1) && !isScenarioLoadError(r2)) {
      const a = r1.logs.filter(l => l.id.startsWith('pat-unseeded')).map(l => l.atSecond)
      const b = r2.logs.filter(l => l.id.startsWith('pat-unseeded')).map(l => l.atSecond)
      expect(a).not.toEqual(b)
    }
  })
})

// ── background_logs expansion ─────────────────────────────────────────────────

describe('background_logs — basic expansion', () => {
  it('expands java_web_service profile into a non-empty log list', async () => {
    const result = await loadWithOverrides({
      background_logs: [{
        profile: 'java_web_service', service: 'payment-service',
        from_second: 0, to_second: 300, density: 'medium', seed: 1,
      }],
    })
    expect(isScenarioLoadError(result)).toBe(false)
    if (!isScenarioLoadError(result)) {
      const bg = result.logs.filter(l => l.id.startsWith('bg-0'))
      expect(bg.length).toBeGreaterThan(0)
    }
  })

  it('all background entries have atSecond inside [from_second, to_second]', async () => {
    const result = await loadWithOverrides({
      background_logs: [{
        profile: 'nodejs_api', service: 'api',
        from_second: 10, to_second: 200, density: 'medium', seed: 2,
      }],
    })
    expect(isScenarioLoadError(result)).toBe(false)
    if (!isScenarioLoadError(result)) {
      const bg = result.logs.filter(l => l.id.startsWith('bg-0'))
      for (const e of bg) {
        expect(e.atSecond).toBeGreaterThanOrEqual(10)
        expect(e.atSecond).toBeLessThanOrEqual(200)
      }
    }
  })

  it('high density produces more entries than low density', async () => {
    const base = {
      profile: 'java_web_service', service: 'svc',
      from_second: 0, to_second: 300,
    }
    const rHigh = await loadWithOverrides({ background_logs: [{ ...base, density: 'high',   seed: 5 }] })
    const rLow  = await loadWithOverrides({ background_logs: [{ ...base, density: 'low',    seed: 5 }] })
    expect(isScenarioLoadError(rHigh)).toBe(false)
    expect(isScenarioLoadError(rLow)).toBe(false)
    if (!isScenarioLoadError(rHigh) && !isScenarioLoadError(rLow)) {
      const cntHigh = rHigh.logs.filter(l => l.id.startsWith('bg-0')).length
      const cntLow  = rLow.logs.filter(l => l.id.startsWith('bg-0')).length
      expect(cntHigh).toBeGreaterThan(cntLow)
    }
  })

  it('entries only use messages defined in the profile', async () => {
    const profileLines = new Set(LOG_PROFILES['java_web_service'].lines.map(l => l.message))
    const result = await loadWithOverrides({
      background_logs: [{
        profile: 'java_web_service', service: 'svc',
        from_second: 0, to_second: 120, density: 'high', seed: 3,
      }],
    })
    expect(isScenarioLoadError(result)).toBe(false)
    if (!isScenarioLoadError(result)) {
      const bg = result.logs.filter(l => l.id.startsWith('bg-0'))
      for (const e of bg) {
        expect(profileLines.has(e.message)).toBe(true)
      }
    }
  })

  it('unknown profile is skipped with no error — scenario still loads', async () => {
    const result = await loadWithOverrides({
      background_logs: [{
        profile: 'nonexistent_profile_xyz', service: 'svc',
        from_second: 0, to_second: 60, density: 'medium', seed: 1,
      }],
    })
    expect(isScenarioLoadError(result)).toBe(false)
    if (!isScenarioLoadError(result)) {
      const bg = result.logs.filter(l => l.id.startsWith('bg-0'))
      expect(bg.length).toBe(0)
    }
  })
})

describe('background_logs — seeded vs unseeded RNG', () => {
  it('seeded background produces identical entries on two loads', async () => {
    const opts = {
      background_logs: [{
        profile: 'nodejs_api', service: 'svc',
        from_second: 0, to_second: 120, density: 'medium', seed: 77,
      }],
    }
    const r1 = await loadWithOverrides(opts)
    const r2 = await loadWithOverrides(opts)
    expect(isScenarioLoadError(r1)).toBe(false)
    expect(isScenarioLoadError(r2)).toBe(false)
    if (!isScenarioLoadError(r1) && !isScenarioLoadError(r2)) {
      const a = r1.logs.filter(l => l.id.startsWith('bg-0'))
      const b = r2.logs.filter(l => l.id.startsWith('bg-0'))
      expect(a.map(e => e.atSecond)).toEqual(b.map(e => e.atSecond))
      expect(a.map(e => e.message)).toEqual(b.map(e => e.message))
    }
  })

  it('unseeded background produces different streams on two loads (statistical)', async () => {
    const opts = {
      background_logs: [{
        profile: 'java_web_service', service: 'svc',
        from_second: 0, to_second: 300, density: 'high',
        // no seed
      }],
    }
    const r1 = await loadWithOverrides(opts)
    const r2 = await loadWithOverrides(opts)
    expect(isScenarioLoadError(r1)).toBe(false)
    expect(isScenarioLoadError(r2)).toBe(false)
    if (!isScenarioLoadError(r1) && !isScenarioLoadError(r2)) {
      const a = r1.logs.filter(l => l.id.startsWith('bg-0')).map(e => e.atSecond)
      const b = r2.logs.filter(l => l.id.startsWith('bg-0')).map(e => e.atSecond)
      expect(a).not.toEqual(b)
    }
  })
})

// ── Merge order — scripted + patterns + background ────────────────────────────

describe('merged log output', () => {
  it('scripted, pattern, and background entries all appear in merged logs', async () => {
    const result = await loadWithOverrides({
      logs: [{ id: 'scripted-001', at_second: 0, level: 'ERROR', service: 'svc', message: 'scripted' }],
      log_patterns: [{
        id: 'pat-merge', level: 'WARN', service: 'svc', message: 'pattern {n}',
        interval_seconds: 30, from_second: 5, to_second: 35,
      }],
      background_logs: [{
        profile: 'java_web_service', service: 'svc',
        from_second: 0, to_second: 60, density: 'low', seed: 10,
      }],
    })
    expect(isScenarioLoadError(result)).toBe(false)
    if (!isScenarioLoadError(result)) {
      expect(result.logs.some(l => l.id === 'scripted-001')).toBe(true)
      expect(result.logs.some(l => l.id.startsWith('pat-merge'))).toBe(true)
      expect(result.logs.some(l => l.id.startsWith('bg-0'))).toBe(true)
    }
  })

  it('merged logs are sorted by atSecond ascending', async () => {
    const result = await loadWithOverrides({
      logs: [{ id: 's1', at_second: 50, level: 'INFO', service: 'svc', message: 'late scripted' }],
      log_patterns: [{
        id: 'early', level: 'DEBUG', service: 'svc', message: 'msg',
        interval_seconds: 10, from_second: 0, to_second: 20,
      }],
      background_logs: [{
        profile: 'nodejs_api', service: 'svc',
        from_second: 0, to_second: 60, density: 'medium', seed: 4,
      }],
    })
    expect(isScenarioLoadError(result)).toBe(false)
    if (!isScenarioLoadError(result)) {
      const times = result.logs.map(l => l.atSecond)
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThanOrEqual(times[i - 1])
      }
    }
  })

  it('logs field is optional in scenario YAML — omitting it does not fail', async () => {
    const result = await loadWithOverrides({ logs: [] })
    expect(isScenarioLoadError(result)).toBe(false)
  })
})

// ── getDensityMultiplier ──────────────────────────────────────────────────────

describe('getDensityMultiplier', () => {
  it('low < medium < high', () => {
    expect(getDensityMultiplier('low')).toBeLessThan(getDensityMultiplier('medium'))
    expect(getDensityMultiplier('medium')).toBeLessThan(getDensityMultiplier('high'))
  })

  it('unknown density falls back to 1.0', () => {
    expect(getDensityMultiplier('extreme')).toBe(1.0)
  })
})

// ── LOG_PROFILES integrity ────────────────────────────────────────────────────

describe('LOG_PROFILES integrity', () => {
  const profileNames = Object.keys(LOG_PROFILES)

  it('at least 4 profiles are defined', () => {
    expect(profileNames.length).toBeGreaterThanOrEqual(4)
  })

  for (const name of profileNames) {
    it(`${name}: has positive baseRate`, () => {
      expect(LOG_PROFILES[name].baseRate).toBeGreaterThan(0)
    })

    it(`${name}: has at least 5 lines`, () => {
      expect(LOG_PROFILES[name].lines.length).toBeGreaterThanOrEqual(5)
    })

    it(`${name}: all lines have valid level`, () => {
      const valid = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR'])
      for (const line of LOG_PROFILES[name].lines) {
        expect(valid.has(line.level)).toBe(true)
      }
    })

    it(`${name}: all lines have non-empty message`, () => {
      for (const line of LOG_PROFILES[name].lines) {
        expect(line.message.length).toBeGreaterThan(0)
      }
    })
  }
})
