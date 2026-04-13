// loader.ts — browser-compatible scenario loader.
// I/O abstracted behind resolveFile callback; same transform/validate pipeline as server.
// Bundled scenarios: resolveFile backed by import.meta.glob eager map.
// Remote scenarios: resolveFile backed by fetch().

import yaml from "js-yaml";
import { ScenarioSchema } from "./schema";
import { validateCrossReferences, type ValidationError } from "./validator";
import { LOG_PROFILES, getDensityMultiplier, makeRng } from "./log-profiles";
import { logger } from "../logger";
import type {
  LoadedScenario,
  ServiceNode,
  ServiceComponent,
  IncidentConfig,
  PropagationDirection,
  TrafficProfile,
  ComponentType,
} from "./types";
import type { OverlayApplication } from "../metrics/types";
import { COMPONENT_METRICS } from "../metrics/component-metrics";
import {
  findEntrypoint,
  propagationPath,
  propagationPathForDirection,
  propagationLag,
} from "./component-topology";

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

  // Step 3: Cross-reference validation
  const crossRefErrors = validateCrossReferences(raw);
  if (crossRefErrors.length > 0) {
    return { scenarioId: raw.id, errors: crossRefErrors };
  }

  // Step 4: Transform
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
    difficulty: scenario.difficulty,
    tags: scenario.tags,
  };
}

// ── Bundled scenario loader (Vite import.meta.glob) ───────────────────────────

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

