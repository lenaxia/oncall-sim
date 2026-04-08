// session.ts — Session model, factory, and populateInitialState.

import { randomUUID } from 'crypto'
import type { LoadedScenario } from '../scenario/types'
import type { GameLoop } from '../engine/game-loop'
import type { EvaluationState } from '../engine/evaluator'
import type { AuditEntry } from '@shared/types/events'
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
  llmClient:  LLMClient
): Promise<Session> {
  const sessionId = randomUUID()

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
  // Pre-populate tickets
  for (const ticket of scenario.tickets) {
    store.addTicket({
      id:          ticket.id,
      title:       ticket.title,
      severity:    ticket.severity,
      status:      ticket.status,
      description: ticket.description,
      createdBy:   ticket.createdBy,
      simTime:     ticket.atSecond,
    })
  }

  // Pre-populate deployments (history)
  for (const dep of scenario.cicd.deployments) {
    store.addDeployment(dep.service, {
      version:       dep.version,
      deployedAtSec: dep.deployedAtSec,
      status:        dep.status,
      commitMessage: dep.commitMessage,
      author:        dep.author,
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
