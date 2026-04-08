import React from 'react'

interface EmptyStateProps {
  title:    string
  message?: string
  action?:  React.ReactNode
}

export function EmptyState({ title, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 p-8">
      <span className="text-2xl text-sim-text-faint select-none" aria-hidden="true">∅</span>
      <span className="text-sm text-sim-text-muted">{title}</span>
      {message && (
        <span className="text-xs text-sim-text-faint">{message}</span>
      )}
      {action}
    </div>
  )
}
