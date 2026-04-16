import { z } from "zod";
import { LOG_PROFILES } from "./log-profiles";

// ── Schema versioning ─────────────────────────────────────────────────────────
//
// Bump SCENARIO_SCHEMA_VERSION whenever a breaking change is made to the
// scenario YAML format (field renamed, required field added, enum value
// removed, etc.). Scenario YAMLs must declare `schema_version: N` at the
// top level. The loader rejects any YAML whose version doesn't match.
//
// Non-breaking additions (new optional fields, new enum values) do NOT
// require a version bump — existing YAMLs will continue to parse correctly.
//
// When bumping: update this constant, add a migration note below, and update
// all bundled scenario YAMLs.
//
// Version history:
//   1 — initial versioned schema (2026-04-16)
export const SCENARIO_SCHEMA_VERSION = 1;

export const PersonaSchema = z.object({
  id: z.string().min(1),
  display_name: z.string().min(1),
  job_title: z.string().min(1),
  team: z.string().min(1),
  avatar_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  initiates_contact: z.boolean(),
  cooldown_seconds: z.number().positive(),
  silent_until_contacted: z.boolean(),
  system_prompt: z.string().min(1),
});

export const AlarmConfigSchema = z.object({
  id: z.string().min(1),
  service: z.string().min(1),
  metric_id: z.string().min(1),
  condition: z.string().min(1),
  severity: z.enum(["SEV1", "SEV2", "SEV3", "SEV4"]),
  threshold: z.number().optional(),
  auto_fire: z.boolean().optional().default(true),
  onset_second: z.number().optional(),
  auto_page: z.boolean().optional().default(false),
  page_message: z.string().optional(),
});

export const ThrottleTargetSchema = z.object({
  id: z.string().min(1),
  scope: z.enum(["endpoint", "customer", "consumer", "concurrent", "global"]),
  label: z.string().min(1),
  description: z.string().min(1),
  llm_hint: z.string().optional(),
  unit: z.enum(["rps", "msg_per_sec", "concurrent"]),
  baseline_rate: z.number().positive(),
});

export const RemediationActionSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "rollback",
    "roll_forward",
    "restart_service",
    "scale_cluster",
    "throttle_traffic",
    "emergency_deploy",
    "toggle_feature_flag",
  ]),
  service: z.string().min(1),
  is_correct_fix: z.boolean(),
  side_effect: z.string().optional(),
  target_version: z.string().optional(),
  target_stage: z.string().optional(),
  flag_id: z.string().optional(),
  flag_enabled: z.boolean().optional(),
  label: z.string().optional(),
  throttle_targets: z.array(ThrottleTargetSchema).optional(),
});

export const EvaluationSchema = z.object({
  root_cause: z.string().min(1),
  relevant_actions: z.array(
    z.object({
      action: z.string().min(1),
      why: z.string().min(1),
      service: z.string().optional(),
      remediation_action_id: z.string().optional(),
    }),
  ),
  red_herrings: z.array(
    z.object({
      action: z.string().min(1),
      why: z.string().min(1),
    }),
  ),
  debrief_context: z.string().min(1),
});

export const MetricConfigSchema = z.object({
  archetype: z.string().min(1),
  label: z.string().optional(),
  unit: z.string().optional(),
  baseline_value: z.number().optional(),
  warning_threshold: z.number().optional(),
  critical_threshold: z.number().optional(),
  noise: z.enum(["low", "medium", "high", "extreme"]).optional(),
  incident_peak: z.number().optional(),
  onset_second: z.number().optional(),
  resolved_value: z.number().min(0).optional(),
  incident_response: z
    .object({
      overlay: z.string().min(1),
      onset_second: z.number().optional(),
      peak_value: z.number().optional(),
      drop_factor: z.number().optional(),
      ramp_duration_seconds: z.number().optional(),
      saturation_duration_seconds: z.number().optional(),
    })
    .optional(),
  series_override: z
    .array(z.object({ t: z.number(), v: z.number() }))
    .optional(),
});

export const LLMEventToolNameEnum = z.enum([
  "select_metric_reaction",
  "apply_metric_response",
  "fire_alarm",
  "silence_alarm",
  "inject_log_entry",
  "trigger_cascade",
]);

export const LLMEventToolSchema = z.object({
  tool: LLMEventToolNameEnum,
  enabled: z.boolean().optional(),
  max_calls: z.number().positive().optional(),
  services: z.array(z.string()).optional(),
});

