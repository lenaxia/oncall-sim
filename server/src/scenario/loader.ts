// loader.ts — orchestrates scenario loading: read YAML, Zod parse,
// cross-reference validation, file reference resolution, and camelCase transform.
// Metric generation is NOT called here — deferred to session start (LLD 06).

import path from 'path'
import fs from 'fs'
import fsPromises from 'fs/promises'
import yaml from 'js-yaml'
import { ScenarioSchema } from './schema'
import { validateCrossReferences, type ValidationError } from './validator'
import { validateIncidentType } from '../metrics/resolver'
import { logger } from '../logger'

const log = logger.child({ component: 'loader' })

import type {
  LoadedScenario, ServiceType, Difficulty, PersonaConfig, AlarmConfig,
  RemediationActionConfig, ScriptedEmail, ChatConfig, ScriptedTicket,
  ScriptedLogEntry, WikiConfig, CICDConfig, OpsDashboardConfig,
  FocalServiceConfig, CorrelatedServiceConfig, MetricConfig, EvaluationConfig,
  ScriptedChatMessage, ScriptedDeployment,
} from './types'

// ── Public data types ─────────────────────────────────────────────────────────

export interface ScenarioSummary {
  id:          string
  title:       string
  description: string
  serviceType: ServiceType
  difficulty:  Difficulty
  tags:        string[]
}

export interface ScenarioLoadError {
  scenarioId:  string
  scenarioDir: string
  errors:      ValidationError[]
}

export function isScenarioLoadError(
  result: LoadedScenario | ScenarioLoadError
): result is ScenarioLoadError {
  return 'errors' in result && Array.isArray(result.errors)
}

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Loads all scenarios from scenariosDir.
 * Skips _fixture/. Invalid scenarios are logged and excluded — never throws.
 */
export async function loadAllScenarios(
  scenariosDir: string
): Promise<Map<string, LoadedScenario>> {
  const map = new Map<string, LoadedScenario>()

  let entries: fs.Dirent[]
  try {
    entries = await fsPromises.readdir(scenariosDir, { withFileTypes: true })
  } catch {
    log.warn({ scenariosDir }, 'Scenarios directory not found or unreadable')
    return map
  }

  const subdirs = entries
    .filter(e => e.isDirectory() && e.name !== '_fixture')
    .map(e => path.join(scenariosDir, e.name))

  for (const dir of subdirs) {
    const result = await loadScenario(dir)
    if (isScenarioLoadError(result)) {
      log.error({ scenarioId: result.scenarioId, scenarioDir: result.scenarioDir, errors: result.errors }, 'Scenario failed validation — excluded')
    } else {
      const metricCount = Object.values(result.opsDashboard.focalService.metrics).length
      log.info({ scenarioId: result.id, metrics: metricCount }, 'Scenario loaded')
      map.set(result.id, result)
    }
  }

  return map
}

/**
 * Loads and validates a single scenario directory.
 * Returns LoadedScenario if valid, ScenarioLoadError if not.
 * Never throws.
 */
