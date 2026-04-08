import { useState } from 'react'
import { useSession } from '../../context/SessionContext'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { EmptyState } from '../EmptyState'
import { WallTimestamp } from '../Timestamp'
import { Badge, severityVariant } from '../Badge'
import { Button } from '../Button'
import type { Ticket, TicketStatus, TicketSeverity } from '@shared/types/events'

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

  function handleMarkInProgress() {
    if (!selected) return
    dispatchAction('update_ticket', { ticketId: selected.id, changes: { status: 'in_progress' } })
  }

  function handleMarkResolved() {
    if (!selected) return
    dispatchAction('mark_resolved',  { ticketId: selected.id })
    dispatchAction('update_ticket',  { ticketId: selected.id, changes: { status: 'resolved' } })
  }

  function handleAddComment() {
    if (!selected || !commentText.trim()) return
    dispatchAction('add_ticket_comment', { ticketId: selected.id, body: commentText })
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

  const statusColour: Record<TicketStatus, string> = {
    open:        'text-sim-text-muted',
    in_progress: 'text-sim-yellow',
    resolved:    'text-sim-green',
  }

  return (
    <div className="flex h-full">
      {/* Left — ticket list */}
      <div className="w-56 border-r border-sim-border overflow-auto flex-shrink-0 bg-sim-surface">
        {state.tickets.length === 0 ? (
          <EmptyState title="No tickets" message="Tickets will appear during the incident." />
        ) : (
          state.tickets.map(t => (
            <div
              key={t.id}
              className={[
                'px-3 py-2 border-b border-sim-border-muted cursor-pointer hover:bg-sim-surface-2',
                t.id === selectedId ? 'bg-sim-surface-2' : '',
              ].join(' ')}
              onClick={() => handleSelectTicket(t.id)}
            >
              <div className="flex items-center gap-2">
                <Badge label={t.severity} variant={severityVariant(t.severity)} />
                <span className="text-xs font-medium text-sim-text">{t.id}</span>
              </div>
              <div className="text-xs text-sim-text-muted truncate mt-0.5">{t.title}</div>
              <div className="text-xs text-sim-text-faint mt-0.5">
                <span className={statusColour[t.status]}>{t.status}</span>
                {' · '}
                <WallTimestamp simTime={t.simTime} />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Right — ticket detail */}
      <div className="flex-1 overflow-auto">
        {selected === null ? (
          <EmptyState title="Select a ticket" message="Click a ticket to view its details." />
        ) : (
          <TicketDetail
            ticket={selected}
            comments={comments}
            commentText={commentText}
            onCommentChange={setCommentText}
            onAddComment={handleAddComment}
            onMarkInProgress={handleMarkInProgress}
            onMarkResolved={handleMarkResolved}
            onStatusChange={handleStatusChange}
            onSeverityChange={handleSeverityChange}
            inactive={state.status !== 'active'}
          />
        )}
      </div>
    </div>
  )
}

function TicketDetail({
  ticket, comments, commentText, onCommentChange,
  onAddComment, onMarkInProgress, onMarkResolved,
  onStatusChange: _onStatusChange, onSeverityChange: _onSeverityChange, inactive,
}: {
  ticket:          Ticket
  comments:        import('@shared/types/events').TicketComment[]
  commentText:     string
  onCommentChange: (v: string) => void
  onAddComment:    () => void
  onMarkInProgress: () => void
  onMarkResolved:   () => void
  onStatusChange:   (s: TicketStatus) => void
  onSeverityChange: (s: TicketSeverity) => void
  inactive:        boolean
}) {
  return (
    <div className="p-0 flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-sim-border bg-sim-surface flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Badge label={ticket.severity} variant={severityVariant(ticket.severity)} />
          <span className="text-xs">{ticket.id}</span>
          <span className="text-xs text-sim-yellow">{ticket.status}</span>
        </div>
        <span className="text-sm font-semibold text-sim-text">{ticket.title}</span>
      </div>

      <div className="p-3 flex flex-col gap-4">
        {/* Description */}
        <MarkdownRenderer content={ticket.description} />

        {/* Comments */}
        <div>
          <div className="text-xs font-semibold text-sim-text-faint uppercase tracking-wide mb-2">
            Comments
          </div>
          <div className="flex flex-col gap-2">
            {comments.map(c => (
              <div key={c.id} className="flex flex-col gap-0.5">
                <div className="flex items-baseline gap-2">
                  <span className={`text-xs font-semibold ${c.author === 'trainee' ? 'text-sim-trainee' : 'text-sim-persona'}`}>
                    {c.author}
                  </span>
                  <WallTimestamp simTime={c.simTime} />
                </div>
                <span className="text-xs text-sim-text">{c.body}</span>
              </div>
            ))}
          </div>
          <textarea
            placeholder="Add a comment..."
            value={commentText}
            onChange={e => onCommentChange(e.target.value)}
            disabled={inactive}
            className="w-full mt-2 bg-sim-surface border border-sim-border text-sim-text text-xs
                       font-mono px-3 py-1 rounded resize-none min-h-[48px] max-h-[96px] outline-none
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

        {/* Actions */}
        <div>
          <div className="text-xs font-semibold text-sim-text-faint uppercase tracking-wide mb-2">
            Actions
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            {ticket.status === 'open' && (
              <Button variant="secondary" size="sm" onClick={onMarkInProgress} disabled={inactive}>
                Mark In Progress
              </Button>
            )}
            {ticket.status === 'in_progress' && (
              <Button variant="danger" size="sm" onClick={onMarkResolved} disabled={inactive}>
                Mark Resolved
              </Button>
            )}
            {ticket.status === 'resolved' && (
              <span className="text-xs text-sim-green">✓ Resolved</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