export const EngineSchema = z.object({
  llm_event_tools: z.array(LLMEventToolSchema).optional().default([]),
  default_tab: z
    .enum(["email", "chat", "tickets", "ops", "logs", "wiki", "cicd"])
    .optional(),
});

export const ScriptedEmailSchema = z.object({
  id: z.string().min(1),
  at_second: z.number(),
  thread_id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().optional(),
  body_file: z.string().optional(),
});

export const ChatChannelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export const ScriptedChatMessageSchema = z.object({
  id: z.string().min(1),
  at_second: z.number(),
  channel: z.string().min(1),
  persona: z.string().min(1),
  text: z.string().min(1),
});
export const ChatSchema = z.object({
  channels: z.array(ChatChannelSchema),
  messages: z.array(ScriptedChatMessageSchema).optional().default([]),
});

export const TicketSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  severity: z.enum(["SEV1", "SEV2", "SEV3", "SEV4"]),
  status: z.enum(["open", "in_progress", "resolved"]),
  description: z.string().optional(),
  description_file: z.string().optional(),
  created_by: z.string().min(1),
  assignee: z.string().optional(),
  at_second: z.number(),
});

export const ScriptedLogSchema = z.object({
  id: z.string().min(1),
  at_second: z.number(),
  level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]),
  service: z.string().min(1),
  message: z.string().min(1),
});

export const LogPatternSchema = z.object({
  id: z.string().min(1),
  level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]),
  service: z.string().min(1),
  message: z.string().min(1),
  interval_seconds: z.number().positive(),
  from_second: z.number(),
  to_second: z.number(),
  count: z.number().positive().optional(),
  jitter_seconds: z.number().min(0).optional(),
  seed: z.number().int().optional(),
});

export const BackgroundLogsSchema = z.object({
  profile: z.enum(Object.keys(LOG_PROFILES) as [string, ...string[]]),
  service: z.string().min(1),
  from_second: z.number(),
  to_second: z.number(),
  density: z.enum(["low", "medium", "high"]).optional().default("medium"),
  seed: z.number().int().optional(),
});

export const WikiPageSchema = z.object({
  title: z.string().min(1),
  content: z.string().optional(),
  content_file: z.string().optional(),
});
export const WikiSchema = z.object({ pages: z.array(WikiPageSchema) });

export const StageBlockerSchema = z.object({
  type: z.enum(["alarm", "time_window", "manual_approval", "test_failure"]),
  alarm_id: z.string().optional(),
  message: z.string().optional(),
});
export const StageTestSchema = z.object({
  name: z.string().min(1),
  status: z.enum(["pending", "running", "passed", "failed", "skipped"]),
  url: z.string().optional(),
  note: z.string().optional(),
});
export const PromotionEventSchema = z.object({
  version: z.string().min(1),
  sim_time: z.number(),
  status: z.enum(["succeeded", "failed", "blocked"]),
  note: z.string().min(1),
});
export const PipelineStageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["build", "deploy"]),
  current_version: z.string().min(1),
  previous_version: z.string().nullable().optional(),
  status: z.enum([
    "not_started",
    "in_progress",
    "succeeded",
    "failed",
    "blocked",
  ]),
  deployed_at_sec: z.number(),
  commit_message: z.string().min(1),
  author: z.string().min(1),
  blockers: z.array(StageBlockerSchema).optional().default([]),
  alarm_watches: z.array(z.string()).optional().default([]),
  tests: z.array(StageTestSchema).optional().default([]),
  promotion_events: z.array(PromotionEventSchema).optional().default([]),
});
export const PipelineSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  service: z.string().min(1),
  stages: z.array(PipelineStageSchema).min(1),
});
export const DeploymentSchema = z.object({
  service: z.string().min(1),
  version: z.string().min(1),
  deployed_at_sec: z.number(),
  status: z.enum(["active", "previous", "rolled_back"]),
  commit_message: z.string().min(1),
  author: z.string().min(1),
});
export const CICDSchema = z.object({
  pipelines: z.array(PipelineSchema).optional().default([]),
  deployments: z.array(DeploymentSchema).optional().default([]),
});

export const FeatureFlagSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  default_on: z.boolean().optional().default(false),
  description: z.string().optional(),
});
export const HostGroupSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  service: z.string().min(1),
  instance_count: z.number().int().positive(),
  description: z.string().optional(),
});

