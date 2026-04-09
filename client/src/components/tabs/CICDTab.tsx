import { useState } from 'react'
import { useSession } from '../../context/SessionContext'
import { useScenario } from '../../context/ScenarioContext'
import { useSimClock } from '../../hooks/useSimClock'
import { EmptyState } from '../EmptyState'
import { WallTimestamp } from '../Timestamp'
import { Button } from '../Button'
import { Modal } from '../Modal'
import type { Pipeline, PipelineStage, StageStatus, TestStatus } from '@shared/types/events'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelativeSim(simTime: number, current: number): string {
  const diff = current - simTime
  if (diff < 0) return 'future'
  const d = Math.floor(diff / 86400)
  const h = Math.floor((diff % 86400) / 3600)
  const m = Math.floor((diff % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ago`
  if (h > 0) return `${h}h ${m}m ago`
  if (m > 0) return `${m}m ago`
  return 'just now'
}

function pipelineOverallStatus(pipeline: Pipeline): 'healthy' | 'blocked' | 'failed' | 'in_progress' {
  const statuses = pipeline.stages.map(s => s.status)
  if (statuses.some(s => s === 'failed'))      return 'failed'
  if (statuses.some(s => s === 'blocked'))     return 'blocked'
  if (statuses.some(s => s === 'in_progress')) return 'in_progress'
  return 'healthy'
}

function prodStage(pipeline: Pipeline): PipelineStage | null {
  return [...pipeline.stages].reverse().find(s => s.type === 'deploy') ?? null
}

function oldestVersionNotInProd(pipeline: Pipeline): number {
  const prod = prodStage(pipeline)
  if (!prod) return 0
  return pipeline.stages.filter(s => s.currentVersion !== prod.currentVersion).length
}

const STAGE_STATUS_COLOURS: Record<StageStatus, string> = {
  succeeded:   'bg-sim-green text-sim-bg',
  in_progress: 'bg-sim-accent text-white animate-pulse',
  blocked:     'bg-sim-red text-white',
  failed:      'bg-sim-red text-white',
  not_started: 'bg-sim-surface-2 text-sim-text-faint',
}

const STAGE_STATUS_LABEL: Record<StageStatus, string> = {
  succeeded:   '✓',
  in_progress: '…',
  blocked:     '⚠',
  failed:      '✗',
  not_started: '○',
}

const BLOCKER_ICON: Record<string, string> = {
  alarm:            '🔔',
  time_window:      '⏰',
  manual_approval:  '👤',
  test_failure:     '✗',
}

const TEST_STATUS_STYLES: Record<TestStatus, { dot: string; text: string }> = {
  passed:  { dot: 'bg-sim-green',        text: 'text-sim-green' },
  failed:  { dot: 'bg-sim-red',          text: 'text-sim-red' },
  running: { dot: 'bg-sim-accent animate-pulse', text: 'text-sim-accent' },
  pending: { dot: 'bg-sim-text-faint',   text: 'text-sim-text-faint' },
  skipped: { dot: 'bg-sim-border',       text: 'text-sim-text-faint' },
}

const OVERALL_STATUS_STYLES = {
  healthy:     { dot: 'bg-sim-green',   label: 'HEALTHY',   text: 'text-sim-green' },
  blocked:     { dot: 'bg-sim-red',     label: 'BLOCKED',   text: 'text-sim-red' },
  failed:      { dot: 'bg-sim-red',     label: 'FAILED',    text: 'text-sim-red' },
  in_progress: { dot: 'bg-sim-accent',  label: 'DEPLOYING', text: 'text-sim-accent' },
}

// ── Main component ────────────────────────────────────────────────────────────

export function CICDTab() {
  const { state, dispatchAction } = useSession()
  const { simTime } = useSimClock()

  const pipelines = state.pipelines
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null)
  const [selectedStageId,    setSelectedStageId]    = useState<string | null>(null)

  const [confirmRollback, setConfirmRollback] = useState<{ pipelineId: string; stageId: string; version: string } | null>(null)
  const [confirmOverride, setConfirmOverride] = useState<{ pipelineId: string; stageId: string } | null>(null)

  const selectedPipeline = pipelines.find(p => p.id === selectedPipelineId) ?? null
  const selectedStage    = selectedPipeline?.stages.find(s => s.id === selectedStageId) ?? null

  function handleSelectPipeline(pipeline: Pipeline) {
    setSelectedPipelineId(pipeline.id)
    setSelectedStageId(null)
    dispatchAction('view_pipeline', { pipelineId: pipeline.id, pipelineName: pipeline.name })
  }

  function handleRollback() {
    if (!confirmRollback) return
    dispatchAction('trigger_rollback', { pipelineId: confirmRollback.pipelineId, stageId: confirmRollback.stageId })
    setConfirmRollback(null)
  }

  function handleOverride() {
    if (!confirmOverride) return
    dispatchAction('override_blocker', { pipelineId: confirmOverride.pipelineId, stageId: confirmOverride.stageId })
    setConfirmOverride(null)
  }

  const inactive = state.status !== 'active'

  if (pipelines.length === 0) {
    return <EmptyState title="No pipelines" message="Pipeline data will appear here." />
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Pipeline list */}
      <div className="flex-shrink-0 border-b border-sim-border bg-sim-surface">
        <div className="text-xs font-semibold text-sim-text-faint uppercase tracking-wide px-4 pt-3 pb-2">
          Pipelines
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-sim-text-faint uppercase tracking-wide border-b border-sim-border">
              <th className="px-4 py-1.5 text-left">Pipeline</th>
              <th className="px-4 py-1.5 text-left">Status</th>
              <th className="px-4 py-1.5 text-left" data-testid="pipeline-last-prod">Last Prod Deploy</th>
              <th className="px-4 py-1.5 text-left" data-testid="pipeline-oldest-not-prod">Versions Pending Prod</th>
            </tr>
          </thead>
          <tbody>
            {pipelines.map(p => {
              const overall  = pipelineOverallStatus(p)
              const style    = OVERALL_STATUS_STYLES[overall]
              const prod     = prodStage(p)
              const pending  = oldestVersionNotInProd(p)
              const isActive = p.id === selectedPipelineId
              return (
                <tr
                  key={p.id}
                  className={[
                    'border-b border-sim-border-muted cursor-pointer hover:bg-sim-surface-2 transition-colors duration-75',
                    isActive ? 'bg-sim-surface-2 border-l-2 border-l-sim-accent' : '',
                  ].join(' ')}
                  onClick={() => handleSelectPipeline(p)}
                >
                  <td className="px-4 py-2 font-medium text-sim-text">{p.name}</td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${style.dot}`} />
                      <span className={`font-mono ${style.text}`}>{style.label}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sim-text-muted">
                    {prod ? formatRelativeSim(prod.deployedAtSec, simTime) : '—'}
                  </td>
                  <td className="px-4 py-2">
                    {pending > 0
                      ? <span className="text-sim-yellow">{pending} stage{pending > 1 ? 's' : ''}</span>
                      : <span className="text-sim-text-faint">0</span>
                    }
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Stage flow + detail */}
      {selectedPipeline ? (
        <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
          <div className="text-xs font-semibold text-sim-text-muted uppercase tracking-wide">
            {selectedPipeline.name}
          </div>

          {/* Stage flow */}
          <div data-testid="stage-flow" className="flex items-stretch gap-0 overflow-x-auto">
            {selectedPipeline.stages.map((stage, idx) => (
              <div key={stage.id} className="flex items-stretch">
                {idx > 0 && (
                  <div className="flex items-center">
                    <div className={`w-6 h-px ${stage.status === 'not_started' ? 'bg-sim-border' : 'bg-sim-text-faint'}`} />
                  </div>
                )}
                <button
                  data-testid={`stage-pill-${stage.id}`}
                  onClick={() => setSelectedStageId(stage.id === selectedStageId ? null : stage.id)}
                  className={[
                    'flex flex-col items-center gap-0.5 px-3 py-2 rounded text-xs font-medium transition-colors duration-75 min-w-[80px]',
                    STAGE_STATUS_COLOURS[stage.status],
                    selectedStageId === stage.id ? 'ring-2 ring-white ring-offset-1 ring-offset-sim-bg' : '',
                  ].join(' ')}
                >
                  <span className="text-base leading-none">{STAGE_STATUS_LABEL[stage.status]}</span>
                  <span>{stage.name}</span>
                  <span className="font-mono text-[10px] opacity-75">{stage.currentVersion}</span>
                  {stage.blockers.length > 0 && (
                    <span className="text-[10px]">{stage.blockers.map(b => BLOCKER_ICON[b.type]).join('')}</span>
                  )}
                </button>
              </div>
            ))}
          </div>

          {/* Stage detail */}
          {selectedStage && (
            <StageDetail
              pipeline={selectedPipeline}
              stage={selectedStage}
              simTime={simTime}
              inactive={inactive}
              onRollback={() => setConfirmRollback({
                pipelineId: selectedPipeline.id,
                stageId:    selectedStage.id,
                version:    selectedStage.previousVersion ?? '',
              })}
              onOverride={() => setConfirmOverride({ pipelineId: selectedPipeline.id, stageId: selectedStage.id })}
              onApproveGate={() => dispatchAction('approve_gate', { pipelineId: selectedPipeline.id, stageId: selectedStage.id })}
              onBlockPromotion={() => dispatchAction('block_promotion', { pipelineId: selectedPipeline.id, stageId: selectedStage.id })}
            />
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState title="Select a pipeline" message="Click a pipeline above to view its stages." />
        </div>
      )}

      {/* Rollback confirmation */}
      <Modal
        open={confirmRollback !== null}
        onClose={() => setConfirmRollback(null)}
        title="Confirm Rollback"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmRollback(null)}>Cancel</Button>
            <Button variant="danger" size="sm" onClick={handleRollback}>Rollback →</Button>
          </>
        }
      >
        <p className="text-xs text-sim-text-muted">
          Roll back the <strong>{confirmRollback?.stageId}</strong> stage
          to <strong>{confirmRollback?.version}</strong>?
        </p>
      </Modal>

      {/* Override blocker confirmation */}
      <Modal
        open={confirmOverride !== null}
        onClose={() => setConfirmOverride(null)}
        title="Override Blocker"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmOverride(null)}>Cancel</Button>
            <Button variant="danger" size="sm" onClick={handleOverride}>Override →</Button>
          </>
        }
      >
        <p className="text-xs text-sim-text-muted mb-2">
          Force-promote through the blocking condition on the <strong>{confirmOverride?.stageId}</strong> stage.
        </p>
        <p className="text-xs text-sim-yellow">
          ⚠ Alarm blockers will reinstate in 30 sim-minutes if the alarm is still firing.
        </p>
      </Modal>
    </div>
  )
}

