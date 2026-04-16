// validator.ts — cross-reference validation (browser port).
// The checkFileRef existence check (fs.accessSync) is removed.
// Path-traversal guard uses string prefix matching instead of path.resolve.

import { z } from "zod";
import {
  ScenarioSchema,
  PersonaSchema,
  AlarmConfigSchema,
  RemediationActionSchema,
  EvaluationSchema,
  EngineSchema,
  ScriptedEmailSchema,
  ChatSchema,
  TicketSchema,
  ScriptedLogSchema,
  LogPatternSchema,
  BackgroundLogsSchema,
  WikiSchema,
  CICDSchema,
  FeatureFlagSchema,
  HostGroupSchema,
  TopologySchema,
  TimelineSchema,
} from "./schema";
import { getValidArchetypes } from "../metrics/archetypes";
import type { ActionType } from "@shared/types/events";
import { lintScenario } from "./lint";
import type { ScenarioValidationError } from "./lint";
export type { ScenarioValidationError } from "./lint";

const VALID_ACTION_TYPES: Set<string> = new Set<ActionType>([
  "ack_page",
  "page_user",
  "update_ticket",
  "add_ticket_comment",
  "mark_resolved",
  "investigate_alert",
  "post_chat_message",
  "reply_email",
  "direct_message_persona",
  "open_tab",
  "search_logs",
  "view_metric",
  "read_wiki_page",
  "view_deployment_history",
  "view_pipeline",
  "trigger_rollback",
  "trigger_roll_forward",
  "override_blocker",
  "approve_gate",
  "block_promotion",
  "restart_service",
  "scale_cluster",
  "scale_capacity",
  "throttle_traffic",
  "suppress_alarm",
  "emergency_deploy",
  "toggle_feature_flag",
  "monitor_recovery",
]);

export interface ValidationError {
  scenarioId: string;
  field: string;
  message: string;
}

type RawConfig = z.infer<typeof ScenarioSchema>;

