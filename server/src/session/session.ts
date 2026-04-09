// session.ts — Session model, factory, and populateInitialState.

import { randomUUID } from 'crypto'
import type { LoadedScenario } from '../scenario/types'
import type { GameLoop } from '../engine/game-loop'
import type { EvaluationState } from '../engine/evaluator'
import type { AuditEntry, SimEventLogEntry } from '@shared/types/events'
import type { LLMClient } from '../llm/llm-client'
import { generateAllMetrics } from '../metrics/generator'
import { createSimClock } from '../engine/sim-clock'
import { createEventScheduler } from '../engine/event-scheduler'
import { createAuditLog } from '../engine/audit-log'
import { createConversationStore } from '../engine/conversation-store'
import { createEvaluator } from '../engine/evaluator'
import { createStakeholderEngine } from '../engine/stakeholder-engine'
import { createGameLoop } from '../engine/game-loop'

export type SessionStatus = 'active' | 'resolved' | 'expired'

export interface DebriefResult {
  narrative:         string
  evaluationState:   EvaluationState
  auditLog:          AuditEntry[]
  eventLog:          SimEventLogEntry[]   // simulation events for debrief timeline
  resolvedAtSimTime: number
}

export interface Session {
  id:         string
  scenarioId: string
  scenario:   LoadedScenario
  gameLoop:   GameLoop
  debrief:    DebriefResult | null
  createdAt:  number
  lastSseAt:  number
  status:     SessionStatus
}

export function createSession(
  scenarioId: string,
  scenario:   LoadedScenario,
  llmClient:  LLMClient,
  clockAnchorMs?: number   // Unix ms for simTime=0; defaults to now
): Promise<Session> {
  const sessionId = randomUUID()
  const anchor    = clockAnchorMs ?? Date.now()

  const metrics      = generateAllMetrics(scenario, sessionId)
  const clock        = createSimClock(scenario.timeline.defaultSpeed)
  const scheduler    = createEventScheduler(scenario)
  const auditLog     = createAuditLog()
  const store        = createConversationStore()
  const evaluator    = createEvaluator()

  populateInitialState(store, scenario)

  const stakeholderEngine = createStakeholderEngine(llmClient, scenario)

  const gameLoop = createGameLoop({
    scenario,
    sessionId,
    clock,
    scheduler,
    auditLog,
    store,
    evaluator,
    metrics,
    clockAnchorMs: anchor,
    onDirtyTick: (ctx) => stakeholderEngine.tick(ctx),
  })

  return Promise.resolve({
    id:         sessionId,
    scenarioId,
    scenario,
    gameLoop,
    debrief:    null,
    createdAt:  Date.now(),
    lastSseAt:  Date.now(),
    status:     'active',
  })
}

/**
 * Seeds the conversation store with scenario's pre-configured state.
 * Adds tickets, deployments, and any scripted events at t < 0.
 */
function populateInitialState(
  store:    ReturnType<typeof createConversationStore>,
  scenario: LoadedScenario
): void {
  // Pre-populate tickets that start before incident (atSecond < 0).
  // Tickets at atSecond >= 0 are fired as ticket_created events by the scheduler.
  for (const ticket of scenario.tickets) {
    if (ticket.atSecond < 0) {
      store.addTicket({
        id:          ticket.id,
        title:       ticket.title,
        severity:    ticket.severity,
        status:      ticket.status,
        description: ticket.description,
        createdBy:   ticket.createdBy,
        assignee:    ticket.assignee,
        simTime:     ticket.atSecond,
      })
    }
  }

  // Deployments are NOT pre-populated here — the scheduler fires all deployment events
  // (including historical ones at negative simTime) on the first tick.

  // Pre-populate pipelines with stage state from scenario config.
  // Each pipeline's stages represent the state at scenario start (t=0).
  // Alarm blockers have their message derived from the referenced alarm config.
  for (const pipelineConfig of scenario.cicd.pipelines) {
    const stages: import('@shared/types/events').PipelineStage[] = pipelineConfig.stages.map(s => {
      let blocker: import('@shared/types/events').StageBlocker | null = null
      if (s.blocker) {
        const alarmConfig = s.blocker.alarmId
          ? scenario.alarms.find(a => a.id === s.blocker!.alarmId)
          : null
        const message = alarmConfig
          ? `Alarm firing: ${alarmConfig.condition} on ${alarmConfig.service}`
          : `${s.blocker.type.replace('_', ' ')} blocking promotion`
        blocker = {
          type:    s.blocker.type,
          alarmId: s.blocker.alarmId,
          message,
        }
      }
      return {
        id:              s.id,
        name:            s.name,
        type:            s.type,
        currentVersion:  s.currentVersion,
        previousVersion: s.previousVersion,
        status:          s.status,
        deployedAtSec:   s.deployedAtSec,
        commitMessage:   s.commitMessage,
        author:          s.author,
        blocker,
      }
    })
    store.addPipeline({
      id:      pipelineConfig.id,
      name:    pipelineConfig.name,
      service: pipelineConfig.service,
      stages,
    })
  }

  // Pre-populate scripted emails at t < 0 (pre-incident)
  for (const email of scenario.emails) {
    if (email.atSecond < 0) {
      store.addEmail({
        id:       email.id,
        threadId: email.threadId,
        from:     email.from,
        to:       email.to,
        subject:  email.subject,
        body:     email.body,
        simTime:  email.atSecond,
      })
    }
  }

  // Ensure all declared channels exist in the store, even if empty.
  // This makes them visible in the chat sidebar from the start.
  for (const channel of scenario.chat.channels) {
    store.ensureChannel(channel.name)
  }

  // Pre-populate scripted chat messages at t < 0
  for (const msg of scenario.chat.messages) {
    if (msg.atSecond < 0) {
      store.addChatMessage(msg.channel, {
        id:      msg.id,
        channel: msg.channel,
        persona: msg.persona,
        text:    msg.text,
        simTime: msg.atSecond,
      })
    }
  }

  // Pre-populate scripted logs at t < 0
  for (const log of scenario.logs) {
    if (log.atSecond < 0) {
      store.addLogEntry({
        id:      log.id,
        simTime: log.atSecond,
        level:   log.level,
        service: log.service,
        message: log.message,
      })
    }
  }
}
