import { useState } from 'react'
import { useSession } from '../../context/SessionContext'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { EmptyState } from '../EmptyState'
import { WallTimestamp } from '../Timestamp'
import { Button } from '../Button'
import type { EmailMessage } from '@shared/types/events'

interface EmailTabProps {
  selectedThreadId: string | null
  onSelectThread:   (threadId: string, newReadIds: string[]) => void
  readIds:          Set<string>
}

export function EmailTab({ selectedThreadId, onSelectThread, readIds }: EmailTabProps) {
  const { state, replyEmail } = useSession()

  const [replyText, setReplyText]           = useState('')
  const [optimisticReplies, setOptimisticReplies] = useState<EmailMessage[]>([])

  const allEmails    = [...state.emails, ...optimisticReplies]
  const displayEmails = selectedThreadId
    ? allEmails
        .filter(e => e.threadId === selectedThreadId)
        .sort((a, b) => a.simTime - b.simTime)
    : []

  function handleSelectThread(threadId: string) {
    const ids = allEmails
      .filter(e => e.threadId === threadId)
      .map(e => e.id)
    onSelectThread(threadId, ids)
  }

  function handleSend() {
    if (!selectedThreadId || !replyText.trim()) return
    const optimistic: EmailMessage = {
      id:       `optimistic-${Date.now()}`,
      threadId: selectedThreadId,
      from:     'trainee',
      to:       displayEmails[0]?.from ?? '',
      subject:  displayEmails[0]?.subject ?? '',
      body:     replyText,
      simTime:  state.simTime,
    }
    setOptimisticReplies(prev => [...prev, optimistic])
    replyEmail(selectedThreadId, replyText)
    setReplyText('')
  }

  // Unread: persona emails not in readIds
  const unreadThreadIds = new Set(
    state.emails
      .filter(e => e.from !== 'trainee' && !readIds.has(e.id))
      .map(e => e.threadId)
  )

  if (state.emails.length === 0 && optimisticReplies.length === 0) {
    return (
      <div className="flex h-full">
        <div className="flex-1 flex items-center justify-center">
          <EmptyState title="No emails" message="Emails will arrive during the incident." />
        </div>
      </div>
    )
  }

  const threadedGroups = groupByThread(allEmails)

  return (
    <div className="flex h-full">
      {/* Left — inbox */}
      <div className="w-56 border-r border-sim-border overflow-auto flex-shrink-0 bg-sim-surface">
        {threadedGroups.map(({ threadId, latest, subject }) => {
          const isRead     = !unreadThreadIds.has(threadId)
          const isSelected = threadId === selectedThreadId
          return (
            <div
              key={threadId}
              className={[
                'px-3 py-2 border-b border-sim-border-muted cursor-pointer hover:bg-sim-surface-2 transition-colors duration-75',
                isSelected ? 'bg-sim-surface-2' : '',
              ].join(' ')}
              onClick={() => handleSelectThread(threadId)}
            >
              <div className="flex items-start gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${!isRead ? 'bg-sim-accent' : 'invisible'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline">
                    <span className={`text-xs font-medium truncate ${!isRead ? 'text-sim-text' : 'text-sim-text-muted'}`}>
                      {latest.from}
                    </span>
                    <WallTimestamp simTime={latest.simTime} />
                  </div>
                  <div className="text-xs text-sim-text-muted truncate mt-0.5">{subject}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Right — thread view */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedThreadId === null ? (
          <EmptyState title="Select an email" message="Click an email to view the thread." />
        ) : (
          <>
            <div className="px-3 py-2 border-b border-sim-border flex-shrink-0 bg-sim-surface">
              <span className="text-xs font-semibold text-sim-text">
                {displayEmails[0]?.subject}
              </span>
            </div>
            <div className="flex-1 overflow-auto px-3 py-2 flex flex-col">
              {displayEmails.map((email, idx) => (
                <div key={email.id} className={idx > 0 ? 'border-t border-sim-border-muted pt-3 mt-3' : ''}>
                  <div data-message-header="" className="flex justify-between text-xs font-semibold mb-1">
                    <span
                      data-sender=""
                      className={email.from === 'trainee' ? 'text-sim-trainee' : 'text-sim-persona'}
                    >
                      {email.from}
                    </span>
                    <WallTimestamp simTime={email.simTime} />
                  </div>
                  <MarkdownRenderer content={email.body} />
                </div>
              ))}
            </div>
            <div className="border-t border-sim-border p-3 flex-shrink-0 bg-sim-surface flex flex-col gap-2">
              <textarea
                placeholder="Reply..."
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                disabled={state.status !== 'active'}
                className="w-full bg-sim-surface border border-sim-border text-sim-text text-xs font-mono
                           px-3 py-1 rounded resize-none min-h-[60px] max-h-[120px] outline-none
                           focus:border-sim-accent placeholder:text-sim-text-faint"
              />
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSend}
                  disabled={!replyText.trim() || state.status !== 'active'}
                >
                  Send
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function groupByThread(emails: EmailMessage[]) {
  const map = new Map<string, EmailMessage[]>()
  for (const e of emails) {
    if (!map.has(e.threadId)) map.set(e.threadId, [])
    map.get(e.threadId)!.push(e)
  }
  return Array.from(map.entries())
    .map(([threadId, msgs]) => ({
      threadId,
      latest:  msgs.reduce((a, b) => (a.simTime >= b.simTime ? a : b)),
      subject: msgs[0].subject,
    }))
    .sort((a, b) => b.latest.simTime - a.latest.simTime)
}
