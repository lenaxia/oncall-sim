import React, { createContext, useContext, useEffect, useState } from 'react'
import type { TabId } from './SessionContext'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PersonaConfig {
  id:           string
  displayName:  string
  jobTitle:     string
  team:         string
  systemPrompt: string
}

export interface MetricMeta {
  label:              string
  unit:               string
  criticalThreshold?: number   // alarm threshold — shown as red reference line
}

export interface ScenarioConfig {
  id:          string
  title:       string
  description: string
  serviceType: string
  difficulty:  string
  tags:        string[]
  topology: {
    focalService: string
    upstream:     string[]
    downstream:   string[]
  }
  personas:     PersonaConfig[]
  wikiPages:    Array<{ title: string; content: string }>
  featureFlags: Array<{ id: string; label: string }>
  cicd:         { pipelines: Array<{ service: string; steps: string[] }> }
  /** Metric display metadata keyed by service → metricId */
  metricsMeta:  Record<string, Record<string, MetricMeta>>
  evaluation: {
    rootCause:       string
    relevantActions: Array<{ action: string; why: string }>
    redHerrings:     Array<{ action: string; why: string }>
    debriefContext:  string
  }
  engine: {
    defaultTab:              TabId
    timelineDurationSeconds: number
    hasFeatureFlags:         boolean
  }
}

export interface ScenarioContextValue {
  scenario: ScenarioConfig | null
}

// ── Context ───────────────────────────────────────────────────────────────────

const ScenarioContext = createContext<ScenarioContextValue | null>(null)

export interface ScenarioProviderProps {
  scenarioId: string
  children:   React.ReactNode
}

export function ScenarioProvider({ scenarioId, children }: ScenarioProviderProps) {
  const [scenario, setScenario] = useState<ScenarioConfig | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/scenarios/${scenarioId}`)
      .then(r => r.json())
      .then((raw: Record<string, unknown>) => {
        if (!cancelled) setScenario(normalise(raw))
      })
      .catch(() => {
        // Fetch failure — scenario stays null; App handles via onError
      })
    return () => { cancelled = true }
  }, [scenarioId])

  return (
    <ScenarioContext.Provider value={{ scenario }}>
      {children}
    </ScenarioContext.Provider>
  )
}

// ── Normalise raw server response → ScenarioConfig ────────────────────────────
// The server returns LoadedScenario (camelCase but with nested wiki.pages,
// no featureFlags top-level, no hasFeatureFlags in engine). Map to the flat
// ScenarioConfig shape the client expects.

function normalise(raw: Record<string, unknown>): ScenarioConfig {
  const wiki         = (raw.wiki as { pages?: Array<{ title: string; content: string }> } | undefined)
  const engine       = (raw.engine as { defaultTab?: string; tickIntervalSeconds?: number } | undefined)
  const cicd         = (raw.cicd as { pipelines?: Array<{ service: string }> } | undefined)
  const featureFlags = (raw.featureFlags as Array<{ id: string; label: string }> | undefined) ?? []

  // Extract metric threshold/label metadata from opsDashboard
  type RawMetric = { archetype: string; label?: string; unit?: string; warningThreshold?: number; criticalThreshold?: number }
  type RawService = { name: string; metrics?: RawMetric[]; overrides?: RawMetric[] }
  type RawOpsDashboard = { focalService?: RawService; correlatedServices?: RawService[] }
  const ops = (raw.opsDashboard as RawOpsDashboard | undefined)
  const metricsMeta: Record<string, Record<string, MetricMeta>> = {}

  function addMetrics(svc: RawService) {
    const metrics = [...(svc.metrics ?? []), ...(svc.overrides ?? [])]
    if (metrics.length === 0) return
    metricsMeta[svc.name] = metricsMeta[svc.name] ?? {}
    for (const m of metrics) {
      metricsMeta[svc.name][m.archetype] = {
        label:             m.label ?? m.archetype,
        unit:              m.unit  ?? '',
        criticalThreshold: m.criticalThreshold,
      }
    }
  }

  if (ops?.focalService)       addMetrics(ops.focalService)
  for (const cs of ops?.correlatedServices ?? []) addMetrics(cs)

  return {
    id:          raw.id as string,
    title:       raw.title as string,
    description: raw.description as string,
    serviceType: raw.serviceType as string,
    difficulty:  raw.difficulty as string,
    tags:        (raw.tags as string[]) ?? [],
    topology:    raw.topology as ScenarioConfig['topology'],
    personas:    (raw.personas as PersonaConfig[]) ?? [],
    wikiPages:   wiki?.pages ?? [],
    featureFlags,
    metricsMeta,
    cicd: {
      pipelines: (cicd?.pipelines ?? []).map(p => ({ service: p.service, steps: [] })),
    },
    evaluation:  raw.evaluation as ScenarioConfig['evaluation'],
    engine: {
      defaultTab:              (engine?.defaultTab ?? 'email') as import('./SessionContext').TabId,
      timelineDurationSeconds: ((raw.timeline as { durationMinutes?: number } | undefined)?.durationMinutes ?? 10) * 60,
      hasFeatureFlags:         featureFlags.length > 0,
    },
  }
}

export function useScenario(): ScenarioContextValue {
  const ctx = useContext(ScenarioContext)
  if (ctx === null) {
    throw new Error('useScenario must be used inside <ScenarioProvider>')
  }
  return ctx
}
