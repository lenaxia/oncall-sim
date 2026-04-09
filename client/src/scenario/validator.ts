// validator.ts — cross-reference validation (browser port).
// The checkFileRef existence check (fs.accessSync) is removed.
// Path-traversal guard uses string prefix matching instead of path.resolve.
// File existence for bundled scenarios is guaranteed by import.meta.glob at build time;
// for remote scenarios, a failed fetch surfaces to the user.

import type { z } from "zod";
import type { ScenarioSchema } from "./schema";
import { getValidArchetypes } from "../metrics/archetypes";
import type { ActionType } from "@shared/types/events";

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
  // scenarioBaseUrl is unused in browser port — kept for API compatibility with server version
  _scenarioBaseUrl?: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const id = scenario.id;

  function err(field: string, message: string): void {
    errors.push({ scenarioId: id, field, message });
  }

  if (scenario.ops_dashboard && scenario.ops_dashboard_file) {
    err(
      "ops_dashboard_file",
      "ops_dashboard and ops_dashboard_file are mutually exclusive — provide one or the other, not both.",
    );
  }

  const focalServiceName =
    scenario.ops_dashboard?.focal_service.name ?? scenario.ops_dashboard_file;
  const correlatedNames = (
    scenario.ops_dashboard?.correlated_services ?? []
  ).map((cs) => cs.name);
  const allServiceNames = new Set(
    [focalServiceName, ...correlatedNames].filter(Boolean),
  );

  const metricsPerService: Map<string, Set<string>> = new Map();
  if (scenario.ops_dashboard) {
    const focal = scenario.ops_dashboard.focal_service;
    metricsPerService.set(
      focal.name,
      new Set(focal.metrics.map((m) => m.archetype)),
    );
    for (const cs of scenario.ops_dashboard.correlated_services ?? []) {
      const overrideArchetypes = (cs.overrides ?? []).map((m) => m.archetype);
      const focalArchetypes = Array.from(
        metricsPerService.get(focal.name) ?? [],
      );
      metricsPerService.set(
        cs.name,
        new Set([...focalArchetypes, ...overrideArchetypes]),
      );
    }
  }

  // No duplicate IDs
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

  // Alarm service + metric_id cross-refs
  for (let i = 0; i < scenario.alarms.length; i++) {
    const alarm = scenario.alarms[i];
    if (!allServiceNames.has(alarm.service)) {
      err(
        `alarms[${i}].service`,
        `alarm '${alarm.id}' references service '${alarm.service}' which does not appear in ops_dashboard. Valid: ${[...allServiceNames].join(", ")}`,
      );
    } else {
      const serviceMetrics = metricsPerService.get(alarm.service);
      if (serviceMetrics && !serviceMetrics.has(alarm.metric_id)) {
        err(
          `alarms[${i}].metric_id`,
          `alarm '${alarm.id}' references metric_id '${alarm.metric_id}' not defined for '${alarm.service}'. Defined: ${[...serviceMetrics].join(", ")}`,
        );
      }
    }
  }

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
    if (ra.service && !allServiceNames.has(ra.service)) {
      err(
        `evaluation.relevant_actions[${i}].service`,
        `relevant_action '${ra.action}' references service '${ra.service}' not in ops_dashboard`,
      );
    }
  }

  const topologyServices = new Set([
    ...scenario.topology.upstream,
    ...scenario.topology.downstream,
  ]);
  for (
    let i = 0;
    i < (scenario.ops_dashboard?.correlated_services ?? []).length;
    i++
  ) {
    const cs = scenario.ops_dashboard!.correlated_services![i];
    if (!topologyServices.has(cs.name)) {
      err(
        `ops_dashboard.correlated_services[${i}].name`,
        `correlated service '${cs.name}' not in topology.upstream or topology.downstream`,
      );
    }
  }

  const validArchetypes = new Set(getValidArchetypes());
  if (scenario.ops_dashboard) {
    for (
      let i = 0;
      i < scenario.ops_dashboard.focal_service.metrics.length;
      i++
    ) {
      const m = scenario.ops_dashboard.focal_service.metrics[i];
      if (!validArchetypes.has(m.archetype)) {
        err(
          `ops_dashboard.focal_service.metrics[${i}].archetype`,
          `'${m.archetype}' is not a registered archetype. Valid: ${[...validArchetypes].join(", ")}`,
        );
      }
    }
    for (
      let ci = 0;
      ci < (scenario.ops_dashboard.correlated_services ?? []).length;
      ci++
    ) {
      const cs = scenario.ops_dashboard.correlated_services![ci];
      for (let mi = 0; mi < (cs.overrides ?? []).length; mi++) {
        const m = cs.overrides![mi];
        if (!validArchetypes.has(m.archetype)) {
          err(
            `ops_dashboard.correlated_services[${ci}].overrides[${mi}].archetype`,
            `'${m.archetype}' is not a registered archetype`,
          );
        }
      }
    }
  }

  // File reference path-traversal guard (browser: no fs.accessSync)
  function checkFileRef(filePath: string): string | null {
    // Reject obvious path traversal
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

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dups.add(v);
    seen.add(v);
  }
  return [...dups];
}
