import React, { createContext, useContext, useState } from "react";
import type { TabId } from "./SessionContext";
import type { LoadedScenario } from "../scenario/types";
import { getArchetypeDefaults } from "../metrics/archetypes";

// ── Re-exported types used by child components ─────────────────────────────────

export type {
  RemediationActionConfig as RemediationAction,
  FeatureFlagConfig as FeatureFlag,
  HostGroupConfig as HostGroup,
  PersonaConfig,
} from "../scenario/types";

// ── Metric meta (display metadata for the Ops dashboard) ──────────────────────

export interface MetricMeta {
  label: string;
  unit: string;
  criticalThreshold?: number;
  thresholdDirection: "high" | "low";
}

// ── ScenarioConfig (the shape child components read via useScenario()) ─────────
// This is derived from LoadedScenario and shaped to match what the UI tabs expect.
// Field names intentionally match the old ScenarioConfig shape consumed by tabs,
// so no changes are needed in tab components.

export interface ScenarioConfig {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  tags: string[];
  topology: {
    focalService: {
      name: string;
      components: import("../scenario/types").ServiceComponent[];
    };
    upstream: string[];
    downstream: string[];
  };
  personas: import("../scenario/types").PersonaConfig[];
  wikiPages: Array<{ title: string; content: string }>;
  featureFlags: import("../scenario/types").FeatureFlagConfig[];
  hostGroups: import("../scenario/types").HostGroupConfig[];
  remediationActions: import("../scenario/types").RemediationActionConfig[];
  cicd: { pipelines: Array<{ service: string; steps: string[] }> };
  metricsMeta: Record<string, Record<string, MetricMeta>>;
  evaluation: {
    rootCause: string;
    relevantActions: Array<{ action: string; why: string }>;
    redHerrings: Array<{ action: string; why: string }>;
    debriefContext: string;
  };
  engine: {
    defaultTab: TabId;
    timelineDurationSeconds: number;
    hasFeatureFlags: boolean;
    hasHostGroups: boolean;
  };
}

export interface ScenarioContextValue {
  scenario: ScenarioConfig | null;
  hostGroupCounts: Record<string, number>;
  adjustHostGroup: (groupId: string, delta: number) => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

const ScenarioContext = createContext<ScenarioContextValue | null>(null);

// ── Provider (new API: accepts LoadedScenario directly) ───────────────────────

export interface ScenarioProviderProps {
  scenario: LoadedScenario;
  children: React.ReactNode;
}

export function ScenarioProvider({
  scenario: loadedScenario,
  children,
}: ScenarioProviderProps) {
  const scenario = toScenarioConfig(loadedScenario);
  const [hostGroupCounts, setHostGroupCounts] = useState<
    Record<string, number>
  >(
    Object.fromEntries(
      loadedScenario.hostGroups.map((g) => [g.id, g.instanceCount]),
    ),
  );

  function adjustHostGroup(groupId: string, delta: number) {
    setHostGroupCounts((prev) => ({
      ...prev,
      [groupId]: Math.max(0, (prev[groupId] ?? 0) + delta),
    }));
  }

  return (
    <ScenarioContext.Provider
      value={{ scenario, hostGroupCounts, adjustHostGroup }}
    >
      {children}
    </ScenarioContext.Provider>
  );
}

// ── Transform LoadedScenario → ScenarioConfig ─────────────────────────────────

function toScenarioConfig(s: LoadedScenario): ScenarioConfig {
  // Build metricsMeta from opsDashboard
  const metricsMeta: Record<string, Record<string, MetricMeta>> = {};

  function addMetrics(
    serviceName: string,
    metrics: import("../scenario/types").MetricConfig[],
  ) {
    if (metrics.length === 0) return;
    metricsMeta[serviceName] = metricsMeta[serviceName] ?? {};
    for (const m of metrics) {
      metricsMeta[serviceName][m.archetype] = {
        label: m.label ?? m.archetype,
        unit: m.unit ?? "",
        criticalThreshold: m.criticalThreshold,
        thresholdDirection: (() => {
          try {
            return getArchetypeDefaults(m.archetype).thresholdDirection;
          } catch {
            return "high" as const;
          }
        })(),
      };
    }
  }

  addMetrics(
    s.opsDashboard.focalService.name,
    s.opsDashboard.focalService.metrics,
  );
  for (const cs of s.opsDashboard.correlatedServices) {
    addMetrics(cs.name, cs.overrides ?? []);
  }

  return {
    id: s.id,
    title: s.title,
    description: s.description,
    difficulty: s.difficulty,
    tags: s.tags,
    topology: {
      focalService: {
        name: s.topology.focalService.name,
        components: s.topology.focalService.components,
      },
      upstream: s.topology.upstream.map((n) => n.name),
      downstream: s.topology.downstream.map((n) => n.name),
    },
    personas: s.personas,
    wikiPages: s.wiki.pages,
    featureFlags: s.featureFlags,
    hostGroups: s.hostGroups,
    remediationActions: s.remediationActions,
    metricsMeta,
    cicd: {
      pipelines: s.cicd.pipelines.map((p) => ({
        service: p.service,
        steps: [],
      })),
    },
    evaluation: {
      rootCause: s.evaluation.rootCause,
      relevantActions: s.evaluation.relevantActions,
      redHerrings: s.evaluation.redHerrings,
      debriefContext: s.evaluation.debriefContext,
    },
    engine: {
      defaultTab: s.engine.defaultTab as TabId,
      timelineDurationSeconds: s.timeline.durationMinutes * 60,
      hasFeatureFlags: s.featureFlags.length > 0,
      hasHostGroups: s.hostGroups.length > 0,
    },
  };
}

export function useScenario(): ScenarioContextValue {
  const ctx = useContext(ScenarioContext);
  if (ctx === null) {
    throw new Error("useScenario must be used inside <ScenarioProvider>");
  }
  return ctx;
}