// ── Component schema — discriminated union ────────────────────────────────────

const ComponentBaseSchema = {
  id: z.string().min(1),
  label: z.string().min(1),
  inputs: z.array(z.string()),
};

export const ComponentSchema = z.discriminatedUnion("type", [
  z.object({ ...ComponentBaseSchema, type: z.literal("load_balancer") }),
  z.object({ ...ComponentBaseSchema, type: z.literal("api_gateway") }),
  z.object({
    ...ComponentBaseSchema,
    type: z.literal("ecs_cluster"),
    instance_count: z.number().int().positive(),
    utilization: z.number().min(0).max(1),
  }),
  z.object({
    ...ComponentBaseSchema,
    type: z.literal("ec2_fleet"),
    instance_count: z.number().int().positive(),
    utilization: z.number().min(0).max(1),
  }),
  z.object({
    ...ComponentBaseSchema,
    type: z.literal("lambda"),
    reserved_concurrency: z.number().int().positive(),
    lambda_utilization: z.number().min(0).max(1),
  }),
  z.object({
    ...ComponentBaseSchema,
    type: z.literal("kinesis_stream"),
    shard_count: z.number().int().positive(),
  }),
  z.object({ ...ComponentBaseSchema, type: z.literal("sqs_queue") }),
  z.object({
    ...ComponentBaseSchema,
    type: z.literal("dynamodb"),
    write_capacity: z.number().int().positive(),
    read_capacity: z.number().int().positive(),
    write_utilization: z.number().min(0).max(1),
    read_utilization: z.number().min(0).max(1),
    billing_mode: z.enum(["provisioned", "on_demand"]).default("provisioned"),
  }),
  z.object({
    ...ComponentBaseSchema,
    type: z.literal("rds"),
    instance_count: z.number().int().positive(),
    max_connections: z.number().int().positive(),
    utilization: z.number().min(0).max(1),
    connection_utilization: z.number().min(0).max(1),
  }),
  z.object({
    ...ComponentBaseSchema,
    type: z.literal("elasticache"),
    instance_count: z.number().int().positive(),
    utilization: z.number().min(0).max(1),
  }),
  z.object({ ...ComponentBaseSchema, type: z.literal("s3") }),
  z.object({ ...ComponentBaseSchema, type: z.literal("scheduler") }),
]);

// ── Incident schema ───────────────────────────────────────────────────────────

export const IncidentConfigSchema = z
  .object({
    id: z.string().min(1),
    affected_component: z.string().min(1),
    description: z.string().min(1),
    onset_overlay: z.enum([
      "spike_and_sustain",
      "gradual_degradation",
      "saturation",
      "sudden_drop",
    ]),
    onset_second: z.number(),
    magnitude: z.number().min(0),
    ramp_duration_seconds: z.number().min(0).optional(),
    end_second: z.number().optional(),
    /**
     * Direction the incident blast radius propagates through the component graph.
     *   upstream   — callers of the affected component feel the impact
     *                (e.g. DB pool exhaustion: ECS service calling postgres degrades)
     *   downstream — dependencies of the affected component are flooded
     *                (e.g. DDoS on ALB: backend ECS/DB gets flooded)
     *   both       — propagates in both directions
     *                (e.g. cache stampede: DB downstream gets flooded AND service upstream slows)
     * Defaults to "upstream" — the most common case for backend-origin incidents.
     */
    propagation_direction: z
      .enum(["upstream", "downstream", "both"])
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.onset_overlay === "saturation" && val.magnitude > 1.0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `saturation magnitude must be ≤ 1.0 (got ${val.magnitude}); use spike_and_sustain for values > 1`,
        path: ["magnitude"],
      });
    }
    if (val.onset_overlay === "sudden_drop" && val.magnitude >= 1.0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `sudden_drop magnitude must be < 1.0 (got ${val.magnitude}); it is the fraction the metric drops TO`,
        path: ["magnitude"],
      });
    }
    // For all overlays except sudden_drop, magnitude must be > 0
    if (val.onset_overlay !== "sudden_drop" && val.magnitude <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `magnitude must be > 0 for ${val.onset_overlay} (got ${val.magnitude})`,
        path: ["magnitude"],
      });
    }
  });

// ── ServiceNode schema ────────────────────────────────────────────────────────

