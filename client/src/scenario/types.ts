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

// Overlay types that can be authored on an incident.
// "none" is intentionally excluded — it is not a valid incident onset.
export type IncidentOverlayType =
  | "spike_and_sustain"
  | "gradual_degradation"
  | "saturation"
  | "sudden_drop";

// ── Component types ───────────────────────────────────────────────────────────

export type ComponentType =
  | "load_balancer"
  | "api_gateway"
  | "ecs_cluster"
  | "ec2_fleet"
  | "lambda"
  | "kinesis_stream"
  | "sqs_queue"
  | "dynamodb"
  | "rds"
  | "elasticache"
  | "s3"
  | "scheduler";

interface ServiceComponentBase {
  id: string;
  label: string;
  inputs: string[];
}

export interface LoadBalancerComponent extends ServiceComponentBase {
  type: "load_balancer";
}
export interface ApiGatewayComponent extends ServiceComponentBase {
  type: "api_gateway";
}
export interface EcsClusterComponent extends ServiceComponentBase {
  type: "ecs_cluster";
  instanceCount: number;
  utilization: number;
}
export interface Ec2FleetComponent extends ServiceComponentBase {
  type: "ec2_fleet";
  instanceCount: number;
  utilization: number;
  diskUtilization?: number; // fraction [0,1], optional — defaults to 0.4
}
export interface LambdaComponent extends ServiceComponentBase {
  type: "lambda";
  reservedConcurrency: number;
  lambdaUtilization: number;
}
export interface KinesisStreamComponent extends ServiceComponentBase {
  type: "kinesis_stream";
  shardCount: number;
}
export interface SqsQueueComponent extends ServiceComponentBase {
  type: "sqs_queue";
}
export interface DynamoDbComponent extends ServiceComponentBase {
  type: "dynamodb";
  writeCapacity: number;
  readCapacity: number;
  writeUtilization: number;
  readUtilization: number;
  billingMode: "provisioned" | "on_demand";
}
export interface RdsComponent extends ServiceComponentBase {
  type: "rds";
  instanceCount: number;
  maxConnections: number;
  utilization: number;
  connectionUtilization: number;
}
export interface ElasticacheComponent extends ServiceComponentBase {
  type: "elasticache";
  instanceCount: number;
  utilization: number;
}
export interface S3Component extends ServiceComponentBase {
  type: "s3";
}
export interface SchedulerComponent extends ServiceComponentBase {
  type: "scheduler";
}

export type ServiceComponent =
  | LoadBalancerComponent
  | ApiGatewayComponent
  | EcsClusterComponent
  | Ec2FleetComponent
  | LambdaComponent
  | KinesisStreamComponent
  | SqsQueueComponent
  | DynamoDbComponent
  | RdsComponent
  | ElasticacheComponent
  | S3Component
  | SchedulerComponent;

export type PropagationDirection = "upstream" | "downstream" | "both";

export interface IncidentConfig {
  id: string;
  affectedComponent: string;
  description: string;
  onsetOverlay: IncidentOverlayType;
  onsetSecond: number;
  magnitude: number;
  rampDurationSeconds?: number;
  endSecond?: number;
  /** Direction the blast radius propagates. Defaults to "upstream". */
  propagationDirection: PropagationDirection;
}

export interface ServiceNode {
  name: string;
  description: string;
  owner?: string;
  typicalRps?: number;
  trafficProfile?: TrafficProfile;
  health?: HealthLevel;
  correlation?: CorrelationType;
  lagSeconds?: number;
  impactFactor?: number;
  components: ServiceComponent[];
  incidents: IncidentConfig[];
}

export interface TopologyConfig {
  focalService: ServiceNode;
  upstream: ServiceNode[];
  downstream: ServiceNode[];
}

export interface TimelineConfig {
  defaultSpeed: 1 | 2 | 5 | 10;
  durationMinutes: number;
  preIncidentSeconds: number;
}

export type LLMEventToolName =
  | "select_metric_reaction"
  | "apply_metric_response"
  | "fire_alarm"
  | "silence_alarm"
  | "inject_log_entry"
  | "trigger_cascade";

export interface LLMEventToolConfig {
  tool: LLMEventToolName;
  enabled?: boolean;
  maxCalls?: number;
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
  /** Whether the alarm fires when value is high (>=) or low (<=). Default: "high". */
  thresholdDirection?: "high" | "low";
  autoFire: boolean;
  onsetSecond?: number;
  autoPage: boolean;
  pageMessage?: string;
}

import type { ThrottleScope, ThrottleUnit } from "@shared/types/events";

export type { ThrottleScope, ThrottleUnit };

export interface ThrottleTargetConfig {
  id: string;
  scope: ThrottleScope;
  label: string;
  description: string;
  llmHint?: string;
  unit: ThrottleUnit;
  baselineRate: number;
}

export interface RemediationActionConfig {
  id: string;
  type: RemediationActionType;
  service: string;
  isCorrectFix: boolean;
  sideEffect?: string;
  targetVersion?: string;
  /** Stage id to deploy to for emergency_deploy. Defaults to the last stage (prod). */
  targetStage?: string;
  flagId?: string;
  flagEnabled?: boolean;
  label?: string;
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

import type { OverlayApplication } from "../metrics/types";

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
  /** Derived by loader from component graph. Never authored in YAML. */
  incidentResponses?: OverlayApplication[];
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
  difficulty: Difficulty;
  tags: string[];
}