export async function loadScenario(
  scenarioDir: string
): Promise<LoadedScenario | ScenarioLoadError> {
  const scenarioYaml = path.join(scenarioDir, 'scenario.yaml')

  // Step 1: Read scenario.yaml
  let rawContent: string
  try {
    rawContent = await fsPromises.readFile(scenarioYaml, 'utf8')
  } catch {
    return {
      scenarioId:  path.basename(scenarioDir),
      scenarioDir,
      errors: [{
        scenarioId:  path.basename(scenarioDir),
        field:       'scenario.yaml',
        message:     `scenario.yaml not found in ${scenarioDir}`,
      }],
    }
  }

  // Step 2: Parse YAML
  let rawObject: unknown
  try {
    rawObject = yaml.load(rawContent)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      scenarioId:  path.basename(scenarioDir),
      scenarioDir,
      errors: [{
        scenarioId: path.basename(scenarioDir),
        field:      'scenario.yaml',
        message:    `YAML parse error: ${msg}`,
      }],
    }
  }

  // Step 3: Zod schema parse
  const zodResult = ScenarioSchema.safeParse(rawObject)
  if (!zodResult.success) {
    const errors: ValidationError[] = zodResult.error.issues.map(issue => ({
      scenarioId:  path.basename(scenarioDir),
      field:       issue.path.join('.'),
      message:     issue.message,
    }))
    return { scenarioId: path.basename(scenarioDir), scenarioDir, errors }
  }
  const raw = zodResult.data

  // Step 4: ops_dashboard_file merging
  // Per LLD §3: if both are present, return error immediately (mutually exclusive)
  if (raw.ops_dashboard && raw.ops_dashboard_file) {
    return {
      scenarioId: raw.id,
      scenarioDir,
      errors: [{
        scenarioId: raw.id,
        field:      'ops_dashboard_file',
        message:    'ops_dashboard and ops_dashboard_file are mutually exclusive — provide one or the other, not both.',
      }],
    }
  }

  if (raw.ops_dashboard_file && !raw.ops_dashboard) {
    const metricsPath = path.resolve(scenarioDir, raw.ops_dashboard_file)
    const normalDir   = path.resolve(scenarioDir)
    if (!metricsPath.startsWith(normalDir + path.sep)) {
      return {
        scenarioId: raw.id,
        scenarioDir,
        errors: [{
          scenarioId: raw.id,
          field:      'ops_dashboard_file',
          message:    `ops_dashboard_file path traversal rejected: '${raw.ops_dashboard_file}'`,
        }],
      }
    }
    let metricsContent: string
    try {
      metricsContent = await fsPromises.readFile(metricsPath, 'utf8')
    } catch {
      return {
        scenarioId: raw.id,
        scenarioDir,
        errors: [{
          scenarioId: raw.id,
          field:      'ops_dashboard_file',
          message:    `ops_dashboard_file '${raw.ops_dashboard_file}' not found`,
        }],
      }
    }
    const metricsObj = yaml.load(metricsContent)
    ;(raw as Record<string, unknown>)['ops_dashboard'] = metricsObj
    // Clear the file reference so the validator's mutual-exclusion check sees only ops_dashboard
    ;(raw as Record<string, unknown>)['ops_dashboard_file'] = undefined
  }

  // Step 5: Cross-reference validation
  const crossRefErrors = validateCrossReferences(raw, scenarioDir)
  if (crossRefErrors.length > 0) {
    return { scenarioId: raw.id, scenarioDir, errors: crossRefErrors }
  }

  // Step 6: incident_type warning for unrecognized values
  if (raw.ops_dashboard) {
    const incidentType = raw.ops_dashboard.focal_service.incident_type
    if (!validateIncidentType(incidentType)) {
      log.warn({ scenarioId: raw.id, incidentType }, 'incident_type not in registry — Tier 1 metrics will have no incident overlay')
    }
  }

  // Step 7: Transform raw config → LoadedScenario
  try {
    const loaded = await transform(raw, scenarioDir)
    return loaded
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      scenarioId: raw.id,
      scenarioDir,
      errors: [{
        scenarioId: raw.id,
        field:      'transform',
        message:    `Transform error: ${msg}`,
      }],
    }
  }
}

/**
 * Returns a scenario summary for the GET /api/scenarios list endpoint.
 */
export function toScenarioSummary(scenario: LoadedScenario): ScenarioSummary {
  return {
    id:          scenario.id,
    title:       scenario.title,
    description: scenario.description,
    serviceType: scenario.serviceType,
    difficulty:  scenario.difficulty,
    tags:        scenario.tags,
  }
}

// ── Transform: raw (Zod output) → LoadedScenario (camelCase) ─────────────────

