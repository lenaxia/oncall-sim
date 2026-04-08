// ── formatSimTime (kept for debrief/testing contexts without wall-clock anchor) ──

export function formatSimTime(simTime: number, prefix = 'T+'): string {
  const abs = Math.abs(simTime)
  const h   = Math.floor(abs / 3600)
  const m   = Math.floor((abs % 3600) / 60)
  const s   = Math.floor(abs % 60)
  const sign = simTime < 0 ? 'T-' : prefix
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ── Timestamp ─────────────────────────────────────────────────────────────────

interface TimestampProps {
  simTime:        number
  clockAnchorMs?: number   // when provided, renders wall clock ("19:07:42")
  prefix?:        string   // only used when clockAnchorMs is absent
}

export function Timestamp({ simTime, clockAnchorMs, prefix = 'T+' }: TimestampProps) {
  let text: string
  if (clockAnchorMs !== undefined && clockAnchorMs !== 0 && !isNaN(clockAnchorMs)) {
    const wallMs = clockAnchorMs + simTime * 1000
    const d  = new Date(wallMs)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    text = `${hh}:${mm}:${ss}`
  } else {
    text = formatSimTime(simTime, prefix)
  }

  return (
    <span className="text-xs text-sim-text-muted font-mono tabular-nums">
      {text}
    </span>
  )
}

// ── WallTimestamp ─────────────────────────────────────────────────────────────
// Reads clockAnchorMs directly from SessionContext (no rAF loop, safe to use
// in list items, table rows, etc.).

import { useSession } from '../context/SessionContext'

export function WallTimestamp({ simTime }: { simTime: number }) {
  const { state } = useSession()
  return <Timestamp simTime={simTime} clockAnchorMs={state.clockAnchorMs} />
}
