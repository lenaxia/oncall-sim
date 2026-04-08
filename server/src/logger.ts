// logger.ts — singleton pino logger for the server process.
//
// Log levels:
//   trace  — very verbose (disabled in production)
//   debug  — internal flow (disabled unless LOG_LEVEL=debug)
//   info   — normal lifecycle events (startup, session created, scenario loaded)
//   warn   — degraded-but-recoverable (validation failures, unknown tool calls)
//   error  — unexpected errors that affect behaviour
//   fatal  — process-terminating errors
//
// Output format:
//   NODE_ENV=production  → JSON (one line per event, machine-readable)
//   otherwise            → pino-pretty (human-readable, coloured)
//
// Usage:
//   import { logger } from '../logger'
//   logger.info({ scenarioId }, 'Scenario loaded')
//   logger.child({ component: 'game-loop' })

import pino from 'pino'

const level = process.env.LOG_LEVEL ?? 'info'

const transport =
  process.env.NODE_ENV === 'production'
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize:        true,
          translateTime:   'HH:MM:ss',
          ignore:          'pid,hostname',
          messageKey:      'msg',
          levelFirst:      false,
          singleLine:      false,
        },
      }

export const logger = pino({ level, transport })
