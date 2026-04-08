import React from 'react'

interface PanelProps {
  title?:     string
  actions?:   React.ReactNode
  children:   React.ReactNode
  className?: string
  noPadding?: boolean
}

export function Panel({ title, actions, children, className, noPadding = false }: PanelProps) {
  return (
    <div className={`bg-sim-surface rounded border border-sim-border ${className ?? ''}`.trim()}>
      {title !== undefined && (
        <header className="px-3 py-2 border-b border-sim-border flex items-center justify-between">
          <span className="text-xs font-semibold text-sim-text-muted uppercase tracking-wide">
            {title}
          </span>
          {actions && <div>{actions}</div>}
        </header>
      )}
      <div data-panel-body="" className={noPadding ? '' : 'p-3'}>
        {children}
      </div>
    </div>
  )
}
