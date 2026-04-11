import { useEffect, useState } from "react";
import { Button } from "./Button";
import { Spinner } from "./Spinner";
import { EmptyState } from "./EmptyState";
import type { LoadedScenario, ScenarioSummary } from "../scenario/types";
import {
  loadBundledScenarios,
  loadRemoteScenario,
  isScenarioLoadError,
  toScenarioSummary,
} from "../scenario/loader";

interface ScenarioPickerProps {
  onStart: (scenario: LoadedScenario) => void;
}

export function ScenarioPicker({ onStart }: ScenarioPickerProps) {
  const [scenarios, setScenarios] = useState<Array<{
    summary: ScenarioSummary;
    loaded: LoadedScenario;
  }> | null>(null);
  const [error, setError] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      try {
        const bundled = await loadBundledScenarios();
        const items = bundled.map((s) => ({
          summary: toScenarioSummary(s),
          loaded: s,
        }));

        // Remote scenarios from VITE_SCENARIO_URLS (comma-separated) or window.__ONCALL_CONFIG__
        const remoteUrls: string[] = [];
        const envUrls = import.meta.env.VITE_SCENARIO_URLS;
        if (envUrls)
          remoteUrls.push(
            ...envUrls
              .split(",")
              .map((u: string) => u.trim())
              .filter(Boolean),
          );
        const configUrls = window.__ONCALL_CONFIG__?.scenarioUrls ?? [];
        remoteUrls.push(...configUrls);

        for (const baseUrl of remoteUrls) {
          const result = await loadRemoteScenario(baseUrl);
          if (!isScenarioLoadError(result)) {
            items.push({ summary: toScenarioSummary(result), loaded: result });
          }
        }

        if (!cancelled) setScenarios(items);
      } catch {
        if (!cancelled) setError(true);
      }
    }

    void loadAll();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleStart(scenario: LoadedScenario) {
    setStarting(scenario.id);
    onStart(scenario);
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="Failed to load scenarios"
          message="Could not load the scenario list. Please refresh."
        />
      </div>
    );
  }

  if (scenarios === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
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
          {scenarios.map(({ summary, loaded }) => (
            <div
              key={summary.id}
              className="bg-sim-surface border border-sim-border rounded p-4 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="text-sm font-semibold text-sim-text">
                    {summary.title}
                  </span>
                  <span className="text-xs text-sim-text-muted">
                    {summary.description}
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-sim-text-faint">
                      {summary.difficulty}
                    </span>
                    {summary.tags.map((tag) => (
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
                  loading={starting === summary.id}
                  onClick={() => handleStart(loaded)}
                >
                  Start
                </Button>
              </div>
            </div>
          ))}
          {scenarios.length === 0 && (
            <EmptyState
              title="No scenarios found"
              message="No bundled or remote scenarios available."
            />
          )}
        </div>
      </div>
    </div>
  );
}
