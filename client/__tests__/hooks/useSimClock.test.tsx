import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import React from 'react'
import { useSimClock } from '../../src/hooks/useSimClock'
import { SimClockContext, type SimClockInput, formatWallClock } from '../../src/hooks/useSimClock'

// ── Helper: wrap hook in a provider that feeds controlled clock inputs ─────────

function makeWrapper(input: SimClockInput) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <SimClockContext.Provider value={input}>
        {children}
      </SimClockContext.Provider>
    )
  }
}

// Fixed anchor: 2026-01-15 19:00:00 UTC = 1736967600000 ms
// simTime=0    → 19:00:00 UTC (but displayed in local timezone)
// We test formatWallClock directly so tests are timezone-independent.
const ANCHOR = 1736967600000

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('formatWallClock', () => {
  it('returns HH:MM:SS format', () => {
    const result = formatWallClock(0, ANCHOR)
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('simTime=222 adds 3m42s to the anchor', () => {
    const at0   = formatWallClock(0, ANCHOR)
    const at222 = formatWallClock(222, ANCHOR)
    // Parse hours/minutes/seconds and compare
    const [h0, m0, s0] = at0.split(':').map(Number)
    const [h222, m222, s222] = at222.split(':').map(Number)
    const total0   = h0 * 3600 + m0 * 60 + s0
    const total222 = h222 * 3600 + m222 * 60 + s222
    expect(total222 - total0).toBe(222)
  })

  it('simTime=-300 subtracts 5 minutes from the anchor', () => {
    const at0    = formatWallClock(0, ANCHOR)
    const atMinus = formatWallClock(-300, ANCHOR)
    const [h0, m0, s0] = at0.split(':').map(Number)
    const [hm, mm, sm] = atMinus.split(':').map(Number)
    const total0 = h0 * 3600 + m0 * 60 + s0
    const totalM = hm * 3600 + mm * 60 + sm
    expect(total0 - totalM).toBe(300)
  })
})

describe('useSimClock', () => {
  describe('display formatting', () => {
    it('display is a HH:MM:SS string', () => {
      const { result } = renderHook(() => useSimClock(), {
        wrapper: makeWrapper({ simTime: 0, speed: 1, paused: false, clockAnchorMs: ANCHOR }),
      })
      expect(result.current.display).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    })

    it('display advances by 222 seconds at simTime=222', () => {
      const { result: result0 } = renderHook(() => useSimClock(), {
        wrapper: makeWrapper({ simTime: 0, speed: 1, paused: false, clockAnchorMs: ANCHOR }),
      })
      const { result: result222 } = renderHook(() => useSimClock(), {
        wrapper: makeWrapper({ simTime: 222, speed: 1, paused: false, clockAnchorMs: ANCHOR }),
      })
      const [h0, m0, s0]       = result0.current.display.split(':').map(Number)
      const [h222, m222, s222] = result222.current.display.split(':').map(Number)
      const total0   = h0 * 3600 + m0 * 60 + s0
      const total222 = h222 * 3600 + m222 * 60 + s222
      expect(total222 - total0).toBe(222)
    })

    it('wallClock helper returns same as display for simTime=0', () => {
      const { result } = renderHook(() => useSimClock(), {
        wrapper: makeWrapper({ simTime: 0, speed: 1, paused: false, clockAnchorMs: ANCHOR }),
      })
      expect(result.current.wallClock(0)).toBe(result.current.display)
    })
  })

  describe('state passthrough', () => {
    it('paused=true reflected in return value', () => {
      const { result } = renderHook(() => useSimClock(), {
        wrapper: makeWrapper({ simTime: 0, speed: 1, paused: true, clockAnchorMs: ANCHOR }),
      })
      expect(result.current.paused).toBe(true)
    })

    it('speed=5 reflected in return value', () => {
      const { result } = renderHook(() => useSimClock(), {
        wrapper: makeWrapper({ simTime: 0, speed: 5, paused: false, clockAnchorMs: ANCHOR }),
      })
      expect(result.current.speed).toBe(5)
    })

    it('clockAnchorMs reflected in return value', () => {
      const { result } = renderHook(() => useSimClock(), {
        wrapper: makeWrapper({ simTime: 0, speed: 1, paused: false, clockAnchorMs: ANCHOR }),
      })
      expect(result.current.clockAnchorMs).toBe(ANCHOR)
    })
  })

  describe('rAF interpolation', () => {
    it('interpolates forward when not paused (speed=1, 1 real second elapsed)', () => {
      let rafCallback: FrameRequestCallback | null = null
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        rafCallback = cb
        return 1
      })
      vi.stubGlobal('cancelAnimationFrame', vi.fn())

      const { result } = renderHook(() => useSimClock(), {
        wrapper: makeWrapper({ simTime: 100, speed: 1, paused: false, clockAnchorMs: ANCHOR }),
      })

      act(() => {
        vi.advanceTimersByTime(1000)
        rafCallback!(performance.now())
      })

      expect(result.current.simTime).toBeGreaterThan(100)
    })

    it('does not interpolate when paused=true', () => {
      let rafCallback: FrameRequestCallback | null = null
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        rafCallback = cb
        return 1
      })
      vi.stubGlobal('cancelAnimationFrame', vi.fn())

      const { result } = renderHook(() => useSimClock(), {
        wrapper: makeWrapper({ simTime: 100, speed: 1, paused: true, clockAnchorMs: ANCHOR }),
      })

      act(() => {
        vi.advanceTimersByTime(5000)
        rafCallback!(performance.now())
      })

      expect(result.current.simTime).toBe(100)
    })

    it('respects speed multiplier during interpolation', () => {
      let rafCallback: FrameRequestCallback | null = null
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        rafCallback = cb
        return 1
      })
      vi.stubGlobal('cancelAnimationFrame', vi.fn())

      const { result } = renderHook(() => useSimClock(), {
        wrapper: makeWrapper({ simTime: 0, speed: 10, paused: false, clockAnchorMs: ANCHOR }),
      })

      act(() => {
        vi.advanceTimersByTime(1000)
        rafCallback!(performance.now())
      })

      expect(result.current.simTime).toBeGreaterThan(5)
    })

    it('cancels rAF on unmount', () => {
      const cancelMock = vi.fn()
      vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(42))
      vi.stubGlobal('cancelAnimationFrame', cancelMock)

      const { unmount } = renderHook(() => useSimClock(), {
        wrapper: makeWrapper({ simTime: 0, speed: 1, paused: false, clockAnchorMs: ANCHOR }),
      })
      unmount()
      expect(cancelMock).toHaveBeenCalledWith(42)
    })
  })
})
