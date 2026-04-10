// loader.ts — browser-compatible scenario loader.
// I/O abstracted behind resolveFile callback; same transform/validate pipeline as server.
// Bundled scenarios: resolveFile backed by import.meta.glob eager map.
// Remote scenarios: resolveFile backed by fetch().

import yaml from "js-yaml";
import { ScenarioSchema } from "./schema";
import { validateCrossReferences, type ValidationError } from "./validator";
import { validateIncidentType } from "../metrics/resolver";
import { LOG_PROFILES, getDensityMultiplier, makeRng } from "./log-profiles";
import { logger } from "../logger";
import type {
  LoadedScenario,
  ScenarioSummary,
  ServiceType,
  Difficulty,
  PersonaConfig,
  AlarmConfig,
  RemediationActionConfig,
  FeatureFlagConfig,
  HostGroupConfig,
  ScriptedEmail,
  ChatConfig,
  ScriptedTicket,
  ScriptedLogEntry,
  WikiConfig,
  CICDConfig,
  OpsDashboardConfig,
  FocalServiceConfig,
  CorrelatedServiceConfig,
  MetricConfig,
  EvaluationConfig,
  ScriptedChatMessage,
  ScriptedDeployment,
} from "./types";

const log = logger.child({ component: "loader" });

// ── Public types ──────────────────────────────────────────────────────────────

export type { ScenarioSummary };

export interface ScenarioLoadError {
  scenarioId: string;
  errors: ValidationError[];
}

export function isScenarioLoadError(
  result: LoadedScenario | ScenarioLoadError,
): result is ScenarioLoadError {
  return "errors" in result && Array.isArray(result.errors);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Loads and validates a scenario from a YAML string.
 * resolveFile(relativePath) fetches referenced file content (body_file, content_file, etc.)
 */
export async function loadScenarioFromText(
  yamlText: string,
  resolveFile: (relativePath: string) => Promise<string>,
): Promise<LoadedScenario | ScenarioLoadError> {
  // Step 1: Parse YAML
  let rawObject: unknown;
  try {
    rawObject = yaml.load(yamlText);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      scenarioId: "unknown",
      errors: [
        {
          scenarioId: "unknown",
          field: "scenario.yaml",
          message: `YAML parse error: ${msg}`,
        },
      ],
    };
  }

  // Step 2: Zod schema parse
  const zodResult = ScenarioSchema.safeParse(rawObject);
  if (!zodResult.success) {
    const scenarioId =
      ((rawObject as Record<string, unknown>)?.["id"] as string) ?? "unknown";
    const errors: ValidationError[] = zodResult.error.issues.map((issue) => ({
      scenarioId,
      field: issue.path.join("."),
      message: issue.message,
    }));
    return { scenarioId, errors };
  }
  const raw = zodResult.data;

  // Step 3: ops_dashboard_file handling — fetch and merge
  if (raw.ops_dashboard && raw.ops_dashboard_file) {
    return {
      scenarioId: raw.id,
      errors: [
        {
          scenarioId: raw.id,
          field: "ops_dashboard_file",
          message:
            "ops_dashboard and ops_dashboard_file are mutually exclusive.",
        },
      ],
    };
  }

  if (raw.ops_dashboard_file && !raw.ops_dashboard) {
    // Path-traversal guard
    const fileRef = raw.ops_dashboard_file;
    if (
      fileRef.includes("../") ||
      fileRef.includes("..\\") ||
      fileRef.startsWith("/")
    ) {
      return {
        scenarioId: raw.id,
        errors: [
          {
            scenarioId: raw.id,
            field: "ops_dashboard_file",
            message: `ops_dashboard_file path traversal rejected: '${fileRef}'`,
          },
        ],
      };
    }
    let metricsContent: string;
    try {
      metricsContent = await resolveFile(fileRef);
    } catch {
      return {
        scenarioId: raw.id,
        errors: [
          {
            scenarioId: raw.id,
            field: "ops_dashboard_file",
            message: `ops_dashboard_file '${fileRef}' could not be loaded`,
          },
        ],
      };
    }
    const metricsObj = yaml.load(metricsContent);
    (raw as Record<string, unknown>)["ops_dashboard"] = metricsObj;
    (raw as Record<string, unknown>)["ops_dashboard_file"] = undefined;
  }

  // Step 4: Cross-reference validation
  const crossRefErrors = validateCrossReferences(raw);
  if (crossRefErrors.length > 0) {
    return { scenarioId: raw.id, errors: crossRefErrors };
  }

  // Step 5: incident_type warning
  if (raw.ops_dashboard) {
    const incidentType = raw.ops_dashboard.focal_service.incident_type;
    if (!validateIncidentType(incidentType)) {
      log.warn(
        { scenarioId: raw.id, incidentType },
        "incident_type not in registry — Tier 1 metrics will have no incident overlay",
      );
    }
  }

  // Step 6: Transform
  try {
    const loaded = await transform(raw, resolveFile);
    return loaded;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      scenarioId: raw.id,
      errors: [
        {
          scenarioId: raw.id,
          field: "transform",
          message: `Transform error: ${msg}`,
        },
      ],
    };
  }
}

