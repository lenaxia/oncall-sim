import { useRef } from 'react'
import { useSession } from '../../context/SessionContext'
import { WallTimestamp } from '../Timestamp'
import { Badge, logLevelVariant } from '../Badge'
import type { LogLevel } from '@shared/types/events'
import type { LogFilterState } from '../SimShell'

interface LogsTabProps {
  filterState:    LogFilterState
  onFilterChange: (f: LogFilterState) => void
}

const MAX_RENDERED = 1000

export function LogsTab({ filterState, onFilterChange }: LogsTabProps) {
  const { state, dispatchAction } = useSession()
  const containerRef = useRef<HTMLDivElement>(null)

  const { query, levels, service } = filterState

  // Unique services from logs
  const services = Array.from(new Set(state.logs.map(l => l.service))).sort()

  // Filtered + capped list
  const filtered = state.logs
    .filter(entry => {
      if (query && !entry.message.toLowerCase().includes(query.toLowerCase()) &&
          !entry.service.toLowerCase().includes(query.toLowerCase())) return false
      if (levels.size > 0 && !levels.has(entry.level)) return false
      if (service && entry.service !== service) return false
      return true
    })
    .slice(-MAX_RENDERED)

  function toggleLevel(level: LogLevel) {
    const next = new Set(levels)
    if (next.has(level)) next.delete(level)
    else next.add(level)
    onFilterChange({ ...filterState, levels: next })
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      dispatchAction('search_logs', { query })
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filter bar */}
      <div className="flex-shrink-0 flex flex-wrap gap-2 items-center px-3 py-2 border-b border-sim-border bg-sim-surface">
        <input
          type="text"
          placeholder="Search logs..."
          value={query}
          onChange={e => onFilterChange({ ...filterState, query: e.target.value })}
          onKeyDown={handleSearchKeyDown}
          className="flex-1 min-w-[120px] bg-sim-surface border border-sim-border text-sim-text text-xs
                     font-mono px-3 py-1 rounded outline-none
                     focus:border-sim-accent focus:ring-1 focus:ring-sim-accent
                     placeholder:text-sim-text-faint"
        />

        {(['DEBUG', 'INFO', 'WARN', 'ERROR'] as LogLevel[]).map(level => {
          const active = levels.has(level)
          const activeClasses: Record<LogLevel, string> = {
            DEBUG: 'border-sim-border text-sim-text bg-sim-surface-2',
            INFO:  'border-sim-accent text-sim-accent bg-sim-accent/10',
            WARN:  'border-sim-yellow text-sim-yellow bg-sim-yellow-dim',
            ERROR: 'border-sim-red text-sim-red bg-sim-red-dim',
          }
          return (
            <button
              key={level}
              role="button"
              aria-pressed={active}
              onClick={() => toggleLevel(level)}
              className={[
                'text-xs px-2 py-1 rounded border transition-colors duration-100',
                active
                  ? activeClasses[level]
                  : 'border-sim-border text-sim-text-muted bg-transparent hover:text-sim-text',
              ].join(' ')}
            >
              {level}
            </button>
          )
        })}

        <select
          value={service}
          onChange={e => onFilterChange({ ...filterState, service: e.target.value })}
          className="bg-sim-surface border border-sim-border text-sim-text text-xs font-mono
                     px-3 py-1 rounded outline-none cursor-pointer"
        >
          <option value="">All services</option>
          {services.map(svc => (
            <option key={svc} value={svc}>{svc}</option>
          ))}
        </select>
      </div>

      {/* Log stream */}
      <div ref={containerRef} className="flex-1 overflow-auto relative">
        {filtered.map(entry => (
          <div
            key={entry.id}
            className="flex items-start gap-2 px-3 py-1 hover:bg-sim-surface-2 border-b border-sim-border-muted"
          >
            <WallTimestamp simTime={entry.simTime} />
            {entry.level === 'DEBUG' ? (
              <span className="text-xs text-sim-text-faint border border-sim-border-muted rounded-sm px-1 py-0.5 font-mono flex-shrink-0">
                DEBUG
              </span>
            ) : (
              <Badge
                label={entry.level}
                variant={logLevelVariant(entry.level) as 'sev1' | 'warning' | 'info'}
              />
            )}
            <span className="text-xs text-sim-text-muted flex-shrink-0">{entry.service}</span>
            <span className="text-xs text-sim-text break-words">{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
