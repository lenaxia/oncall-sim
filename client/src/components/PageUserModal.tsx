import { useState } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'
import type { PersonaConfig } from '../context/ScenarioContext'

interface PageUserModalProps {
  open:        boolean
  onClose:     () => void
  onSubmit:    (personaId: string, message: string) => void
  personas:    PersonaConfig[]
  alarmId?:    string
  alarmLabel?: string
}

export function PageUserModal({ open, onClose, onSubmit, personas, alarmId, alarmLabel }: PageUserModalProps) {
  const [selectedPersonaId, setSelectedPersonaId] = useState(
    personas.length === 1 ? personas[0].id : ''
  )
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const valid = selectedPersonaId !== '' && message.length >= 10

  async function handleSubmit() {
    if (!valid) return
    setLoading(true)
    onSubmit(selectedPersonaId, message)
    setLoading(false)
    setMessage('')
    setSelectedPersonaId(personas.length === 1 ? personas[0].id : '')
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Page User"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" disabled={!valid} loading={loading} onClick={handleSubmit}>
            Send Page
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {alarmId && (
          <div className="text-xs text-sim-text-muted bg-sim-surface-2 border border-sim-border-muted rounded px-3 py-2">
            Re: {alarmLabel}
          </div>
        )}

        <div>
          <div className="text-xs font-medium text-sim-text-muted uppercase tracking-wide mb-1">
            Who To Page
          </div>
          <select
            value={selectedPersonaId}
            onChange={e => setSelectedPersonaId(e.target.value)}
            className="w-full bg-sim-surface border border-sim-border text-sim-text text-xs
                       font-mono px-3 py-1 rounded outline-none cursor-pointer"
          >
            {personas.length !== 1 && <option value="">Select...</option>}
            {personas.map(p => (
              <option key={p.id} value={p.id}>
                {p.displayName} — {p.jobTitle}, {p.team}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="text-xs font-medium text-sim-text-muted uppercase tracking-wide mb-1">
            Message
          </div>
          <textarea
            autoFocus
            placeholder="Brief description of the issue and why you are paging them..."
            value={message}
            onChange={e => setMessage(e.target.value)}
            className="w-full bg-sim-surface border border-sim-border text-sim-text text-xs
                       font-mono px-3 py-1 rounded resize-none min-h-[72px] outline-none
                       focus:border-sim-accent placeholder:text-sim-text-faint"
          />
          <div className="text-xs text-sim-text-faint mt-1">
            Be specific: include service name, current impact, and what you need.
          </div>
        </div>
      </div>
    </Modal>
  )
}
