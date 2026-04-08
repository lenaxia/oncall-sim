import { describe, it, expect } from 'vitest'
import { createSimClock } from '../../src/engine/sim-clock'

describe('createSimClock', () => {
  it('getSimTime() starts at 0', () => {
    expect(createSimClock().getSimTime()).toBe(0)
  })

  it('tick(1000) at speed=1 advances simTime by 1', () => {
    const clock = createSimClock(1)
    clock.tick(1000)
    expect(clock.getSimTime()).toBe(1)
  })

  it('tick(1000) at speed=10 advances simTime by 10', () => {
    const clock = createSimClock(10)
    clock.tick(1000)
    expect(clock.getSimTime()).toBe(10)
  })

  it('tick(500) at speed=2 advances simTime by 1', () => {
    const clock = createSimClock(2)
    clock.tick(500)
    expect(clock.getSimTime()).toBe(1)
  })

  it('pause() → tick() is a no-op', () => {
    const clock = createSimClock(1)
    clock.pause()
    clock.tick(5000)
    expect(clock.getSimTime()).toBe(0)
  })

  it('isPaused() reflects pause state', () => {
    const clock = createSimClock()
    expect(clock.isPaused()).toBe(false)
    clock.pause()
    expect(clock.isPaused()).toBe(true)
    clock.resume()
    expect(clock.isPaused()).toBe(false)
  })

  it('resume() → tick() advances again after pause', () => {
    const clock = createSimClock(1)
    clock.pause()
    clock.tick(1000)
    clock.resume()
    clock.tick(1000)
    expect(clock.getSimTime()).toBe(1)
  })

  it('setSpeed changes subsequent ticks', () => {
    const clock = createSimClock(1)
    clock.tick(1000)   // +1 at speed 1
    clock.setSpeed(5)
    clock.tick(1000)   // +5 at speed 5
    expect(clock.getSimTime()).toBe(6)
  })

  it('getSpeed() returns current speed', () => {
    const clock = createSimClock(2)
    expect(clock.getSpeed()).toBe(2)
    clock.setSpeed(10)
    expect(clock.getSpeed()).toBe(10)
  })

  it('toSimTimeEvent() returns correct simTime, speed, paused values', () => {
    const clock = createSimClock(5)
    clock.tick(2000)
    clock.pause()
    const ev = clock.toSimTimeEvent()
    expect(ev.type).toBe('sim_time')
    expect(ev.simTime).toBeCloseTo(10)
    expect(ev.speed).toBe(5)
    expect(ev.paused).toBe(true)
  })

  it('multiple ticks accumulate correctly', () => {
    const clock = createSimClock(1)
    clock.tick(1000)
    clock.tick(2000)
    clock.tick(500)
    expect(clock.getSimTime()).toBeCloseTo(3.5)
  })
})
