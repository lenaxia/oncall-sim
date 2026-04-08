import { useState } from 'react'
import { useSession } from '../context/SessionContext'
import { WallTimestamp } from './Timestamp'

export function CoachPanelShell() {
  const { state } = useSession()
  const [open, setOpen]           = useState(false)
  const [lastSeenCount, setLastSeenCount] = useState(0)

  const messageCount  = state.coachMessages.length
  const hasUnread     = !open && messageCount > lastSeenCount

  function toggle() {
    if (!open) setLastSeenCount(messageCount)
    setOpen(prev => !prev)
  }

  return (
    <div className="flex-shrink-0 flex items-center border-l border-sim-border relative">
      {/* Toggle button */}
      <button
        aria-label="Toggle coach panel"
        className="relative px-3 py-2.5 text-xs text-sim-text-muted hover:text-sim-text transition-colors duration-75"
        onClick={toggle}
      >
        Coach
        {hasUnread && (
          <span
            data-coach-badge=""
            className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-sim-accent"
            aria-hidden="true"
          />
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          data-testid="coach-panel"
          className="absolute right-0 top-full z-30 w-72 bg-sim-surface border border-sim-border rounded shadow-lg"
        >
          <div className="px-3 py-2 border-b border-sim-border text-xs font-semibold text-sim-text">
            Coach
          </div>
          <div className="flex flex-col gap-0 max-h-80 overflow-auto">
            {state.coachMessages.length === 0 ? (
              <div className="px-3 py-4 text-xs text-sim-text-faint text-center">
                No messages yet. The coach will provide guidance as the simulation progresses.
              </div>
            ) : (
              state.coachMessages.map(msg => (
                <div
                  key={msg.id}
                  className="px-3 py-2 border-b border-sim-border-muted flex flex-col gap-0.5"
                >
                  <span className="text-xs text-sim-text leading-snug">{msg.text}</span>
                  <WallTimestamp simTime={msg.simTime} />
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