export function validateCrossReferences(
  scenario: RawConfig,
  _scenarioBaseUrl?: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const id = scenario.id;

  function err(field: string, message: string): void {
    errors.push({ scenarioId: id, field, message });
  }

  // ── Alarm service validation — uses topology service names ────────────────

  const topologyServiceNames = new Set([
    scenario.topology.focal_service.name,
    ...scenario.topology.upstream.map((n) => n.name),
    ...scenario.topology.downstream.map((n) => n.name),
  ]);

  // Build a set of valid metric archetypes per service for alarm cross-refs.
  // Without a derived ops_dashboard (Step 3), we allow any registered archetype
  // for topology-listed services. Strict per-service metric validation comes
  // in a later step once deriveOpsDashboard is implemented.
  const validArchetypes = new Set(getValidArchetypes());

  for (let i = 0; i < scenario.alarms.length; i++) {
    const alarm = scenario.alarms[i];
    if (!topologyServiceNames.has(alarm.service)) {
      err(
        `alarms[${i}].service`,
        `alarm '${alarm.id}' references service '${alarm.service}' which does not appear in topology. Valid: ${[...topologyServiceNames].join(", ")}`,
      );
    } else if (!validArchetypes.has(alarm.metric_id)) {
      err(
        `alarms[${i}].metric_id`,
        `alarm '${alarm.id}' references metric_id '${alarm.metric_id}' which is not a registered archetype. Registered: ${[...validArchetypes].join(", ")}`,
      );
    }
  }

  // ── No duplicate IDs ──────────────────────────────────────────────────────

  const alarmIds = scenario.alarms.map((a) => a.id);
  findDuplicates(alarmIds).forEach((dup) =>
    err("alarms", `Duplicate alarm id: '${dup}'`),
  );

  const personaIds = scenario.personas.map((p) => p.id);
  findDuplicates(personaIds).forEach((dup) =>
    err("personas", `Duplicate persona id: '${dup}'`),
  );

  const remediationIds = scenario.remediation_actions.map((r) => r.id);
  const remediationIdSet = new Set(remediationIds);
  findDuplicates(remediationIds).forEach((dup) =>
    err("remediation_actions", `Duplicate remediation_action id: '${dup}'`),
  );

  const ticketIds = scenario.ticketing.map((t) => t.id);
  findDuplicates(ticketIds).forEach((dup) =>
    err("ticketing", `Duplicate ticket id: '${dup}'`),
  );

  const wikiTitles = scenario.wiki.pages.map((p) => p.title);
  findDuplicates(wikiTitles).forEach((dup) =>
    err("wiki.pages", `Duplicate wiki page title: '${dup}'`),
  );

  // ── Persona references ────────────────────────────────────────────────────

  const personaIdSet = new Set(personaIds);

  for (let i = 0; i < (scenario.chat.messages ?? []).length; i++) {
    const msg = scenario.chat.messages[i];
    if (!personaIdSet.has(msg.persona)) {
      err(
        `chat.messages[${i}].persona`,
        `chat message '${msg.id}' references persona '${msg.persona}' not in personas[]`,
      );
    }
  }

  for (let i = 0; i < scenario.email.length; i++) {
    const email = scenario.email[i];
    if (email.from !== "trainee" && !personaIdSet.has(email.from)) {
      err(
        `email[${i}].from`,
        `email '${email.id}' from '${email.from}' is not a valid persona ID or 'trainee'`,
      );
    }
    if (email.to !== "trainee" && !personaIdSet.has(email.to)) {
      err(
        `email[${i}].to`,
        `email '${email.id}' to '${email.to}' is not a valid persona ID or 'trainee'`,
      );
    }
  }

  for (let i = 0; i < scenario.ticketing.length; i++) {
    const ticket = scenario.ticketing[i];
    if (
      ticket.created_by !== "trainee" &&
      ticket.created_by !== "pagerduty-bot" &&
      !personaIdSet.has(ticket.created_by)
    ) {
      err(
        `ticketing[${i}].created_by`,
        `ticket '${ticket.id}' created_by '${ticket.created_by}' is not a valid persona ID, 'trainee', or 'pagerduty-bot'`,
      );
    }
  }

  // ── Evaluation cross-references ───────────────────────────────────────────

  for (let i = 0; i < scenario.evaluation.relevant_actions.length; i++) {
    const ra = scenario.evaluation.relevant_actions[i];
    if (!VALID_ACTION_TYPES.has(ra.action)) {
      err(
        `evaluation.relevant_actions[${i}].action`,
        `'${ra.action}' is not a valid ActionType. Valid: ${[...VALID_ACTION_TYPES].join(", ")}`,
      );
    }
    if (
      ra.remediation_action_id &&
      !remediationIdSet.has(ra.remediation_action_id)
    ) {
      err(
        `evaluation.relevant_actions[${i}].remediation_action_id`,
        `relevant_action '${ra.action}' references remediation_action_id '${ra.remediation_action_id}' not in remediation_actions[]`,
      );
    }
    if (ra.service && !topologyServiceNames.has(ra.service)) {
      err(
        `evaluation.relevant_actions[${i}].service`,
        `relevant_action '${ra.action}' references service '${ra.service}' not in topology`,
      );
    }
  }

  // ── New rules: component graph validation ─────────────────────────────────

  const allServiceNodes = [
    {
      node: scenario.topology.focal_service,
      path: "topology.focal_service",
      isFocal: true,
    },
    ...scenario.topology.upstream.map((n, i) => ({
      node: n,
      path: `topology.upstream[${i}]`,
      isFocal: false,
    })),
    ...scenario.topology.downstream.map((n, i) => ({
      node: n,
      path: `topology.downstream[${i}]`,
      isFocal: false,
    })),
  ];

  for (const { node, path, isFocal } of allServiceNodes) {
    const components = node.components ?? [];
    if (components.length === 0) continue;

    // Rule 1: typical_rps required on focal_service when components present
    if (isFocal && node.typical_rps === undefined) {
      err(
        `${path}.typical_rps`,
        `'${node.name}' has components but no typical_rps — typical_rps is required for metric baseline derivation`,
      );
    }

    const componentIds = new Set(components.map((c) => c.id));

    // Rule 2: entrypoint uniqueness
    const entrypoints = components.filter((c) => c.inputs.length === 0);
    if (entrypoints.length === 0) {
      err(
        `${path}.entrypoint`,
        `'${node.name}' has no entrypoint component (a component with inputs: []). Exactly one is required.`,
      );
    } else if (entrypoints.length > 1) {
      err(
        `${path}.entrypoint`,
        `'${node.name}' has ${entrypoints.length} entrypoint components (${entrypoints.map((c) => c.id).join(", ")}). Exactly one is required.`,
      );
    }

    // Rule 3: input id validity
    for (let ci = 0; ci < components.length; ci++) {
      const comp = components[ci];
      for (let ii = 0; ii < comp.inputs.length; ii++) {
        const inputId = comp.inputs[ii];
        if (!componentIds.has(inputId)) {
          err(
            `${path}.components[${ci}].inputs[${ii}]`,
            `component '${comp.id}' references input id '${inputId}' which does not exist in '${node.name}'.components`,
          );
        }
      }
    }

    // Rule 4: no cycles — DFS
    if (hasCycle(components)) {
      err(`${path}.cycle`, `'${node.name}' component graph contains a cycle`);
    }

    // Rule 5 (focal only): incident component validity
    if (isFocal) {
      const incidents = node.incidents ?? [];
      for (let ii = 0; ii < incidents.length; ii++) {
        const inc = incidents[ii];
        if (!componentIds.has(inc.affected_component)) {
          err(
            `${path}.incidents[${ii}].affected_component`,
            `incident '${inc.id}' references affected_component '${inc.affected_component}' which does not exist in focal_service.components`,
          );
        }
      }
    }
  }

  // Rule 6: warn when non-focal nodes have incidents (they are silently ignored)
  for (const { node, path } of allServiceNodes.filter((s) => !s.isFocal)) {
    const incidents = node.incidents ?? [];
    if (incidents.length > 0) {
      err(
        path,
        `'${node.name}' has ${incidents.length} incident(s) defined, but incidents on upstream/downstream nodes are silently ignored — move them to focal_service if intended`,
      );
    }
  }

  // ── File reference path-traversal guard ───────────────────────────────────

  function checkFileRef(filePath: string): string | null {
    if (
      filePath.includes("../") ||
      filePath.includes("..\\") ||
      filePath.startsWith("/")
    ) {
      return `File reference '${filePath}' contains path traversal characters`;
    }
    return null;
  }

  for (let i = 0; i < scenario.email.length; i++) {
    const email = scenario.email[i];
    if (email.body_file) {
      const result = checkFileRef(email.body_file);
      if (result) err(`email[${i}].body_file`, result);
    }
  }
  for (let i = 0; i < scenario.ticketing.length; i++) {
    const ticket = scenario.ticketing[i];
    if (ticket.description_file) {
      const result = checkFileRef(ticket.description_file);
      if (result) err(`ticketing[${i}].description_file`, result);
    }
  }
  for (let i = 0; i < scenario.wiki.pages.length; i++) {
    const page = scenario.wiki.pages[i];
    if (page.content_file) {
      const result = checkFileRef(page.content_file);
      if (result) err(`wiki.pages[${i}].content_file`, result);
    }
  }
  if (scenario.ops_dashboard_file) {
    const result = checkFileRef(scenario.ops_dashboard_file);
    if (result) err("ops_dashboard_file", result);
  }

  return errors;
}

