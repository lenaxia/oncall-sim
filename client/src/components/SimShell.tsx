import { useState, useEffect, useRef } from 'react'
import { useSession } from '../context/SessionContext'
import { useScenario } from '../context/ScenarioContext'
import { SimClockContext } from '../hooks/useSimClock'
import { Topbar } from './Topbar'
import { TabBar, type TabDef } from './TabBar'
import { Spinner } from './Spinner'
import { Modal } from './Modal'
import { Button } from './Button'
import type { TabId } from '../context/SessionContext'
import type { LogLevel } from '@shared/types/events'

interface SimShellProps {
  onResolve: () => void
}

export interface LogFilterState {
  query:  string
  levels: Set<LogLevel>
  service: string
}

// Tab components loaded lazily — imported here so SimShell owns the routing
// Tabs are implemented in Step 6; stub placeholders used until then
import { EmailTab }        from './tabs/EmailTab'
import { ChatTab }         from './tabs/ChatTab'
import { TicketingTab }    from './tabs/TicketingTab'
import { OpsDashboardTab } from './tabs/OpsDashboardTab'
import { LogsTab }         from './tabs/LogsTab'
import { WikiTab }         from './tabs/WikiTab'
import { CICDTab }         from './tabs/CICDTab'

const ALL_TABS: TabDef[] = [
  { id: 'email',   label: 'Email' },
  { id: 'chat',    label: 'Chat' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'ops',     label: 'Ops Dashboard' },
  { id: 'logs',    label: 'Logs' },
  { id: 'wiki',    label: 'Wiki' },
  { id: 'cicd',    label: 'CI/CD' },
]

