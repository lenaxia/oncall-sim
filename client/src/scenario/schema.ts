import { z } from "zod";

const PersonaSchema = z.object({
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

const AlarmConfigSchema = z.object({
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

const ThrottleTargetSchema = z.object({
  id: z.string().min(1),
  scope: z.enum(["endpoint", "customer", "consumer", "concurrent", "global"]),
  label: z.string().min(1),
  description: z.string().min(1),
  llm_hint: z.string().optional(),
  unit: z.enum(["rps", "msg_per_sec", "concurrent"]),
  baseline_rate: z.number().positive(),
});

const RemediationActionSchema = z.object({
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

const EvaluationSchema = z.object({
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

const MetricConfigSchema = z.object({
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

const LLMEventToolSchema = z.object({
  tool: z.string().min(1),
  enabled: z.boolean().optional(),
  max_calls: z.number().positive().optional(),
  requires_action: z.string().optional(),
  services: z.array(z.string()).optional(),
});

const EngineSchema = z.object({
  tick_interval_seconds: z.number().positive(),
  llm_event_tools: z.array(LLMEventToolSchema).optional().default([]),
  default_tab: z
    .enum(["email", "chat", "tickets", "ops", "logs", "wiki", "cicd"])
    .optional(),
});

const ScriptedEmailSchema = z.object({
  id: z.string().min(1),
  at_second: z.number(),
  thread_id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().optional(),
  body_file: z.string().optional(),
});

const ChatChannelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
const ScriptedChatMessageSchema = z.object({
  id: z.string().min(1),
  at_second: z.number(),
  channel: z.string().min(1),
  persona: z.string().min(1),
  text: z.string().min(1),
});
const ChatSchema = z.object({
  channels: z.array(ChatChannelSchema),
  messages: z.array(ScriptedChatMessageSchema).optional().default([]),
});

const TicketSchema = z.object({
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

const ScriptedLogSchema = z.object({
  id: z.string().min(1),
  at_second: z.number(),
  level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]),
  service: z.string().min(1),
  message: z.string().min(1),
});

const LogPatternSchema = z.object({
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

const BackgroundLogsSchema = z.object({
  profile: z.string().min(1),
  service: z.string().min(1),
  from_second: z.number(),
  to_second: z.number(),
  density: z.enum(["low", "medium", "high"]).optional().default("medium"),
  seed: z.number().int().optional(),
});

const WikiPageSchema = z.object({
  title: z.string().min(1),
  content: z.string().optional(),
  content_file: z.string().optional(),
});
const WikiSchema = z.object({ pages: z.array(WikiPageSchema) });

const StageBlockerSchema = z.object({
  type: z.enum(["alarm", "time_window", "manual_approval", "test_failure"]),
  alarm_id: z.string().optional(),
  message: z.string().optional(),
});
const StageTestSchema = z.object({
  name: z.string().min(1),
  status: z.enum(["pending", "running", "passed", "failed", "skipped"]),
  url: z.string().optional(),
  note: z.string().optional(),
});
const PromotionEventSchema = z.object({
  version: z.string().min(1),
  sim_time: z.number(),
  status: z.enum(["succeeded", "failed", "blocked"]),
  note: z.string().min(1),
});
const PipelineStageSchema = z.object({
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
const PipelineSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  service: z.string().min(1),
  stages: z.array(PipelineStageSchema).min(1),
});
const DeploymentSchema = z.object({
  service: z.string().min(1),
  version: z.string().min(1),
  deployed_at_sec: z.number(),
  status: z.enum(["active", "previous", "rolled_back"]),
  commit_message: z.string().min(1),
  author: z.string().min(1),
});
const CICDSchema = z.object({
  pipelines: z.array(PipelineSchema).optional().default([]),
  deployments: z.array(DeploymentSchema).optional().default([]),
});

const FeatureFlagSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  default_on: z.boolean().optional().default(false),
  description: z.string().optional(),
});
const HostGroupSchema = z.object({
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

const TopologySchema = z.object({
  focal_service: ServiceNodeSchema,
  upstream: z.array(ServiceNodeSchema).optional().default([]),
  downstream: z.array(ServiceNodeSchema).optional().default([]),
});

// ── Timeline schema ───────────────────────────────────────────────────────────

const TimelineSchema = z.object({
  default_speed: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(5),
    z.literal(10),
  ]),
  duration_minutes: z.number().positive(),
  pre_incident_seconds: z.number().positive().optional().default(43200), // defaults to 12h
  resolution_seconds: z.number().positive().optional().default(15),
});

// ── Root scenario schema ──────────────────────────────────────────────────────

export const ScenarioSchema = z.object({
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