// ── Graph helpers ─────────────────────────────────────────────────────────────

function hasCycle(
  components: Array<{ id: string; inputs: string[] }>,
): boolean {
  // Build adjacency list: edge from input → component (downstream direction)
  const children: Map<string, string[]> = new Map();
  for (const c of components) {
    if (!children.has(c.id)) children.set(c.id, []);
    for (const input of c.inputs) {
      const list = children.get(input) ?? [];
      list.push(c.id);
      children.set(input, list);
    }
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(id: string): boolean {
    if (inStack.has(id)) return true; // cycle
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    for (const child of children.get(id) ?? []) {
      if (dfs(child)) return true;
    }
    inStack.delete(id);
    return false;
  }

  for (const c of components) {
    if (dfs(c.id)) return true;
  }
  return false;
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dups.add(v);
    seen.add(v);
  }
  return [...dups];
}

// ── ScenarioValidator — reusable validation pipeline ─────────────────────────

// ScenarioValidationError is defined in lint.ts and re-exported from here
// to keep it as a single source of truth and avoid circular imports.

// full() and partial() succeed even with lint warnings.
export interface ValidationSuccess<T> {
  ok: true;
  data: T;
  warnings: ScenarioValidationError[]; // lint issues — non-blocking; log and surface in UI
}

