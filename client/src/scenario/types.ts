// Typed output interfaces for fully parsed, validated scenario config.
// These are the camelCase runtime types used throughout the client engine.

import type {
  AlarmSeverity,
  TicketSeverity,
  TicketStatus,
  LogLevel,
  DeploymentStatus,
  StageStatus,
  BlockerType,
  TestStatus,
} from "@shared/types/events";

export type ServiceType =
  | "api"
  | "workflow"
  | "serverless"
  | "database"
  | "console";
export type Difficulty = "easy" | "medium" | "hard";
export type NoiseLevel = "low" | "medium" | "high" | "extreme";
export type HealthLevel = "healthy" | "degraded" | "flaky";
export type CorrelationType = "upstream_impact" | "exonerated" | "independent";
export type TrafficProfile =
  | "business_hours_web"
  | "business_hours_b2b"
  | "always_on_api"
  | "batch_nightly"
  | "batch_weekly"
  | "none";
export type RemediationActionType =
  | "rollback"
  | "roll_forward"
  | "restart_service"
  | "scale_cluster"
  | "throttle_traffic"
  | "emergency_deploy"
  | "toggle_feature_flag";

export interface TimelineConfig {
  defaultSpeed: 1 | 2 | 5 | 10;
  durationMinutes: number;
}

export interface TopologyConfig {
  focalService: string;
  upstream: string[];
  downstream: string[];
}

export interface LLMEventToolConfig {
  tool: string;
  enabled?: boolean;
  maxCalls?: number;
  requiresAction?: string;
  services?: string[];
}

export type TabId =
  | "email"
  | "chat"
  | "tickets"
  | "ops"
  | "logs"
  | "wiki"
  | "cicd";

export interface EngineConfig {
  tickIntervalSeconds: number;
  llmEventTools: LLMEventToolConfig[];
  defaultTab: TabId;
}

export interface PersonaConfig {
  id: string;
  displayName: string;
  jobTitle: string;
  team: string;
  avatarColor?: string;
  initiatesContact: boolean;
  cooldownSeconds: number;
  silentUntilContacted: boolean;
  systemPrompt: string;
}

export interface AlarmConfig {
  id: string;
  service: string;
  metricId: string;
  condition: string;
  severity: AlarmSeverity;
  threshold?: number;
  autoFire: boolean;
  onsetSecond?: number;
  autoPage: boolean;
  pageMessage?: string;
}

import type { ThrottleScope, ThrottleUnit } from "@shared/types/events";

export type { ThrottleScope, ThrottleUnit };

// A throttle target defined by the scenario author.
// Describes one lever the trainee can pull in the Traffic Throttling panel.
export interface ThrottleTargetConfig {
  id: string;
  scope: ThrottleScope;
  label: string; // shown to trainee — arbitrary string, e.g. "POST /v1/charges"
  description: string; // shown to trainee — factual description only
  llmHint?: string; // LLM-only — causal context; NEVER shown to trainee
  unit: ThrottleUnit;
  baselineRate: number; // normal operating rate, shown as reference in UI
}

export interface RemediationActionConfig {
  id: string;
  type: RemediationActionType;
  service: string;
  isCorrectFix: boolean;
  sideEffect?: string;
  targetVersion?: string;
  flagId?: string;
  flagEnabled?: boolean;
  label?: string;
  // Only present on type === 'throttle_traffic'
  throttleTargets?: ThrottleTargetConfig[];
}

export interface FeatureFlagConfig {
  id: string;
  label: string;
  defaultOn: boolean;
  description?: string;
}

export interface HostGroupConfig {
  id: string;
  label: string;
  service: string;
  instanceCount: number;
  description?: string;
}

export interface EvaluationConfig {
  rootCause: string;
  relevantActions: Array<{
    action: string;
    why: string;
    service?: string;
    remediationActionId?: string;
  }>;
  redHerrings: Array<{ action: string; why: string }>;
  debriefContext: string;
}

export interface ServiceScale {
  typicalRps: number;
  instanceCount?: number;
  maxConnections?: number;
}

