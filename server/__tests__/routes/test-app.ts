// test-app.ts — creates a real Express app instance for integration tests.

import path from 'path'
import { createApp } from '../../src/index'
import { loadAllScenarios } from '../../src/scenario/loader'
import { createLLMClient } from '../../src/llm/llm-client'
import { createSessionStore } from '../../src/session/session-store'
import { createSSEBroker } from '../../src/sse/sse-broker'

const FIXTURE_SCENARIOS_DIR = path.resolve('/home/mikekao/personal/oncall/scenarios')

let _app: Awaited<ReturnType<typeof createApp>> | null = null
let _sessionStore: ReturnType<typeof createSessionStore> | null = null
let _sseBroker: ReturnType<typeof createSSEBroker> | null = null

export async function getTestApp() {
  if (_app) return { app: _app, sessionStore: _sessionStore!, sseBroker: _sseBroker! }

  const scenarios    = await loadAllScenarios(FIXTURE_SCENARIOS_DIR)
  const llmClient    = createLLMClient()
  const sessionStore = createSessionStore(600_000)
  const sseBroker    = createSSEBroker(sessionStore)

  _sessionStore = sessionStore
  _sseBroker    = sseBroker
  _app          = createApp(scenarios, sessionStore, sseBroker, llmClient)

  return { app: _app, sessionStore, sseBroker }
}

export function resetTestApp() {
  // Clear all sessions between tests
  if (_sessionStore) {
    for (const session of _sessionStore.getAll()) {
      session.gameLoop.stop()
    }
    for (const session of _sessionStore.getAll()) {
      _sessionStore.delete(session.id)
    }
  }
}
