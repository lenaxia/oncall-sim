import { http, HttpResponse } from 'msw'
import {
  buildScenarioSummary,
  buildFullScenario,
  buildDebriefPayload,
} from './index'

export const defaultHandlers = [
  http.get('/api/scenarios', () =>
    HttpResponse.json([buildScenarioSummary()])
  ),
  http.get('/api/scenarios/:id', () =>
    HttpResponse.json(buildFullScenario())
  ),
  http.post('/api/sessions', () =>
    HttpResponse.json({ sessionId: 'test-session-id' }, { status: 201 })
  ),
  http.post('/api/sessions/:id/actions', () =>
    new HttpResponse(null, { status: 204 })
  ),
  http.post('/api/sessions/:id/chat', () =>
    new HttpResponse(null, { status: 204 })
  ),
  http.post('/api/sessions/:id/email/reply', () =>
    new HttpResponse(null, { status: 204 })
  ),
  http.post('/api/sessions/:id/speed', () =>
    new HttpResponse(null, { status: 204 })
  ),
  http.post('/api/sessions/:id/resolve', () =>
    HttpResponse.json({ status: 'resolving' }, { status: 202 })
  ),
  http.get('/api/sessions/:id/debrief', () =>
    HttpResponse.json(buildDebriefPayload())
  ),
]
