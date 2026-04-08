import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSSE } from '../../src/hooks/useSSE'
import type { SimEvent } from '@shared/types/events'

// ── MockEventSource ───────────────────────────────────────────────────────────
// We stub window.EventSource so useSSE never opens a real network connection.

interface MockESInstance {
  url: string
  onmessage: ((e: MessageEvent) => void) | null
  onerror:   ((e: Event) => void) | null
  close:     ReturnType<typeof vi.fn>
  readyState: number
  simulateMessage(data: string): void
  simulateError(): void
}

let lastInstance: MockESInstance | null = null

class MockEventSource {
  url: string
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror:   ((e: Event) => void) | null = null
  close = vi.fn()
  readyState = 0

  constructor(url: string) {
    this.url = url
    lastInstance = this as MockESInstance
  }

  // Helper: simulate receiving a data line
  simulateMessage(data: string) {
    this.onmessage?.({ data } as MessageEvent)
  }

  // Helper: simulate a connection error
  simulateError() {
    this.onerror?.({} as Event)
  }
}

beforeEach(() => {
  lastInstance = null
  vi.stubGlobal('EventSource', MockEventSource)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useSSE', () => {
  describe('connection state', () => {
    it('connected=false before any message', () => {
      const { result } = renderHook(() =>
        useSSE({ sessionId: 'sess-1', onEvent: vi.fn(), onExpired: vi.fn(), onDebriefReady: vi.fn() })
      )
      expect(result.current.connected).toBe(false)
    })

    it('connected=true after first message received', () => {
      const { result } = renderHook(() =>
        useSSE({ sessionId: 'sess-1', onEvent: vi.fn(), onExpired: vi.fn(), onDebriefReady: vi.fn() })
      )
      act(() => {
        lastInstance!.simulateMessage(JSON.stringify({ type: 'sim_time', simTime: 0, speed: 1, paused: false }))
      })
      expect(result.current.connected).toBe(true)
    })

    it('opens EventSource to the correct URL', () => {
      renderHook(() =>
        useSSE({ sessionId: 'abc123', onEvent: vi.fn(), onExpired: vi.fn(), onDebriefReady: vi.fn() })
      )
      expect(lastInstance!.url).toBe('/api/sessions/abc123/events')
    })
  })

  describe('event handling', () => {
    it('calls onEvent with parsed SimEvent for each message', () => {
      const onEvent = vi.fn()
      renderHook(() =>
        useSSE({ sessionId: 's', onEvent, onExpired: vi.fn(), onDebriefReady: vi.fn() })
      )
      const event: SimEvent = { type: 'sim_time', simTime: 10, speed: 1, paused: false }
      act(() => { lastInstance!.simulateMessage(JSON.stringify(event)) })
      expect(onEvent).toHaveBeenCalledWith(event)
    })

    it('ignores SSE comment/heartbeat lines (data starting with :)', () => {
      const onEvent = vi.fn()
      renderHook(() =>
        useSSE({ sessionId: 's', onEvent, onExpired: vi.fn(), onDebriefReady: vi.fn() })
      )
      act(() => { lastInstance!.simulateMessage(':heartbeat') })
      expect(onEvent).not.toHaveBeenCalled()
    })

    it('ignores malformed JSON without crashing', () => {
      const onEvent = vi.fn()
      const { result } = renderHook(() =>
        useSSE({ sessionId: 's', onEvent, onExpired: vi.fn(), onDebriefReady: vi.fn() })
      )
      act(() => { lastInstance!.simulateMessage('{not json') })
      expect(onEvent).not.toHaveBeenCalled()
      expect(result.current).toBeDefined()
    })

    it('calls onExpired when session_expired event received', () => {
      const onExpired = vi.fn()
      renderHook(() =>
        useSSE({ sessionId: 's', onEvent: vi.fn(), onExpired, onDebriefReady: vi.fn() })
      )
      act(() => {
        lastInstance!.simulateMessage(JSON.stringify({ type: 'session_expired', reason: 'timeout' }))
      })
      expect(onExpired).toHaveBeenCalledOnce()
    })

    it('calls onDebriefReady when debrief_ready event received', () => {
      const onDebriefReady = vi.fn()
      renderHook(() =>
        useSSE({ sessionId: 's', onEvent: vi.fn(), onExpired: vi.fn(), onDebriefReady })
      )
      act(() => {
        lastInstance!.simulateMessage(JSON.stringify({ type: 'debrief_ready', sessionId: 's' }))
      })
      expect(onDebriefReady).toHaveBeenCalledOnce()
    })
  })

  describe('reconnection', () => {
    it('reconnecting=true when EventSource error fires', () => {
      const { result } = renderHook(() =>
        useSSE({ sessionId: 's', onEvent: vi.fn(), onExpired: vi.fn(), onDebriefReady: vi.fn() })
      )
      act(() => { lastInstance!.simulateError() })
      expect(result.current.reconnecting).toBe(true)
    })

    it('reconnects after 1s backoff on first failure', () => {
      renderHook(() =>
        useSSE({ sessionId: 's', onEvent: vi.fn(), onExpired: vi.fn(), onDebriefReady: vi.fn() })
      )
      const firstInstance = lastInstance
      act(() => { firstInstance!.simulateError() })
      expect(lastInstance).toBe(firstInstance)  // not reconnected yet
      act(() => { vi.advanceTimersByTime(1000) })
      expect(lastInstance).not.toBe(firstInstance) // new EventSource created
    })

    it('backoff doubles on each failure: 1s → 2s → 4s', () => {
      renderHook(() =>
        useSSE({ sessionId: 's', onEvent: vi.fn(), onExpired: vi.fn(), onDebriefReady: vi.fn() })
      )

      // 1st failure → 1s backoff
      act(() => { lastInstance!.simulateError() })
      act(() => { vi.advanceTimersByTime(1000) })
      const after1 = lastInstance

      // 2nd failure → 2s backoff
      act(() => { lastInstance!.simulateError() })
      act(() => { vi.advanceTimersByTime(1999) })
      expect(lastInstance).toBe(after1) // not yet
      act(() => { vi.advanceTimersByTime(1) })
      const after2 = lastInstance

      // 3rd failure → 4s backoff
      act(() => { lastInstance!.simulateError() })
      act(() => { vi.advanceTimersByTime(3999) })
      expect(lastInstance).toBe(after2) // not yet
      act(() => { vi.advanceTimersByTime(1) })
      expect(lastInstance).not.toBe(after2) // reconnected
    })

    it('backoff caps at 30s', () => {
      renderHook(() =>
        useSSE({ sessionId: 's', onEvent: vi.fn(), onExpired: vi.fn(), onDebriefReady: vi.fn() })
      )
      // Drive through 1→2→4→8→16→30
      const delays = [1000, 2000, 4000, 8000, 16000]
      for (const delay of delays) {
        act(() => { lastInstance!.simulateError() })
        act(() => { vi.advanceTimersByTime(delay) })
      }
      const beforeCap = lastInstance
      // Should be capped at 30s now
      act(() => { lastInstance!.simulateError() })
      act(() => { vi.advanceTimersByTime(29999) })
      expect(lastInstance).toBe(beforeCap) // not yet
      act(() => { vi.advanceTimersByTime(1) })
      expect(lastInstance).not.toBe(beforeCap) // reconnected at exactly 30s
    })

    it('backoff resets to 1s after successful reconnect', () => {
      renderHook(() =>
        useSSE({ sessionId: 's', onEvent: vi.fn(), onExpired: vi.fn(), onDebriefReady: vi.fn() })
      )
      // Fail once → wait 1s → reconnect → receive message (resets backoff)
      act(() => { lastInstance!.simulateError() })
      act(() => { vi.advanceTimersByTime(1000) })
      // New connection established — simulate successful message to reset backoff
      act(() => {
        lastInstance!.simulateMessage(JSON.stringify({ type: 'sim_time', simTime: 0, speed: 1, paused: false }))
      })
      const afterReset = lastInstance
      // Fail again — backoff should be back to 1s (not 2s)
      act(() => { lastInstance!.simulateError() })
      act(() => { vi.advanceTimersByTime(999) })
      expect(lastInstance).toBe(afterReset) // not yet
      act(() => { vi.advanceTimersByTime(1) })
      expect(lastInstance).not.toBe(afterReset) // reconnected at 1s
    })
  })

  describe('cleanup', () => {
    it('closes EventSource on unmount', () => {
      const { unmount } = renderHook(() =>
        useSSE({ sessionId: 's', onEvent: vi.fn(), onExpired: vi.fn(), onDebriefReady: vi.fn() })
      )
      const instance = lastInstance!
      unmount()
      expect(instance.close).toHaveBeenCalledOnce()
    })

    it('clears pending reconnect timeout on unmount', () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
      const { unmount } = renderHook(() =>
        useSSE({ sessionId: 's', onEvent: vi.fn(), onExpired: vi.fn(), onDebriefReady: vi.fn() })
      )
      act(() => { lastInstance!.simulateError() }) // schedules a timeout
      unmount()
      expect(clearTimeoutSpy).toHaveBeenCalled()
    })
  })
})
