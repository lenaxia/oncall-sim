import { Router } from 'express'

export function coachRouter(): Router {
  const router = Router({ mergeParams: true })

  // POST /api/sessions/:id/coach — stub until Phase 9
  router.post('/', (_req, res) => {
    res.status(501).json({ error: 'Coach not implemented until Phase 9' })
  })

  return router
}
