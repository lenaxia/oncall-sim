import type { LoadedScenario } from '../scenario/types'
import type {
  EmailMessage, ChatMessage, LogEntry, Alarm, Ticket, Deployment,
} from '@shared/types/events'

export type ScriptedEvent =
  | { kind: 'email';        simTime: number; email: EmailMessage }
  | { kind: 'chat_message'; simTime: number; channel: string; message: ChatMessage }
  | { kind: 'log_entry';    simTime: number; entry: LogEntry }
  | { kind: 'alarm_fired';  simTime: number; alarm: Alarm }
  | { kind: 'ticket';       simTime: number; ticket: Ticket }
  | { kind: 'deployment';   simTime: number; service: string; deployment: Deployment }

export interface EventScheduler {
  tick(currentSimTime: number): ScriptedEvent[]
  reset(): void
}

// Internal pending event record
interface PendingEvent {
  simTime: number
  fired:   boolean
  expand(): ScriptedEvent[]   // may return 1-N ScriptedEvents
}

export function createEventScheduler(scenario: LoadedScenario): EventScheduler {
  const pending: PendingEvent[] = buildPendingEvents(scenario)

  return {
    tick(currentSimTime: number): ScriptedEvent[] {
      const due: ScriptedEvent[] = []
      for (const pe of pending) {
        if (!pe.fired && pe.simTime <= currentSimTime) {
          pe.fired = true
          due.push(...pe.expand())
        }
      }
      return due
    },

    reset() {
      for (const pe of pending) pe.fired = false
    },
  }
}

// ── Build all pending events from scenario ────────────────────────────────────

function buildPendingEvents(scenario: LoadedScenario): PendingEvent[] {
  const events: PendingEvent[] = []

  // Emails
  for (const e of scenario.emails) {
    const email: EmailMessage = {
      id:       e.id,
      threadId: e.threadId,
      from:     e.from,
      to:       e.to,
      subject:  e.subject,
      body:     e.body,
      simTime:  e.atSecond,
    }
    events.push({ simTime: e.atSecond, fired: false, expand: () => [{ kind: 'email', simTime: e.atSecond, email }] })
  }

  // Chat messages
  for (const m of scenario.chat.messages) {
    const msg: ChatMessage = {
      id:      m.id,
      channel: m.channel,
      persona: m.persona,
      text:    m.text,
      simTime: m.atSecond,
    }
    events.push({
      simTime: m.atSecond,
      fired: false,
      expand: () => [{ kind: 'chat_message', simTime: m.atSecond, channel: m.channel, message: msg }],
    })
  }

  // Logs
  for (const l of scenario.logs) {
    const entry: LogEntry = {
      id:      l.id,
      simTime: l.atSecond,
      level:   l.level,
      service: l.service,
      message: l.message,
    }
    events.push({ simTime: l.atSecond, fired: false, expand: () => [{ kind: 'log_entry', simTime: l.atSecond, entry }] })
  }

  // Tickets
  for (const t of scenario.tickets) {
    const ticket: Ticket = {
      id:          t.id,
      title:       t.title,
      severity:    t.severity,
      status:      t.status,
      description: t.description,
      createdBy:   t.createdBy,
      simTime:     t.atSecond,
    }
    events.push({ simTime: t.atSecond, fired: false, expand: () => [{ kind: 'ticket', simTime: t.atSecond, ticket }] })
  }

  // Alarms (with auto-page expansion)
  for (const a of scenario.alarms) {
    const alarm: Alarm = {
      id:        a.id,
      service:   a.service,
      metricId:  a.metricId,
      condition: a.condition,
      value:     0,                // runtime value — no static value available at schedule time
      severity:  a.severity,
      status:    'firing',
      simTime:   a.onsetSecond,
    }
    const simTime = a.onsetSecond
    events.push({
      simTime,
      fired: false,
      expand: () => {
        const result: ScriptedEvent[] = [{ kind: 'alarm_fired', simTime, alarm }]

        if (a.autoPage && a.pageMessage) {
          const pageMsg = a.pageMessage
          const alarmId = a.id
          const svc     = a.service

          // Auto-page: generate a PagerDuty-style email
          const pageEmail: EmailMessage = {
            id:       `auto-page-email-${alarmId}`,
            threadId: `page-${alarmId}`,
            from:     'pagerduty-bot',
            to:       'trainee',
            subject:  `[ALERT] ${svc}: ${pageMsg}`,
            body:     `**PagerDuty Alert**\n\nService: ${svc}\nSeverity: ${alarm.severity}\n\n${pageMsg}\n\nAcknowledge this alert to stop further escalation.`,
            simTime,
          }
          result.push({ kind: 'email', simTime, email: pageEmail })

          // Auto-page: generate a bot chat message in #incidents
          const botMsg: ChatMessage = {
            id:      `auto-page-chat-${alarmId}`,
            channel: '#incidents',
            persona: 'pagerduty-bot',
            text:    `🔔 **${alarm.severity}** | ${svc} | ${pageMsg}`,
            simTime,
          }
          result.push({ kind: 'chat_message', simTime, channel: '#incidents', message: botMsg })
        }

        return result
      },
    })
  }

  // Deployments (from CICD)
  for (const dep of scenario.cicd.deployments) {
    const deployment: Deployment = {
      version:       dep.version,
      deployedAtSec: dep.deployedAtSec,
      status:        dep.status,
      commitMessage: dep.commitMessage,
      author:        dep.author,
    }
    events.push({
      simTime: dep.deployedAtSec,
      fired: false,
      expand: () => [{ kind: 'deployment', simTime: dep.deployedAtSec, service: dep.service, deployment }],
    })
  }

  return events
}
