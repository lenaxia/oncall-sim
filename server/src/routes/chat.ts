import { Router, type Request, type Response } from 'express'
import type { SessionStore } from '../session/session-store'

export function chatRouter(sessionStore: SessionStore): Router {
  const router = Router({ mergeParams: true })

  // POST /api/sessions/:id/chat
  router.post('/', (req: Request<{ id: string }>, res: Response) => {
    const session = sessionStore.get(req.params.id)
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    if (session.status !== 'active') {
      res.status(409).json({ error: 'Session is not active' })
      return
    }

    const { channel, text } = req.body as { channel?: string; text?: string }
    if (!channel || !text) {
      res.status(400).json({ error: 'channel and text are required' })
      return
    }

    session.gameLoop.handleChatMessage(channel, text)
    res.status(204).send()
  })

  return router
}