export function toScenarioSummary(scenario: LoadedScenario): ScenarioSummary {
  return {
    id: scenario.id,
    title: scenario.title,
    description: scenario.description,
    serviceType: scenario.serviceType,
    difficulty: scenario.difficulty,
    tags: scenario.tags,
  };
}

// ── Bundled scenario loader (Vite import.meta.glob) ───────────────────────────

// These are resolved at build time by Vite. Values are raw strings (eager: true).
// The ?raw query returns file contents as strings without module evaluation.
type RawGlob = Record<string, string>;

let _bundledYamls: RawGlob | null = null;
let _bundledFiles: RawGlob | null = null;

function getBundledGlobs(): { yamls: RawGlob; files: RawGlob } {
  if (!_bundledYamls || !_bundledFiles) {
    _bundledYamls = import.meta.glob("../../../scenarios/*/scenario.yaml", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as RawGlob;
    _bundledFiles = import.meta.glob("../../../scenarios/**/*", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as RawGlob;
  }
  return { yamls: _bundledYamls, files: _bundledFiles };
}

/**
 * Loads all bundled scenarios (from Vite import.meta.glob).
 * Skips _fixture/. Invalid scenarios are logged and excluded.
 */
export async function loadBundledScenarios(): Promise<LoadedScenario[]> {
  const { yamls, files } = getBundledGlobs();
  const results: LoadedScenario[] = [];

  for (const [yamlPath, yamlText] of Object.entries(yamls)) {
    // Skip _fixture
    if (yamlPath.includes("/_fixture/")) continue;

    // Base path for this scenario (strip trailing 'scenario.yaml')
    const basePath = yamlPath.replace(/scenario\.yaml$/, "");

    const resolveFile = (relativePath: string): Promise<string> => {
      const key = `${basePath}${relativePath}`;
      const content = files[key];
      if (content === undefined) {
        return Promise.reject(new Error(`Bundled file not found: ${key}`));
      }
      return Promise.resolve(content);
    };

    const result = await loadScenarioFromText(yamlText, resolveFile);
    if (isScenarioLoadError(result)) {
      log.error(
        { scenarioId: result.scenarioId, errors: result.errors },
        "Bundled scenario failed validation — excluded",
      );
    } else {
      results.push(result);
    }
  }

  return results;
}

/**
 * Loads a single scenario from a remote base URL.
 * Expects scenario.yaml at baseUrl + '/scenario.yaml'.
 * File references resolved as baseUrl + '/' + relativePath.
 */
export async function loadRemoteScenario(
  baseUrl: string,
): Promise<LoadedScenario | ScenarioLoadError> {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  let yamlText: string;
  try {
    const res = await fetch(`${normalizedBase}/scenario.yaml`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    yamlText = await res.text();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      scenarioId: normalizedBase,
      errors: [
        {
          scenarioId: normalizedBase,
          field: "scenario.yaml",
          message: `Failed to fetch: ${msg}`,
        },
      ],
    };
  }

  const resolveFile = async (relativePath: string): Promise<string> => {
    const res = await fetch(`${normalizedBase}/${relativePath}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${relativePath}`);
    return res.text();
  };

  return loadScenarioFromText(yamlText, resolveFile);
}

// ── Log expansion helpers ─────────────────────────────────────────────────────

function expandLogPattern(p: {
  id: string;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  service: string;
  message: string;
  interval_seconds: number;
  from_second: number;
  to_second: number;
  count?: number;
  jitter_seconds?: number;
  seed?: number;
}): ScriptedLogEntry[] {
  const rng = makeRng(p.seed);
  const jitter = p.jitter_seconds ?? 0;
  const entries: ScriptedLogEntry[] = [];
  let n = 0;

  for (
    let t = p.from_second;
    t <= p.to_second && (p.count === undefined || n < p.count);
    t += p.interval_seconds
  ) {
    const offset = jitter > 0 ? (rng() * 2 - 1) * jitter : 0;
    const atSecond = Math.max(
      p.from_second,
      Math.min(p.to_second, Math.round(t + offset)),
    );
    const message = p.message.replace(/\{n\}/g, String(n + 1));
    entries.push({
      id: `${p.id}-${n + 1}`,
      atSecond,
      level: p.level,
      service: p.service,
      message,
    });
    n++;
  }

  return entries;
}

function expandBackgroundLogs(
  b: {
    profile: string;
    service: string;
    from_second: number;
    to_second: number;
    density: string;
    seed?: number;
  },
  blockIndex: number,
  scenarioId: string,
): ScriptedLogEntry[] {
  const profile = LOG_PROFILES[b.profile];
  if (!profile) {
    log.warn(
      { scenarioId, profile: b.profile },
      "background_logs profile not found — block skipped",
    );
    return [];
  }

  const rng = makeRng(b.seed);
  const multiplier = getDensityMultiplier(b.density);
  const windowSecs = b.to_second - b.from_second;
  const totalCount = Math.round(
    (profile.baseRate / 60) * windowSecs * multiplier,
  );

  const table: typeof profile.lines = [];
  for (const line of profile.lines) {
    const w = line.weight ?? 1;
    for (let i = 0; i < w; i++) table.push(line);
  }

  const entries: ScriptedLogEntry[] = [];
  for (let i = 0; i < totalCount; i++) {
    const line = table[Math.floor(rng() * table.length)];
    const atSecond = b.from_second + Math.floor(rng() * (windowSecs + 1));
    entries.push({
      id: `bg-${blockIndex}-${i + 1}`,
      atSecond,
      level: line.level,
      service: b.service,
      message: line.message,
    });
  }

  return entries;
}

// ── Transform: raw Zod output → LoadedScenario (camelCase) ───────────────────

async function transform(
  raw: ReturnType<typeof ScenarioSchema.parse>,
  resolveFile: (relativePath: string) => Promise<string>,
): Promise<LoadedScenario> {
  async function resolveContent(
    inlineContent: string | undefined,
    fileRef: string | undefined,
    _fieldPath: string,
  ): Promise<string> {
    if (inlineContent) return inlineContent;
    if (!fileRef) return "";
    return resolveFile(fileRef);
  }

  const emails: ScriptedEmail[] = await Promise.all(
    raw.email.map(async (e, i) => ({
      id: e.id,
      atSecond: e.at_second,
      threadId: e.thread_id,
      from: e.from,
      to: e.to,
      subject: e.subject,
      body: await resolveContent(e.body, e.body_file, `email[${i}].body_file`),
    })),
  );

  const chat: ChatConfig = {
    channels: raw.chat.channels.map((ch) => ({ id: ch.id, name: ch.name })),
    messages: (raw.chat.messages ?? []).map(
      (m): ScriptedChatMessage => ({
        id: m.id,
        atSecond: m.at_second,
        channel: m.channel,
        persona: m.persona,
        text: m.text,
      }),
    ),
  };

  const tickets: ScriptedTicket[] = await Promise.all(
    raw.ticketing.map(async (t, i) => ({
      id: t.id,
      title: t.title,
      severity: t.severity,
      status: t.status,
      description: await resolveContent(
        t.description,
        t.description_file,
        `ticketing[${i}].description_file`,
      ),
      createdBy: t.created_by,
      assignee: t.assignee ?? "trainee",
      atSecond: t.at_second,
    })),
  );

  const alarms: AlarmConfig[] = raw.alarms.map((a) => ({
    id: a.id,
    service: a.service,
    metricId: a.metric_id,
    condition: a.condition,
    severity: a.severity,
    threshold: a.threshold,
    autoFire: a.auto_fire ?? true,
    onsetSecond: a.onset_second,
    autoPage: a.auto_page ?? false,
    pageMessage: a.page_message,
  }));

  const scriptedLogs: ScriptedLogEntry[] = raw.logs.map((l) => ({
    id: l.id,
    atSecond: l.at_second,
    level: l.level,
    service: l.service,
    message: l.message,
  }));
  const patternLogs: ScriptedLogEntry[] = raw.log_patterns.flatMap((p) =>
    expandLogPattern(p),
  );
  const backgroundLogs: ScriptedLogEntry[] = raw.background_logs.flatMap(
    (b, i) => expandBackgroundLogs(b, i, raw.id),
  );
  const logs: ScriptedLogEntry[] = [
    ...scriptedLogs,
    ...patternLogs,
    ...backgroundLogs,
  ].sort((a, b) => a.atSecond - b.atSecond);

  const wiki: WikiConfig = {
    pages: await Promise.all(
      raw.wiki.pages.map(async (p, i) => ({
        title: p.title,
        content: await resolveContent(
          p.content,
          p.content_file,
          `wiki.pages[${i}].content_file`,
        ),
      })),
    ),
  };

  const cicd: CICDConfig = {
    pipelines: (raw.cicd.pipelines ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      service: p.service,
      stages: (p.stages ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        currentVersion: s.current_version,
        previousVersion: s.previous_version ?? null,
        status: s.status,
        deployedAtSec: s.deployed_at_sec,
        commitMessage: s.commit_message,
        author: s.author,
        blockers: (s.blockers ?? []).map((b) => ({
          type: b.type,
          alarmId: b.alarm_id,
          message: b.message,
        })),
        alarmWatches: s.alarm_watches ?? [],
        tests: (s.tests ?? []).map((t) => ({
          name: t.name,
          status: t.status,
          url: t.url,
          note: t.note,
        })),
        promotionEvents: (s.promotion_events ?? []).map((e) => ({
          version: e.version,
          simTime: e.sim_time,
          status: e.status,
          note: e.note,
        })),
      })),
    })),
    deployments: (raw.cicd.deployments ?? []).map(
      (d): ScriptedDeployment => ({
        service: d.service,
        version: d.version,
        deployedAtSec: d.deployed_at_sec,
        status: d.status,
        commitMessage: d.commit_message,
        author: d.author,
      }),
    ),
  };

  const personas: PersonaConfig[] = raw.personas.map((p) => ({
    id: p.id,
    displayName: p.display_name,
    jobTitle: p.job_title,
    team: p.team,
    avatarColor: p.avatar_color,
    initiatesContact: p.initiates_contact,
    cooldownSeconds: p.cooldown_seconds,
    silentUntilContacted: p.silent_until_contacted,
    systemPrompt: p.system_prompt,
  }));

  const remediationActions: RemediationActionConfig[] =
    raw.remediation_actions.map((r) => ({
      id: r.id,
      type: r.type,
      service: r.service,
      isCorrectFix: r.is_correct_fix,
      sideEffect: r.side_effect,
      targetVersion: r.target_version,
      flagId: r.flag_id,
      flagEnabled: r.flag_enabled,
      label: r.label,
      throttleTargets: r.throttle_targets?.map((t) => ({
        id: t.id,
        scope: t.scope,
        label: t.label,
        description: t.description,
        llmHint: t.llm_hint,
        unit: t.unit,
        baselineRate: t.baseline_rate,
      })),
    }));

  const featureFlags: FeatureFlagConfig[] = raw.feature_flags.map((f) => ({
    id: f.id,
    label: f.label,
    defaultOn: f.default_on,
    description: f.description,
  }));

  const hostGroups: HostGroupConfig[] = raw.host_groups.map((h) => ({
    id: h.id,
    label: h.label,
    service: h.service,
    instanceCount: h.instance_count,
    description: h.description,
  }));

  const evaluation: EvaluationConfig = {
    rootCause: raw.evaluation.root_cause,
    relevantActions: raw.evaluation.relevant_actions.map((a) => ({
      action: a.action,
      why: a.why,
      service: a.service,
      remediationActionId: a.remediation_action_id,
    })),
    redHerrings: raw.evaluation.red_herrings.map((a) => ({
      action: a.action,
      why: a.why,
    })),
    debriefContext: raw.evaluation.debrief_context,
  };

  const rawOps = raw.ops_dashboard!;
  const opsDashboard: OpsDashboardConfig = {
    preIncidentSeconds: rawOps.pre_incident_seconds,
    resolutionSeconds: rawOps.resolution_seconds,
    focalService: transformFocalService(rawOps.focal_service),
    correlatedServices: (rawOps.correlated_services ?? []).map(
      transformCorrelatedService,
    ),
  };

  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    serviceType: raw.service_type as ServiceType,
    difficulty: raw.difficulty as Difficulty,
    tags: raw.tags,
    timeline: {
      defaultSpeed: raw.timeline.default_speed,
      durationMinutes: raw.timeline.duration_minutes,
    },
    topology: {
      focalService: raw.topology.focal_service,
      upstream: raw.topology.upstream,
      downstream: raw.topology.downstream,
    },
    engine: {
      tickIntervalSeconds: raw.engine.tick_interval_seconds,
      defaultTab: raw.engine.default_tab ?? "email",
      llmEventTools: (raw.engine.llm_event_tools ?? []).map((t) => ({
        tool: t.tool,
        enabled: t.enabled,
        maxCalls: t.max_calls,
        requiresAction: t.requires_action,
        services: t.services,
      })),
    },
    emails,
    chat,
    tickets,
    opsDashboard,
    alarms,
    logs,
    wiki,
    cicd,
    personas,
    remediationActions,
    featureFlags,
    hostGroups,
    evaluation,
  };
}

