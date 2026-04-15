import React, { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { Spinner } from "./Spinner";
import { EmptyState } from "./EmptyState";
import type { LoadedScenario, ScenarioSummary } from "../scenario/types";
import {
  loadBundledScenarios,
  loadRemoteScenario,
  loadScenarioFromText,
  isScenarioLoadError,
  toScenarioSummary,
} from "../scenario/loader";
import type { ValidationError } from "../scenario/validator";

interface ScenarioPickerProps {
  onStart: (scenario: LoadedScenario) => void;
  onCreateScenario?: () => void;
}

interface ScenarioItem {
  summary: ScenarioSummary;
  loaded: LoadedScenario;
  custom?: boolean;
}

/**
 * Returns true if the URL is safe to fetch a remote scenario from.
 * Accepts only http: and https: schemes; rejects javascript:, data:, blob:, etc.
 * In production builds (non-localhost origin) also rejects private/loopback targets
 * to prevent SSRF from the browser against internal network resources.
 */
function isSafeScenarioUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  // Only allow http and https
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  // When the app itself is served over HTTPS (production), block private/loopback
  // targets — there is no legitimate reason for a public demo to fetch from them.
  if (window.location.protocol === "https:") {
    const h = url.hostname;
    if (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "[::1]" ||
      h.startsWith("192.168.") ||
      h.startsWith("10.") ||
      h.startsWith("172.16.") ||
      h.startsWith("172.17.") ||
      h.startsWith("172.18.") ||
      h.startsWith("172.19.") ||
      h.startsWith("172.2") ||
      h.startsWith("172.30.") ||
      h.startsWith("172.31.") ||
      h === "0.0.0.0"
    ) {
      return false;
    }
  }

  return true;
}

// noOpResolver: uploaded YAMLs must be self-contained (no body_file / content_file refs).
const noOpResolver = (_: string): Promise<string> =>
  Promise.reject(
    new Error(
      "File references (body_file, content_file, etc.) are not supported in uploaded scenarios. " +
        "Inline all content directly in the YAML.",
    ),
  );

export function ScenarioPicker({
  onStart,
  onCreateScenario,
}: ScenarioPickerProps) {
  const [scenarios, setScenarios] = useState<ScenarioItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);

  // Upload state
  const [uploadErrors, setUploadErrors] = useState<ValidationError[] | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      try {
        const bundled = await loadBundledScenarios();
        const items: ScenarioItem[] = bundled.map((s) => ({
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
          if (!isSafeScenarioUrl(baseUrl)) {
            console.warn(
              `[ScenarioPicker] Skipping unsafe remote scenario URL: ${baseUrl}`,
            );
            continue;
          }
          const result = await loadRemoteScenario(baseUrl);
          if (!isScenarioLoadError(result)) {
            items.push({ summary: toScenarioSummary(result), loaded: result });
          }
        }

        if (!cancelled) setScenarios(items);
      } catch {
        if (!cancelled) setLoadError(true);
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

  function handleUploadClick() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset so the same file can be re-selected after fixing errors
    e.target.value = "";

    const text = await file.text();
    const result = await loadScenarioFromText(text, noOpResolver);

    if (isScenarioLoadError(result)) {
      setUploadErrors(result.errors);
    } else {
      setUploadErrors(null);
      const item: ScenarioItem = {
        summary: toScenarioSummary(result),
        loaded: result,
        custom: true,
      };
      setScenarios((prev) => (prev ? [item, ...prev] : [item]));
    }
  }

  if (loadError) {
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
        <p className="text-xs text-sim-text-muted mb-4">
          Select a scenario to begin your training session.
        </p>

        {/* Action buttons */}
        <div className="flex gap-2 mb-4">
          {onCreateScenario && (
            <Button variant="secondary" size="sm" onClick={onCreateScenario}>
              Build scenario
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={handleUploadClick}>
            Load scenario
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </div>

        {/* Upload error block */}
        {uploadErrors && uploadErrors.length > 0 && (
          <div
            data-testid="upload-error-block"
            className="mb-4 border border-sim-red/40 bg-sim-red/10 rounded p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold text-sim-red">
                  Could not load scenario — {uploadErrors.length} error
                  {uploadErrors.length !== 1 ? "s" : ""}:
                </p>
                <ul className="flex flex-col gap-0.5 mt-1">
                  {uploadErrors.map((e, i) => (
                    <li key={i} className="text-xs text-sim-red/80">
                      <span className="font-medium">{e.field}:</span>{" "}
                      {e.message}
                    </li>
                  ))}
                </ul>
              </div>
              <button
                aria-label="Dismiss"
                onClick={() => setUploadErrors(null)}
                className="text-sim-red hover:text-sim-red/70 flex-shrink-0 text-sm font-bold"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* Scenario list */}
        <div className="flex flex-col gap-4">
          {scenarios.map(({ summary, loaded, custom }) => (
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
                    {custom && (
                      <span className="text-xs bg-sim-accent/20 text-sim-accent px-1.5 py-0.5 rounded">
                        Custom
                      </span>
                    )}
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
