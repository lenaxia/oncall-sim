import { Router, type Request, type Response } from 'express'
import type { SessionStore } from '../session/session-store'

export function emailRouter(sessionStore: SessionStore): Router {
  const router = Router({ mergeParams: true })

  // POST /api/sessions/:id/email/reply
  router.post('/reply', (req: Request<{ id: string }>, res: Response) => {
    const session = sessionStore.get(req.params.id)
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    if (session.status !== 'active') {
      res.status(409).json({ error: 'Session is not active' })
      return
    }

    const { threadId, body } = req.body as { threadId?: string; body?: string }
    if (!threadId || !body) {
      res.status(400).json({ error: 'threadId and body are required' })
      return
    }

    session.gameLoop.handleEmailReply(threadId, body)
    res.status(204).send()
  })

  return router
}