function transformMetric(m: {
  archetype: string;
  label?: string;
  unit?: string;
  baseline_value?: number;
  warning_threshold?: number;
  critical_threshold?: number;
  noise?: "low" | "medium" | "high" | "extreme";
  incident_peak?: number;
  onset_second?: number;
  resolved_value?: number;
  incident_response?: {
    overlay: string;
    onset_second?: number;
    peak_value?: number;
    drop_factor?: number;
    ramp_duration_seconds?: number;
    saturation_duration_seconds?: number;
  };
  series_override?: Array<{ t: number; v: number }>;
}): MetricConfig {
  return {
    archetype: m.archetype,
    label: m.label,
    unit: m.unit,
    baselineValue: m.baseline_value,
    warningThreshold: m.warning_threshold,
    criticalThreshold: m.critical_threshold,
    noise: m.noise,
    incidentPeak: m.incident_peak,
    onsetSecond: m.onset_second,
    resolvedValue: m.resolved_value,
    incidentResponse: m.incident_response
      ? {
          overlay: m.incident_response.overlay,
          onsetSecond: m.incident_response.onset_second,
          peakValue: m.incident_response.peak_value,
          dropFactor: m.incident_response.drop_factor,
          rampDurationSeconds: m.incident_response.ramp_duration_seconds,
          saturationDurationSeconds:
            m.incident_response.saturation_duration_seconds,
        }
      : undefined,
    seriesOverride: m.series_override,
  };
}

