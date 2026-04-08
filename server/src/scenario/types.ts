// Typed output interfaces for fully parsed, validated scenario config.
// These are the camelCase runtime types used throughout the server.
// Distinct from the raw YAML shape (which uses snake_case).

import type { AlarmSeverity, TicketSeverity, TicketStatus, LogLevel, DeploymentStatus } from '@shared/types/events'

export type ServiceType          = 'api' | 'workflow' | 'serverless' | 'database' | 'console'
export type Difficulty           = 'easy' | 'medium' | 'hard'
export type NoiseLevel           = 'low' | 'medium' | 'high' | 'extreme'
export type HealthLevel          = 'healthy' | 'degraded' | 'flaky'
export type CorrelationType      = 'upstream_impact' | 'exonerated' | 'independent'
export type TrafficProfile       = 'business_hours_web' | 'business_hours_b2b'
                                 | 'always_on_api' | 'batch_nightly' | 'batch_weekly' | 'none'
export type RemediationActionType = 'rollback' | 'roll_forward' | 'restart_service'
                                  | 'scale_cluster' | 'throttle_traffic'
                                  | 'emergency_deploy' | 'toggle_feature_flag'

export interface TimelineConfig {
  defaultSpeed:    1 | 2 | 5 | 10
  durationMinutes: number
}

export interface TopologyConfig {
  focalService: string
  upstream:     string[]
  downstream:   string[]
}

export interface LLMEventToolConfig {
  tool:            string
  enabled?:        boolean
  maxCalls?:       number
  requiresAction?: string
  services?:       string[]
}

export type TabId = 'email' | 'chat' | 'tickets' | 'ops' | 'logs' | 'wiki' | 'cicd'

export interface EngineConfig {
  tickIntervalSeconds: number
  llmEventTools:       LLMEventToolConfig[]
  /**
   * The tab the client opens by default when the session starts.
   * Set this to whichever channel first reports the incident in the scenario:
   * - 'email' for PagerDuty-style page (email notification)
   * - 'chat'  for Slack-style "hey something's weird" message
   * - 'ops'   for a scenario where the trainee is already watching dashboards
   * Defaults to 'email' if omitted.
   */
  defaultTab: TabId
}

export interface PersonaConfig {
  id:                   string
  displayName:          string
  jobTitle:             string   // e.g. "Senior SRE" — shown in DM persona card
  team:                 string   // e.g. "Platform" — shown below job title
  avatarColor?:         string
  initiatesContact:     boolean
  cooldownSeconds:      number
  silentUntilContacted: boolean
  systemPrompt:         string
}

export interface AlarmConfig {
  id:           string
  service:      string
  metricId:     string
  condition:    string
  severity:     AlarmSeverity
  onsetSecond:  number
  autoPage:     boolean
  pageMessage?: string
}

export interface RemediationActionConfig {
  id:             string
  type:           RemediationActionType
  service:        string
  isCorrectFix:   boolean
  sideEffect?:    string
  targetVersion?: string
}

export interface EvaluationConfig {
  rootCause:       string
  relevantActions: Array<{ action: string; why: string; service?: string; remediationActionId?: string }>
  redHerrings:     Array<{ action: string; why: string }>
  debriefContext:  string
}

export interface ServiceScale {
  typicalRps:      number
  instanceCount?:  number
  maxConnections?: number
}

export interface MetricConfig {
  archetype:           string
  label?:              string
  unit?:               string
  baselineValue?:      number
  warningThreshold?:   number
  criticalThreshold?:  number
  noise?:              NoiseLevel
  incidentPeak?:       number
  onsetSecond?:        number
  incidentResponse?: {
    overlay:                    string
    onsetSecond?:               number
    peakValue?:                 number
    dropFactor?:                number
    rampDurationSeconds?:       number
    saturationDurationSeconds?: number
  }
  seriesOverride?: Array<{ t: number; v: number }>
}

export interface FocalServiceConfig {
  name:           string
  scale:          ServiceScale
  trafficProfile: TrafficProfile
  health:         HealthLevel
  incidentType:   string
  metrics:        MetricConfig[]
}

export interface CorrelatedServiceConfig {
  name:          string
  correlation:   CorrelationType
  lagSeconds?:   number
  impactFactor?: number
  health:        HealthLevel
  scale?:        ServiceScale   // if omitted, baseline falls back to archetype default or focal scale
  overrides?:    MetricConfig[]
}

export interface OpsDashboardConfig {
  preIncidentSeconds:  number
  resolutionSeconds:   number
  focalService:        FocalServiceConfig
  correlatedServices:  CorrelatedServiceConfig[]
}

export interface ScriptedEmail {
  id:       string
  atSecond: number
  threadId: string
  from:     string
  to:       string
  subject:  string
  body:     string           // resolved markdown content
}

export interface ChatChannelConfig {
  id:   string
  name: string
}

export interface ScriptedChatMessage {
  id:       string
  atSecond: number
  channel:  string
  persona:  string
  text:     string
}

export interface ChatConfig {
  channels: ChatChannelConfig[]
  messages: ScriptedChatMessage[]
}

export interface ScriptedTicket {
  id:          string
  title:       string
  severity:    TicketSeverity
  status:      TicketStatus
  description: string        // resolved markdown content
  createdBy:   string
  atSecond:    number
}

export interface ScriptedLogEntry {
  id:       string
  atSecond: number
  level:    LogLevel
  service:  string
  message:  string
}

export interface WikiPage {
  title:   string
  content: string            // resolved markdown content
}

export interface WikiConfig {
  pages: WikiPage[]
}

export interface PipelineConfig {
  id:      string
  service: string
  name:    string
}

export interface ScriptedDeployment {
  service:       string
  version:       string
  deployedAtSec: number
  status:        DeploymentStatus
  commitMessage: string
  author:        string
}

export interface CICDConfig {
  pipelines:   PipelineConfig[]
  deployments: ScriptedDeployment[]
}

// Top-level loaded scenario — used everywhere in the server after loading.
// Note: metrics are NOT stored here — they are session-scoped and generated at session start.
export interface LoadedScenario {
  id:                 string
  title:              string
  description:        string
  serviceType:        ServiceType
  difficulty:         Difficulty
  tags:               string[]
  timeline:           TimelineConfig
  topology:           TopologyConfig
  engine:             EngineConfig
  emails:             ScriptedEmail[]
  chat:               ChatConfig
  tickets:            ScriptedTicket[]
  opsDashboard:       OpsDashboardConfig  // always present after loader resolves ops_dashboard_file
  alarms:             AlarmConfig[]
  logs:               ScriptedLogEntry[]
  wiki:               WikiConfig
  cicd:               CICDConfig
  personas:           PersonaConfig[]
  remediationActions: RemediationActionConfig[]
  evaluation:         EvaluationConfig
}