// ── Stage detail panel ────────────────────────────────────────────────────────

function StageDetail({
  pipeline, stage, simTime, inactive,
  onRollback, onOverride, onApproveGate, onBlockPromotion,
}: {
  pipeline:         Pipeline
  stage:            PipelineStage
  simTime:          number
  inactive:         boolean
  onRollback:       () => void
  onOverride:       () => void
  onApproveGate:    () => void
  onBlockPromotion: () => void
}) {
  const hasBlockers      = stage.blockers.length > 0
  const hasAlarmBlocker  = stage.blockers.some(b => b.type !== 'manual_approval')
  const hasManualGate    = stage.blockers.some(b => b.type === 'manual_approval')

  return (
    <div className="bg-sim-surface border border-sim-border rounded flex flex-col gap-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-sim-border flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-sim-text">{stage.name}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${STAGE_STATUS_COLOURS[stage.status]}`}>
              {stage.status.replace('_', ' ')}
            </span>
          </div>
          <div className="text-xs font-mono text-sim-text-muted">{stage.currentVersion}</div>
          <div className="text-xs text-sim-text-faint">
            {stage.commitMessage} · {stage.author} · <WallTimestamp simTime={stage.deployedAtSec} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-1.5 flex-shrink-0">
          {stage.previousVersion && (
            <Button variant="danger" size="sm" onClick={onRollback} disabled={inactive}>
              Rollback to {stage.previousVersion}
            </Button>
          )}
          {hasBlockers && hasAlarmBlocker && (
            <Button variant="secondary" size="sm" onClick={onOverride} disabled={inactive}>
              Override Blocker
            </Button>
          )}
          {hasManualGate && (
            <Button variant="primary" size="sm" onClick={onApproveGate} disabled={inactive}>
              Approve Gate
            </Button>
          )}
          {!hasBlockers && (
            <Button variant="ghost" size="sm" onClick={onBlockPromotion} disabled={inactive}>
              Block Promotion
            </Button>
          )}
        </div>
      </div>

      {/* Active blockers */}
      {hasBlockers && (
        <div className="px-4 py-3 border-b border-sim-border bg-sim-red-dim/20 flex flex-col gap-2">
          {stage.blockers.map((blocker, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="flex-shrink-0 text-base leading-none">{BLOCKER_ICON[blocker.type] ?? '⚠'}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-sim-red capitalize">
                  {blocker.type.replace('_', ' ')} blocking promotion
                </div>
                <div className="text-xs text-sim-text-muted">{blocker.message}</div>
                {blocker.suppressedUntil != null && (
                  <div className="text-xs text-sim-yellow mt-0.5">
                    Override active — alarm will re-block at simTime {blocker.suppressedUntil}s
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tests + Promotion history (two-column) */}
      <div className="grid grid-cols-2 divide-x divide-sim-border">
        {/* Test results */}
        <div className="px-4 py-3">
          <div className="text-xs font-semibold text-sim-text-faint uppercase tracking-wide mb-2">Tests</div>
          {stage.tests.length === 0 ? (
            <div className="text-xs text-sim-text-faint">No tests configured</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {stage.tests.map((t, i) => {
                const style = TEST_STATUS_STYLES[t.status]
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${style.dot}`} />
                    <span className={`text-xs ${style.text}`}>{t.name}</span>
                    {t.note && (
                      <span className="text-xs text-sim-text-faint ml-auto truncate max-w-[120px]">{t.note}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Promotion history */}
        <div className="px-4 py-3">
          <div className="text-xs font-semibold text-sim-text-faint uppercase tracking-wide mb-2">
            Recent Promotions
          </div>
          {stage.promotionEvents.length === 0 ? (
            <div className="text-xs text-sim-text-faint">No history</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {stage.promotionEvents.slice(0, 5).map((ev, i) => {
                const dot = ev.status === 'succeeded' ? 'text-sim-green' :
                            ev.status === 'failed'    ? 'text-sim-red'   : 'text-sim-yellow'
                return (
                  <div key={i} className="flex items-start gap-2">
                    <span className={`text-xs flex-shrink-0 font-medium ${dot}`}>
                      {ev.status === 'succeeded' ? '✓' : ev.status === 'failed' ? '✗' : '⚠'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-mono text-sim-text-muted">{ev.version}</span>
                      <span className="text-xs text-sim-text-faint ml-1">
                        · <WallTimestamp simTime={ev.simTime} />
                      </span>
                      <div className="text-xs text-sim-text-faint truncate">{ev.note}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Previous version */}
      {stage.previousVersion && (
        <div className="px-4 py-2 border-t border-sim-border-muted bg-sim-surface-2 text-xs text-sim-text-faint">
          Previous version: <span className="font-mono text-sim-text-muted">{stage.previousVersion}</span>
        </div>
      )}
    </div>
  )
}
