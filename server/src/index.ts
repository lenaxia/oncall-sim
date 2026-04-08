// index.ts — Express app entry point.

import express, { type Request, type Response, type NextFunction } from 'express'
import path from 'path'
import { loadConfig } from './config'
import { loadAllScenarios } from './scenario/loader'
import { createLLMClient } from './llm/llm-client'
import { createSessionStore } from './session/session-store'
import { createSSEBroker } from './sse/sse-broker'
import { scenariosRouter } from './routes/scenarios'
import { sessionsRouter } from './routes/sessions'
import { actionsRouter } from './routes/actions'
import { chatRouter } from './routes/chat'
import { emailRouter } from './routes/email'
import { coachRouter } from './routes/coach'

export function createApp(
  scenarios:    ReturnType<typeof loadAllScenarios> extends Promise<infer T> ? T : never,
  sessionStore: ReturnType<typeof createSessionStore>,
  sseBroker:    ReturnType<typeof createSSEBroker>,
  llmClient:    ReturnType<typeof createLLMClient>
): express.Application {
  const app = express()
  app.use(express.json())

  app.use('/api/scenarios', scenariosRouter(scenarios))
  app.use('/api/sessions',  sessionsRouter(sessionStore, sseBroker, scenarios, llmClient))
  app.use('/api/sessions/:id/actions', actionsRouter(sessionStore))
  app.use('/api/sessions/:id/chat',    chatRouter(sessionStore))
  app.use('/api/sessions/:id/email',   emailRouter(sessionStore))
  app.use('/api/sessions/:id/coach',   coachRouter())

  // Global error handler
  // Preserves status codes set by middleware (e.g. body-parser returns 400 for malformed JSON).
  app.use((err: Error & { status?: number; statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status ?? err.statusCode ?? 500
    if (status >= 500) console.error('[server] Unhandled route error', err)
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' })
  })

  return app
}

async function main(): Promise<void> {
  let config
  try {
    config = loadConfig()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[startup] Configuration error: ${msg}`)
    process.exit(1)
  }

  const scenariosDir = path.resolve(config.scenariosDir)
  const scenarios    = await loadAllScenarios(scenariosDir)
  console.info(`[startup] Loaded ${scenarios.size} scenario(s)`)

  const llmClient    = createLLMClient()
  const sessionStore = createSessionStore(config.sessionExpiryMs)
  const sseBroker    = createSSEBroker(sessionStore)

  setInterval(() => sessionStore.evictExpired(), 60_000)

  const app = createApp(scenarios, sessionStore, sseBroker, llmClient)

  app.listen(config.port, () => {
    console.info(`[startup] Server started on port ${config.port}`)
  })
}

// Only run main() when executed directly (not imported by tests)
// Use process.argv[1] check — works in both ESM and CJS contexts
const scriptPath = process.argv[1]
const isMain = scriptPath ? scriptPath.endsWith('index.ts') || scriptPath.endsWith('index.js') : false
if (isMain) {
  main().catch(err => {
    console.error('[startup] Fatal error', err)
    process.exit(1)
  })
}
