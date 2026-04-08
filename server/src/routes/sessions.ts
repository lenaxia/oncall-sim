import { Router } from 'express'
import type { LoadedScenario } from '../scenario/types'
import type { LLMClient } from '../llm/llm-client'
import type { SessionStore } from '../session/session-store'
import type { SSEBroker } from '../sse/sse-broker'
import { createSession } from '../session/session'

export function sessionsRouter(
  sessionStore: SessionStore,
  sseBroker:   SSEBroker,
  scenarios:   Map<string, LoadedScenario>,
  llmClient:   LLMClient
): Router {
  const router = Router()

  // POST /api/sessions — create session, start game loop
  router.post('/', async (req, res, next) => {
    try {
      const { scenarioId } = req.body as { scenarioId?: string }
      if (!scenarioId) {
        res.status(400).json({ error: 'scenarioId is required' })
        return
      }
      const scenario = scenarios.get(scenarioId)
      if (!scenario) {
        res.status(404).json({ error: `Scenario '${scenarioId}' not found` })
        return
      }

      const session = await createSession(scenarioId, scenario, llmClient)
      sessionStore.create(session)
      session.gameLoop.start()

      res.status(201).json({ sessionId: session.id })
    } catch (err) {
      next(err)
    }
  })

  // DELETE /api/sessions/:id
  router.delete('/:id', (req, res) => {
    const session = sessionStore.get(req.params.id)
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    session.gameLoop.stop()
    sessionStore.delete(req.params.id)
    res.status(204).send()
  })

  // GET /api/sessions/:id/events — SSE stream
  router.get('/:id/events', (req, res) => {
    const cleanup = sseBroker.connect(req.params.id, res)
    req.on('close', cleanup)
  })

  // POST /api/sessions/:id/speed
  router.post('/:id/speed', (req, res) => {
    const session = sessionStore.get(req.params.id)
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    if (session.status !== 'active') {
      res.status(409).json({ error: 'Session is not active' })
      return
    }

    const { speed, paused } = req.body as { speed?: number; paused?: boolean }
    if (speed !== undefined) {
      if (![1, 2, 5, 10].includes(speed)) {
        res.status(400).json({ error: 'speed must be 1, 2, 5, or 10' })
        return
      }
      session.gameLoop.setSpeed(speed as 1 | 2 | 5 | 10)
    }
    if (paused === true)  session.gameLoop.pause()
    if (paused === false) session.gameLoop.resume()

    res.status(204).send()
  })

  // POST /api/sessions/:id/resolve
  router.post('/:id/resolve', (req, res) => {
    const session = sessionStore.get(req.params.id)
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    if (session.status !== 'active') {
      res.status(409).json({ error: 'Session is already resolved or expired' })
      return
    }

    session.gameLoop.stop()
    session.status = 'resolved'
    const evalState = session.gameLoop.getEvaluationState()
    const snap      = session.gameLoop.getSnapshot()

    // Stub debrief — Phase 9 fills in the LLM narrative
    session.debrief = {
      narrative:         '',
      evaluationState:   evalState,
      auditLog:          snap.auditLog,
      eventLog:          session.gameLoop.getEventLog(),
      resolvedAtSimTime: snap.simTime,
    }

    // Respond 202 immediately
    res.status(202).json({ status: 'resolving' })

    // Async: broadcast debrief_ready when stub completes
    // (Phase 9 replaces this with real LLM call)
    setImmediate(() => {
      sseBroker.broadcast(session.id, { type: 'debrief_ready', sessionId: session.id })
    })
  })

  // GET /api/sessions/:id/debrief
  router.get('/:id/debrief', (req, res) => {
    const session = sessionStore.get(req.params.id)
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    if (!session.debrief) {
      res.status(404).json({ error: 'Debrief not ready yet' })
      return
    }
    res.json(session.debrief)
  })

  return router
}