export const ServiceNodeSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  owner: z.string().optional(),
  typical_rps: z.number().positive().optional(),
  traffic_profile: z
    .enum([
      "business_hours_web",
      "business_hours_b2b",
      "always_on_api",
      "batch_nightly",
      "batch_weekly",
      "none",
    ])
    .optional(),
  health: z.enum(["healthy", "degraded", "flaky"]).optional(),
  correlation: z
    .enum(["upstream_impact", "exonerated", "independent"])
    .optional(),
  lag_seconds: z.number().optional(),
  impact_factor: z.number().min(0).max(1).optional(),
  components: z.array(ComponentSchema).optional().default([]),
  incidents: z.array(IncidentConfigSchema).optional().default([]),
});

// ── Topology schema ───────────────────────────────────────────────────────────

export const TopologySchema = z.object({
  focal_service: ServiceNodeSchema,
  upstream: z.array(ServiceNodeSchema).optional().default([]),
  downstream: z.array(ServiceNodeSchema).optional().default([]),
});

// ── Timeline schema ───────────────────────────────────────────────────────────

export const TimelineSchema = z.object({
  default_speed: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(5),
    z.literal(10),
  ]),
  duration_minutes: z.number().positive(),
  pre_incident_seconds: z.number().positive().optional().default(43200), // defaults to 12h
});

// ── Root scenario schema ──────────────────────────────────────────────────────

