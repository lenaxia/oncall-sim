import { useState } from 'react'
import { useSession } from '../../context/SessionContext'
import { useScenario } from '../../context/ScenarioContext'
import { useSimClock } from '../../hooks/useSimClock'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { EmptyState } from '../EmptyState'
import { WallTimestamp } from '../Timestamp'
import { Badge, severityVariant } from '../Badge'
import { Button } from '../Button'
import type { Ticket, TicketStatus, TicketSeverity, TicketComment } from '@shared/types/events'

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: TicketStatus; label: string }[] = [
  { value: 'open',        label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved',    label: 'Resolved' },
]

const SEVERITY_OPTIONS: { value: TicketSeverity; label: string }[] = [
  { value: 'SEV1', label: 'SEV1 — Critical' },
  { value: 'SEV2', label: 'SEV2 — High' },
  { value: 'SEV3', label: 'SEV3 — Medium' },
  { value: 'SEV4', label: 'SEV4 — Low' },
]

const STATUS_COLOUR: Record<TicketStatus, string> = {
  open:        'text-sim-text-muted',
  in_progress: 'text-sim-yellow',
  resolved:    'text-sim-green',
}

function formatElapsed(simSeconds: number): string {
  const abs = Math.abs(simSeconds)
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const s = Math.floor(abs % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

// ── Main component ────────────────────────────────────────────────────────────

export function TicketingTab() {
  const { state, dispatchAction } = useSession()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = state.tickets.find(t => t.id === selectedId) ?? null
  const comments = selectedId ? (state.ticketComments[selectedId] ?? []) : []
  const [commentText, setCommentText] = useState('')

  function handleSelectTicket(id: string) {
    setSelectedId(id)
    setCommentText('')
  }

  function handleStatusChange(status: TicketStatus) {
    if (!selected) return
    dispatchAction('update_ticket', { ticketId: selected.id, changes: { status } })
  }

  function handleSeverityChange(severity: TicketSeverity) {
    if (!selected) return
    dispatchAction('update_ticket', { ticketId: selected.id, changes: { severity } })
  }

  function handleAssigneeChange(assignee: string) {
    if (!selected) return
    dispatchAction('update_ticket', {
      ticketId: selected.id,
      changes: { assignee: assignee === '' ? undefined : assignee },
    })
  }

  function handleAddComment() {
    if (!selected || !commentText.trim()) return
    dispatchAction('add_ticket_comment', { ticketId: selected.id, body: commentText })
    setCommentText('')
  }

  const inactive = state.status !== 'active'

  return (
    <div className="flex h-full">
      {/* Left — ticket list */}
      <div className="w-52 border-r border-sim-border overflow-auto flex-shrink-0 bg-sim-surface">
        {state.tickets.length === 0 ? (
          <EmptyState title="No tickets" message="Tickets will appear during the incident." />
        ) : (
          state.tickets.map(t => (
            <div
              key={t.id}
              className={[
                'px-3 py-2 border-b border-sim-border-muted cursor-pointer hover:bg-sim-surface-2 transition-colors duration-75',
                t.id === selectedId ? 'bg-sim-surface-2 border-l-2 border-l-sim-accent pl-[10px]' : '',
              ].join(' ')}
              onClick={() => handleSelectTicket(t.id)}
            >
              <div className="flex items-center gap-1.5">
                <Badge label={t.severity} variant={severityVariant(t.severity)} />
                <span className="text-xs font-mono text-sim-text-muted">{t.id}</span>
              </div>
              <div className="text-xs text-sim-text truncate mt-0.5 font-medium">{t.title}</div>
              <div className="text-xs mt-0.5 flex items-center gap-1">
                <span className={STATUS_COLOUR[t.status]}>{t.status.replace('_', ' ')}</span>
                <span className="text-sim-text-faint">·</span>
                <WallTimestamp simTime={t.simTime} />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Middle — metadata panel */}
      {selected !== null && (
        <TicketMetadata
          ticket={selected}
          inactive={inactive}
          onStatusChange={handleStatusChange}
          onSeverityChange={handleSeverityChange}
          onAssigneeChange={handleAssigneeChange}
        />
      )}

      {/* Right — description + comments */}
      <div className="flex-1 overflow-auto min-w-0">
        {selected === null ? (
          <EmptyState title="Select a ticket" message="Click a ticket to view its details." />
        ) : (
          <TicketDetail
            ticket={selected}
            comments={comments}
            commentText={commentText}
            onCommentChange={setCommentText}
            onAddComment={handleAddComment}
            inactive={inactive}
          />
        )}
      </div>
    </div>
  )
}

// ── Metadata panel ────────────────────────────────────────────────────────────

function TicketMetadata({
  ticket, inactive, onStatusChange, onSeverityChange, onAssigneeChange,
}: {
  ticket:            Ticket
  inactive:          boolean
  onStatusChange:    (s: TicketStatus) => void
  onSeverityChange:  (s: TicketSeverity) => void
  onAssigneeChange:  (a: string) => void
}) {
  const { state } = useSession()
  const { scenario } = useScenario()
  const { simTime: currentSimTime } = useSimClock()

  const elapsed = currentSimTime - ticket.simTime
  const personas = scenario?.personas ?? []

  const selectClasses = `w-full bg-sim-surface border border-sim-border text-sim-text text-xs
    font-mono px-2 py-1 rounded outline-none cursor-pointer
    focus:border-sim-accent disabled:opacity-40 disabled:cursor-not-allowed`

  return (
    <div
      data-testid="ticket-metadata"
      className="w-60 border-r border-sim-border overflow-auto flex-shrink-0 bg-sim-surface-2 flex flex-col"
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-sim-border bg-sim-surface">
        <div className="text-xs font-mono text-sim-text-muted">{ticket.id}</div>
        <div className="text-xs font-semibold text-sim-text mt-0.5 leading-snug">{ticket.title}</div>
      </div>

      <div className="flex-1 overflow-auto">
        {/* Status */}
        <MetaSection label="Status">
          <select
            data-testid="ticket-status-select"
            value={ticket.status}
            onChange={e => onStatusChange(e.target.value as TicketStatus)}
            disabled={inactive}
            className={selectClasses}
          >
            {STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </MetaSection>

        {/* Severity */}
        <MetaSection label="Severity">
          <select
            data-testid="ticket-severity-select"
            value={ticket.severity}
            onChange={e => onSeverityChange(e.target.value as TicketSeverity)}
            disabled={inactive}
            className={selectClasses}
          >
            {SEVERITY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </MetaSection>

        {/* Assignee */}
        <MetaSection label="Assignee">
          <select
            data-testid="ticket-assignee-select"
            value={ticket.assignee ?? ''}
            onChange={e => onAssigneeChange(e.target.value)}
            disabled={inactive}
            className={selectClasses}
          >
            <option value="">Unassigned</option>
            <option value="trainee">Me (on-call)</option>
            {personas.map(p => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))}
          </select>
        </MetaSection>

        {/* Opened */}
        <MetaSection label="Opened">
          <div className="flex flex-col gap-0.5">
            <span data-testid="ticket-created-time" className="text-xs text-sim-text font-mono">
              <WallTimestamp simTime={ticket.simTime} />
            </span>
            <span
              data-testid="ticket-elapsed"
              className="text-xs text-sim-text-muted"
            >
              {formatElapsed(elapsed)} ago
            </span>
          </div>
        </MetaSection>

        {/* Reporter */}
        <MetaSection label="Reported by">
          <span className="text-xs text-sim-persona">{ticket.createdBy}</span>
        </MetaSection>
      </div>
    </div>
  )
}

function MetaSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-2.5 border-b border-sim-border-muted">
      <div className="text-xs font-semibold text-sim-text-faint uppercase tracking-wide mb-1.5">
        {label}
      </div>
      {children}
    </div>
  )
}

// ── Detail pane (description + comments) ─────────────────────────────────────

function TicketDetail({
  ticket, comments, commentText, onCommentChange, onAddComment, inactive,
}: {
  ticket:          Ticket
  comments:        TicketComment[]
  commentText:     string
  onCommentChange: (v: string) => void
  onAddComment:    () => void
  inactive:        boolean
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Title header */}
      <div className="px-4 py-3 border-b border-sim-border bg-sim-surface flex-shrink-0">
        <div className="flex items-center gap-2 mb-0.5">
          <Badge label={ticket.severity} variant={severityVariant(ticket.severity)} />
          <span className="text-xs text-sim-text-muted">{ticket.status.replace('_', ' ')}</span>
        </div>
        <span className="text-sm font-semibold text-sim-text">{ticket.title}</span>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-auto px-4 py-4 flex flex-col gap-6">
        {/* Description */}
        <MarkdownRenderer content={ticket.description} />

        {/* Comments */}
        <div>
          <div className="text-xs font-semibold text-sim-text-faint uppercase tracking-wide mb-3">
            Activity
          </div>
          {comments.length === 0 ? (
            <div className="text-xs text-sim-text-faint">No comments yet.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {comments.map(c => (
                <div key={c.id} className="flex flex-col gap-0.5">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-xs font-semibold ${c.author === 'trainee' ? 'text-sim-trainee' : 'text-sim-persona'}`}>
                      {c.author}
                    </span>
                    <WallTimestamp simTime={c.simTime} />
                  </div>
                  <span className="text-xs text-sim-text leading-snug">{c.body}</span>
                </div>
              ))}
            </div>
          )}

          {/* Add comment */}
          <div className="mt-3">
            <textarea
              placeholder="Add a comment..."
              value={commentText}
              onChange={e => onCommentChange(e.target.value)}
              disabled={inactive}
              className="w-full bg-sim-surface border border-sim-border text-sim-text text-xs
                         font-mono px-3 py-1.5 rounded resize-none min-h-[56px] max-h-[120px] outline-none
                         focus:border-sim-accent placeholder:text-sim-text-faint"
            />
            <div className="flex justify-end mt-1.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={onAddComment}
                disabled={!commentText.trim() || inactive}
              >
                Comment
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
