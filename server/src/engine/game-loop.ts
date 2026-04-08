import { randomUUID } from 'crypto'
import type { LoadedScenario } from '../scenario/types'
import type {
  SessionSnapshot, SimEvent, TimeSeriesPoint, ActionType,
  ChatMessage, EmailMessage, CoachMessage, AuditEntry,
  PageAlert, SimEventLogEntry,
} from '@shared/types/events'
import type { SimClock } from './sim-clock'
import type { EventScheduler, ScriptedEvent } from './event-scheduler'
import type { AuditLog } from './audit-log'
import { logger } from '../logger'

const log = logger.child({ component: 'game-loop' })
import type { ConversationStore, ConversationStoreSnapshot } from './conversation-store'
import type { Evaluator, EvaluationState } from './evaluator'

// ── StakeholderContext (Phase 5 consumes this) ────────────────────────────────

export interface StakeholderContext {
  sessionId:          string
  scenario:           LoadedScenario
  simTime:            number
  auditLog:           AuditEntry[]
  conversations:      ConversationStoreSnapshot
  personaCooldowns:   Record<string, number>
  directlyAddressed:  Set<string>   // persona IDs directly messaged since last LLM tick
}

// ── GameLoop ──────────────────────────────────────────────────────────────────

// Event types recorded in the simulation event log.
// sim_time (heartbeat) and session_snapshot are excluded — too frequent/large.
const LOGGABLE_EVENT_TYPES = new Set<SimEvent['type']>([
  'email_received', 'chat_message', 'ticket_created', 'ticket_updated',
  'ticket_comment', 'log_entry', 'alarm_fired', 'alarm_silenced',
  'deployment_update', 'page_sent', 'coach_message',
])
const EVENT_LOG_MAX_SIZE = 500

export interface GameLoop {
  start(): void
  stop(): void
  pause(): void
  resume(): void
  setSpeed(speed: 1 | 2 | 5 | 10): void
  handleAction(action: ActionType, params: Record<string, unknown>): void
  handleChatMessage(channel: string, text: string): void
  handleEmailReply(threadId: string, body: string): void
  getConversationSnapshot(): ConversationStoreSnapshot
  handleCoachMessage(message: CoachMessage): void
  getSnapshot(): SessionSnapshot
  getEvaluationState(): EvaluationState
  /** Returns the simulation event log for use in the debrief. */
  getEventLog(): SimEventLogEntry[]
  onEvent(handler: (event: SimEvent) => void): () => void
}

export interface GameLoopDependencies {
  scenario:       LoadedScenario
  sessionId:      string
  clock:          SimClock
  scheduler:      EventScheduler
  auditLog:       AuditLog
  store:          ConversationStore
  evaluator:      Evaluator
  metrics:        Record<string, Record<string, TimeSeriesPoint[]>>
  clockAnchorMs:  number
  onDirtyTick?:   (context: StakeholderContext) => Promise<SimEvent[]>
  onCoachTick?:   (context: StakeholderContext) => Promise<CoachMessage | null>
}