export interface MetricConfig {
  archetype: string;
  label?: string;
  unit?: string;
  baselineValue?: number;
  warningThreshold?: number;
  criticalThreshold?: number;
  noise?: NoiseLevel;
  incidentPeak?: number;
  onsetSecond?: number;
  resolvedValue?: number;
  incidentResponse?: {
    overlay: string;
    onsetSecond?: number;
    peakValue?: number;
    dropFactor?: number;
    rampDurationSeconds?: number;
    saturationDurationSeconds?: number;
  };
  seriesOverride?: Array<{ t: number; v: number }>;
}

export interface FocalServiceConfig {
  name: string;
  scale: ServiceScale;
  trafficProfile: TrafficProfile;
  health: HealthLevel;
  incidentType: string;
  metrics: MetricConfig[];
}

export interface CorrelatedServiceConfig {
  name: string;
  correlation: CorrelationType;
  lagSeconds?: number;
  impactFactor?: number;
  health: HealthLevel;
  scale?: ServiceScale;
  overrides?: MetricConfig[];
}

export interface OpsDashboardConfig {
  preIncidentSeconds: number;
  resolutionSeconds: number;
  focalService: FocalServiceConfig;
  correlatedServices: CorrelatedServiceConfig[];
}

export interface ScriptedEmail {
  id: string;
  atSecond: number;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
}

export interface ChatChannelConfig {
  id: string;
  name: string;
}

export interface ScriptedChatMessage {
  id: string;
  atSecond: number;
  channel: string;
  persona: string;
  text: string;
}

export interface ChatConfig {
  channels: ChatChannelConfig[];
  messages: ScriptedChatMessage[];
}

export interface ScriptedTicket {
  id: string;
  title: string;
  severity: TicketSeverity;
  status: TicketStatus;
  description: string;
  createdBy: string;
  assignee: string;
  atSecond: number;
}

export interface ScriptedLogEntry {
  id: string;
  atSecond: number;
  level: LogLevel;
  service: string;
  message: string;
}

export interface WikiPage {
  title: string;
  content: string;
}

export interface WikiConfig {
  pages: WikiPage[];
}

export interface StageBlockerConfig {
  type: BlockerType;
  alarmId?: string;
  message?: string;
}

export interface StageTestConfig {
  name: string;
  status: TestStatus;
  url?: string;
  note?: string;
}

export interface PromotionEventConfig {
  version: string;
  simTime: number;
  status: "succeeded" | "failed" | "blocked";
  note: string;
}

export interface PipelineStageConfig {
  id: string;
  name: string;
  type: "build" | "deploy";
  currentVersion: string;
  previousVersion: string | null;
  status: StageStatus;
  deployedAtSec: number;
  commitMessage: string;
  author: string;
  blockers: StageBlockerConfig[];
  alarmWatches: string[];
  tests: StageTestConfig[];
  promotionEvents: PromotionEventConfig[];
}

export interface PipelineConfig {
  id: string;
  name: string;
  service: string;
  stages: PipelineStageConfig[];
}

export interface ScriptedDeployment {
  service: string;
  version: string;
  deployedAtSec: number;
  status: DeploymentStatus;
  commitMessage: string;
  author: string;
}

export interface CICDConfig {
  pipelines: PipelineConfig[];
  deployments: ScriptedDeployment[];
}

export interface LoadedScenario {
  id: string;
  title: string;
  description: string;
  serviceType: ServiceType;
  difficulty: Difficulty;
  tags: string[];
  timeline: TimelineConfig;
  topology: TopologyConfig;
  engine: EngineConfig;
  emails: ScriptedEmail[];
  chat: ChatConfig;
  tickets: ScriptedTicket[];
  opsDashboard: OpsDashboardConfig;
  alarms: AlarmConfig[];
  logs: ScriptedLogEntry[];
  wiki: WikiConfig;
  cicd: CICDConfig;
  personas: PersonaConfig[];
  remediationActions: RemediationActionConfig[];
  featureFlags: FeatureFlagConfig[];
  hostGroups: HostGroupConfig[];
  evaluation: EvaluationConfig;
}

// Scenario summary — used by ScenarioPicker
export interface ScenarioSummary {
  id: string;
  title: string;
  description: string;
  serviceType: ServiceType;
  difficulty: Difficulty;
  tags: string[];
}
