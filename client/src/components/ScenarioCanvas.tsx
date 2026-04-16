// ScenarioCanvas.tsx — read-only live canvas showing the current scenario draft
// as a card grid. Updated on every update_scenario tool call from the builder LLM.

import React, { useEffect, useRef, useState } from "react";
import type { RawScenarioConfig } from "../scenario/schema";
import type { ScenarioValidationError } from "../scenario/lint";
import { ThinkingDots } from "./ThinkingDots";
import {
  TopologySummaryTable,
  COMPONENT_META,
  type TopologySummaryRow,
} from "./TopologySummaryTable";

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
  description?: string;
  children: React.ReactNode;
  pulsing?: boolean;
}

function Card({ title, description, children, pulsing = false }: CardProps) {
  return (
    <div
      className={`bg-sim-surface border rounded p-4 flex flex-col gap-2 transition-colors duration-500 ${
        pulsing ? "border-sim-accent" : "border-sim-border"
      }`}
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="text-xs font-semibold text-sim-text-muted uppercase tracking-wide">
          {title}
        </h3>
        {description && (
          <p className="text-xs text-sim-text-faint">{description}</p>
        )}
      </div>
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
// Re-exported from the shared ThinkingDots component for consumers that
// import it from ScenarioCanvas (e.g. ScenarioBuilderChat).
export { ThinkingDots } from "./ThinkingDots";

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
    <Card
      title="Overview"
      description="Scenario metadata shown to the trainee at start. Difficulty and tags help filter scenarios in the picker."
      pulsing={pulsing}
    >
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

function ServiceTopologyCard({ draft }: { draft: Partial<RawScenarioConfig> }) {
  const topology = draft.topology;
  const focal = topology?.focal_service;
  const pulsing = useChangePulse(JSON.stringify(topology));

  if (!focal) {
    return (
      <Card
        title="Service Topology"
        description="The focal service (where the incident occurs) plus any upstream callers and downstream dependencies."
        pulsing={pulsing}
      >
        <Placeholder />
      </Card>
    );
  }

  const rows: TopologySummaryRow[] = [
    {
      name: focal.name,
      role: "primary",
      description: focal.description,
      owner: focal.owner,
    },
    ...(topology?.upstream ?? []).map(
      (n): TopologySummaryRow => ({
        name: n.name,
        role: "upstream",
        description: n.description,
        owner: n.owner,
      }),
    ),
    ...(topology?.downstream ?? []).map(
      (n): TopologySummaryRow => ({
        name: n.name,
        role: "downstream",
        description: n.description,
        owner: n.owner,
      }),
    ),
  ];

  return (
    <Card
      title="Service Topology"
      description="The focal service (where the incident occurs) plus any upstream callers and downstream dependencies."
      pulsing={pulsing}
    >
      <TopologySummaryTable rows={rows} />

      {/* Focal service component pipeline — left-to-right with arrows */}
      {focal.components.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          <span className="text-xs font-medium text-sim-text-muted uppercase tracking-wide">
            {focal.name} — architecture
          </span>
          <div className="flex items-center flex-wrap gap-0 mt-1">
            {focal.components.map((c, i) => {
              const meta = COMPONENT_META[c.type] ?? {
                icon: "□",
                label: c.type,
                color: "#94a3b8",
              };
              return (
                <React.Fragment key={c.id}>
                  {i > 0 && (
                    <span className="text-sim-text-faint text-xs mx-1">→</span>
                  )}
                  <div
                    className="flex flex-col items-center gap-0.5 px-2 py-1 rounded border border-sim-border bg-sim-surface-2"
                    title={c.label ?? c.id}
                  >
                    <span
                      style={{ color: meta.color }}
                      className="text-sm leading-none"
                    >
                      {meta.icon}
                    </span>
                    <span
                      className="text-xs font-medium"
                      style={{ color: meta.color }}
                    >
                      {meta.label}
                    </span>
                    {c.label && (
                      <span
                        className="text-xs text-sim-text-faint leading-none"
                        style={{
                          maxWidth: 72,
                          textAlign: "center",
                          wordBreak: "break-word",
                        }}
                      >
                        {c.label}
                      </span>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

function IncidentCard({ draft }: { draft: Partial<RawScenarioConfig> }) {
  const incidents = draft.topology?.focal_service?.incidents ?? [];
  const pulsing = useChangePulse(JSON.stringify(incidents));

  if (incidents.length === 0) {
    return (
      <Card
        title="Incident"
        description="What breaks and how. Defines the metric overlay applied to the focal service at onset_second."
        pulsing={pulsing}
      >
        <Placeholder />
      </Card>
    );
  }

  const inc = incidents[0];
  return (
    <Card
      title={`Incident${incidents.length > 1 ? `s (${incidents.length})` : ""}`}
      description="What breaks and how. Defines the metric overlay applied to the focal service at onset_second."
      pulsing={pulsing}
    >
      {incidents.map((inc, i) => (
        <div key={i} className="flex flex-col gap-1">
          <span className="text-xs text-sim-text">{inc.description}</span>
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-sim-text-faint">
              Component:{" "}
              <strong className="text-sim-text">
                {inc.affected_component}
              </strong>
            </span>
            <span className="text-xs bg-sim-surface-2 text-sim-text-muted px-1.5 py-0.5 rounded">
              {inc.onset_overlay}
            </span>
            <span className="text-xs text-sim-text-faint">
              T+{Math.round(inc.onset_second / 60)}m
            </span>
            {inc.magnitude !== undefined && (
              <span className="text-xs text-sim-text-faint">
                ×{inc.magnitude}
              </span>
            )}
          </div>
        </div>
      ))}
    </Card>
  );
}

function PersonasCard({ draft }: { draft: Partial<RawScenarioConfig> }) {
  const personas = draft.personas;
  const pulsing = useChangePulse(JSON.stringify(personas));

  if (!personas || personas.length === 0) {
    return (
      <Card
        title="Personas"
        description="NPCs the trainee can message. Each has a role, cooldown, and a system prompt governing how they respond."
        pulsing={pulsing}
      >
        <Placeholder />
      </Card>
    );
  }

  return (
    <Card
      title={`Personas (${personas.length})`}
      description="NPCs the trainee can message. Each has a role, cooldown, and a system prompt governing how they respond."
      pulsing={pulsing}
    >
      {personas.map((p) => (
        <div key={p.id} className="flex items-center gap-2 flex-wrap">
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

  if (!actions || actions.length === 0) {
    return (
      <Card
        title="Remediation Actions"
        description="Actions available to the trainee. Correct fixes resolve the incident; red herrings are plausible but wrong."
        pulsing={pulsing}
      >
        <Placeholder />
      </Card>
    );
  }

  return (
    <Card
      title={`Remediation Actions (${actions.length})`}
      description="Actions available to the trainee. Correct fixes resolve the incident; red herrings are plausible but wrong."
      pulsing={pulsing}
    >
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
            <span className="text-xs text-sim-text">
              {a.label ?? a.type} · {a.service}
            </span>
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
      <Card
        title="Evaluation"
        description="Post-incident debrief material. Defines the correct root cause, which actions count as correct, and which are red herrings."
        pulsing={pulsing}
      >
        <Placeholder />
      </Card>
    );
  }

  return (
    <Card
      title="Evaluation"
      description="Post-incident debrief material. Defines the correct root cause, which actions count as correct, and which are red herrings."
      pulsing={pulsing}
    >
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

function AlarmsCard({ draft }: { draft: Partial<RawScenarioConfig> }) {
  const alarms = draft.alarms;
  const pulsing = useChangePulse(JSON.stringify(alarms));

  const SEVERITY_COLOURS: Record<string, string> = {
    SEV1: "text-red-400",
    SEV2: "text-orange-400",
    SEV3: "text-yellow-400",
    SEV4: "text-sim-text-muted",
  };

  if (!alarms || alarms.length === 0) {
    return (
      <Card
        title="Alarms"
        description="Metric thresholds that fire automatically during the sim. Can page the trainee or trigger silently in the background."
        pulsing={pulsing}
      >
        <Placeholder />
      </Card>
    );
  }

  return (
    <Card
      title={`Alarms (${alarms.length})`}
      description="Metric thresholds that fire automatically during the sim. Can page the trainee or trigger silently in the background."
      pulsing={pulsing}
    >
      {alarms.map((a) => (
        <div key={a.id} className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-xs font-semibold flex-shrink-0 ${SEVERITY_COLOURS[a.severity] ?? "text-sim-text-muted"}`}
          >
            {a.severity}
          </span>
          <span className="text-xs text-sim-text font-medium">{a.id}</span>
          <span className="text-xs text-sim-text-faint">{a.metric_id}</span>
          {a.auto_fire === false && (
            <span className="text-xs bg-sim-surface-2 text-sim-text-faint px-1 rounded">
              manual
            </span>
          )}
          {a.auto_page && (
            <span className="text-xs bg-blue-900/30 text-blue-400 px-1 rounded">
              pages
            </span>
          )}
          {a.onset_second !== undefined && (
            <span className="text-xs text-sim-text-faint">
              T+{Math.round(a.onset_second / 60)}m
            </span>
          )}
        </div>
      ))}
    </Card>
  );
}

function TicketsCard({ draft }: { draft: Partial<RawScenarioConfig> }) {
  const tickets = draft.ticketing;
  const pulsing = useChangePulse(JSON.stringify(tickets));

  const STATUS_COLOURS: Record<string, string> = {
    open: "text-red-400",
    in_progress: "text-yellow-400",
    resolved: "text-green-400",
  };

  if (!tickets || tickets.length === 0) {
    return (
      <Card
        title="Tickets"
        description="Pre-existing incident tickets visible in the ticketing panel. Gives the trainee early context about what's already known."
        pulsing={pulsing}
      >
        <Placeholder />
      </Card>
    );
  }

  return (
    <Card
      title={`Tickets (${tickets.length})`}
      description="Pre-existing incident tickets visible in the ticketing panel. Gives the trainee early context about what's already known."
      pulsing={pulsing}
    >
      {tickets.map((t) => (
        <div key={t.id} className="flex items-start gap-2">
          <span
            className={`text-xs font-semibold flex-shrink-0 mt-0.5 ${STATUS_COLOURS[t.status] ?? "text-sim-text-muted"}`}
          >
            {t.severity}
          </span>
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-xs text-sim-text truncate">{t.title}</span>
            <span className="text-xs text-sim-text-faint">
              {t.status} · by {t.created_by}
            </span>
          </div>
        </div>
      ))}
    </Card>
  );
}

function ChatCard({ draft }: { draft: Partial<RawScenarioConfig> }) {
  const chat = draft.chat;
  const pulsing = useChangePulse(JSON.stringify(chat));

  const channels = chat?.channels ?? [];
  const messages = chat?.messages ?? [];

  if (channels.length === 0 && messages.length === 0) {
    return (
      <Card
        title="Chat"
        description="Slack-style channels where personas and the trainee communicate. Scripted messages play out at set sim-time offsets."
        pulsing={pulsing}
      >
        <Placeholder />
      </Card>
    );
  }

  return (
    <Card
      title="Chat"
      description="Slack-style channels where personas and the trainee communicate. Scripted messages play out at set sim-time offsets."
      pulsing={pulsing}
    >
      <div className="flex flex-wrap gap-2">
        {channels.map((ch) => (
          <span
            key={ch.id}
            className="text-xs bg-sim-surface-2 text-sim-text-muted px-1.5 py-0.5 rounded font-mono"
          >
            {ch.name}
          </span>
        ))}
      </div>
      {messages.length > 0 && (
        <span className="text-xs text-sim-text-faint">
          {messages.length} scripted message{messages.length !== 1 ? "s" : ""}
        </span>
      )}
    </Card>
  );
}

function WikiCard({ draft }: { draft: Partial<RawScenarioConfig> }) {
  const wiki = draft.wiki;
  const pulsing = useChangePulse(JSON.stringify(wiki));
  const pages = wiki?.pages ?? [];

  if (pages.length === 0) {
    return (
      <Card
        title="Wiki"
        description="Internal runbooks and service docs the trainee can consult. Include on-call procedures, architecture notes, and known failure modes."
        pulsing={pulsing}
      >
        <Placeholder />
      </Card>
    );
  }

  return (
    <Card
      title={`Wiki (${pages.length} page${pages.length !== 1 ? "s" : ""})`}
      description="Internal runbooks and service docs the trainee can consult. Include on-call procedures, architecture notes, and known failure modes."
      pulsing={pulsing}
    >
      {pages.map((p, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <span className="text-xs text-sim-text font-medium">{p.title}</span>
          {p.content && (
            <span className="text-xs text-sim-text-faint line-clamp-1">
              {p.content.split("\n")[0].replace(/^#+\s*/, "")}
            </span>
          )}
        </div>
      ))}
    </Card>
  );
}

function LogsCard({ draft }: { draft: Partial<RawScenarioConfig> }) {
  const patterns = draft.log_patterns ?? [];
  const bgLogs = draft.background_logs ?? [];
  const pulsing = useChangePulse(JSON.stringify({ patterns, bgLogs }));

  const LEVEL_COLOURS: Record<string, string> = {
    ERROR: "text-red-400",
    WARN: "text-yellow-400",
    INFO: "text-sim-text-muted",
    DEBUG: "text-sim-text-faint",
  };

  if (patterns.length === 0 && bgLogs.length === 0) {
    return (
      <Card
        title="Logs"
        description="Scripted log patterns (specific messages at intervals) and ambient background streams that give the logs panel realistic noise."
        pulsing={pulsing}
      >
        <Placeholder />
      </Card>
    );
  }

  return (
    <Card
      title="Logs"
      description="Scripted log patterns (specific messages at intervals) and ambient background streams that give the logs panel realistic noise."
      pulsing={pulsing}
    >
      {patterns.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-sim-text-muted">
            Patterns ({patterns.length})
          </span>
          {patterns.map((p) => (
            <div key={p.id} className="flex items-baseline gap-2 min-w-0">
              <span
                className={`text-xs font-mono flex-shrink-0 ${LEVEL_COLOURS[p.level] ?? "text-sim-text-muted"}`}
              >
                {p.level}
              </span>
              <span className="text-xs text-sim-text-faint font-medium flex-shrink-0">
                {p.service}
              </span>
              <span className="text-xs text-sim-text truncate">
                {p.message}
              </span>
            </div>
          ))}
        </div>
      )}
      {bgLogs.length > 0 && (
        <div className="flex flex-col gap-1 mt-1">
          <span className="text-xs font-medium text-sim-text-muted">
            Background streams ({bgLogs.length})
          </span>
          {bgLogs.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-sim-text-faint font-medium">
                {b.service}
              </span>
              <span className="text-xs bg-sim-surface-2 text-sim-text-faint px-1 rounded">
                {b.profile}
              </span>
              {b.density && b.density !== "medium" && (
                <span className="text-xs text-sim-text-faint">{b.density}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function CICDCard({ draft }: { draft: Partial<RawScenarioConfig> }) {
  const pipelines = draft.cicd?.pipelines ?? [];
  const deployments = draft.cicd?.deployments ?? [];
  const pulsing = useChangePulse(JSON.stringify(draft.cicd));

  const STAGE_STATUS_COLOURS: Record<string, string> = {
    succeeded: "text-green-400",
    failed: "text-red-400",
    in_progress: "text-sim-accent",
    blocked: "text-yellow-400",
    not_started: "text-sim-text-faint",
  };

  const DEPLOY_STATUS_COLOURS: Record<string, string> = {
    active: "text-green-400",
    previous: "text-sim-text-faint",
    rolled_back: "text-yellow-400",
  };

  if (pipelines.length === 0 && deployments.length === 0) {
    return (
      <Card
        title="CI/CD"
        description="Pipeline stages and deployment history shown in the CI/CD panel. The builder adds this automatically for deploy, rollback, and config-change scenarios."
        pulsing={pulsing}
      >
        <Placeholder />
      </Card>
    );
  }

  return (
    <Card
      title="CI/CD"
      description="Pipeline stages and deployment history shown in the CI/CD panel. Useful for rollback and roll-forward scenarios."
      pulsing={pulsing}
    >
      {pipelines.length > 0 && (
        <div className="flex flex-col gap-3">
          {pipelines.map((p) => {
            // Find the prod/last deploy stage to surface the key commit
            const prodStage =
              [...p.stages].reverse().find((s) => s.type === "deploy") ??
              p.stages[p.stages.length - 1];
            return (
              <div key={p.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-sim-text font-medium">
                    {p.name}
                  </span>
                  <span className="text-xs text-sim-text-faint">
                    {p.service}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap pl-1">
                  {p.stages.map((s) => (
                    <span
                      key={s.id}
                      className={`text-xs font-mono ${STAGE_STATUS_COLOURS[s.status] ?? "text-sim-text-faint"}`}
                      title={`${s.name}: ${s.current_version}`}
                    >
                      {s.name}
                    </span>
                  ))}
                </div>
                {prodStage && (
                  <div
                    className="text-xs text-sim-text-faint pl-1 line-clamp-1"
                    title={prodStage.commit_message}
                  >
                    "{prodStage.commit_message}"
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {deployments.length > 0 && (
        <div className="flex flex-col gap-1.5 mt-2">
          <span className="text-xs font-medium text-sim-text-muted">
            Deployments ({deployments.length})
          </span>
          {deployments.map((d, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-semibold flex-shrink-0 ${DEPLOY_STATUS_COLOURS[d.status] ?? "text-sim-text-faint"}`}
                >
                  {d.status}
                </span>
                <span className="text-xs font-mono text-sim-text">
                  {d.version}
                </span>
                <span className="text-xs text-sim-text-faint">{d.service}</span>
              </div>
              {d.commit_message && (
                <div
                  className="text-xs text-sim-text-faint pl-1 line-clamp-1"
                  title={d.commit_message}
                >
                  "{d.commit_message}"
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function TimelineEngineCard({ draft }: { draft: Partial<RawScenarioConfig> }) {
  const timeline = draft.timeline;
  const engine = draft.engine;
  const pulsing = useChangePulse(JSON.stringify({ timeline, engine }));

  if (!timeline && !engine) {
    return (
      <Card
        title="Timeline & Engine"
        description="How long the sim runs, the default playback speed, and which LLM tools are available to the stakeholder personas."
        pulsing={pulsing}
      >
        <Placeholder />
      </Card>
    );
  }

  return (
    <Card
      title="Timeline & Engine"
      description="How long the sim runs, the default playback speed, and which LLM tools are available to the stakeholder personas."
      pulsing={pulsing}
    >
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
      <Card
        title="Assumptions"
        description="Choices the LLM made on your behalf. Review these and ask for changes if anything is wrong."
      >
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
          <AlarmsCard draft={draft} />
          <TicketsCard draft={draft} />
          <ChatCard draft={draft} />
          <WikiCard draft={draft} />
          <LogsCard draft={draft} />
          <CICDCard draft={draft} />
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
