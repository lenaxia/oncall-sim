import { useEffect, useRef, useState } from 'react'
import type { SimEvent } from '@shared/types/events'

export interface UseSSEOptions {
  sessionId:      string
  onEvent:        (event: SimEvent) => void
  onExpired:      () => void
  onDebriefReady: () => void
}

export interface UseSSEResult {
  connected:    boolean
  reconnecting: boolean
}

const BACKOFF_INITIAL = 1000
const BACKOFF_MAX     = 30000

export function useSSE({
  sessionId,
  onEvent,
  onExpired,
  onDebriefReady,
}: UseSSEOptions): UseSSEResult {
  const [connected,    setConnected]    = useState(false)
  const [reconnecting, setReconnecting] = useState(false)

  // Stable refs so the effect closure always sees the latest callbacks
  const onEventRef        = useRef(onEvent)
  const onExpiredRef      = useRef(onExpired)
  const onDebriefReadyRef = useRef(onDebriefReady)
  onEventRef.current        = onEvent
  onExpiredRef.current      = onExpired
  onDebriefReadyRef.current = onDebriefReady

  const backoffRef   = useRef(BACKOFF_INITIAL)
  const timeoutRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const esRef        = useRef<EventSource | null>(null)

  useEffect(() => {
    let cancelled = false

    function connect() {
      if (cancelled) return

      const es = new EventSource(`/api/sessions/${sessionId}/events`)
      esRef.current = es

      es.onmessage = (e: MessageEvent<string>) => {
        const data: string = e.data
        // Ignore SSE comments / heartbeats
        if (data.startsWith(':')) return

        let parsed: SimEvent
        try {
          parsed = JSON.parse(data) as SimEvent
        } catch {
          return // Ignore malformed JSON
        }

        // First successful message: mark connected, reset backoff
        setConnected(true)
        setReconnecting(false)
        backoffRef.current = BACKOFF_INITIAL

        // Route special lifecycle events before passing to onEvent
        if (parsed.type === 'session_expired') {
          onExpiredRef.current()
          return
        }
        if (parsed.type === 'debrief_ready') {
          onDebriefReadyRef.current()
          return
        }

        onEventRef.current(parsed)
      }

      es.onerror = () => {
        if (cancelled) return
        es.close()
        esRef.current = null
        setConnected(false)
        setReconnecting(true)

        const delay = backoffRef.current
        backoffRef.current = Math.min(delay * 2, BACKOFF_MAX)

        timeoutRef.current = setTimeout(() => {
          if (!cancelled) connect()
        }, delay)
      }
    }

    connect()

    return () => {
      cancelled = true
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      esRef.current?.close()
      esRef.current = null
    }
  // sessionId is the only dep that should re-run the effect
   
  }, [sessionId])

  return { connected, reconnecting }
}
