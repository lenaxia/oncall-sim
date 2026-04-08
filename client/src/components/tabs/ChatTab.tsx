import { useState, useRef } from 'react'
import { useSession } from '../../context/SessionContext'
import { useScenario } from '../../context/ScenarioContext'
import { EmptyState } from '../EmptyState'
import { WallTimestamp } from '../Timestamp'
import { Button } from '../Button'

interface ChatTabProps {
  chatUnread:      Map<string, number>
  activeChannel:   string | null
  onChannelChange: (channelId: string) => void
}

export function ChatTab({ chatUnread, activeChannel, onChannelChange }: ChatTabProps) {
  const { state, postChatMessage, dispatchAction } = useSession()
  const { scenario } = useScenario()

  const channels       = Object.keys(state.chatMessages)
  const publicChannels = channels.filter(c => c.startsWith('#'))
  const dmChannels     = channels.filter(c => c.startsWith('dm:'))

  // If no channel selected yet, default to first public channel
  const resolvedChannel = activeChannel ?? publicChannels[0] ?? null

  const [messageText,       setMessageText]       = useState('')
  const [showMention,       setShowMention]        = useState(false)
  const [mentionFilter,     setMentionFilter]      = useState('')
  const [mentionHighlight,  setMentionHighlight]   = useState(0)
  const dmDispatched = useRef<Set<string>>(new Set())

  const personas = scenario?.personas ?? []

  function handleChannelClick(channelId: string) {
    onChannelChange(channelId)
    if (channelId.startsWith('dm:')) {
      const personaId = channelId.slice(3)
      if (!dmDispatched.current.has(personaId)) {
        dmDispatched.current.add(personaId)
        dispatchAction('direct_message_persona', { personaId })
      }
    }
  }

  function send() {
    if (!resolvedChannel || !messageText.trim()) return
    postChatMessage(resolvedChannel, messageText)
    setMessageText('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showMention) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionHighlight(h => Math.min(h + 1, filteredPersonas.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionHighlight(h => Math.max(h - 1, 0))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        insertMention(filteredPersonas[mentionHighlight])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowMention(false)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setMessageText(val)
    const atIdx = val.lastIndexOf('@')
    if (atIdx !== -1 && atIdx === val.length - 1) {
      setShowMention(true)
      setMentionFilter('')
      setMentionHighlight(0)
    } else if (atIdx !== -1 && val.slice(atIdx + 1).match(/^[\w\s-]*$/)) {
      setMentionFilter(val.slice(atIdx + 1).toLowerCase())
      setShowMention(true)
    } else {
      setShowMention(false)
    }
  }

  const filteredPersonas = personas.filter(p =>
    p.displayName.toLowerCase().startsWith(mentionFilter)
  )

  function insertMention(persona: typeof personas[0]) {
    if (!persona) return
    const atIdx = messageText.lastIndexOf('@')
    setMessageText(messageText.slice(0, atIdx) + '@' + persona.displayName)
    setShowMention(false)
  }

  const activeMessages = resolvedChannel
    ? (state.chatMessages[resolvedChannel] ?? []).slice().sort((a, b) => a.simTime - b.simTime)
    : []

  const placeholder = resolvedChannel
    ? resolvedChannel.startsWith('dm:')
      ? `Message @${personas.find(p => `dm:${p.id}` === resolvedChannel)?.displayName ?? resolvedChannel}...`
      : `Message ${resolvedChannel}...`
    : 'Select a channel...'

  return (
    <div className="flex h-full">
      {/* Left — sidebar */}
      <div className="w-44 border-r border-sim-border overflow-auto flex-shrink-0 bg-sim-surface flex flex-col">
        {publicChannels.length > 0 && (
          <>
            <div className="text-xs font-semibold text-sim-text-faint px-3 pt-3 pb-1 uppercase tracking-wide">
              Channels
            </div>
            {publicChannels.map(ch => (
              <ChannelItem
                key={ch}
                id={ch}
                label={ch}
                active={ch === resolvedChannel}
                unread={chatUnread.get(ch) ?? 0}
                onClick={() => handleChannelClick(ch)}
              />
            ))}
          </>
        )}
        {dmChannels.length > 0 && (
          <>
            <div className="text-xs font-semibold text-sim-text-faint px-3 pt-3 pb-1 uppercase tracking-wide">
              DMs
            </div>
            {dmChannels.map(ch => {
              const personaId = ch.slice(3)
              const persona   = personas.find(p => p.id === personaId)
              const unread    = chatUnread.get(ch) ?? 0
              return (
                <div
                  key={ch}
                  className={[
                    'px-3 py-2 cursor-pointer transition-colors duration-75 flex items-start justify-between gap-1',
                    ch === resolvedChannel ? 'bg-sim-surface-2' : 'hover:bg-sim-surface-2',
                  ].join(' ')}
                  onClick={() => handleChannelClick(ch)}
                >
                  <div className="flex flex-col min-w-0">
                    <div className="text-xs font-medium text-sim-text truncate">
                      {persona?.displayName ?? personaId}
                    </div>
                    {persona && (
                      <>
                        <div className="text-xs text-sim-text-muted">{persona.jobTitle}</div>
                        <div className="text-xs text-sim-text-faint">{persona.team}</div>
                      </>
                    )}
                  </div>
                  {unread > 0 && (
                    <span className="flex-shrink-0 mt-0.5 text-xs font-medium bg-sim-red text-white rounded-full px-1.5 min-w-[1.25rem] text-center tabular-nums">
                      {unread}
                    </span>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* Right — message pane */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-sim-border flex-shrink-0 bg-sim-surface text-xs font-semibold text-sim-text">
          {resolvedChannel ?? 'Select a channel'}
        </div>

        <div className="flex-1 overflow-auto px-3 py-2 flex flex-col gap-3">
          {activeMessages.length === 0 ? (
            <EmptyState title="No messages yet" message="Messages will appear here during the incident." />
          ) : (
            activeMessages.map(msg => (
              <div key={msg.id}>
                <div className="flex items-baseline gap-2 text-xs font-semibold">
                  <span
                    data-sender=""
                    className={msg.persona === 'trainee' ? 'text-sim-trainee' : 'text-sim-persona'}
                  >
                    {msg.persona}
                  </span>
                  <WallTimestamp simTime={msg.simTime} />
                </div>
                <div className="text-xs text-sim-text leading-snug mt-0.5">{msg.text}</div>
              </div>
            ))
          )}
        </div>

        <div className="relative border-t border-sim-border p-3 flex-shrink-0 bg-sim-surface">
          {showMention && filteredPersonas.length > 0 && (
            <div
              data-testid="mention-dropdown"
              className="absolute bottom-full left-3 right-3 mb-1 bg-sim-surface border border-sim-border
                         rounded shadow-lg z-20 overflow-y-auto max-h-[160px]"
            >
              {filteredPersonas.map((p, i) => (
                <div
                  key={p.id}
                  className={`px-3 py-1.5 text-xs cursor-pointer ${i === mentionHighlight ? 'bg-sim-surface-2' : ''}`}
                  onMouseDown={() => insertMention(p)}
                >
                  <span className="text-sim-text font-medium">{p.displayName}</span>
                  <span className="text-sim-text-faint ml-1">· {p.jobTitle}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <textarea
              placeholder={placeholder}
              value={messageText}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              disabled={state.status !== 'active'}
              className="flex-1 bg-sim-surface border border-sim-border text-sim-text text-xs font-mono
                         px-3 py-1 rounded resize-none min-h-[32px] max-h-[80px] outline-none
                         focus:border-sim-accent placeholder:text-sim-text-faint"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={send}
              disabled={!messageText.trim() || state.status !== 'active'}
            >
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ChannelItem({
  id: _id, label, active, unread, onClick
}: {
  id: string; label: string; active: boolean; unread: number; onClick: () => void
}) {
  return (
    <div
      className={[
        'flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors duration-75',
        active ? 'bg-sim-surface-2 text-sim-text' : 'text-sim-text-muted hover:bg-sim-surface-2 hover:text-sim-text',
      ].join(' ')}
      onClick={onClick}
    >
      <span className="text-xs">{label}</span>
      {unread > 0 && (
        <span className="ml-auto text-xs font-medium bg-sim-red text-white rounded-full px-1.5 min-w-[1.25rem] text-center tabular-nums">
          {unread}
        </span>
      )}
    </div>
  )
}