export const ScenarioSchema = z.object({
  schema_version: z.literal(SCENARIO_SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  tags: z.array(z.string()),
  timeline: TimelineSchema,
  topology: TopologySchema,
  engine: EngineSchema,
  email: z.array(ScriptedEmailSchema),
  chat: ChatSchema,
  ticketing: z.array(TicketSchema),
  alarms: z.array(AlarmConfigSchema),
  logs: z.array(ScriptedLogSchema).optional().default([]),
  log_patterns: z.array(LogPatternSchema).optional().default([]),
  background_logs: z.array(BackgroundLogsSchema).optional().default([]),
  wiki: WikiSchema,
  cicd: CICDSchema,
  personas: z.array(PersonaSchema),
  remediation_actions: z.array(RemediationActionSchema),
  feature_flags: z.array(FeatureFlagSchema).optional().default([]),
  host_groups: z.array(HostGroupSchema).optional().default([]),
  evaluation: EvaluationSchema,
  // Legacy fields kept as passthrough so old YAML files don't hard-fail at parse
  // time — the validator emits a warning if ops_dashboard is present.
  ops_dashboard: z.unknown().optional(),
  ops_dashboard_file: z.string().optional(),
});

export type RawScenarioConfig = z.infer<typeof ScenarioSchema>;

// ── Schema reference for LLM prompt generation ───────────────────────────────

/**
 * Generates the authoritative schema reference string for the scenario builder
 * LLM prompt. Derived directly from the Zod schemas above so it never goes
 * stale when fields, enums, or component types change.
 */
export function buildSchemaReference(): string {
  const componentTypes = ComponentSchema.options.map((o) => {
    const shape = o.shape as Record<string, z.ZodTypeAny>;
    const typeVal = (shape.type as z.ZodLiteral<string>).value;
    const extras = Object.entries(shape)
      .filter(([k]) => !["id", "label", "inputs", "type"].includes(k))
      .map(([k, v]) => {
        const isOpt = v instanceof z.ZodOptional || v instanceof z.ZodDefault;
        const inner = isOpt
          ? (v as z.ZodOptional<z.ZodTypeAny> | z.ZodDefault<z.ZodTypeAny>)._def
              .innerType
          : v;
        let typeName = "unknown";
        if (inner instanceof z.ZodNumber) {
          typeName = inner._def.checks.some(
            (c: z.ZodNumberCheck) => c.kind === "int",
          )
            ? "int"
            : "float";
        } else if (inner instanceof z.ZodEnum) {
          typeName = inner.options.map((o: string) => `"${o}"`).join("|");
        }
        return `${k}: ${typeName}${isOpt ? "?" : ""}`;
      });
    return { typeVal, extras };
  });

  const simpleTypes = componentTypes
    .filter((c) => c.extras.length === 0)
    .map((c) => `  type: "${c.typeVal}"  → no extra fields`)
    .join("\n");

  const complexTypes = componentTypes
    .filter((c) => c.extras.length > 0)
    .map((c) => `  type: "${c.typeVal}"  → ${c.extras.join(", ")}`)
    .join("\n");

  const onsetOverlays = IncidentConfigSchema._def.schema.shape.onset_overlay
    .options as string[];

  const remediationTypes = RemediationActionSchema.shape.type
    .options as string[];

  const alarmSeverities = AlarmConfigSchema.shape.severity.options as string[];

  const ticketSeverities = TicketSchema.shape.severity.options as string[];
  const ticketStatuses = TicketSchema.shape.status.options as string[];

  const logLevels = ScriptedLogSchema.shape.level.options as string[];

  const difficultyVals = ScenarioSchema.shape.difficulty.options as string[];

  const speedVals = TimelineSchema.shape.default_speed.options.map(
    (o: z.ZodLiteral<number>) => o.value,
  );

  const bgLogProfiles = BackgroundLogsSchema.shape.profile.options as string[];
  // density is z.enum(...).optional().default(...) — extract values directly
  const bgLogDensities = ["low", "medium", "high"] as const;

  const trafficProfiles = ServiceNodeSchema.shape.traffic_profile._def.innerType
    .options as string[];

  const propagationDirs = IncidentConfigSchema._def.schema.shape
    .propagation_direction._def.innerType.options as string[];

  const pipelineStageStatuses = PipelineStageSchema.shape.status
    .options as string[];
  const pipelineStageTypes = PipelineStageSchema.shape.type.options as string[];
  const deploymentStatuses = DeploymentSchema.shape.status.options as string[];

  // engine.default_tab valid values — extracted from the optional enum wrapper
  const defaultTabVals = (
    EngineSchema.shape.default_tab._def as {
      innerType: z.ZodEnum<[string, ...string[]]>;
    }
  ).innerType.options;

  return `\
═══════════════════════════════════════════════════════════════
EXACT SCHEMA — use these field names and types precisely
═══════════════════════════════════════════════════════════════

── TOP-LEVEL FIELDS ──────────────────────────────────────────
schema_version: ${SCENARIO_SCHEMA_VERSION}   ← REQUIRED, must be exactly this number
id: string (slug, e.g. "order-api-cascade")
title: string
description: string
difficulty: ${difficultyVals.map((v) => `"${v}"`).join(" | ")}
tags: string[]
timeline: { default_speed: ${speedVals.join("|")}, duration_minutes: number }
topology: { focal_service: ServiceNode, upstream: ServiceNode[], downstream: ServiceNode[] }
engine: { llm_event_tools: [], default_tab?: ${defaultTabVals.map((v) => `"${v}"`).join(" | ")} }
personas: Persona[]
remediation_actions: RemediationAction[]
evaluation: Evaluation
email: []
chat: { channels: [{ id: "incidents", name: "#incidents" }], messages: [] }
ticketing: Ticket[]
alarms: Alarm[]
wiki: { pages: [{ title: string, content: string }] }
cicd: { pipelines: [], deployments: [] }   ← DEFAULT: empty unless user asks
logs: []                                    ← DEFAULT: always empty
log_patterns: LogPattern[]                  ← AUTO-GENERATED in Phase 5
background_logs: BackgroundLog[]            ← AUTO-GENERATED in Phase 5
feature_flags: []                           ← DEFAULT: always empty
host_groups: []                             ← DEFAULT: always empty

── COMPONENT TYPES (discriminated union on "type") ───────────
Every component MUST have: id (string), label (string), inputs (string[])
Additional required fields per type:

${simpleTypes}

${complexTypes}

VALID TYPE VALUES (only these ${componentTypes.length}): ${componentTypes.map((c) => c.typeVal).join(", ")}

── TOPOLOGY ──────────────────────────────────────────────────
topology: {
  focal_service: ServiceNode,     ← the main service the incident affects
  upstream: ServiceNode[],        ← services that CALL the focal service (can be [])
  downstream: ServiceNode[]       ← services the focal service CALLS (can be [])
}

Every ServiceNode MUST have:
  name: string          ← REQUIRED
  description: string   ← REQUIRED
  components: []        ← REQUIRED (can be empty for upstream/downstream)
  incidents: []         ← REQUIRED (can be empty for upstream/downstream)

Optional ServiceNode fields:
  traffic_profile: ${trafficProfiles.map((v) => `"${v}"`).join(" | ")}
  health: "healthy" | "degraded" | "flaky"
  correlation: "upstream_impact" | "exonerated" | "independent"
  lag_seconds: number
  impact_factor: number (0.0–1.0)

── INCIDENT ──────────────────────────────────────────────────
{
  id: string,
  affected_component: string,   ← must match a component id in the same service
  description: string,
  onset_overlay: ${onsetOverlays.map((v) => `"${v}"`).join(" | ")},
  onset_second: number,
  magnitude: number,
  propagation_direction: ${propagationDirs.map((v) => `"${v}"`).join(" | ")}   ← optional, default "upstream"
  ramp_duration_seconds?: number,
  end_second?: number
}
magnitude rules:
  saturation  → 0 < magnitude ≤ 1.0
  sudden_drop → 0 < magnitude < 1.0  (fraction the metric drops TO)
  others      → magnitude > 0 (multiplier, e.g. 5.0 = 5× normal)

── PERSONA ───────────────────────────────────────────────────
{
  id: string, display_name: string, job_title: string, team: string,
  avatar_color: string (hex), initiates_contact: boolean,
  cooldown_seconds: number, silent_until_contacted: boolean,
  system_prompt: string
}

DEFAULT PERSONA BEHAVIOUR:
  silent_until_contacted: true   ← default for all personas
  initiates_contact: false       ← default for all personas
  cooldown_seconds: 120
The trainee should drive the sim. Only set initiates_contact: true for
personas with a clear, realistic reason to reach out unprompted (e.g. an
on-call manager paging at incident start, or an automated alert bot).

── REMEDIATION ACTION ────────────────────────────────────────
{
  id: string,
  type: ${remediationTypes.map((v) => `"${v}"`).join(" | ")},
  service: string, is_correct_fix: boolean, side_effect?: string
}

── TICKET ────────────────────────────────────────────────────
ticketing is an ARRAY:
[{ id, title, severity: ${ticketSeverities.map((v) => `"${v}"`).join("|")},
   status: ${ticketStatuses.map((v) => `"${v}"`).join("|")},
   description, created_by: (persona id), at_second: number }]

── EVALUATION ────────────────────────────────────────────────
{
  root_cause: string (non-empty),
  relevant_actions: [{ action: string, why: string, service?: string }],
  red_herrings: [{ action: string, why: string }],
  debrief_context: string (non-empty)
}

── ALARM ─────────────────────────────────────────────────────
{ id, service, metric_id, condition, severity: ${alarmSeverities.map((v) => `"${v}"`).join("|")},
  auto_fire: boolean, auto_page: boolean,
  onset_second?: number, page_message?: string }

metric_id must be a registered archetype ID (see METRIC IDs section below).

── CICD (only if user explicitly asks) ──────────────────────
cicd: { pipelines: Pipeline[], deployments: Deployment[] }

Pipeline: { id, name, service, stages: PipelineStage[] }
PipelineStage: {
  id, name, type: ${pipelineStageTypes.map((v) => `"${v}"`).join("|")}, current_version,
  previous_version?: string|null,
  status: ${pipelineStageStatuses.map((v) => `"${v}"`).join("|")},
  deployed_at_sec: number, commit_message, author
}
Deployment: {
  service, version,
  deployed_at_sec: number,
  status: ${deploymentStatuses.map((v) => `"${v}"`).join("|")},
  commit_message, author
}

── LOG PATTERNS (auto-generated in Phase 5) ─────────────────
Generate 3–6 entries that tell the story of the incident. Use real service
names and component types from the topology. Cover: normal traffic before
onset, early warning signals around onset_second, and error/warn patterns
during the incident.
log_patterns: [{
  id, level: ${logLevels.map((v) => `"${v}"`).join("|")}, service,
  message, interval_seconds: number (positive),
  from_second: number, to_second: number,
  count?: number, jitter_seconds?: number
}]

── BACKGROUND LOGS (auto-generated in Phase 5) ───────────────
Generate one entry per service in the topology. Choose the most appropriate
profile for each service based on its role and component types.
background_logs: [{
  profile: ${bgLogProfiles.map((v) => `"${v}"`).join("|")},
  service, from_second: number, to_second: number,
  density?: ${bgLogDensities.map((v) => `"${v}"`).join("|")}
}]

── FEATURE FLAGS (only if user explicitly asks) ──────────────
feature_flags: [{ id, label, default_on?: boolean, description?: string }]

── HOST GROUPS (only if user explicitly asks) ────────────────
host_groups: [{ id, label, service, instance_count: int, description?: string }]
═══════════════════════════════════════════════════════════════`;
}