function transformFocalService(focal: {
  name: string;
  scale: {
    typical_rps: number;
    instance_count?: number;
    max_connections?: number;
  };
  traffic_profile: string;
  health: "healthy" | "degraded" | "flaky";
  incident_type: string;
  metrics: Parameters<typeof transformMetric>[0][];
}): FocalServiceConfig {
  return {
    name: focal.name,
    scale: {
      typicalRps: focal.scale.typical_rps,
      instanceCount: focal.scale.instance_count,
      maxConnections: focal.scale.max_connections,
    },
    trafficProfile:
      focal.traffic_profile as FocalServiceConfig["trafficProfile"],
    health: focal.health,
    incidentType: focal.incident_type,
    metrics: focal.metrics.map(transformMetric),
  };
}

function transformCorrelatedService(cs: {
  name: string;
  correlation: "upstream_impact" | "exonerated" | "independent";
  lag_seconds?: number;
  impact_factor?: number;
  health: "healthy" | "degraded" | "flaky";
  overrides?: Parameters<typeof transformMetric>[0][];
}): CorrelatedServiceConfig {
  return {
    name: cs.name,
    correlation: cs.correlation,
    lagSeconds: cs.lag_seconds,
    impactFactor: cs.impact_factor,
    health: cs.health,
    overrides: (cs.overrides ?? []).map(transformMetric),
  };
}
