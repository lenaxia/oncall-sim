import { Router } from 'express'
import type { LoadedScenario } from '../scenario/types'
import { toScenarioSummary } from '../scenario/loader'

export function scenariosRouter(
  scenarios: Map<string, LoadedScenario>
): Router {
  const router = Router()

  // GET /api/scenarios
  router.get('/', (_req, res) => {
    const summaries = [...scenarios.values()].map(toScenarioSummary)
    res.json(summaries)
  })

  // GET /api/scenarios/:id
  router.get('/:id', (req, res) => {
    const scenario = scenarios.get(req.params.id)
    if (!scenario) {
      res.status(404).json({ error: 'Scenario not found' })
      return
    }
    res.json(scenario)
  })

  return router
}
