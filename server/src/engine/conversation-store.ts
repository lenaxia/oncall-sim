import type {
  ChatMessage, EmailMessage, Ticket, TicketComment, LogEntry,
  Alarm, AlarmStatus, Deployment, PageAlert, Pipeline, PipelineStage,
} from '@shared/types/events'

export interface ConversationStoreSnapshot {
  emails:         EmailMessage[]
  chatChannels:   Record<string, ChatMessage[]>
  tickets:        Ticket[]
  ticketComments: Record<string, TicketComment[]>
  logs:           LogEntry[]
  alarms:         Alarm[]
  deployments:    Record<string, Deployment[]>
  pipelines:      Pipeline[]
  pages:          PageAlert[]
}

export interface ConversationStore {
  addChatMessage(channel: string, message: ChatMessage): void
  ensureChannel(channel: string): void            // creates empty channel if not exists
  getChatChannel(channel: string): ChatMessage[]
  getAllChatChannels(): Record<string, ChatMessage[]>

  addEmail(email: EmailMessage): void
  getEmailThread(threadId: string): EmailMessage[]
  getAllEmails(): EmailMessage[]

  addTicket(ticket: Ticket): void
  updateTicket(ticketId: string, changes: Partial<Ticket>): void
  addTicketComment(ticketId: string, comment: TicketComment): void
  getTicket(ticketId: string): Ticket | null
  getAllTickets(): Ticket[]
  getTicketComments(ticketId: string): TicketComment[]

  addLogEntry(entry: LogEntry): void
  getAllLogs(): LogEntry[]

  addAlarm(alarm: Alarm): void
  updateAlarmStatus(alarmId: string, status: AlarmStatus): void
  getAllAlarms(): Alarm[]

  addDeployment(service: string, deployment: Deployment): void
  getDeployments(service: string): Deployment[]
  getAllDeployments(): Record<string, Deployment[]>

  addPipeline(pipeline: Pipeline): void
  updateStage(pipelineId: string, stageId: string, changes: Partial<PipelineStage>): void
  getPipeline(pipelineId: string): Pipeline | null
  getAllPipelines(): Pipeline[]

  addPage(page: PageAlert): void
  getAllPages(): PageAlert[]

  snapshot(): ConversationStoreSnapshot
}

export function createConversationStore(): ConversationStore {
  const _chat:           Record<string, ChatMessage[]>     = {}
  const _emails:         EmailMessage[]                    = []
  const _tickets:        Map<string, Ticket>               = new Map()
  const _comments:       Map<string, TicketComment[]>      = new Map()
  const _logs:           LogEntry[]                        = []
  const _alarms:         Map<string, Alarm>                = new Map()
  const _deployments:    Record<string, Deployment[]>      = {}
  const _pipelines:      Map<string, Pipeline>              = new Map()
  const _pages:          PageAlert[]                        = []

  function deepClone<T>(val: T): T {
    return JSON.parse(JSON.stringify(val)) as T
  }

  return {
    // ── Chat ────────────────────────────────────────────────────────────────
    addChatMessage(channel, message) {
      if (!_chat[channel]) _chat[channel] = []
      _chat[channel].push(message)
    },
    ensureChannel(channel) {
      if (!_chat[channel]) _chat[channel] = []
    },
    getChatChannel(channel) {
      return deepClone(_chat[channel] ?? [])
    },
    getAllChatChannels() {
      return deepClone(_chat)
    },

    // ── Email ────────────────────────────────────────────────────────────────
    addEmail(email) {
      _emails.push(email)
    },
    getEmailThread(threadId) {
      return deepClone(_emails.filter(e => e.threadId === threadId))
    },
    getAllEmails() {
      return deepClone(_emails)
    },

    // ── Tickets ──────────────────────────────────────────────────────────────
    addTicket(ticket) {
      _tickets.set(ticket.id, ticket)
    },
    updateTicket(ticketId, changes) {
      const existing = _tickets.get(ticketId)
      if (existing) _tickets.set(ticketId, { ...existing, ...changes })
    },
    addTicketComment(ticketId, comment) {
      const existing = _comments.get(ticketId) ?? []
      _comments.set(ticketId, [...existing, comment])
    },
    getTicket(ticketId) {
      const t = _tickets.get(ticketId)
      return t ? deepClone(t) : null
    },
    getAllTickets() {
      return deepClone([..._tickets.values()])
    },
    getTicketComments(ticketId) {
      return deepClone(_comments.get(ticketId) ?? [])
    },

    // ── Logs ─────────────────────────────────────────────────────────────────
    addLogEntry(entry) {
      _logs.push(entry)
    },
    getAllLogs() {
      return deepClone(_logs)
    },

    // ── Alarms ───────────────────────────────────────────────────────────────
    addAlarm(alarm) {
      _alarms.set(alarm.id, alarm)
    },
    updateAlarmStatus(alarmId, status) {
      const existing = _alarms.get(alarmId)
      if (existing) _alarms.set(alarmId, { ...existing, status })
    },
    getAllAlarms() {
      return deepClone([..._alarms.values()])
    },

    // ── Deployments ──────────────────────────────────────────────────────────
    addDeployment(service, deployment) {
      if (!_deployments[service]) _deployments[service] = []
      _deployments[service].push(deployment)
    },
    getDeployments(service) {
      return deepClone(_deployments[service] ?? [])
    },
    getAllDeployments() {
      return deepClone(_deployments)
    },

    // ── Pipelines ─────────────────────────────────────────────────────────────
    addPipeline(pipeline) {
      _pipelines.set(pipeline.id, deepClone(pipeline))
    },
    updateStage(pipelineId, stageId, changes) {
      const pipeline = _pipelines.get(pipelineId)
      if (!pipeline) return
      const updated: Pipeline = {
        ...pipeline,
        stages: pipeline.stages.map(s =>
          s.id === stageId ? { ...s, ...changes } : s
        ),
      }
      _pipelines.set(pipelineId, updated)
    },
    getPipeline(pipelineId) {
      const p = _pipelines.get(pipelineId)
      return p ? deepClone(p) : null
    },
    getAllPipelines() {
      return deepClone([..._pipelines.values()])
    },

    // ── Pages ─────────────────────────────────────────────────────────────────
    addPage(page) {
      _pages.push(page)
    },
    getAllPages() {
      return deepClone(_pages)
    },

    // ── Snapshot ─────────────────────────────────────────────────────────────
    snapshot(): ConversationStoreSnapshot {
      const ticketComments: Record<string, TicketComment[]> = {}
      for (const [id, comments] of _comments.entries()) {
        ticketComments[id] = deepClone(comments)
      }
      return {
        emails:         deepClone(_emails),
        chatChannels:   deepClone(_chat),
        tickets:        deepClone([..._tickets.values()]),
        ticketComments,
        logs:           deepClone(_logs),
        alarms:         deepClone([..._alarms.values()]),
        deployments:    deepClone(_deployments),
        pipelines:      deepClone([..._pipelines.values()]),
        pages:          deepClone(_pages),
      }
    },
  }
}
