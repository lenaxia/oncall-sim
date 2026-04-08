import { useState } from 'react'
import { useSession } from '../../context/SessionContext'
import { useScenario } from '../../context/ScenarioContext'
import { EmptyState } from '../EmptyState'
import { WallTimestamp } from '../Timestamp'
import { Button } from '../Button'
import { Modal } from '../Modal'
import type { Deployment } from '@shared/types/events'

function formatRelativeTime(sec: number): string {
  const abs = Math.abs(sec)
  const d   = Math.floor(abs / 86400)
  const h   = Math.floor((abs % 86400) / 3600)
  const m   = Math.floor((abs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h before`
  if (h > 0) return `${h}h ${m}m before`
  return `${m}m before`
}

export function CICDTab() {
  const { state, dispatchAction } = useSession()
  const { scenario } = useScenario()

  const services = Object.keys(state.deployments)
  const [activeService, setActiveService] = useState<string | null>(services[0] ?? null)

  // Modal state
  const [confirmRollback,    setConfirmRollback]    = useState<{ version: string } | null>(null)
  const [confirmRollForward, setConfirmRollForward] = useState<{ version: string } | null>(null)
  const [showEmergencyDeploy, setShowEmergencyDeploy] = useState(false)
  const [showThrottle,        setShowThrottle]        = useState(false)
  const [showFeatureFlag,     setShowFeatureFlag]      = useState(false)
  const [emergencyNotes,      setEmergencyNotes]       = useState('')
  const [throttleValue,       setThrottleValue]        = useState('')
  const [featureFlagId,       setFeatureFlagId]        = useState('')
  const [toggledFlags,        setToggledFlags]         = useState<Map<string, boolean>>(new Map())

  const featureFlags = scenario?.featureFlags ?? []
  const hasFeatureFlags = scenario?.engine.hasFeatureFlags ?? false

  function handleSelectService(svc: string) {
    setActiveService(svc)
    dispatchAction('view_deployment_history', { service: svc })
  }

  function handleConfirmRollback() {
    if (!activeService || !confirmRollback) return
    dispatchAction('trigger_rollback', { service: activeService, version: confirmRollback.version })
    setConfirmRollback(null)
  }

  function handleConfirmRollForward() {
    if (!activeService || !confirmRollForward) return
    dispatchAction('trigger_roll_forward', { service: activeService, version: confirmRollForward.version })
    setConfirmRollForward(null)
  }

  function handleEmergencyDeploy() {
    if (!activeService) return
    const notes = emergencyNotes.trim() || undefined
    dispatchAction('emergency_deploy', { service: activeService, ...(notes ? { notes } : {}) })
    setShowEmergencyDeploy(false)
    setEmergencyNotes('')
  }

  function handleThrottle() {
    if (!activeService) return
    const pct = Number(throttleValue)
    dispatchAction('throttle_traffic', { service: activeService, percentage: pct })
    setShowThrottle(false)
    setThrottleValue('')
  }

  function handleToggleFlag(enabled: boolean) {
    if (!activeService || !featureFlagId) return
    dispatchAction('toggle_feature_flag', { flag: featureFlagId, enabled })
    setToggledFlags(m => new Map(m).set(featureFlagId, enabled))
    setShowFeatureFlag(false)
  }

  const deployments = activeService ? (state.deployments[activeService] ?? []) : []
  const prevDeployments   = deployments.filter(d => d.status === 'previous')
  const rolledBackDeps    = deployments.filter(d => d.status === 'rolled_back')

  const alarms = state.alarms
  const hasFiringAlarmForService = (svc: string) =>
    alarms.some(a => a.service === svc && a.status === 'firing')

  const throttleNum = Number(throttleValue)
  const throttleValid = throttleValue !== '' && throttleNum >= 0 && throttleNum <= 100

  return (
    <div className="flex h-full">
      {/* Left — service list */}
      <div className="w-44 border-r border-sim-border overflow-auto flex-shrink-0 bg-sim-surface">
        {services.map(svc => (
          <div
            key={svc}
            className={[
              'flex items-center px-3 py-2 border-b border-sim-border-muted cursor-pointer text-xs transition-colors duration-75',
              svc === activeService
                ? 'bg-sim-surface-2 text-sim-text border-l-2 border-l-sim-accent pl-[10px]'
                : 'text-sim-text-muted hover:bg-sim-surface-2',
            ].join(' ')}
            onClick={() => handleSelectService(svc)}
          >
            {svc}
            {hasFiringAlarmForService(svc) && (
              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-sim-red animate-pulse" />
            )}
          </div>
        ))}
      </div>

      {/* Right */}
      <div className="flex-1 overflow-auto flex flex-col">
        {activeService === null ? (
          <EmptyState title="Select a service" message="Choose a service from the list." />
        ) : (
          <>
            {/* Header */}
            <div className="px-3 py-2 border-b border-sim-border bg-sim-surface flex-shrink-0">
              <span className="text-xs font-semibold text-sim-text">{activeService} deployments</span>
            </div>

            {deployments.length === 0 ? (
              <EmptyState title="No deployments" message="No deployment history available for this service." />
            ) : (
              <div className="flex-1 overflow-auto">
                {/* Deployment table */}
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="text-xs font-medium text-sim-text-faint uppercase tracking-wide">
                      <th className="py-2 px-3 text-left">Version</th>
                      <th className="py-2 px-3 text-left">Deployed At</th>
                      <th className="py-2 px-3 text-left">Status</th>
                      <th className="py-2 px-3 text-left">Author</th>
                      <th className="py-2 px-3 text-left">Commit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deployments.map((dep, i) => (
                      <DeploymentRow key={`${dep.version}-${i}`} dep={dep} />
                    ))}
                  </tbody>
                </table>

                {/* Action buttons */}
                <div className="p-3 border-t border-sim-border">
                  {/* Recovery group */}
                  <div className="flex flex-wrap gap-2 mb-3">
                    {prevDeployments.map(dep => (
                      <Button
                        key={dep.version}
                        variant="danger"
                        size="sm"
                        onClick={() => setConfirmRollback({ version: dep.version })}
                      >
                        Rollback to {dep.version}
                      </Button>
                    ))}
                    {rolledBackDeps.map(dep => (
                      <Button
                        key={dep.version}
                        variant="danger"
                        size="sm"
                        onClick={() => setConfirmRollForward({ version: dep.version })}
                      >
                        Roll-forward to {dep.version}
                      </Button>
                    ))}
                    <Button variant="danger" size="sm" onClick={() => setShowEmergencyDeploy(true)}>
                      Emergency deploy
                    </Button>
                  </div>

                  <div className="border-t border-sim-border-muted my-1" />

                  {/* Operational group */}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => dispatchAction('restart_service', { service: activeService })}>
                      Restart service
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => dispatchAction('scale_cluster', { service: activeService, direction: 'up' })}>
                      Scale up
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => dispatchAction('scale_cluster', { service: activeService, direction: 'down' })}>
                      Scale down
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setShowThrottle(true)}>
                      Throttle traffic
                    </Button>
                    {hasFeatureFlags && (
                      <Button variant="secondary" size="sm" onClick={() => { setFeatureFlagId(featureFlags[0]?.id ?? ''); setShowFeatureFlag(true) }}>
                        Toggle feature flag
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Rollback confirmation modal */}
      <Modal
        open={confirmRollback !== null}
        onClose={() => setConfirmRollback(null)}
        title="Confirm Rollback"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmRollback(null)}>Cancel</Button>
            <Button variant="danger" size="sm" onClick={handleConfirmRollback}>Rollback →</Button>
          </>
        }
      >
        <p className="text-xs text-sim-text-muted">
          Roll back {activeService} to {confirmRollback?.version}?
        </p>
      </Modal>

      {/* Roll-forward confirmation modal */}
      <Modal
        open={confirmRollForward !== null}
        onClose={() => setConfirmRollForward(null)}
        title="Confirm Roll-forward"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmRollForward(null)}>Cancel</Button>
            <Button variant="danger" size="sm" onClick={handleConfirmRollForward}>Roll-forward →</Button>
          </>
        }
      >
        <p className="text-xs text-sim-text-muted">
          Roll forward {activeService} to {confirmRollForward?.version}?
        </p>
      </Modal>

      {/* Emergency deploy modal */}
      <Modal
        open={showEmergencyDeploy}
        onClose={() => setShowEmergencyDeploy(false)}
        title={`Emergency Deploy — ${activeService}`}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowEmergencyDeploy(false)}>Cancel</Button>
            <Button variant="danger" size="sm" onClick={handleEmergencyDeploy}>Deploy →</Button>
          </>
        }
      >
        <p className="text-xs text-sim-text-muted mb-3">
          This will trigger an emergency deployment for {activeService}. Use only if a hotfix is ready.
        </p>
        <div>
          <div className="text-xs font-medium text-sim-text-muted uppercase tracking-wide mb-1">
            Notes (optional)
          </div>
          <textarea
            placeholder="Brief description of what is being deployed..."
            value={emergencyNotes}
            onChange={e => setEmergencyNotes(e.target.value)}
            className="w-full bg-sim-surface border border-sim-border text-sim-text text-xs
                       font-mono px-3 py-1 rounded resize-none min-h-[48px] outline-none
                       focus:border-sim-accent placeholder:text-sim-text-faint"
          />
        </div>
      </Modal>

      {/* Throttle traffic modal */}
      <Modal
        open={showThrottle}
        onClose={() => setShowThrottle(false)}
        title={`Throttle Traffic — ${activeService}`}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowThrottle(false)}>Cancel</Button>
            <Button variant="secondary" size="sm" disabled={!throttleValid} onClick={handleThrottle}>
              Apply Throttle
            </Button>
          </>
        }
      >
        <div>
          <div className="text-xs font-medium text-sim-text-muted uppercase tracking-wide mb-1">
            Throttle To (% of normal traffic)
          </div>
          <input
            type="number"
            min={0}
            max={100}
            placeholder="e.g. 50"
            value={throttleValue}
            onChange={e => setThrottleValue(e.target.value)}
            className="w-full bg-sim-surface border border-sim-border text-sim-text text-xs
                       font-mono px-3 py-1 rounded outline-none focus:border-sim-accent"
          />
          <div className="text-xs text-sim-text-faint mt-1">Enter 0–100. 0 = drop all traffic. 100 = no throttle.</div>
        </div>
      </Modal>

      {/* Feature flag modal */}
      {hasFeatureFlags && (
        <Modal
          open={showFeatureFlag}
          onClose={() => setShowFeatureFlag(false)}
          title="Toggle Feature Flag"
          footer={
            <Button variant="ghost" size="sm" onClick={() => setShowFeatureFlag(false)}>Cancel</Button>
          }
        >
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-xs font-medium text-sim-text-muted uppercase tracking-wide mb-1">Flag</div>
              <select
                value={featureFlagId}
                onChange={e => setFeatureFlagId(e.target.value)}
                className="w-full bg-sim-surface border border-sim-border text-sim-text text-xs
                           font-mono px-3 py-1 rounded outline-none cursor-pointer"
              >
                {featureFlags.map(f => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={toggledFlags.get(featureFlagId) === true}
                onClick={() => handleToggleFlag(true)}
              >
                Enable
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={toggledFlags.get(featureFlagId) === false}
                onClick={() => handleToggleFlag(false)}
              >
                Disable
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function DeploymentRow({ dep }: { dep: Deployment }) {
  const statusDot =
    dep.status === 'active'      ? 'text-sim-green' :
    dep.status === 'previous'    ? 'text-sim-text-faint' :
                                   'text-sim-orange'

  return (
    <tr className={`border-b border-sim-border-muted ${dep.status === 'active' ? 'bg-sim-surface-2' : ''}`}>
      <td className="py-2 px-3">
        {dep.status === 'rolled_back' ? (
          <span className="text-sim-text-muted line-through">{dep.version}</span>
        ) : (
          <span className={dep.status === 'active' ? 'text-sim-text font-medium' : 'text-sim-text-muted'}>
            {dep.version}
          </span>
        )}
      </td>
      <td className="py-2 px-3 text-sim-text-muted">
        {dep.deployedAtSec < 0
          ? formatRelativeTime(dep.deployedAtSec)
          : <WallTimestamp simTime={dep.deployedAtSec} />
        }
      </td>
      <td className="py-2 px-3">
        <span className={statusDot}>●</span>
        {' '}
        <span className={`${statusDot} text-xs`}>{dep.status.replace('_', ' ')}</span>
      </td>
      <td className="py-2 px-3 text-sim-text-muted">{dep.author}</td>
      <td className="py-2 px-3 text-sim-text-muted truncate max-w-[160px]">{dep.commitMessage}</td>
    </tr>
  )
}