export function createGameLoop(deps: GameLoopDependencies): GameLoop {
  const {
    scenario, sessionId, clock, scheduler, auditLog, store, evaluator, metrics,
    clockAnchorMs,
  } = deps

  const onDirtyTick = deps.onDirtyTick ?? (() => Promise.resolve([]))
  const onCoachTick = deps.onCoachTick ?? (() => Promise.resolve(null))

  const _eventHandlers: Array<(event: SimEvent) => void> = []
  let _dirty          = false
  let _inFlight       = false
  let _intervalId:    ReturnType<typeof setInterval> | null = null
  let _lastRealMs     = 0
  let _coachTickCount = 0
  const _coachMessages: CoachMessage[] = []
  const _personaCooldowns: Record<string, number> = {}
  const _eventLog: SimEventLogEntry[] = []
  const _directlyAddressed = new Set<string>()  // cleared after each LLM tick

  const COACH_TICK_INTERVAL = 3   // call onCoachTick every 3 dirty ticks

  function emit(event: SimEvent): void {
    // Record significant events in the simulation event log (for debrief)
    if (LOGGABLE_EVENT_TYPES.has(event.type)) {
      if (_eventLog.length >= EVENT_LOG_MAX_SIZE) _eventLog.shift()
      _eventLog.push({ recordedAt: clock.getSimTime(), event })
    }
    for (const h of _eventHandlers) h(event)
  }

  function buildStakeholderContext(): StakeholderContext {
    return {
      sessionId,
      scenario,
      simTime:           clock.getSimTime(),
      auditLog:          auditLog.getAll(),
      conversations:     store.snapshot(),
      personaCooldowns:  { ..._personaCooldowns },
      directlyAddressed: new Set(_directlyAddressed),
    }
  }

  function handleScriptedEvent(se: ScriptedEvent): void {
    switch (se.kind) {
      case 'email':
        store.addEmail(se.email)
        emit({ type: 'email_received', email: se.email })
        break
      case 'chat_message':
        store.addChatMessage(se.channel, se.message)
        emit({ type: 'chat_message', channel: se.channel, message: se.message })
        break
      case 'log_entry':
        store.addLogEntry(se.entry)
        emit({ type: 'log_entry', entry: se.entry })
        break
      case 'alarm_fired':
        store.addAlarm(se.alarm)
        emit({ type: 'alarm_fired', alarm: se.alarm })
        break
      case 'ticket':
        store.addTicket(se.ticket)
        emit({ type: 'ticket_created', ticket: se.ticket })
        break
      case 'deployment':
        store.addDeployment(se.service, se.deployment)
        emit({ type: 'deployment_update', service: se.service, deployment: se.deployment })
        break
    }
  }

  function applySimEventToStore(ev: SimEvent): void {
    switch (ev.type) {
      case 'chat_message':
        store.addChatMessage(ev.channel, ev.message)
        break
      case 'email_received':
        store.addEmail(ev.email)
        break
      case 'ticket_comment':
        store.addTicketComment(ev.ticketId, ev.comment)
        break
      case 'alarm_fired':
        store.addAlarm(ev.alarm)
        break
      case 'alarm_silenced':
        store.updateAlarmStatus(ev.alarmId, 'suppressed')
        break
      case 'log_entry':
        store.addLogEntry(ev.entry)
        break
      case 'deployment_update':
        store.addDeployment(ev.service, ev.deployment)
        break
      case 'ticket_created':
        store.addTicket(ev.ticket)
        break
      case 'page_sent':
        store.addPage(ev.alert)
        break
      // All other event types (sim_time, coach_message, etc.) don't affect the store
    }
  }

  function triggerDirtyTick(): void {
    if (_inFlight) return
    _inFlight = true
    _dirty    = false
    _coachTickCount++

    const ctx = buildStakeholderContext()
    _directlyAddressed.clear()  // context captured; clear so next round starts fresh

    // Stakeholder tick
    onDirtyTick(ctx).then(events => {
      for (const ev of events) {
        applySimEventToStore(ev)
        emit(ev)
      }
      // Do NOT set _dirty here — LLM output is already applied.
      // _dirty is only set by external inputs (actions, chat, ticks with scripted events).
    }).catch(err => {
      log.error({ err }, 'onDirtyTick error')
    }).finally(() => {
      _inFlight = false
      // Re-trigger only if external input arrived while we were in-flight
      if (_dirty) triggerDirtyTick()
    })

    // Coach tick (every N dirty ticks)
    if (_coachTickCount % COACH_TICK_INTERVAL === 0) {
      onCoachTick(ctx).then(msg => {
        if (msg) {
          _coachMessages.push(msg)
          emit({ type: 'coach_message', message: msg })
        }
      }).catch(err => {
        log.error({ err }, 'onCoachTick error')
      })
    }
  }

  function tick(): void {
    const now = Date.now()
    const realElapsedMs = _lastRealMs > 0 ? now - _lastRealMs : 0
    _lastRealMs = now

    // Step 1: advance clock
    clock.tick(realElapsedMs)

    // Step 2: fire due scripted events
    const due = scheduler.tick(clock.getSimTime())
    for (const se of due) {
      handleScriptedEvent(se)
      _dirty = true
    }

    // Step 3: broadcast sim_time
    emit(clock.toSimTimeEvent())

    // Step 4: dirty tick
    if (_dirty) triggerDirtyTick()
  }

  return {
    start() {
      _lastRealMs = Date.now()
      // Fire t=0 scripted events immediately on start (don't wait for first tick interval)
      tick()
      const intervalMs = scenario.engine.tickIntervalSeconds * 1000
      _intervalId = setInterval(tick, intervalMs)
    },

    stop() {
      if (_intervalId) {
        clearInterval(_intervalId)
        _intervalId = null
      }
    },

    pause()              { clock.pause() },
    resume()             { clock.resume() },
    setSpeed(speed)      { clock.setSpeed(speed) },

    handleAction(action, params) {
      auditLog.record(action, params, clock.getSimTime())
      evaluator.evaluate(auditLog, scenario)

      // Update conversation store for state-affecting actions
      switch (action) {
        case 'update_ticket': {
          const ticketId = params['ticketId'] as string | undefined
          const changes  = params['changes']  as Partial<import('@shared/types/events').Ticket> | undefined
          if (ticketId && changes) {
            store.updateTicket(ticketId, changes)
            emit({ type: 'ticket_updated', ticketId, changes })
          }
          break
        }
        case 'add_ticket_comment': {
          const ticketId = params['ticketId'] as string | undefined
          // Client sends { ticketId, body } — server constructs the TicketComment
          const body     = params['body'] as string | undefined
          if (ticketId && body) {
            const comment: import('@shared/types/events').TicketComment = {
              id:       randomUUID(),
              ticketId,
              author:   'trainee',
              body,
              simTime:  clock.getSimTime(),
            }
            store.addTicketComment(ticketId, comment)
            emit({ type: 'ticket_comment', ticketId, comment })
          }
          break
        }
        case 'suppress_alarm': {
          const alarmId = params['alarmId'] as string | undefined
          if (alarmId) {
            store.updateAlarmStatus(alarmId, 'suppressed')
            emit({ type: 'alarm_silenced', alarmId })
          }
          break
        }
        case 'ack_page': {
          const alarmId = params['alarmId'] as string | undefined
          if (alarmId) {
            store.updateAlarmStatus(alarmId, 'acknowledged')
          }
          break
        }
        case 'page_user': {
          // The trainee pages a persona. This sends a real page (not a chat message).
          // The PageAlert is stored so it appears in the Ops dashboard page history.
          // The paged persona is marked as engaged (for silentUntilContacted personas).
          // A dirty tick is triggered so the persona's LLM can respond to being paged.
          const personaId = params['personaId'] as string | undefined
          const message   = params['message']   as string | undefined
          if (personaId && message) {
            const alert: PageAlert = {
              id:        randomUUID(),
              personaId,
              message,
              simTime:   clock.getSimTime(),
            }
            store.addPage(alert)
            emit({ type: 'page_sent', alert })
            // Mark persona as engaged regardless of silentUntilContacted
            _personaCooldowns[personaId] = clock.getSimTime()
          }
          break
        }
      }

      // Emit a sim_time event so the client clock stays in sync after any action
      emit({ type: 'sim_time', simTime: clock.getSimTime(), speed: clock.getSpeed(), paused: clock.isPaused() })

      _dirty = true
      triggerDirtyTick()
    },

    handleChatMessage(channel, text) {
      const msg: ChatMessage = {
        id:      randomUUID(),
        channel,
        persona: 'trainee',
        text,
        simTime: clock.getSimTime(),
      }
      auditLog.record('post_chat_message', { channel, text }, clock.getSimTime())
      store.addChatMessage(channel, msg)
      emit({ type: 'chat_message', channel, message: msg })

      // If DM to a persona, mark them as engaged and directly addressed
      if (channel.startsWith('dm:')) {
        const personaId = channel.slice(3)
        _personaCooldowns[personaId] = clock.getSimTime()
        _directlyAddressed.add(personaId)
      }

      // @mention detection: find any persona whose displayName appears after @
      // Also engages silent_until_contacted personas — being @mentioned counts as contact.
      const lowerText = text.toLowerCase()
      for (const persona of scenario.personas) {
        if (lowerText.includes('@' + persona.displayName.toLowerCase()) ||
            lowerText.includes('@' + persona.id.toLowerCase())) {
          _directlyAddressed.add(persona.id)
          // Engage silent_until_contacted personas so they stay eligible on future ticks
          if (_personaCooldowns[persona.id] == null) {
            _personaCooldowns[persona.id] = clock.getSimTime()
          }
        }
      }

      _dirty = true
      triggerDirtyTick()
    },

    handleEmailReply(threadId, body) {
      const thread = store.getEmailThread(threadId)
      const original = thread[0]
      const email: EmailMessage = {
        id:       randomUUID(),
        threadId,
        from:     'trainee',
        to:       original?.from ?? 'unknown',
        subject:  `Re: ${original?.subject ?? ''}`,
        body,
        simTime:  clock.getSimTime(),
      }
      auditLog.record('reply_email', { threadId }, clock.getSimTime())
      store.addEmail(email)
      emit({ type: 'email_received', email })

      _dirty = true
      triggerDirtyTick()
    },

    getConversationSnapshot() {
      return store.snapshot()
    },

    handleCoachMessage(message) {
      _coachMessages.push(message)
      emit({ type: 'coach_message', message })
    },

    getSnapshot(): SessionSnapshot {
      const storeSnap = store.snapshot()
      return {
        sessionId,
        scenarioId:     scenario.id,
        simTime:        clock.getSimTime(),
        speed:          clock.getSpeed(),
        paused:         clock.isPaused(),
        clockAnchorMs,
        emails:         storeSnap.emails,
        chatChannels:   storeSnap.chatChannels,
        tickets:        storeSnap.tickets,
        ticketComments: storeSnap.ticketComments,
        logs:           storeSnap.logs,
        metrics,
        alarms:         storeSnap.alarms,
        deployments:    storeSnap.deployments,
        pages:          storeSnap.pages,
        auditLog:       auditLog.getAll(),
        coachMessages:  [..._coachMessages],
      }
    },

    getEvaluationState() {
      return evaluator.evaluate(auditLog, scenario)
    },

    getEventLog() {
      return [..._eventLog]
    },

    onEvent(handler) {
      _eventHandlers.push(handler)
      return () => {
        const idx = _eventHandlers.indexOf(handler)
        if (idx !== -1) _eventHandlers.splice(idx, 1)
      }
    },
  }
}
