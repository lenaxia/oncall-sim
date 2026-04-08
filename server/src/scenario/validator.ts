// validator.ts — cross-reference validation (second pass after Zod parse).
// Validates relationships between fields that Zod cannot express.
// All 10 rules from LLD 03 §3 are implemented here.
// Never throws — all errors are returned for collection.

import path from 'path'
import fs from 'fs'
import type { z } from 'zod'
import type { ScenarioSchema } from './schema'
import { getValidArchetypes } from '../metrics/archetypes'
import type { ActionType } from '@shared/types/events'

// All valid ActionType values from shared/types/events.ts
const VALID_ACTION_TYPES: Set<string> = new Set<ActionType>([
  'ack_page', 'escalate_page', 'update_ticket', 'add_ticket_comment', 'mark_resolved',
  'post_chat_message', 'reply_email', 'direct_message_persona',
  'open_tab', 'search_logs', 'view_metric', 'read_wiki_page', 'view_deployment_history',
  'trigger_rollback', 'trigger_roll_forward', 'restart_service', 'scale_cluster',
  'throttle_traffic', 'suppress_alarm', 'emergency_deploy', 'toggle_feature_flag',
  'monitor_recovery',
])

export interface ValidationError {
  scenarioId: string
  field:      string   // dot-path to the offending field
  message:    string   // human-readable, actionable
}

type RawConfig = z.infer<typeof ScenarioSchema>

/**
 * Runs all 10 cross-reference validation rules on a parsed scenario config.
 * Returns an array of ValidationErrors. Empty array = valid.
 * Never throws.
 */