async function transform(
  raw: ReturnType<typeof ScenarioSchema.parse>,
  scenarioDir: string
): Promise<LoadedScenario> {
  // Helper: resolve a file reference to string content
  async function resolveContent(
    inlineContent: string | undefined,
    fileRef: string | undefined,
    fieldPath: string
  ): Promise<string> {
    if (inlineContent) return inlineContent
    if (!fileRef) return ''
    const resolved = path.resolve(scenarioDir, fileRef)
    const normalDir = path.resolve(scenarioDir)
    if (!resolved.startsWith(normalDir + path.sep)) {
      throw new Error(`Path traversal rejected for ${fieldPath}: '${fileRef}'`)
    }
    return fsPromises.readFile(resolved, 'utf8')
  }

  // Emails
  const emails: ScriptedEmail[] = await Promise.all(
    raw.email.map(async (e, i) => ({
      id:       e.id,
      atSecond: e.at_second,
      threadId: e.thread_id,
      from:     e.from,
      to:       e.to,
      subject:  e.subject,
      body:     await resolveContent(e.body, e.body_file, `email[${i}].body_file`),
    }))
  )

  // Chat
  const chat: ChatConfig = {
    channels: raw.chat.channels.map(ch => ({ id: ch.id, name: ch.name })),
    messages: (raw.chat.messages ?? []).map((m): ScriptedChatMessage => ({
      id:       m.id,
      atSecond: m.at_second,
      channel:  m.channel,
      persona:  m.persona,
      text:     m.text,
    })),
  }

  // Tickets
  const tickets: ScriptedTicket[] = await Promise.all(
    raw.ticketing.map(async (t, i) => ({
      id:          t.id,
      title:       t.title,
      severity:    t.severity,
      status:      t.status,
      description: await resolveContent(t.description, t.description_file, `ticketing[${i}].description_file`),
      createdBy:   t.created_by,
      assignee:    t.assignee ?? 'trainee',
      atSecond:    t.at_second,
    }))
  )

  // Alarms
  const alarms: AlarmConfig[] = raw.alarms.map(a => ({
    id:           a.id,
    service:      a.service,
    metricId:     a.metric_id,
    condition:    a.condition,
    severity:     a.severity,
    threshold:    a.threshold,
    autoFire:     a.auto_fire ?? true,
    onsetSecond:  a.onset_second,
    autoPage:     a.auto_page  ?? false,
    pageMessage:  a.page_message,
  }))

  // Logs
  const logs: ScriptedLogEntry[] = raw.logs.map(l => ({
    id:       l.id,
    atSecond: l.at_second,
    level:    l.level,
    service:  l.service,
    message:  l.message,
  }))

  // Wiki
  const wiki: WikiConfig = {
    pages: await Promise.all(
      raw.wiki.pages.map(async (p, i) => ({
        title:   p.title,
        content: await resolveContent(p.content, p.content_file, `wiki.pages[${i}].content_file`),
      }))
    ),
  }

  // CICD
  const cicd: CICDConfig = {
    pipelines: (raw.cicd.pipelines ?? []).map(p => ({
      id:      p.id,
      name:    p.name,
      service: p.service,
      stages:  (p.stages ?? []).map((s): import('../scenario/types').PipelineStageConfig => ({
        id:              s.id,
        name:            s.name,
        type:            s.type,
        currentVersion:  s.current_version,
        previousVersion: s.previous_version ?? null,
        status:          s.status,
        deployedAtSec:   s.deployed_at_sec,
        commitMessage:   s.commit_message,
        author:          s.author,
        blockers:        (s.blockers ?? []).map(b => ({
          type:    b.type,
          alarmId: b.alarm_id,
          message: b.message,
        })),
        alarmWatches:    s.alarm_watches ?? [],
        tests:           (s.tests ?? []).map(t => ({
          name: t.name, status: t.status, url: t.url, note: t.note,
        })),
        promotionEvents: (s.promotion_events ?? []).map(e => ({
          version: e.version, simTime: e.sim_time, status: e.status, note: e.note,
        })),
      })),
    })),
    deployments: (raw.cicd.deployments ?? []).map((d): ScriptedDeployment => ({
      service:       d.service,
      version:       d.version,
      deployedAtSec: d.deployed_at_sec,
      status:        d.status,
      commitMessage: d.commit_message,
      author:        d.author,
    })),
  }

  // Personas
  const personas: PersonaConfig[] = raw.personas.map(p => ({
    id:                   p.id,
    displayName:          p.display_name,
    jobTitle:             p.job_title,
    team:                 p.team,
    avatarColor:          p.avatar_color,
    initiatesContact:     p.initiates_contact,
    cooldownSeconds:      p.cooldown_seconds,
    silentUntilContacted: p.silent_until_contacted,
    systemPrompt:         p.system_prompt,
  }))

  // Remediation actions
  const remediationActions: RemediationActionConfig[] = raw.remediation_actions.map(r => ({
    id:            r.id,
    type:          r.type,
    service:       r.service,
    isCorrectFix:  r.is_correct_fix,
    sideEffect:    r.side_effect,
    targetVersion: r.target_version,
  }))

  // Evaluation
  const evaluation: EvaluationConfig = {
    rootCause:       raw.evaluation.root_cause,
    relevantActions: raw.evaluation.relevant_actions.map(a => ({
      action:                a.action,
      why:                   a.why,
      service:               a.service,
      remediationActionId:   a.remediation_action_id,
    })),
    redHerrings: raw.evaluation.red_herrings.map(a => ({
      action: a.action,
      why:    a.why,
    })),
    debriefContext: raw.evaluation.debrief_context,
  }

  // OpsDashboard — transform the already-merged raw.ops_dashboard
  const rawOps = raw.ops_dashboard!
  const opsDashboard: OpsDashboardConfig = {
    preIncidentSeconds: rawOps.pre_incident_seconds,
    resolutionSeconds:  rawOps.resolution_seconds,
    focalService: transformFocalService(rawOps.focal_service),
    correlatedServices: (rawOps.correlated_services ?? []).map(transformCorrelatedService),
  }

  return {
    id:                 raw.id,
    title:              raw.title,
    description:        raw.description,
    serviceType:        raw.service_type,
    difficulty:         raw.difficulty,
    tags:               raw.tags,
    timeline: {
      defaultSpeed:    raw.timeline.default_speed,
      durationMinutes: raw.timeline.duration_minutes,
    },
    topology: {
      focalService: raw.topology.focal_service,
      upstream:     raw.topology.upstream,
      downstream:   raw.topology.downstream,
    },
    engine: {
      tickIntervalSeconds: raw.engine.tick_interval_seconds,
      defaultTab:          raw.engine.default_tab ?? 'email',
      llmEventTools: (raw.engine.llm_event_tools ?? []).map(t => ({
        tool:           t.tool,
        enabled:        t.enabled,
        maxCalls:       t.max_calls,
        requiresAction: t.requires_action,
        services:       t.services,
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
    evaluation,
  }
}

function transformMetric(m: {
  archetype: string
  label?: string
  unit?: string
  baseline_value?: number
  warning_threshold?: number
  critical_threshold?: number
  noise?: 'low' | 'medium' | 'high' | 'extreme'
  incident_peak?: number
  onset_second?: number
  incident_response?: {
    overlay: string
    onset_second?: number
    peak_value?: number
    drop_factor?: number
    ramp_duration_seconds?: number
    saturation_duration_seconds?: number
  }
  series_override?: Array<{ t: number; v: number }>
}): MetricConfig {
  return {
    archetype:          m.archetype,
    label:              m.label,
    unit:               m.unit,
    baselineValue:      m.baseline_value,
    warningThreshold:   m.warning_threshold,
    criticalThreshold:  m.critical_threshold,
    noise:              m.noise,
    incidentPeak:       m.incident_peak,
    onsetSecond:        m.onset_second,
    incidentResponse:   m.incident_response ? {
      overlay:                    m.incident_response.overlay,
      onsetSecond:                m.incident_response.onset_second,
      peakValue:                  m.incident_response.peak_value,
      dropFactor:                 m.incident_response.drop_factor,
      rampDurationSeconds:        m.incident_response.ramp_duration_seconds,
      saturationDurationSeconds:  m.incident_response.saturation_duration_seconds,
    } : undefined,
    seriesOverride:     m.series_override,
  }
}

function transformFocalService(focal: {
  name: string
  scale: { typical_rps: number; instance_count?: number; max_connections?: number }
  traffic_profile: string
  health: 'healthy' | 'degraded' | 'flaky'
  incident_type: string
  metrics: Array<{
    archetype: string
    label?: string
    unit?: string
    baseline_value?: number
    warning_threshold?: number
    critical_threshold?: number
    noise?: 'low' | 'medium' | 'high' | 'extreme'
    incident_peak?: number
    onset_second?: number
    incident_response?: {
      overlay: string
      onset_second?: number
      peak_value?: number
      drop_factor?: number
      ramp_duration_seconds?: number
      saturation_duration_seconds?: number
    }
    series_override?: Array<{ t: number; v: number }>
  }>
}): FocalServiceConfig {
  return {
    name:           focal.name,
    scale: {
      typicalRps:     focal.scale.typical_rps,
      instanceCount:  focal.scale.instance_count,
      maxConnections: focal.scale.max_connections,
    },
    trafficProfile: focal.traffic_profile as FocalServiceConfig['trafficProfile'],
    health:         focal.health,
    incidentType:   focal.incident_type,
    metrics:        focal.metrics.map(transformMetric),
  }
}

function transformCorrelatedService(cs: {
  name: string
  correlation: 'upstream_impact' | 'exonerated' | 'independent'
  lag_seconds?: number
  impact_factor?: number
  health: 'healthy' | 'degraded' | 'flaky'
  overrides?: Array<{
    archetype: string
    label?: string
    unit?: string
    baseline_value?: number
    warning_threshold?: number
    critical_threshold?: number
    noise?: 'low' | 'medium' | 'high' | 'extreme'
    incident_peak?: number
    onset_second?: number
    incident_response?: {
      overlay: string
      onset_second?: number
      peak_value?: number
      drop_factor?: number
      ramp_duration_seconds?: number
      saturation_duration_seconds?: number
    }
    series_override?: Array<{ t: number; v: number }>
  }>
}): CorrelatedServiceConfig {
  return {
    name:         cs.name,
    correlation:  cs.correlation,
    lagSeconds:   cs.lag_seconds,
    impactFactor: cs.impact_factor,
    health:       cs.health,
    overrides:    (cs.overrides ?? []).map(transformMetric),
  }
}