export interface ValidationFailure {
  ok: false;
  errors: ScenarioValidationError[]; // schema or cross_ref issues — always blocking
}

export type ValidationResult<T = unknown> =
  | ValidationSuccess<T>
  | ValidationFailure;

// Names of top-level scenario sections that can be validated independently.
export type ScenarioSection =
  | "personas"
  | "remediation_actions"
  | "topology"
  | "timeline"
  | "engine"
  | "alarms"
  | "email"
  | "chat"
  | "ticketing"
  | "wiki"
  | "cicd"
  | "evaluation"
  | "logs"
  | "log_patterns"
  | "background_logs"
  | "feature_flags"
  | "host_groups";

// Maps each section name to its Zod sub-schema.
const SECTION_SCHEMAS: Record<ScenarioSection, z.ZodTypeAny> = {
  personas: z.array(PersonaSchema),
  remediation_actions: z.array(RemediationActionSchema),
  topology: TopologySchema,
  timeline: TimelineSchema,
  engine: EngineSchema,
  alarms: z.array(AlarmConfigSchema),
  email: z.array(ScriptedEmailSchema),
  chat: ChatSchema,
  ticketing: z.array(TicketSchema),
  wiki: WikiSchema,
  cicd: CICDSchema,
  evaluation: EvaluationSchema,
  logs: z.array(ScriptedLogSchema),
  log_patterns: z.array(LogPatternSchema),
  background_logs: z.array(BackgroundLogsSchema),
  feature_flags: z.array(FeatureFlagSchema),
  host_groups: z.array(HostGroupSchema),
};