export function validateCrossReferences(
  scenario: RawConfig,
  scenarioDir: string
): ValidationError[] {
  const errors: ValidationError[] = []
  const id = scenario.id

  function err(field: string, message: string): void {
    errors.push({ scenarioId: id, field, message })
  }

  // ── Rule 8: ops_dashboard and ops_dashboard_file are mutually exclusive ──────
  if (scenario.ops_dashboard && scenario.ops_dashboard_file) {
    err('ops_dashboard_file',
      'ops_dashboard and ops_dashboard_file are mutually exclusive — provide one or the other, not both.')
  }

  // Get the service names for subsequent rules
  const focalServiceName = scenario.ops_dashboard?.focal_service.name ?? scenario.ops_dashboard_file
  const correlatedNames = (scenario.ops_dashboard?.correlated_services ?? []).map(cs => cs.name)
  const allServiceNames = new Set([focalServiceName, ...correlatedNames].filter(Boolean))

  // Collect metric IDs per service from ops_dashboard
  const metricsPerService: Map<string, Set<string>> = new Map()
  if (scenario.ops_dashboard) {
    const focal = scenario.ops_dashboard.focal_service
    metricsPerService.set(focal.name, new Set(focal.metrics.map(m => m.archetype)))
    for (const cs of scenario.ops_dashboard.correlated_services ?? []) {
      const overrideArchetypes = (cs.overrides ?? []).map(m => m.archetype)
      // Correlated services inherit focal archetypes plus overrides
      const focalArchetypes = Array.from(metricsPerService.get(focal.name) ?? [])
      metricsPerService.set(cs.name, new Set([...focalArchetypes, ...overrideArchetypes]))
    }
  }

  // ── Rule 9: No duplicate IDs ──────────────────────────────────────────────────
  const alarmIds = scenario.alarms.map(a => a.id)
  const dupAlarms = findDuplicates(alarmIds)
  dupAlarms.forEach(id => err(`alarms`, `Duplicate alarm id: '${id}'`))

  const personaIds = scenario.personas.map(p => p.id)
  const dupPersonas = findDuplicates(personaIds)
  dupPersonas.forEach(id => err(`personas`, `Duplicate persona id: '${id}'`))

  const remediationIds = scenario.remediation_actions.map(r => r.id)
  const remediationIdSet = new Set(remediationIds)
  const dupRemediation = findDuplicates(remediationIds)
  dupRemediation.forEach(id => err(`remediation_actions`, `Duplicate remediation_action id: '${id}'`))

  const ticketIds = scenario.ticketing.map(t => t.id)
  const dupTickets = findDuplicates(ticketIds)
  dupTickets.forEach(id => err(`ticketing`, `Duplicate ticket id: '${id}'`))

  const wikiTitles = scenario.wiki.pages.map(p => p.title)
  const dupWiki = findDuplicates(wikiTitles)
  dupWiki.forEach(t => err(`wiki.pages`, `Duplicate wiki page title: '${t}'`))

  // ── Rule 1: alarm.metric_id must match a metric in ops_dashboard for alarm.service ──
  // ── Rule 2: alarm.service must match focal or correlated service name ─────────────
  for (let i = 0; i < scenario.alarms.length; i++) {
    const alarm = scenario.alarms[i]
    if (!allServiceNames.has(alarm.service)) {
      err(`alarms[${i}].service`,
        `alarm '${alarm.id}' references service '${alarm.service}' which does not appear in ops_dashboard. Valid services: ${[...allServiceNames].join(', ')}`)
    } else {
      const serviceMetrics = metricsPerService.get(alarm.service)
      if (serviceMetrics && !serviceMetrics.has(alarm.metric_id)) {
        err(`alarms[${i}].metric_id`,
          `alarm '${alarm.id}' references metric_id '${alarm.metric_id}' which is not defined for service '${alarm.service}'. Defined metrics: ${[...serviceMetrics].join(', ')}`)
      }
    }
  }

  // ── Rule 3: persona IDs referenced in chat/email/tickets must exist ─────────────
  const personaIdSet = new Set(personaIds)

  for (let i = 0; i < (scenario.chat.messages ?? []).length; i++) {
    const msg = scenario.chat.messages[i]
    if (!personaIdSet.has(msg.persona)) {
      err(`chat.messages[${i}].persona`,
        `chat message '${msg.id}' references persona '${msg.persona}' which is not defined in personas[]`)
    }
  }

  for (let i = 0; i < scenario.email.length; i++) {
    const email = scenario.email[i]
    // from/to can be persona IDs or 'trainee' — validate non-trainee values
    if (email.from !== 'trainee' && !personaIdSet.has(email.from)) {
      err(`email[${i}].from`,
        `email '${email.id}' from '${email.from}' is not a valid persona ID or 'trainee'`)
    }
    if (email.to !== 'trainee' && !personaIdSet.has(email.to)) {
      err(`email[${i}].to`,
        `email '${email.id}' to '${email.to}' is not a valid persona ID or 'trainee'`)
    }
  }

  for (let i = 0; i < scenario.ticketing.length; i++) {
    const ticket = scenario.ticketing[i]
    if (ticket.created_by !== 'trainee' && ticket.created_by !== 'pagerduty-bot'
        && !personaIdSet.has(ticket.created_by)) {
      err(`ticketing[${i}].created_by`,
        `ticket '${ticket.id}' created_by '${ticket.created_by}' is not a valid persona ID, 'trainee', or 'pagerduty-bot'`)
    }
  }

  // ── Rule 4: evaluation.relevant_actions[].action must be a valid ActionType ─────
  for (let i = 0; i < scenario.evaluation.relevant_actions.length; i++) {
    const ra = scenario.evaluation.relevant_actions[i]
    if (!VALID_ACTION_TYPES.has(ra.action)) {
      err(`evaluation.relevant_actions[${i}].action`,
        `'${ra.action}' is not a valid ActionType. Valid values: ${[...VALID_ACTION_TYPES].join(', ')}`)
    }
  }

  // ── Rule 5: evaluation.relevant_actions[].remediation_action_id must exist in remediation_actions[] ──
  for (let i = 0; i < scenario.evaluation.relevant_actions.length; i++) {
    const ra = scenario.evaluation.relevant_actions[i]
    // Check remediation_action_id cross-reference
    if (ra.remediation_action_id && !remediationIdSet.has(ra.remediation_action_id)) {
      err(`evaluation.relevant_actions[${i}].remediation_action_id`,
        `relevant_action '${ra.action}' references remediation_action_id '${ra.remediation_action_id}' which does not exist in remediation_actions[]`)
    }
    // Also validate optional service reference
    if (ra.service && !allServiceNames.has(ra.service)) {
      err(`evaluation.relevant_actions[${i}].service`,
        `relevant_action '${ra.action}' references service '${ra.service}' which is not in ops_dashboard`)
    }
  }

  // ── Rule 6: correlated_services[].name must appear in topology.upstream or downstream ──
  const topologyServices = new Set([
    ...scenario.topology.upstream,
    ...scenario.topology.downstream,
  ])
  for (let i = 0; i < (scenario.ops_dashboard?.correlated_services ?? []).length; i++) {
    const cs = scenario.ops_dashboard!.correlated_services![i]
    if (!topologyServices.has(cs.name)) {
      err(`ops_dashboard.correlated_services[${i}].name`,
        `correlated service '${cs.name}' is not listed in topology.upstream or topology.downstream`)
    }
  }

  // ── Rule 7: metric archetype values must exist in getValidArchetypes() ────────────
  const validArchetypes = new Set(getValidArchetypes())

  if (scenario.ops_dashboard) {
    for (let i = 0; i < scenario.ops_dashboard.focal_service.metrics.length; i++) {
      const m = scenario.ops_dashboard.focal_service.metrics[i]
      if (!validArchetypes.has(m.archetype)) {
        err(`ops_dashboard.focal_service.metrics[${i}].archetype`,
          `'${m.archetype}' is not a registered archetype. Valid archetypes: ${[...validArchetypes].join(', ')}`)
      }
    }
    for (let ci = 0; ci < (scenario.ops_dashboard.correlated_services ?? []).length; ci++) {
      const cs = scenario.ops_dashboard.correlated_services![ci]
      for (let mi = 0; mi < (cs.overrides ?? []).length; mi++) {
        const m = cs.overrides![mi]
        if (!validArchetypes.has(m.archetype)) {
          err(`ops_dashboard.correlated_services[${ci}].overrides[${mi}].archetype`,
            `'${m.archetype}' is not a registered archetype`)
        }
      }
    }
  }

  // ── Rule 10: All file references resolve to existing readable files ───────────────
  // Check email body_file references
  for (let i = 0; i < scenario.email.length; i++) {
    const email = scenario.email[i]
    if (email.body_file) {
      const result = checkFileRef(email.body_file, scenarioDir)
      if (result) err(`email[${i}].body_file`, result)
    }
  }
  // Check ticket description_file references
  for (let i = 0; i < scenario.ticketing.length; i++) {
    const ticket = scenario.ticketing[i]
    if (ticket.description_file) {
      const result = checkFileRef(ticket.description_file, scenarioDir)
      if (result) err(`ticketing[${i}].description_file`, result)
    }
  }
  // Check wiki content_file references
  for (let i = 0; i < scenario.wiki.pages.length; i++) {
    const page = scenario.wiki.pages[i]
    if (page.content_file) {
      const result = checkFileRef(page.content_file, scenarioDir)
      if (result) err(`wiki.pages[${i}].content_file`, result)
    }
  }
  // Check ops_dashboard_file reference
  if (scenario.ops_dashboard_file) {
    const result = checkFileRef(scenario.ops_dashboard_file, scenarioDir)
    if (result) err('ops_dashboard_file', result)
  }

  return errors
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>()
  const dups = new Set<string>()
  for (const v of values) {
    if (seen.has(v)) dups.add(v)
    seen.add(v)
  }
  return [...dups]
}

/**
 * Validates a file reference stays within the scenario directory and exists.
 * Returns an error message string, or null if valid.
 */
function checkFileRef(filePath: string, scenarioDir: string): string | null {
  // Reject path traversal
  const resolved = path.resolve(scenarioDir, filePath)
  const normalDir = path.resolve(scenarioDir)
  if (!resolved.startsWith(normalDir + path.sep) && resolved !== normalDir) {
    return `File reference '${filePath}' would escape the scenario directory (path traversal rejected)`
  }
  // Check file exists and is readable
  try {
    fs.accessSync(resolved, fs.constants.R_OK)
    return null
  } catch {
    return `Referenced file '${filePath}' does not exist or is not readable at '${resolved}'`
  }
}
