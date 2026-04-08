import { useSession } from '../context/SessionContext'
import { useSimClock } from '../hooks/useSimClock'

const SPEEDS: Array<1 | 2 | 5 | 10> = [1, 2, 5, 10]

export function SpeedControl() {
  const { setSpeed, setPaused } = useSession()
  const { speed, paused } = useSimClock()

  return (
    <div className="flex items-center gap-1">
      <button
        className={[
          'text-xs px-1.5 py-0.5 rounded border transition-colors duration-100',
          paused
            ? 'border-sim-yellow text-sim-yellow'
            : 'border-sim-border text-sim-text-muted hover:text-sim-text',
        ].join(' ')}
        aria-pressed={paused}
        onClick={() => setPaused(!paused)}
        aria-label={paused ? 'Resume' : 'Pause'}
      >
        {paused ? '▶' : '⏸'}
      </button>
      {SPEEDS.map(s => (
        <button
          key={s}
          className={[
            'text-xs px-1.5 py-0.5 rounded border transition-colors duration-100',
            speed === s && !paused
              ? 'border-sim-accent text-sim-accent'
              : 'border-sim-border text-sim-text-muted hover:text-sim-text',
          ].join(' ')}
          aria-pressed={speed === s && !paused}
          onClick={() => { setPaused(false); setSpeed(s) }}
        >
          {s}×
        </button>
      ))}
    </div>
  )
}
