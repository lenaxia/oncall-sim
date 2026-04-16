// ScenarioCanvas.tsx — read-only live canvas showing the current scenario draft
// as a card grid. Updated on every update_scenario tool call from the builder LLM.

import React, { useEffect, useRef, useState } from "react";
import type { RawScenarioConfig } from "../scenario/schema";
import type { ScenarioValidationError } from "../scenario/lint";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScenarioCanvasProps {
  draft: Partial<RawScenarioConfig> | null;
  assumptions: string[];
  validationErrors: ScenarioValidationError[];
  thinking: boolean;
}

// ── Highlight pulse hook ──────────────────────────────────────────────────────
// Returns true for 500ms after `value` changes, to drive a brief highlight pulse.

function useChangePulse(value: unknown): boolean {
  const [pulsing, setPulsing] = useState(false);
  const prevRef = useRef<unknown>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (prevRef.current !== undefined && prevRef.current !== value) {
      setPulsing(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setPulsing(false), 500);
    }
    prevRef.current = value;
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value]);

  return pulsing;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface CardProps {
  title: string;
  children: React.ReactNode;
  pulsing?: boolean;
}

function Card({ title, children, pulsing = false }: CardProps) {
  return (
    <div
      className={`bg-sim-surface border rounded p-4 flex flex-col gap-2 transition-colors duration-500 ${
        pulsing ? "border-sim-accent" : "border-sim-border"
      }`}
    >
      <h3 className="text-xs font-semibold text-sim-text-muted uppercase tracking-wide">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Placeholder({ text = "Not yet defined" }: { text?: string }) {
  return <span className="text-xs text-sim-text-faint italic">{text}</span>;
}

function DifficultyBadge({ difficulty }: { difficulty: string }) {
  const colours: Record<string, string> = {
    easy: "bg-green-900/30 text-green-400",
    medium: "bg-yellow-900/30 text-yellow-400",
    hard: "bg-red-900/30 text-red-400",
  };
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded font-medium ${colours[difficulty] ?? "bg-sim-surface-2 text-sim-text-muted"}`}
    >
      {difficulty}
    </span>
  );
}

// ── Thinking dots ─────────────────────────────────────────────────────────────

export function ThinkingDots() {
  return (
    <span
      data-testid="thinking-dots"
      className="inline-flex items-center gap-1"
      aria-label="Thinking"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-sim-text-muted animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}

// ── Cards ─────────────────────────────────────────────────────────────────────

function OverviewCard({ draft }: { draft: Partial<RawScenarioConfig> }) {
  const key = JSON.stringify({
    t: draft.title,
    d: draft.difficulty,
    tags: draft.tags,
    dur: draft.timeline?.duration_minutes,
  });
  const pulsing = useChangePulse(key);

  return (
    <Card title="Overview" pulsing={pulsing}>
      {draft.title ? (
        <span className="text-sm font-semibold text-sim-text">
          {draft.title}
        </span>
      ) : (
        <Placeholder />
      )}
      {draft.description && (
        <span className="text-xs text-sim-text-muted">{draft.description}</span>
      )}
      <div className="flex flex-wrap items-center gap-2 mt-1">
        {draft.difficulty && <DifficultyBadge difficulty={draft.difficulty} />}
        {draft.timeline?.duration_minutes && (
          <span className="text-xs text-sim-text-faint">
            {draft.timeline.duration_minutes} min
          </span>
        )}
        {(draft.tags ?? []).map((tag) => (
          <span
            key={tag}
            className="text-xs bg-sim-surface-2 text-sim-text-muted px-1.5 py-0.5 rounded"
          >
            {tag}
          </span>
        ))}
      </div>
    </Card>
  );
}

function IncidentCard({ draft }: { draft: Partial<RawScenarioConfig> }) {
  const incidents = draft.topology?.focal_service?.incidents ?? [];
  const pulsing = useChangePulse(JSON.stringify(incidents));

  if (incidents.length === 0) {
    return (
      <Card title="Incident" pulsing={pulsing}>
        <Placeholder />
      </Card>
    );
  }

  const inc = incidents[0];
  return (
    <Card title="Incident" pulsing={pulsing}>
      <span className="text-xs text-sim-text">{inc.description}</span>
      <div className="flex flex-wrap gap-2 mt-1">
        <span className="text-xs text-sim-text-faint">
          Component:{" "}
          <strong className="text-sim-text">{inc.affected_component}</strong>
        </span>
        <span className="text-xs bg-sim-surface-2 text-sim-text-muted px-1.5 py-0.5 rounded">
          {inc.onset_overlay}
        </span>
        <span className="text-xs text-sim-text-faint">
          T+{Math.round(inc.onset_second / 60)}m
        </span>
      </div>
    </Card>
  );
}

function ServiceTopologyCard({ draft }: { draft: Partial<RawScenarioConfig> }) {
  const focal = draft.topology?.focal_service;
  const pulsing = useChangePulse(JSON.stringify(focal));

  if (!focal) {
    return (
      <Card title="Service Topology" pulsing={pulsing}>
        <Placeholder />
      </Card>
    );
  }

  const chain = focal.components.map((c) => c.label ?? c.id).join(" → ");

  return (
    <Card title="Service Topology" pulsing={pulsing}>
      <span className="text-xs font-semibold text-sim-text">{focal.name}</span>
      {chain && (
        <span className="text-xs text-sim-text-muted font-mono">{chain}</span>
      )}
      {(draft.topology?.upstream ?? []).length > 0 && (
        <span className="text-xs text-sim-text-faint">
          Upstream: {draft.topology!.upstream.map((n) => n.name).join(", ")}
        </span>
      )}
      {(draft.topology?.downstream ?? []).length > 0 && (
        <span className="text-xs text-sim-text-faint">
          Downstream: {draft.topology!.downstream.map((n) => n.name).join(", ")}
        </span>
      )}
    </Card>
  );
}

function PersonasCard({ draft }: { draft: Partial<RawScenarioConfig> }) {
  const personas = draft.personas;
  const pulsing = useChangePulse(JSON.stringify(personas));

  if (!personas) {
    return (
      <Card title="Personas" pulsing={pulsing}>
        <Placeholder />
      </Card>
    );
  }

  return (
    <Card title={`Personas (${personas.length})`} pulsing={pulsing}>
      {personas.map((p) => (
        <div key={p.id} className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: p.avatar_color ?? "#888" }}
          />
          <span className="text-xs text-sim-text font-medium">
            {p.display_name}
          </span>
          <span className="text-xs text-sim-text-faint">
            {p.job_title} · {p.team}
          </span>
          {p.initiates_contact && (
            <span className="text-xs bg-blue-900/30 text-blue-400 px-1 rounded">
              initiates
            </span>
          )}
          {p.silent_until_contacted && (
            <span className="text-xs bg-sim-surface-2 text-sim-text-faint px-1 rounded">
              silent
            </span>
          )}
        </div>
      ))}
    </Card>
  );
}

function RemediationActionsCard({
  draft,
}: {
  draft: Partial<RawScenarioConfig>;
}) {
  const actions = draft.remediation_actions;
  const pulsing = useChangePulse(JSON.stringify(actions));

  if (!actions) {
    return (
      <Card title="Remediation Actions" pulsing={pulsing}>
        <Placeholder />
      </Card>
    );
  }

  return (
    <Card title={`Remediation Actions (${actions.length})`} pulsing={pulsing}>
      {actions.map((a) => (
        <div key={a.id} className="flex items-start gap-2">
          {a.is_correct_fix ? (
            <span
              data-testid={`correct-fix-${a.id}`}
              className="text-green-400 text-xs font-bold flex-shrink-0 mt-0.5"
              aria-label="Correct fix"
            >
              ✓
            </span>
          ) : (
            <span
              data-testid={`red-herring-${a.id}`}
              className="text-sim-text-faint text-xs font-bold flex-shrink-0 mt-0.5"
              aria-label="Red herring"
            >
              ✗
            </span>
          )}
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-sim-text">{a.type}</span>
            {a.side_effect && (
              <span className="text-xs text-sim-text-faint">
                {a.side_effect}
              </span>
            )}
          </div>
        </div>
      ))}
    </Card>
  );
}

function EvaluationCard({ draft }: { draft: Partial<RawScenarioConfig> }) {
  const evaluation = draft.evaluation;
  const pulsing = useChangePulse(JSON.stringify(evaluation));

  if (!evaluation) {
    return (
      <Card title="Evaluation" pulsing={pulsing}>
        <Placeholder />
      </Card>
    );
  }

  return (
    <Card title="Evaluation" pulsing={pulsing}>
      {evaluation.root_cause && (
        <div>
          <span className="text-xs font-medium text-sim-text-muted">
            Root cause
          </span>
          <p className="text-xs text-sim-text mt-0.5 line-clamp-2">
            {evaluation.root_cause}
          </p>
        </div>
      )}
      {evaluation.debrief_context && (
        <div className="mt-1">
          <span className="text-xs font-medium text-sim-text-muted">
            Debrief
          </span>
          <p className="text-xs text-sim-text mt-0.5 line-clamp-2">
            {evaluation.debrief_context}
          </p>
        </div>
      )}
      <div className="flex gap-3 mt-1 text-xs text-sim-text-faint">
        <span>
          {evaluation.relevant_actions.length} relevant action
          {evaluation.relevant_actions.length !== 1 ? "s" : ""}
        </span>
        <span>
          {evaluation.red_herrings.length} red herring
          {evaluation.red_herrings.length !== 1 ? "s" : ""}
        </span>
      </div>
    </Card>
  );
}

function TimelineEngineCard({ draft }: { draft: Partial<RawScenarioConfig> }) {
  const timeline = draft.timeline;
  const engine = draft.engine;
  const pulsing = useChangePulse(JSON.stringify({ timeline, engine }));

  if (!timeline && !engine) {
    return (
      <Card title="Timeline & Engine" pulsing={pulsing}>
        <Placeholder />
      </Card>
    );
  }

  return (
    <Card title="Timeline & Engine" pulsing={pulsing}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {timeline?.duration_minutes !== undefined && (
          <>
            <span className="text-sim-text-muted">Duration</span>
            <span className="text-sim-text">
              {timeline.duration_minutes} min
            </span>
          </>
        )}
        {timeline?.default_speed !== undefined && (
          <>
            <span className="text-sim-text-muted">Default speed</span>
            <span className="text-sim-text">{timeline.default_speed}×</span>
          </>
        )}
      </div>
    </Card>
  );
}

function AssumptionsCard({ assumptions }: { assumptions: string[] }) {
  if (assumptions.length === 0) return null;

  return (
    <div data-testid="assumptions-card">
      <Card title="Assumptions">
        <div className="flex flex-col gap-1">
          {assumptions.map((a, i) => (
            <span key={i} className="text-xs text-sim-text-faint">
              · {a}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ScenarioCanvas({
  draft,
  assumptions,
  validationErrors,
  thinking,
}: ScenarioCanvasProps) {
  // Empty state — no draft yet
  if (draft === null) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-sim-text-muted">
        {thinking ? (
          <ThinkingDots />
        ) : (
          <p className="text-sm text-center px-8">
            Describe your scenario in the chat →
            <br />
            <span className="text-xs text-sim-text-faint">
              The scenario will take shape here as you talk.
            </span>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Scrollable card grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-4 max-w-2xl">
          <OverviewCard draft={draft} />
          <ServiceTopologyCard draft={draft} />
          <IncidentCard draft={draft} />
          <PersonasCard draft={draft} />
          <RemediationActionsCard draft={draft} />
          <EvaluationCard draft={draft} />
          <TimelineEngineCard draft={draft} />
          <AssumptionsCard assumptions={assumptions} />
        </div>
      </div>

      {/* Validation error bar — sticky at bottom */}
      {validationErrors.length > 0 && (
        <div
          data-testid="validation-error-bar"
          className="flex-shrink-0 border-t border-sim-red/40 bg-sim-red/10 px-4 py-2"
        >
          <p className="text-xs font-semibold text-sim-red mb-1">
            {validationErrors.length} validation issue
            {validationErrors.length !== 1 ? "s" : ""} — fix before downloading
          </p>
          <ul className="flex flex-col gap-0.5">
            {validationErrors.map((e, i) => (
              <li key={i} className="text-xs text-sim-red/80">
                <span className="font-medium">{e.path}:</span> {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
