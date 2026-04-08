import { useState, useRef, useEffect } from 'react'
import { useSession } from '../../context/SessionContext'
import { useScenario } from '../../context/ScenarioContext'
import { MetricChart } from './MetricChart'
import { Badge, severityVariant } from '../Badge'
import { Button } from '../Button'
import { WallTimestamp } from '../Timestamp'
import { EmptyState } from '../EmptyState'
import { PageUserModal } from '../PageUserModal'
import type { Alarm } from '@shared/types/events'

interface OpsDashboardTabProps {
  activeService:    string
  onServiceChange:  (svc: string) => void
}

export function OpsDashboardTab({ activeService, onServiceChange }: OpsDashboardTabProps) {
  const { state, dispatchAction } = useSession()
  const { scenario } = useScenario()

  const services = Object.keys(state.metrics)

  // If activeService is empty and metrics arrive, pick the first service
  useEffect(() => {
    if (activeService === '' && services.length > 0) {
      onServiceChange(services[0])
    }
  }, [services.length, activeService])  // eslint-disable-line react-hooks/exhaustive-deps
  const [pageModalOpen, setPageModalOpen] = useState(false)
  const [pageModalAlarm, setPageModalAlarm] = useState<{ id: string; label: string } | null>(null)

  // Local optimistic alarm status overrides
  const [localAlarmStatus, setLocalAlarmStatus] = useState<Record<string, 'acknowledged' | 'suppressed'>>({})

  // Track view_metric dispatches (once per metric per session)
  const viewedMetrics = useRef<Set<string>>(new Set())

  const serviceMetrics = activeService ? state.metrics[activeService] ?? {} : {}

  function handleAck(alarm: Alarm) {
    setLocalAlarmStatus(prev => ({ ...prev, [alarm.id]: 'acknowledged' }))
    dispatchAction('investigate_alert', { alarmId: alarm.id })
    dispatchAction('ack_page',          { alarmId: alarm.id })
  }

  function handleSuppress(alarm: Alarm) {
    setLocalAlarmStatus(prev => ({ ...prev, [alarm.id]: 'suppressed' }))
    dispatchAction('suppress_alarm', { alarmId: alarm.id })
  }

  function handlePageUser(personaId: string, message: string) {
    dispatchAction('page_user', { personaId, message })
    setPageModalOpen(false)
  }

  const allAlarms = state.alarms.map(a => ({
    ...a,
    status: (localAlarmStatus[a.id] ?? a.status) as import('@shared/types/events').AlarmStatus,
  }))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Service sub-tabs */}
      <div className="flex-shrink-0 flex items-center border-b border-sim-border bg-sim-surface overflow-x-auto">
        {services.map(svc => {
          const hasFiringAlarm = allAlarms.some(a => a.service === svc && a.status === 'firing')
          return (
            <button
              key={svc}
              className={[
                'flex-none px-3 py-2 text-xs cursor-pointer transition-colors duration-75 flex items-center gap-1',
                svc === activeService
                  ? 'text-sim-text border-b-2 border-sim-accent'
                  : 'text-sim-text-muted hover:text-sim-text',
              ].join(' ')}
              onClick={() => onServiceChange(svc)}
            >
              {svc}
              {hasFiringAlarm && (
                <span className="text-sim-red animate-pulse text-[10px]">●</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">
        {/* Metric charts */}
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(serviceMetrics).map(([metricId, series]) => {
            const key  = `${activeService}:${metricId}`
            const meta = scenario?.metricsMeta?.[activeService]?.[metricId]
            return (
              <MetricChart
                key={metricId}
                metricId={metricId}
                service={activeService}
                label={meta?.label ?? metricId}
                unit={meta?.unit ?? ''}
                series={series}
                simTime={state.simTime}
                clockAnchorMs={state.clockAnchorMs}
                criticalThreshold={meta?.criticalThreshold}
                onFirstHover={() => {
                  if (!viewedMetrics.current.has(key)) {
                    viewedMetrics.current.add(key)
                    dispatchAction('view_metric', { metricId, service: activeService })
                  }
                }}
              />
            )
          })}
        </div>

        {/* ACTIVE ALARMS */}
        <div className="mt-4 pt-4 border-t border-sim-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-sim-text-faint uppercase tracking-wide">
              Active Alarms
            </span>
            <Button variant="ghost" size="sm" onClick={() => { setPageModalAlarm(null); setPageModalOpen(true) }}>
              + Page User
            </Button>
          </div>

          {allAlarms.length === 0 ? (
            <EmptyState
              title="No active alarms"
              message="Alarms will appear here when metric thresholds are breached."
            />
          ) : (
            allAlarms.map(alarm => (
              <AlarmRow
                key={alarm.id}
                alarm={alarm}
                onAck={() => handleAck(alarm)}
                onSuppress={() => handleSuppress(alarm)}
                onPageUser={() => {
                  setPageModalAlarm({ id: alarm.id, label: `${alarm.condition} — ${alarm.service}` })
                  setPageModalOpen(true)
                }}
              />
            ))
          )}
        </div>

        {/* SENT PAGES */}
        {state.pages.length > 0 && (
          <div className="mt-4 pt-4 border-t border-sim-border">
            <div className="text-xs font-semibold text-sim-text-faint uppercase tracking-wide mb-3">
              Sent Pages
            </div>
            {state.pages.map(page => {
              const persona = scenario?.personas.find(p => p.id === page.personaId)
              return (
                <div key={page.id} className="flex items-start gap-3 px-3 py-2 border-b border-sim-border-muted">
                  <div className="flex-shrink-0 w-20">
                    <WallTimestamp simTime={page.simTime} />
                  </div>
                  <div className="flex-1 flex flex-col gap-0 min-w-0">
                    <span className="text-xs font-medium text-sim-text">{persona?.displayName ?? page.personaId}</span>
                    {persona && <span className="text-xs text-sim-text-muted">{persona.jobTitle}, {persona.team}</span>}
                  </div>
                  <div className="flex-shrink-0 max-w-[40%]">
                    <span className="text-xs text-sim-text truncate block">{page.message}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <PageUserModal
        open={pageModalOpen}
        onClose={() => setPageModalOpen(false)}
        onSubmit={handlePageUser}
        personas={scenario?.personas ?? []}
        alarmId={pageModalAlarm?.id}
        alarmLabel={pageModalAlarm?.label}
      />
    </div>
  )
}

function AlarmRow({
  alarm, onAck, onSuppress, onPageUser
}: {
  alarm: Alarm; onAck: () => void; onSuppress: () => void; onPageUser: () => void
}) {
  const statusClass =
    alarm.status === 'firing'       ? 'border-sim-red-dim bg-sim-red-dim/20' :
    alarm.status === 'acknowledged' ? 'border-sim-border bg-sim-surface opacity-70' :
                                      'border-sim-border-muted bg-sim-surface opacity-40'

  return (
    <div className={`flex items-start gap-3 p-3 rounded border mb-2 ${statusClass}`}>
      <div className="flex-shrink-0">
        <Badge label={alarm.severity} variant={severityVariant(alarm.severity)} pulse={alarm.status === 'firing'} />
      </div>
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-sim-text">{alarm.id}</span>
          <span className={`text-xs ${alarm.status === 'firing' ? 'text-sim-red' : alarm.status === 'acknowledged' ? 'text-sim-yellow' : 'text-sim-text-faint'}`}>
            {alarm.status}
          </span>
        </div>
        <span className="text-xs text-sim-text-muted">{alarm.condition}</span>
        {alarm.status === 'firing' && (
          <div className="flex items-center gap-2 mt-1">
            <Button variant="ghost" size="sm" onClick={onAck}>Ack</Button>
            <Button variant="ghost" size="sm" onClick={onSuppress}>Suppress</Button>
            <Button variant="ghost" size="sm" onClick={onPageUser}>Page User</Button>
          </div>
        )}
      </div>
    </div>
  )
}
