import { useEffect, useState } from 'react'
import { Button } from './Button'
import { Spinner } from './Spinner'
import { EmptyState } from './EmptyState'
import type { ScenarioSummary } from '../testutil/index'

interface ScenarioPickerProps {
  onStart: (scenarioId: string) => void
}

export function ScenarioPicker({ onStart }: ScenarioPickerProps) {
  const [scenarios, setScenarios] = useState<ScenarioSummary[] | null>(null)
  const [error, setError]         = useState(false)
  const [starting, setStarting]   = useState<string | null>(null) // scenarioId being started

  useEffect(() => {
    fetch('/api/scenarios')
      .then(r => {
        if (!r.ok) throw new Error('fetch failed')
        return r.json()
      })
      .then((data: ScenarioSummary[]) => setScenarios(data))
      .catch(() => setError(true))
  }, [])

  async function handleStart(scenarioId: string) {
    setStarting(scenarioId)
    onStart(scenarioId)
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="Failed to load scenarios"
          message="Could not load the scenario list. Please refresh."
        />
      </div>
    )
  }

  if (scenarios === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="h-full bg-sim-bg overflow-auto p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-lg font-semibold text-sim-text mb-1">
          On-Call Training Simulator
        </h1>
        <p className="text-xs text-sim-text-muted mb-8">
          Select a scenario to begin your training session.
        </p>

        <div className="flex flex-col gap-4">
          {scenarios.map(scenario => (
            <div
              key={scenario.id}
              className="bg-sim-surface border border-sim-border rounded p-4 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="text-sm font-semibold text-sim-text">{scenario.title}</span>
                  <span className="text-xs text-sim-text-muted">{scenario.description}</span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-sim-text-faint">{scenario.difficulty}</span>
                    {scenario.tags.map(tag => (
                      <span
                        key={tag}
                        className="text-xs bg-sim-surface-2 text-sim-text-muted px-1.5 py-0.5 rounded"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  loading={starting === scenario.id}
                  onClick={() => handleStart(scenario.id)}
                >
                  Start
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
