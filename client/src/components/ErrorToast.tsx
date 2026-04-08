import { createPortal } from 'react-dom'
import { Button } from './Button'

interface ErrorToastProps {
  message:   string | null
  onDismiss: () => void
}

export function ErrorToast({ message, onDismiss }: ErrorToastProps) {
  if (message === null) return null

  return createPortal(
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-[60] flex items-center gap-2
                 bg-sim-red-dim border border-sim-red text-sim-red text-xs px-3 py-2 rounded"
    >
      <span className="flex-shrink-0 font-bold" aria-hidden="true">!</span>
      <span className="flex-1">{message}</span>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label="Dismiss"
        onClick={onDismiss}
        className="text-sim-red hover:text-sim-text flex-shrink-0"
      >
        ×
      </Button>
    </div>,
    document.body
  )
}