export function SimShell({ onResolve }: SimShellProps) {
  const { state, dispatchAction, resolveSession, resolving } = useSession()
  const { scenario } = useScenario()

  const defaultTab = (scenario?.engine.defaultTab ?? 'email') as TabId
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab)
  const [confirmResolve, setConfirmResolve] = useState(false)

  // Log filter — persists across tab switches
  const [logFilter, setLogFilter] = useState<LogFilterState>({
    query:  '',
    levels: new Set<LogLevel>(),
    service: '',
  })

  // Email tab state — persists across tab switches
  const [emailSelectedThreadId, setEmailSelectedThreadId] = useState<string | null>(null)
  const [emailReadIds, setEmailReadIds]                   = useState<Set<string>>(new Set())

  // Chat tab state — persists across tab switches
  const [chatActiveChannel, setChatActiveChannel] = useState<string | null>(null)

  // Ops dashboard state — persists across tab switches; kept mounted to avoid Recharts re-init
  const [opsActiveService, setOpsActiveService] = useState<string>('')

  // Unread counts
  const [emailUnread,   setEmailUnread]   = useState<Set<string>>(new Set())
  const [chatUnread,    setChatUnread]    = useState<Map<string, number>>(new Map())
  const [ticketUnread,  setTicketUnread]  = useState(0)
  const [hasNewAlarm,   setHasNewAlarm]   = useState(false)
  const [cicdUnread,    setCicdUnread]    = useState(0)

  // Track seen counts so we can detect new arrivals vs initial snapshot
  const seenEmailIds     = useRef<Set<string>>(new Set())
  const seenChatCounts   = useRef<Map<string, number>>(new Map())
  const seenTicketCount  = useRef(0)
  const seenCicdVersions = useRef<Set<string>>(new Set())

  // Email unread tracking
  useEffect(() => {
    for (const email of state.emails) {
      if (email.from === 'trainee') continue          // own sent messages never unread
      if (seenEmailIds.current.has(email.id)) continue
      seenEmailIds.current.add(email.id)
      if (activeTab !== 'email' || !emailReadIds.has(email.id)) {
        setEmailUnread(prev => new Set([...prev, email.id]))
      }
    }
  }, [state.emails])  // eslint-disable-line react-hooks/exhaustive-deps

  // Chat unread tracking — per channel
  useEffect(() => {
    for (const [channel, msgs] of Object.entries(state.chatMessages)) {
      const prevCount = seenChatCounts.current.get(channel) ?? 0
      const newMsgs   = msgs.slice(prevCount)
      seenChatCounts.current.set(channel, msgs.length)

      const unreadNewMsgs = newMsgs.filter(m => m.persona !== 'trainee')
      if (unreadNewMsgs.length === 0) continue

      // Only increment unread if: not on chat tab, or on chat tab but different channel
      const isActiveAndVisible = activeTab === 'chat' && chatActiveChannel === channel
      if (!isActiveAndVisible) {
        setChatUnread(prev => {
          const next = new Map(prev)
          next.set(channel, (next.get(channel) ?? 0) + unreadNewMsgs.length)
          return next
        })
      }
    }
  }, [state.chatMessages])  // eslint-disable-line react-hooks/exhaustive-deps

  // Alarm badge: show dot while any alarm is firing, regardless of which tab is active.
  // Clears automatically when no alarms remain in firing state.
  useEffect(() => {
    const hasFiring = state.alarms.some(a => a.status === 'firing')
    setHasNewAlarm(hasFiring)
  }, [state.alarms])

  // Ticket unread tracking
  useEffect(() => {
    if (state.tickets.length > seenTicketCount.current && activeTab !== 'tickets') {
      setTicketUnread(prev => prev + (state.tickets.length - seenTicketCount.current))
    }
    seenTicketCount.current = state.tickets.length
  }, [state.tickets])  // eslint-disable-line react-hooks/exhaustive-deps

  // CI/CD unread tracking
  useEffect(() => {
    for (const deps of Object.values(state.deployments)) {
      for (const dep of deps) {
        const key = `${dep.version}-${dep.deployedAtSec}`
        if (!seenCicdVersions.current.has(key)) {
          seenCicdVersions.current.add(key)
          if (activeTab !== 'cicd') {
            setCicdUnread(prev => prev + 1)
          }
        }
      }
    }
  }, [state.deployments])  // eslint-disable-line react-hooks/exhaustive-deps

  // dispatch open_tab on mount / tab switch
  useEffect(() => {
    dispatchAction('open_tab', { tab: activeTab })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  function handleTabChange(id: string) {
    const tabId = id as TabId
    setActiveTab(tabId)
    // Email: do NOT clear on tab switch — badge clears per-thread as user reads them
    // Chat: do NOT clear active channel on tab switch — badge clears when user clicks channel
    // Tickets: clear on arrival since all items are immediately visible
    if (tabId === 'tickets') setTicketUnread(0)
    // CI/CD: clear on arrival since all items are immediately visible
    if (tabId === 'cicd')    setCicdUnread(0)
    // Ops alarm: badge clears when all active alarms are acked/suppressed, not on tab open
    // (handled by alarm tracking useEffect watching alarm status changes)
  }

  const tabs: TabDef[] = ALL_TABS.map(t => ({
    ...t,
    badge: t.id === 'email'   ? emailUnread.size      :
           t.id === 'chat'    ? Array.from(chatUnread.values()).reduce((a, b) => a + b, 0) :
           t.id === 'tickets' ? ticketUnread           :
           t.id === 'cicd'    ? cicdUnread             :
           undefined,
    alarm: t.id === 'ops' ? hasNewAlarm : undefined,
  }))

  const clockInput = { simTime: state.simTime, speed: state.speed, paused: state.paused, clockAnchorMs: state.clockAnchorMs }

  if (!state.connected) {
    return (
      <div className="h-full flex items-center justify-center bg-sim-bg">
        <div className="flex flex-col items-center gap-3">
          <Spinner size="lg" />
          <span className="text-xs text-sim-text-muted">Connecting to simulation...</span>
        </div>
      </div>
    )
  }

  return (
    <SimClockContext.Provider value={clockInput}>
      <div className="h-full flex flex-col bg-sim-bg overflow-hidden">
        <Topbar />

        <TabBar
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onResolve={() => setConfirmResolve(true)}
          resolveDisabled={resolving}
        />

        {/* Reconnecting banner */}
        {state.reconnecting && (
          <div className="flex-shrink-0 bg-sim-yellow-dim border-b border-sim-yellow text-sim-yellow text-xs px-3 py-1 text-center">
            Reconnecting...
          </div>
        )}

        {/* Tab content */}
        <div
          id={`tabpanel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={activeTab}
          className="flex-1 overflow-hidden relative"
        >
          {activeTab === 'email'   && (
            <EmailTab
              selectedThreadId={emailSelectedThreadId}
              onSelectThread={(id, newReadIds) => {
                setEmailSelectedThreadId(id)
                setEmailReadIds(prev => {
                  const next = new Set(prev)
                  newReadIds.forEach(rid => next.add(rid))
                  return next
                })
                // Clear unread for this thread
                setEmailUnread(prev => {
                  const next = new Set(prev)
                  newReadIds.forEach(rid => next.delete(rid))
                  return next
                })
              }}
              readIds={emailReadIds}
            />
          )}
          {activeTab === 'chat'    && (
            <ChatTab
              chatUnread={chatUnread}
              activeChannel={chatActiveChannel}
              onChannelChange={(ch) => {
                setChatActiveChannel(ch)
                setChatUnread(prev => { const n = new Map(prev); n.set(ch, 0); return n })
              }}
            />
          )}
          {activeTab === 'tickets' && <TicketingTab />}
          {/* OpsDashboardTab stays mounted to avoid Recharts ResizeObserver re-init on tab switch */}
          <div className={activeTab === 'ops' ? 'h-full' : 'hidden'}>
            <OpsDashboardTab
              activeService={opsActiveService}
              onServiceChange={setOpsActiveService}
            />
          </div>
          {activeTab === 'logs'    && <LogsTab filterState={logFilter} onFilterChange={setLogFilter} />}
          {activeTab === 'wiki'    && <WikiTab />}
          {activeTab === 'cicd'    && <CICDTab />}
        </div>

        {/* Resolving overlay */}
        {resolving && (
          <div className="absolute inset-0 bg-black/60 z-40 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Spinner size="lg" />
              <span className="text-sm text-sim-text">Generating debrief report...</span>
            </div>
          </div>
        )}

        {/* End Simulation confirmation modal */}
        <Modal
          open={confirmResolve}
          onClose={() => setConfirmResolve(false)}
          title="End Simulation?"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setConfirmResolve(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={async () => {
                  setConfirmResolve(false)
                  await resolveSession()
                  onResolve()
                }}
              >
                End Simulation →
              </Button>
            </>
          }
        >
          <p className="text-xs text-sim-text-muted">
            This will stop the incident simulation and generate your debrief report.
            You won&apos;t be able to take further actions.
          </p>
        </Modal>
      </div>
    </SimClockContext.Provider>
  )
}
