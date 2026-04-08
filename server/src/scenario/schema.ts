import { z } from 'zod'

// ── Sub-schemas ───────────────────────────────────────────────────────────────

const PersonaSchema = z.object({
  id:                     z.string().min(1),
  display_name:           z.string().min(1),
  job_title:              z.string().min(1),
  team:                   z.string().min(1),
  avatar_color:           z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  initiates_contact:      z.boolean(),
  cooldown_seconds:       z.number().positive(),
  silent_until_contacted: z.boolean(),
  system_prompt:          z.string().min(1),
})

const AlarmConfigSchema = z.object({
  id:           z.string().min(1),
  service:      z.string().min(1),
  metric_id:    z.string().min(1),
  condition:    z.string().min(1),
  severity:     z.enum(['SEV1', 'SEV2', 'SEV3', 'SEV4']),
  onset_second: z.number(),
  auto_page:    z.boolean(),
  page_message: z.string().optional(),
})

const RemediationActionSchema = z.object({
  id:             z.string().min(1),
  type:           z.enum(['rollback', 'roll_forward', 'restart_service', 'scale_cluster',
                          'throttle_traffic', 'emergency_deploy', 'toggle_feature_flag']),
  service:        z.string().min(1),
  is_correct_fix: z.boolean(),
  side_effect:    z.string().optional(),
  target_version: z.string().optional(),
})

const EvaluationSchema = z.object({
  root_cause:   z.string().min(1),
  relevant_actions: z.array(z.object({
    action:                 z.string().min(1),
    why:                    z.string().min(1),
    service:                z.string().optional(),
    remediation_action_id:  z.string().optional(),
  })),
  red_herrings: z.array(z.object({
    action: z.string().min(1),
    why:    z.string().min(1),
  })),
  debrief_context: z.string().min(1),
})

const MetricConfigSchema = z.object({
  archetype:           z.string().min(1),
  label:               z.string().optional(),
  unit:                z.string().optional(),
  baseline_value:      z.number().optional(),
  warning_threshold:   z.number().optional(),
  critical_threshold:  z.number().optional(),
  noise:               z.enum(['low', 'medium', 'high', 'extreme']).optional(),
  incident_peak:       z.number().optional(),
  onset_second:        z.number().optional(),
  incident_response:   z.object({
    overlay:                      z.string().min(1),
    onset_second:                 z.number().optional(),
    peak_value:                   z.number().optional(),
    drop_factor:                  z.number().optional(),
    ramp_duration_seconds:        z.number().optional(),
    saturation_duration_seconds:  z.number().optional(),
  }).optional(),
  series_override: z.array(z.object({
    t: z.number(),
    v: z.number(),
  })).optional(),
})

const ServiceScaleSchema = z.object({
  typical_rps:    z.number().positive(),
  instance_count: z.number().positive().optional(),
  max_connections: z.number().positive().optional(),
})

const OpsDashboardSchema = z.object({
  pre_incident_seconds: z.number().positive(),
  resolution_seconds:   z.number().positive().optional().default(15),
  focal_service: z.object({
    name:            z.string().min(1),
    scale:           ServiceScaleSchema,
    traffic_profile: z.enum(['business_hours_web', 'business_hours_b2b',
                             'always_on_api', 'batch_nightly', 'batch_weekly', 'none']),
    health:          z.enum(['healthy', 'degraded', 'flaky']),
    incident_type:   z.string().min(1),
    metrics:         z.array(MetricConfigSchema).min(1),
  }),
  correlated_services: z.array(z.object({
    name:          z.string().min(1),
    correlation:   z.enum(['upstream_impact', 'exonerated', 'independent']),
    lag_seconds:   z.number().optional(),
    impact_factor: z.number().min(0).max(1).optional(),
    health:        z.enum(['healthy', 'degraded', 'flaky']),
    overrides:     z.array(MetricConfigSchema).optional(),
  })).optional(),
})

const LLMEventToolSchema = z.object({
  tool:            z.string().min(1),
  enabled:         z.boolean().optional(),
  max_calls:       z.number().positive().optional(),
  requires_action: z.string().optional(),
  services:        z.array(z.string()).optional(),
})

