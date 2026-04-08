import React, { useEffect, useRef, useId } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'

interface ModalProps {
  open:      boolean
  onClose:   () => void
  title:     string
  children:  React.ReactNode
  footer?:   React.ReactNode
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]'

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const titleId  = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  // Escape key
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // Scroll lock
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Focus first element on open
  useEffect(() => {
    if (!open || !dialogRef.current) return
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
    if (focusable.length > 0) focusable[0].focus()
  }, [open])

  // Focus trap — Tab / Shift+Tab
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !dialogRef.current) return
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last  = focusable[focusable.length - 1]

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  if (!open) return null

  return createPortal(
    <div
      data-testid="modal-overlay"
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-sim-surface border border-sim-border rounded w-full max-w-md mx-4"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-sim-border flex items-center justify-between">
          <span id={titleId} className="text-sm font-semibold text-sim-text">
            {title}
          </span>
          <Button variant="ghost" size="sm" iconOnly aria-label="Close" onClick={onClose}>
            ×
          </Button>
        </div>

        {/* Body */}
        <div className="p-4 text-xs text-sim-text">
          {children}
        </div>

        {/* Footer — only rendered when provided */}
        {footer !== undefined && (
          <div
            data-testid="modal-footer"
            className="px-4 py-3 border-t border-sim-border flex justify-end gap-2"
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
