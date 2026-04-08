import { useEffect, useState } from 'react'
import { Button } from './Button'
import { Spinner } from './Spinner'
import { Timestamp, formatSimTime } from './Timestamp'
import type { DebriefPayload } from '../testutil/index'

interface DebriefScreenProps {
  sessionId:     string
  scenarioId:    string
  scenarioTitle: string
  onBack:        () => void
  onRunAgain:    (scenarioId: string) => void
}

interface TimelineEntry {
  simTime: number
  kind:    'audit' | 'event'
  label:   string
  isRelevant?: boolean
  isRedHerring?: boolean
  why?:    string
}

export function DebriefScreen({
  sessionId, scenarioId, scenarioTitle, onBack, onRunAgain,
}: DebriefScreenProps) {
  const [debrief, setDebrief] = useState<DebriefPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    function fetchDebrief() {
      fetch(`/api/sessions/${sessionId}/debrief`)
        .then(r => { if (!r.ok) throw new Error('not ready'); return r.json() })
        .then((data: DebriefPayload) => {
          if (!cancelled) { setDebrief(data); setLoading(false) }
        })
        .catch(() => {
          if (!cancelled) {
            setTimeout(fetchDebrief, 3000)
          }
        })
    }
    fetchDebrief()
    return () => { cancelled = true }
  }, [sessionId])

  if (loading || debrief === null) {
    return (
      <div className="h-screen bg-sim-bg flex flex-col items-center justify-center gap-3">
        <Spinner size="lg" />
        <span className="text-xs text-sim-text-muted">Loading debrief...</span>
      </div>
    )
  }

  const { evaluationState, auditLog, eventLog, resolvedAtSimTime } = debrief

  // Build unified timeline
  const relevantActions   = new Set(evaluationState.relevantActionsTaken.map(a => a.action))
  const redHerringActions = new Set(evaluationState.redHerringsTaken.map(a => a.action))

  const auditEntries: TimelineEntry[] = auditLog.map(entry => ({
    simTime:     entry.simTime,
    kind:        'audit' as const,
    label:       entry.action,
    isRelevant:  relevantActions.has(entry.action),
    isRedHerring: redHerringActions.has(entry.action),
    why: evaluationState.relevantActionsTaken.find(a => a.action === entry.action)?.why
       ?? evaluationState.redHerringsTaken.find(a => a.action === entry.action)?.why,
  }))

  const eventEntries: TimelineEntry[] = (eventLog ?? []).map(entry => ({
    simTime: entry.recordedAt,
    kind:    'event' as const,
    label:   entry.event.type,
  }))

  const timeline = [...auditEntries, ...eventEntries].sort((a, b) => a.simTime - b.simTime)

  return (
    <div className="h-screen bg-sim-bg overflow-auto">
      {/* Header */}
      <div className="border-b border-sim-border bg-sim-surface px-6 py-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-sim-text-muted mb-0.5">Post-Incident Debrief</div>
          <h1 className="text-sm font-semibold text-sim-text">{scenarioTitle}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            ← New Scenario
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onRunAgain(scenarioId)}>
            ↺ Run Again
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-5xl mx-auto px-6 py-6 grid grid-cols-3 gap-6">
        {/* Left: Timeline */}
        <div className="col-span-2 flex flex-col gap-4">
          <h2 className="text-xs font-semibold text-sim-text-faint uppercase tracking-wide">
            Incident Timeline
          </h2>
          <div className="flex flex-col gap-1">
            {timeline.map((entry, i) => (
              <div key={i} className="flex items-start gap-3 py-1.5 border-b border-sim-border-muted">
                <Timestamp simTime={entry.simTime} />
                <span className="text-xs text-sim-text-faint">
                  {entry.kind === 'audit' ? '▶' : '◆'}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-sim-text font-medium">{entry.label}</span>
                  {entry.why && (
                    <div className="text-xs text-sim-text-muted mt-0.5">{entry.why}</div>
                  )}
                </div>
                {entry.isRelevant && (
                  <span className="text-sim-green text-sm font-bold flex-shrink-0">✓</span>
                )}
                {entry.isRedHerring && (
                  <span className="text-sim-red text-sm font-bold flex-shrink-0">✗</span>
                )}
              </div>
            ))}
            {timeline.length === 0 && (
              <div className="text-xs text-sim-text-faint">No actions recorded.</div>
            )}
          </div>
        </div>

        {/* Right: Evaluation + Stats */}
        <div className="flex flex-col gap-6">
          {/* Stats */}
          <div className="bg-sim-surface border border-sim-border rounded p-4 flex flex-col gap-3">
            <h2 className="text-xs font-semibold text-sim-text-faint uppercase tracking-wide">
              Stats
            </h2>
            <div className="flex flex-col gap-2">
              <div>
                <div className="text-xs text-sim-text-muted">Resolved at</div>
                <div className="text-xs font-medium text-sim-text">
                  {formatSimTime(resolvedAtSimTime)}
                </div>
              </div>
              <div>
                <div className="text-xs text-sim-text-muted">Actions taken</div>
                <div className="text-xs font-medium text-sim-text">{auditLog.length}</div>
              </div>
            </div>
          </div>

          {/* Evaluation */}
          <div className="bg-sim-surface border border-sim-border rounded p-4 flex flex-col gap-3">
            <h2 className="text-xs font-semibold text-sim-text-faint uppercase tracking-wide">
              Evaluation
            </h2>

            {/* Resolution status */}
            <div className={`text-xs ${evaluationState.resolved ? 'text-sim-green' : 'text-sim-text-muted'}`}>
              {evaluationState.resolved
                ? '✓ Incident marked resolved'
                : '○ Incident not explicitly resolved'
              }
            </div>

            {/* Relevant actions taken */}
            {evaluationState.relevantActionsTaken.length > 0 && (
              <div>
                <div className="text-xs font-medium text-sim-text mb-1">Key actions</div>
                {evaluationState.relevantActionsTaken.map((a, i) => (
                  <div key={i} className="flex gap-2 text-xs mb-1">
                    <span className="text-sim-green flex-shrink-0">✓</span>
                    <div>
                      <div className="text-sim-text">{a.action}</div>
                      <div className="text-sim-text-muted">{a.why}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Red herrings */}
            {evaluationState.redHerringsTaken.length > 0 && (
              <div>
                <div className="text-xs font-medium text-sim-text mb-1">Unnecessary actions</div>
                {evaluationState.redHerringsTaken.map((a, i) => (
                  <div key={i} className="flex gap-2 text-xs mb-1">
                    <span className="text-sim-red flex-shrink-0">✗</span>
                    <div>
                      <div className="text-sim-text">{a.action}</div>
                      <div className="text-sim-text-muted">{a.why}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
