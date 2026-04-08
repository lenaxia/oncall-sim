import { describe, it, expect } from 'vitest'
import { createAuditLog } from '../../src/engine/audit-log'

describe('createAuditLog', () => {
  it('record() appends entry with correct action and simTime', () => {
    const log = createAuditLog()
    log.record('view_metric', { service: 'svc' }, 42)
    const entries = log.getAll()
    expect(entries.length).toBe(1)
    expect(entries[0].action).toBe('view_metric')
    expect(entries[0].simTime).toBe(42)
    expect(entries[0].params).toEqual({ service: 'svc' })
  })

  it('getAll() returns entries in insertion order', () => {
    const log = createAuditLog()
    log.record('open_tab',        {}, 0)
    log.record('view_metric',     {}, 10)
    log.record('trigger_rollback', {}, 60)
    const actions = log.getAll().map(e => e.action)
    expect(actions).toEqual(['open_tab', 'view_metric', 'trigger_rollback'])
  })

  it('getAll() returns a copy — mutations do not affect the log', () => {
    const log = createAuditLog()
    log.record('view_metric', {}, 0)
    const copy = log.getAll()
    copy.push({ action: 'monitor_recovery', params: {}, simTime: 999 })
    expect(log.getAll().length).toBe(1)
  })

  it('getLast() returns most recent entry', () => {
    const log = createAuditLog()
    log.record('open_tab',    {}, 0)
    log.record('view_metric', {}, 10)
    expect(log.getLast()!.action).toBe('view_metric')
    expect(log.getLast()!.simTime).toBe(10)
  })

  it('getLast() returns null on empty log', () => {
    expect(createAuditLog().getLast()).toBeNull()
  })

  it('getByAction() filters correctly', () => {
    const log = createAuditLog()
    log.record('view_metric',  { service: 'a' }, 0)
    log.record('trigger_rollback', {}, 30)
    log.record('view_metric',  { service: 'b' }, 45)
    const views = log.getByAction('view_metric')
    expect(views.length).toBe(2)
    expect(views.every(e => e.action === 'view_metric')).toBe(true)
  })

  it('getByAction() returns empty array for unknown action', () => {
    const log = createAuditLog()
    log.record('view_metric', {}, 0)
    expect(log.getByAction('monitor_recovery').length).toBe(0)
  })

  it('multiple calls to record produce correct simTimes', () => {
    const log = createAuditLog()
    log.record('open_tab',    {}, 5)
    log.record('view_metric', {}, 15)
    const entries = log.getAll()
    expect(entries[0].simTime).toBe(5)
    expect(entries[1].simTime).toBe(15)
  })
})