const EngineSchema = z.object({
  tick_interval_seconds: z.number().positive(),
  llm_event_tools:       z.array(LLMEventToolSchema).optional().default([]),
  default_tab:           z.enum(['email', 'chat', 'tickets', 'ops', 'logs', 'wiki', 'cicd']).optional(),
})

const ScriptedEmailSchema = z.object({
  id:        z.string().min(1),
  at_second: z.number(),
  thread_id: z.string().min(1),
  from:      z.string().min(1),
  to:        z.string().min(1),
  subject:   z.string().min(1),
  body:      z.string().optional(),
  body_file: z.string().optional(),
})

const ChatChannelSchema = z.object({
  id:   z.string().min(1),
  name: z.string().min(1),
})

const ScriptedChatMessageSchema = z.object({
  id:        z.string().min(1),
  at_second: z.number(),
  channel:   z.string().min(1),
  persona:   z.string().min(1),
  text:      z.string().min(1),
})

const ChatSchema = z.object({
  channels: z.array(ChatChannelSchema),
  messages: z.array(ScriptedChatMessageSchema).optional().default([]),
})

const TicketSchema = z.object({
  id:           z.string().min(1),
  title:        z.string().min(1),
  severity:     z.enum(['SEV1', 'SEV2', 'SEV3', 'SEV4']),
  status:       z.enum(['open', 'in_progress', 'resolved']),
  description:  z.string().optional(),
  description_file: z.string().optional(),
  created_by:   z.string().min(1),
  assignee:     z.string().optional(),   // persona id or 'trainee'; defaults to 'trainee'
  at_second:    z.number(),
})

const ScriptedLogSchema = z.object({
  id:        z.string().min(1),
  at_second: z.number(),
  level:     z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']),
  service:   z.string().min(1),
  message:   z.string().min(1),
})

const WikiPageSchema = z.object({
  title:        z.string().min(1),
  content:      z.string().optional(),
  content_file: z.string().optional(),
})

const WikiSchema = z.object({
  pages: z.array(WikiPageSchema),
})

const PipelineSchema = z.object({
  id:      z.string().min(1),
  service: z.string().min(1),
  name:    z.string().min(1),
})

const DeploymentSchema = z.object({
  service:         z.string().min(1),
  version:         z.string().min(1),
  deployed_at_sec: z.number(),
  status:          z.enum(['active', 'previous', 'rolled_back']),
  commit_message:  z.string().min(1),
  author:          z.string().min(1),
})

const CICDSchema = z.object({
  pipelines:   z.array(PipelineSchema).optional().default([]),
  deployments: z.array(DeploymentSchema).optional().default([]),
})

// ── Top-level schema ──────────────────────────────────────────────────────────

export const ScenarioSchema = z.object({
  id:           z.string().min(1),
  title:        z.string().min(1),
  description:  z.string(),
  service_type: z.enum(['api', 'workflow', 'serverless', 'database', 'console']),
  difficulty:   z.enum(['easy', 'medium', 'hard']),
  tags:         z.array(z.string()),

  timeline: z.object({
    default_speed:    z.union([z.literal(1), z.literal(2), z.literal(5), z.literal(10)]),
    duration_minutes: z.number().positive(),
  }),

  topology: z.object({
    focal_service: z.string().min(1),
    upstream:      z.array(z.string()),
    downstream:    z.array(z.string()),
  }),

  engine:              EngineSchema,
  email:               z.array(ScriptedEmailSchema),
  chat:                ChatSchema,
  ticketing:           z.array(TicketSchema),
  ops_dashboard_file:  z.string().optional(),
  ops_dashboard:       OpsDashboardSchema.optional(),
  alarms:              z.array(AlarmConfigSchema),
  logs:                z.array(ScriptedLogSchema),
  wiki:                WikiSchema,
  cicd:                CICDSchema,
  personas:            z.array(PersonaSchema),
  remediation_actions: z.array(RemediationActionSchema),
  evaluation:          EvaluationSchema,
})

export type RawScenarioConfig = z.infer<typeof ScenarioSchema>