export async function loadBundledScenarios(): Promise<LoadedScenario[]> {
  const { yamls, files } = getBundledGlobs();
  const results: LoadedScenario[] = [];

  for (const [yamlPath, yamlText] of Object.entries(yamls)) {
    if (yamlPath.includes("/_fixture/")) continue;

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

// ── deriveTrafficProfile ──────────────────────────────────────────────────────

/**
 * Derives a sensible alarm threshold for a metric based on its archetype,
 * baseline value, and capacity ceiling (for saturation-type metrics).
 *
 * The threshold represents "clearly in incident territory" — not a warning,
 * just one threshold. Rules per archetype family:
 *
 *  Capacity-capped (saturation):
 *    write_capacity_used / read_capacity_used / concurrent_executions
 *    connection_pool_used → ceiling × 0.85
 *
 *  Rate / error metrics → baseline × 3
 *    (error_rate, fault_rate, write_throttles, queue_depth, queue_age_ms,
 *     memory_jvm, memory_system, throughput_bytes)
 *
 *  CPU-style (hard %) → 85
 *    (cpu_utilization)
 *
 *  Latency → baseline × 3
 *    (p50/p95/p99_latency_ms)
 *
 *  Traffic / request_rate → baseline × 2
 *    (request_rate — spike in traffic is worth watching but not alarming hard)
 *
 * Returns null when baseline is 0 and there is no ceiling (threshold would be 0,
 * which would fire immediately on any noise).
 */
function deriveCriticalThreshold(
  archetype: string,
  baseline: number,
  ceiling: number | null,
): number | null {
  // cache_hit_rate is an inverted metric (low = bad) — auto-alarm uses >=
  // threshold which would only fire when the cache is healthy (high hit rate).
  // Return null to suppress auto-alarm; scenario authors should add explicit
  // alarms on correlated metrics (latency, error rate) instead.
  if (archetype === "cache_hit_rate") return null;

  // Capacity-based: alarm at 85% of ceiling
  if (
    archetype === "write_capacity_used" ||
    archetype === "read_capacity_used" ||
    archetype === "concurrent_executions" ||
    archetype === "connection_pool_used"
  ) {
    const cap = ceiling ?? baseline * 2;
    return Math.round(cap * 0.85 * 100) / 100;
  }

  // Hard-capped percentage metrics
  if (archetype === "cpu_utilization") return 85;

  // Throttle / queue depth — baseline is 0 so use fixed thresholds
  if (archetype === "write_throttles") return 5;
  if (archetype === "queue_depth") return 50;
  if (archetype === "queue_age_ms")
    return baseline > 0 ? Math.round(baseline * 5 * 100) / 100 : 500;

  // Traffic rate — 2× baseline
  if (archetype === "request_rate") {
    return baseline > 0 ? Math.round(baseline * 2 * 100) / 100 : null;
  }

  // Everything else: 3× baseline (latency, error/fault rate, memory, throttles, queues)
  return baseline > 0 ? Math.round(baseline * 3 * 100) / 100 : null;
}

function deriveTrafficProfile(entrypointType: ComponentType): TrafficProfile {
  switch (entrypointType) {
    case "load_balancer":
    case "api_gateway":
      return "always_on_api";
    case "kinesis_stream":
    case "sqs_queue":
      return "none";
    case "scheduler":
      return "batch_nightly";
    default:
      return "none";
  }
}

// ── deriveOpsDashboard ────────────────────────────────────────────────────────

/**
 * Derives OpsDashboardConfig from the focal ServiceNode's component graph.
 * Called by transform() to replace the old authored ops_dashboard YAML section.
 */
function deriveOpsDashboard(
  focalNode: ServiceNode,
  preIncidentSeconds: number,
  resolutionSeconds: number,
  downstreamNodes: ServiceNode[],
): OpsDashboardConfig {
  const focalService = deriveFocalServiceConfig(focalNode);
  const correlatedServices = downstreamNodes.map(
    deriveCorrelatedServiceConfigFromNode,
  );

  return {
    preIncidentSeconds,
    resolutionSeconds,
    focalService,
    correlatedServices,
  };
}

function deriveFocalServiceConfig(node: ServiceNode): FocalServiceConfig {
  const { components, incidents } = node;

  if (components.length === 0) {
    return {
      name: node.name,
      scale: { typicalRps: node.typicalRps ?? 0 },
      trafficProfile: node.trafficProfile ?? "none",
      health: node.health ?? "healthy",
      incidentType: "",
      metrics: [],
    };
  }

  const entrypoint = findEntrypoint(components);
  const typicalRps = node.typicalRps ?? 0;

  // Collect (archetype → MetricConfig) in topological order.
  // First occurrence (closest to entrypoint) wins on archetype collision.
  const metricByArchetype = new Map<string, MetricConfig>();
  const overlaysByArchetype = new Map<string, OverlayApplication[]>();

  const path = propagationPath(entrypoint.id, components);
  for (const compId of path) {
    const component = components.find((c) => c.id === compId);
    if (!component) continue;

    const specs = COMPONENT_METRICS[component.type];
    for (const spec of specs) {
      const baseline = spec.deriveBaseline(component as never, typicalRps);
      const resolved = spec.resolvedValue(component as never, typicalRps);
      const ceiling = spec.ceiling(component as never);

      // Register metric config if not yet seen (entrypoint-closest wins)
      if (!metricByArchetype.has(spec.archetype)) {
        const criticalThreshold = deriveCriticalThreshold(
          spec.archetype,
          baseline,
          ceiling,
        );
        metricByArchetype.set(spec.archetype, {
          archetype: spec.archetype,
          baselineValue: baseline,
          resolvedValue: resolved,
          ...(criticalThreshold != null ? { criticalThreshold } : {}),
        });
        overlaysByArchetype.set(spec.archetype, []);
      }

      // Build overlay applications for each incident that propagates to this component
      for (const incident of incidents) {
        // Determine which components are in the blast radius based on direction
        const blastRadius = propagationPathForDirection(
          incident.affectedComponent,
          components,
          incident.propagationDirection,
        );
        if (!blastRadius.includes(compId)) continue;

        const lag = propagationLag(
          incident.affectedComponent,
          compId,
          components,
        );
        const laggedOnset = incident.onsetSecond + lag;

        const overlayApp = buildOverlayApplication(
          spec,
          component as never,
          baseline,
          incident,
          laggedOnset,
        );
        if (overlayApp) {
          overlaysByArchetype.get(spec.archetype)!.push(overlayApp);
        }
      }
    }
  }

  // Attach sorted overlay applications to each MetricConfig
  const metrics: MetricConfig[] = [];
  for (const [archetype, metricConfig] of metricByArchetype) {
    const overlays = (overlaysByArchetype.get(archetype) ?? []).sort(
      (a, b) => a.onsetSecond - b.onsetSecond,
    );
    metrics.push({ ...metricConfig, incidentResponses: overlays });
  }

  return {
    name: node.name,
    scale: { typicalRps },
    trafficProfile:
      node.trafficProfile ?? deriveTrafficProfile(entrypoint.type),
    health: node.health ?? "healthy",
    incidentType: "", // legacy field; not read after this phase
    metrics,
  };
}

function buildOverlayApplication(
  spec: {
    ceiling: (c: never) => number | null;
    overlayForIncident: (o: never) => string;
    incidentPeakValue: (b: number, m: number, c: never) => number;
  },
  component: never,
  baseline: number,
  incident: IncidentConfig,
  laggedOnset: number,
): OverlayApplication | null {
  const overlayType = spec.overlayForIncident(
    incident.onsetOverlay as never,
  ) as OverlayApplication["overlay"];
  if (overlayType === "none") return null;

  const ceiling = spec.ceiling(component) ?? baseline;
  const peakValue = spec.incidentPeakValue(
    baseline,
    incident.magnitude,
    component,
  );

  let dropFactor = 1.0;
  if (overlayType === "sudden_drop") {
    dropFactor = incident.magnitude;
  } else if (overlayType !== "saturation") {
    dropFactor = peakValue / Math.max(baseline, 0.001);
  }

  return {
    overlay: overlayType,
    onsetSecond: laggedOnset,
    endSecond: incident.endSecond,
    peakValue,
    dropFactor,
    ceiling,
    rampDurationSeconds: incident.rampDurationSeconds ?? 30,
    saturationDurationSeconds: 60,
  };
}

function deriveCorrelatedServiceConfigFromNode(
  node: ServiceNode,
): CorrelatedServiceConfig {
  if (node.components.length === 0) {
    return {
      name: node.name,
      correlation: node.correlation ?? "independent",
      lagSeconds: node.lagSeconds,
      impactFactor: node.impactFactor,
      health: node.health ?? "healthy",
    };
  }

  // Downstream node with components — derive its metrics too
  const focalConfig = deriveFocalServiceConfig(node);
  return {
    name: node.name,
    correlation: node.correlation ?? "independent",
    lagSeconds: node.lagSeconds,
    impactFactor: node.impactFactor,
    health: node.health ?? "healthy",
    scale: { typicalRps: node.typicalRps ?? 0 },
    overrides: focalConfig.metrics,
  };
}

// ── Component transform: Zod snake_case → TypeScript camelCase ────────────────

type RawComponent = ReturnType<
  typeof ScenarioSchema.parse
>["topology"]["focal_service"]["components"][number];

function transformComponent(c: RawComponent): ServiceComponent {
  switch (c.type) {
    case "load_balancer":
      return {
        id: c.id,
        label: c.label,
        inputs: c.inputs,
        type: "load_balancer",
      };
    case "api_gateway":
      return {
        id: c.id,
        label: c.label,
        inputs: c.inputs,
        type: "api_gateway",
      };
    case "ecs_cluster":
      return {
        id: c.id,
        label: c.label,
        inputs: c.inputs,
        type: "ecs_cluster",
        instanceCount: c.instance_count,
        utilization: c.utilization,
      };
    case "ec2_fleet":
      return {
        id: c.id,
        label: c.label,
        inputs: c.inputs,
        type: "ec2_fleet",
        instanceCount: c.instance_count,
        utilization: c.utilization,
      };
    case "lambda":
      return {
        id: c.id,
        label: c.label,
        inputs: c.inputs,
        type: "lambda",
        reservedConcurrency: c.reserved_concurrency,
        lambdaUtilization: c.lambda_utilization,
      };
    case "kinesis_stream":
      return {
        id: c.id,
        label: c.label,
        inputs: c.inputs,
        type: "kinesis_stream",
        shardCount: c.shard_count,
      };
    case "sqs_queue":
      return { id: c.id, label: c.label, inputs: c.inputs, type: "sqs_queue" };
    case "dynamodb":
      return {
        id: c.id,
        label: c.label,
        inputs: c.inputs,
        type: "dynamodb",
        writeCapacity: c.write_capacity,
        readCapacity: c.read_capacity,
        writeUtilization: c.write_utilization,
        readUtilization: c.read_utilization,
        billingMode: c.billing_mode,
      };
    case "rds":
      return {
        id: c.id,
        label: c.label,
        inputs: c.inputs,
        type: "rds",
        instanceCount: c.instance_count,
        maxConnections: c.max_connections,
        utilization: c.utilization,
        connectionUtilization: c.connection_utilization,
      };
    case "elasticache":
      return {
        id: c.id,
        label: c.label,
        inputs: c.inputs,
        type: "elasticache",
        instanceCount: c.instance_count,
        utilization: c.utilization,
      };
    case "s3":
      return { id: c.id, label: c.label, inputs: c.inputs, type: "s3" };
    case "scheduler":
      return { id: c.id, label: c.label, inputs: c.inputs, type: "scheduler" };
  }
}

type RawIncident = ReturnType<
  typeof ScenarioSchema.parse
>["topology"]["focal_service"]["incidents"][number];

function transformIncident(i: RawIncident): IncidentConfig {
  return {
    id: i.id,
    affectedComponent: i.affected_component,
    description: i.description,
    onsetOverlay: i.onset_overlay,
    onsetSecond: i.onset_second,
    magnitude: i.magnitude,
    rampDurationSeconds: i.ramp_duration_seconds,
    endSecond: i.end_second,
    propagationDirection: (i.propagation_direction ??
      "upstream") as PropagationDirection,
  };
}

type RawServiceNode = ReturnType<
  typeof ScenarioSchema.parse
>["topology"]["focal_service"];

function transformServiceNode(n: RawServiceNode): ServiceNode {
  return {
    name: n.name,
    description: n.description,
    owner: n.owner,
    typicalRps: n.typical_rps,
    trafficProfile: n.traffic_profile,
    health: n.health,
    correlation: n.correlation,
    lagSeconds: n.lag_seconds,
    impactFactor: n.impact_factor,
    components: n.components.map(transformComponent),
    incidents: n.incidents.map(transformIncident),
  };
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

  // Build topology + opsDashboard early so auto-alarm generation can use them
  const topology = {
    focalService: transformServiceNode(raw.topology.focal_service),
    upstream: raw.topology.upstream.map(transformServiceNode),
    downstream: raw.topology.downstream.map(transformServiceNode),
  };

  const opsDashboard = deriveOpsDashboard(
    topology.focalService,
    raw.timeline.pre_incident_seconds,
    raw.timeline.resolution_seconds,
    topology.downstream,
  );

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

  // Auto-generate alarms for every MetricConfig that has a criticalThreshold,
  // unless the author has already defined an alarm for that service+metric pair.
  const authoredAlarmKeys = new Set(
    alarms.map((a) => `${a.service}:${a.metricId}`),
  );
  for (const metric of opsDashboard.focalService.metrics) {
    if (metric.criticalThreshold == null) continue;
    const key = `${opsDashboard.focalService.name}:${metric.archetype}`;
    if (authoredAlarmKeys.has(key)) continue;
    alarms.push({
      id: `auto-${opsDashboard.focalService.name}-${metric.archetype}`,
      service: opsDashboard.focalService.name,
      metricId: metric.archetype,
      condition: `${metric.archetype} > ${metric.criticalThreshold}${metric.unit ? " " + metric.unit : ""}`,
      severity: "SEV2",
      threshold: metric.criticalThreshold,
      autoFire: true,
      autoPage: false,
    });
  }

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

  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    difficulty: raw.difficulty as Difficulty,
    tags: raw.tags,
    timeline: {
      defaultSpeed: raw.timeline.default_speed,
      durationMinutes: raw.timeline.duration_minutes,
      preIncidentSeconds: raw.timeline.pre_incident_seconds,
      resolutionSeconds: raw.timeline.resolution_seconds,
    },
    topology,
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
