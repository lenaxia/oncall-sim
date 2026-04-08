import type { LoadedScenario } from '../scenario/types'
import type { AuditLog } from './audit-log'

export interface EvaluationState {
  relevantActionsTaken: Array<{
    action:   string
    service?: string
    why:      string
    takenAt:  number
  }>
  redHerringsTaken: Array<{
    action:  string
    why:     string
    takenAt: number
  }>
  resolved: boolean
}

export interface Evaluator {
  evaluate(auditLog: AuditLog, scenario: LoadedScenario): EvaluationState
}

export function createEvaluator(): Evaluator {
  return {
    evaluate(auditLog, scenario): EvaluationState {
      const entries     = auditLog.getAll()
      const { evaluation } = scenario

      // Relevant actions — deduped: only first occurrence counts
      const relevantActionsTaken: EvaluationState['relevantActionsTaken'] = []
      const seenRelevant = new Set<string>()

      for (const entry of entries) {
        for (const ra of evaluation.relevantActions) {
          // Match on action type and optionally service
          const actionMatches = ra.action === entry.action
          const serviceMatches = !ra.service || ra.service === (entry.params['service'] as string | undefined)
          const key = `${ra.action}:${ra.service ?? ''}`

          if (actionMatches && serviceMatches && !seenRelevant.has(key)) {
            seenRelevant.add(key)
            relevantActionsTaken.push({
              action:  ra.action,
              service: ra.service,
              why:     ra.why,
              takenAt: entry.simTime,
            })
          }
        }
      }

      // Red herrings
      const redHerringsTaken: EvaluationState['redHerringsTaken'] = []
      const seenRed = new Set<string>()

      for (const entry of entries) {
        for (const rh of evaluation.redHerrings) {
          if (rh.action === entry.action && !seenRed.has(rh.action)) {
            seenRed.add(rh.action)
            redHerringsTaken.push({
              action:  rh.action,
              why:     rh.why,
              takenAt: entry.simTime,
            })
          }
        }
      }

      // Resolved
      const resolved = entries.some(e => e.action === 'mark_resolved')

      return { relevantActionsTaken, redHerringsTaken, resolved }
    },
  }
}