// Converts Zod issues to ScenarioValidationError[] with source:"schema".
function fromZodError(error: z.ZodError): ScenarioValidationError[] {
  return error.issues.map((issue) => ({
    source: "schema" as const,
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}

// Converts cross-ref ValidationError[] to ScenarioValidationError[].
function fromCrossRefErrors(
  errors: ValidationError[],
): ScenarioValidationError[] {
  return errors.map((e) => ({
    source: "cross_ref" as const,
    path: e.field,
    message: e.message,
  }));
}

// ── Validation modes ──────────────────────────────────────────────────────────

/**
 * Full validation. Schema and cross-ref errors are blocking (ok:false).
 * Lint issues are NON-BLOCKING — returned as warnings on a successful result.
 * Use for loading bundled/remote/uploaded scenarios.
 */
function full(raw: unknown): ValidationResult<RawConfig> {
  // Stage 1: structural Zod parse
  const zodResult = ScenarioSchema.safeParse(raw);
  if (!zodResult.success) {
    return { ok: false, errors: fromZodError(zodResult.error) };
  }

  // Stage 2: cross-reference integrity
  const xrefErrors = validateCrossReferences(zodResult.data);
  if (xrefErrors.length > 0) {
    return { ok: false, errors: fromCrossRefErrors(xrefErrors) };
  }

  // Stage 3: authoring quality lint — warnings only, never blocking
  const warnings = lintScenario(zodResult.data, { partial: false });

  return { ok: true, data: zodResult.data, warnings };
}

/**
 * Strict validation. All three stages are blocking including lint.
 * Use for builder mark_complete where the scenario must be fully correct
 * before it can be downloaded.
 */
function strict(raw: unknown): ValidationResult<RawConfig> {
  // Stage 1: structural Zod parse
  const zodResult = ScenarioSchema.safeParse(raw);
  if (!zodResult.success) {
    return { ok: false, errors: fromZodError(zodResult.error) };
  }

  // Stage 2: cross-reference integrity
  const xrefErrors = validateCrossReferences(zodResult.data);
  if (xrefErrors.length > 0) {
    return { ok: false, errors: fromCrossRefErrors(xrefErrors) };
  }

  // Stage 3: lint — fully blocking including strict-only rules
  const lintErrors = lintScenario(zodResult.data, {
    partial: false,
    strict: true,
  });
  if (lintErrors.length > 0) {
    return { ok: false, errors: lintErrors };
  }

  return { ok: true, data: zodResult.data, warnings: [] };
}

/**
 * Partial validation for an incomplete builder draft.
 * Missing required top-level fields are allowed; wrong types on present
 * fields are caught. Lint issues are non-blocking warnings.
 */
function partial(draft: unknown): ValidationResult<Partial<RawConfig>> {
  // Stage 1: structural parse on a deeply-partial schema
  const zodResult = ScenarioSchema.deepPartial().safeParse(draft);
  if (!zodResult.success) {
    return { ok: false, errors: fromZodError(zodResult.error) };
  }

  const candidate = zodResult.data as Partial<RawConfig>;

  // Stage 2: cross-reference integrity — only when enough fields are present
  if (
    candidate.personas !== undefined &&
    (candidate.chat !== undefined || candidate.email !== undefined)
  ) {
    const stub = buildStubForCrossRef(candidate);
    const xrefErrors = validateCrossReferences(stub);
    const relevant = xrefErrors.filter(
      (e) => !e.field.includes("alarms") || candidate.alarms !== undefined,
    );
    if (relevant.length > 0) {
      return { ok: false, errors: fromCrossRefErrors(relevant) };
    }
  }

  // Stage 3: lint in partial mode — warnings only
  const warnings = lintScenario(candidate, { partial: true });

  return { ok: true, data: candidate, warnings };
}

/**
 * Section validation — validates a single named section in isolation.
 * Lint issues are non-blocking warnings on success.
 * Cross-reference rules are NOT run (they span multiple sections).
 */
function section(
  sectionName: ScenarioSection,
  value: unknown,
): ValidationResult {
  const schema = SECTION_SCHEMAS[sectionName];

  const zodResult = schema.safeParse(value);
  if (!zodResult.success) {
    return { ok: false, errors: fromZodError(zodResult.error) };
  }

  const draft: Partial<RawConfig> = { [sectionName]: zodResult.data };
  const warnings = lintScenario(draft, { partial: true });

  return { ok: true, data: zodResult.data, warnings };
}

// Builds a minimal RawConfig stub from a partial draft for cross-ref validation.
function buildStubForCrossRef(draft: Partial<RawConfig>): RawConfig {
  return ScenarioSchema.parse({
    id: draft.id ?? "_stub",
    title: draft.title ?? "stub",
    description: draft.description ?? "",
    difficulty: draft.difficulty ?? "easy",
    tags: draft.tags ?? [],
    timeline: draft.timeline ?? { default_speed: 1, duration_minutes: 15 },
    topology: draft.topology ?? {
      focal_service: {
        name: "stub",
        description: "",
        components: [],
        incidents: [],
      },
      upstream: [],
      downstream: [],
    },
    engine: draft.engine ?? { llm_event_tools: [] },
    email: draft.email ?? [],
    chat: draft.chat ?? { channels: [], messages: [] },
    ticketing: draft.ticketing ?? [],
    alarms: draft.alarms ?? [],
    wiki: draft.wiki ?? { pages: [] },
    cicd: draft.cicd ?? { pipelines: [], deployments: [] },
    personas: draft.personas ?? [],
    remediation_actions: draft.remediation_actions ?? [],
    evaluation: draft.evaluation ?? {
      root_cause: "stub",
      relevant_actions: [],
      red_herrings: [],
      debrief_context: "stub",
    },
  });
}

export const ScenarioValidator = { full, strict, partial, section } as const;
