import React from 'react'

export interface TabDef {
  id:      string
  label:   string
  badge?:  number
  alarm?:  boolean
}

interface TabBarProps {
  tabs:            TabDef[]
  activeTab:       string
  onTabChange:     (id: string) => void
  onResolve:       () => void
  resolveDisabled?: boolean
}

export function TabBar({
  tabs,
  activeTab,
  onTabChange,
  onResolve,
  resolveDisabled = false,
}: TabBarProps) {
  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      const next = (index + 1) % tabs.length
      onTabChange(tabs[next].id)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const prev = (index - 1 + tabs.length) % tabs.length
      onTabChange(tabs[prev].id)
    } else if (e.key === 'Home') {
      e.preventDefault()
      onTabChange(tabs[0].id)
    } else if (e.key === 'End') {
      e.preventDefault()
      onTabChange(tabs[tabs.length - 1].id)
    }
  }

  return (
    <div className="flex-shrink-0 flex items-center border-b border-sim-border bg-sim-surface">
      <div
        role="tablist"
        className="flex items-center flex-1 overflow-x-auto"
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTab
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              className={[
                'flex-none px-3 py-2.5 text-xs flex items-center gap-1.5 transition-colors duration-75',
                isActive
                  ? 'text-sim-text border-b-2 border-sim-accent'
                  : 'text-sim-text-muted hover:text-sim-text border-b-2 border-transparent',
              ].join(' ')}
              onClick={() => onTabChange(tab.id)}
              onKeyDown={e => handleKeyDown(e, index)}
            >
              {tab.label}
              {tab.badge != null && tab.badge > 0 && (
                <span
                  data-badge=""
                  className="text-xs font-medium bg-sim-red text-white rounded-full px-1.5 min-w-[1.25rem] text-center tabular-nums"
                >
                  {tab.badge}
                </span>
              )}
              {tab.alarm && (
                <span
                  data-alarm-dot=""
                  className="w-1.5 h-1.5 rounded-full bg-sim-red animate-pulse"
                  aria-hidden="true"
                />
              )}
            </button>
          )
        })}
      </div>

      <div className="flex-shrink-0 px-3">
        <button
          className={[
            'text-xs px-2.5 py-1 rounded border transition-colors duration-100',
            'border-sim-red text-sim-red bg-transparent hover:bg-sim-red-dim',
            resolveDisabled ? 'opacity-40 cursor-not-allowed' : '',
          ].join(' ')}
          onClick={onResolve}
          disabled={resolveDisabled}
        >
          End Simulation
        </button>
      </div>
    </div>
  )
}
