import { Router, type Request, type Response } from 'express'
import type { SessionStore } from '../session/session-store'
import type { ActionType } from '@shared/types/events'

const VALID_ACTIONS = new Set<ActionType>([
  'ack_page', 'escalate_page', 'update_ticket', 'add_ticket_comment', 'mark_resolved',
  'post_chat_message', 'reply_email', 'direct_message_persona',
  'open_tab', 'search_logs', 'view_metric', 'read_wiki_page', 'view_deployment_history',
  'trigger_rollback', 'trigger_roll_forward', 'restart_service', 'scale_cluster',
  'throttle_traffic', 'suppress_alarm', 'emergency_deploy', 'toggle_feature_flag',
  'monitor_recovery',
])

export function actionsRouter(sessionStore: SessionStore): Router {
  const router = Router({ mergeParams: true })

  // POST /api/sessions/:id/actions
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

    const { action, params } = req.body as {
      action?: string
      params?: Record<string, unknown>
    }

    if (!action) {
      res.status(400).json({ error: 'action is required' })
      return
    }
    if (!VALID_ACTIONS.has(action as ActionType)) {
      res.status(400).json({ error: `Unknown action type: '${action}'` })
      return
    }

    session.gameLoop.handleAction(action as ActionType, params ?? {})
    res.status(204).send()
  })

  return router
}
