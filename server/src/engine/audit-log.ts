import type { AuditEntry, ActionType } from '@shared/types/events'

export interface AuditLog {
  record(action: ActionType, params: Record<string, unknown>, simTime: number): void
  getAll(): AuditEntry[]
  getLast(): AuditEntry | null
  getByAction(action: ActionType): AuditEntry[]
}

export function createAuditLog(): AuditLog {
  const _entries: AuditEntry[] = []

  return {
    record(action, params, simTime) {
      _entries.push({ action, params, simTime })
    },

    getAll() {
      return [..._entries]
    },

    getLast() {
      return _entries.length > 0 ? { ..._entries[_entries.length - 1] } : null
    },

    getByAction(action) {
      return _entries.filter(e => e.action === action).map(e => ({ ...e }))
    },
  }
}
