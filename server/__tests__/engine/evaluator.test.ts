import { describe, it, expect } from 'vitest'
import { createEvaluator } from '../../src/engine/evaluator'
import { createAuditLog } from '../../src/engine/audit-log'
import { getFixtureScenario, clearFixtureCache } from '../../src/testutil/index'
import { beforeEach } from 'vitest'

beforeEach(() => clearFixtureCache())

describe('createEvaluator', () => {
  it('relevant action in audit log → appears in relevantActionsTaken', () => {
    const evaluator = createEvaluator()
    const log       = createAuditLog()
    const scenario  = getFixtureScenario()
    // Fixture relevant_actions includes trigger_rollback for fixture-service
    log.record('trigger_rollback', { service: 'fixture-service' }, 60)
    const state = evaluator.evaluate(log, scenario)
    expect(state.relevantActionsTaken.length).toBeGreaterThan(0)
    expect(state.relevantActionsTaken[0].action).toBe('trigger_rollback')
    expect(state.relevantActionsTaken[0].takenAt).toBe(60)
  })

  it('red herring in audit log → appears in redHerringsTaken', () => {
    const evaluator = createEvaluator()
    const log       = createAuditLog()
    const scenario  = getFixtureScenario()
    // Fixture red_herrings includes restart_service
    log.record('restart_service', {}, 30)
    const state = evaluator.evaluate(log, scenario)
    expect(state.redHerringsTaken.length).toBeGreaterThan(0)
    expect(state.redHerringsTaken[0].action).toBe('restart_service')
    expect(state.redHerringsTaken[0].takenAt).toBe(30)
  })

  it('mark_resolved action → resolved=true', () => {
    const evaluator = createEvaluator()
    const log       = createAuditLog()
    const scenario  = getFixtureScenario()
    log.record('mark_resolved', {}, 120)
    const state = evaluator.evaluate(log, scenario)
    expect(state.resolved).toBe(true)
  })

  it('resolved=false when mark_resolved not in log', () => {
    const evaluator = createEvaluator()
    const log       = createAuditLog()
    const scenario  = getFixtureScenario()
    log.record('view_metric', {}, 10)
    const state = evaluator.evaluate(log, scenario)
    expect(state.resolved).toBe(false)
  })

  it('action not in either list → ignored silently', () => {
    const evaluator = createEvaluator()
    const log       = createAuditLog()
    const scenario  = getFixtureScenario()
    log.record('open_tab', {}, 5)
    const state = evaluator.evaluate(log, scenario)
    expect(state.relevantActionsTaken.length).toBe(0)
    expect(state.redHerringsTaken.length).toBe(0)
    expect(state.resolved).toBe(false)
  })

  it('same relevant action taken twice → appears once (deduped)', () => {
    const evaluator = createEvaluator()
    const log       = createAuditLog()
    const scenario  = getFixtureScenario()
    log.record('trigger_rollback', { service: 'fixture-service' }, 60)
    log.record('trigger_rollback', { service: 'fixture-service' }, 90)
    const state = evaluator.evaluate(log, scenario)
    const rollbacks = state.relevantActionsTaken.filter(a => a.action === 'trigger_rollback')
    expect(rollbacks.length).toBe(1)
    expect(rollbacks[0].takenAt).toBe(60)  // first occurrence
  })

  it('same red herring taken twice → appears once (deduped)', () => {
    const evaluator = createEvaluator()
    const log       = createAuditLog()
    const scenario  = getFixtureScenario()
    log.record('restart_service', {}, 30)
    log.record('restart_service', {}, 50)
    const state = evaluator.evaluate(log, scenario)
    const restarts = state.redHerringsTaken.filter(a => a.action === 'restart_service')
    expect(restarts.length).toBe(1)
  })

  it('empty audit log → empty state', () => {
    const evaluator = createEvaluator()
    const log       = createAuditLog()
    const scenario  = getFixtureScenario()
    const state = evaluator.evaluate(log, scenario)
    expect(state.relevantActionsTaken).toEqual([])
    expect(state.redHerringsTaken).toEqual([])
    expect(state.resolved).toBe(false)
  })
})
