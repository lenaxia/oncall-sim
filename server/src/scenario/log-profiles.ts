// log-profiles.ts — ambient background log profiles for background_logs expansion.
//
// Each profile is a list of LogLine templates. During expansion the loader uses a
// seeded Mulberry32 RNG to:
//   1. Scatter entry timestamps randomly across [from_second, to_second]
//   2. Sample which lines fire at each tick based on density weights
//
// When no seed is provided by the scenario author the expansion uses Math.random()
// so every session gets a different but plausible stream.

import type { LogLevel } from '@shared/types/events'

export interface LogLine {
  level:   LogLevel
  message: string
  /** Relative weight for how often this line appears (default 1). */
  weight?: number
}

export interface LogProfile {
  /** Approximate entries per 60 real seconds at 'medium' density. */
  baseRate: number
  lines:    LogLine[]
}

export const LOG_PROFILES: Record<string, LogProfile> = {
  java_web_service: {
    baseRate: 8,
    lines: [
      { level: 'INFO',  message: 'GET /health - 200 OK - 2ms',                                         weight: 4 },
      { level: 'INFO',  message: 'GET /health - 200 OK - 3ms',                                         weight: 3 },
      { level: 'INFO',  message: 'GET /metrics - 200 OK - 1ms',                                        weight: 2 },
      { level: 'DEBUG', message: 'HikariPool-1 - keepalive: connection is alive',                       weight: 2 },
      { level: 'DEBUG', message: 'Scheduled task heartbeat fired',                                      weight: 1 },
      { level: 'INFO',  message: 'GC: minor collection complete — heap 312MB/512MB',                    weight: 1 },
      { level: 'DEBUG', message: 'Thread pool stats: active=3 queued=0 completed=18204',               weight: 1 },
      { level: 'INFO',  message: 'Config refresh: no changes detected',                                 weight: 1 },
      { level: 'DEBUG', message: 'Evicted 12 expired entries from response cache',                      weight: 1 },
      { level: 'INFO',  message: 'POST /v1/charges - 200 OK - 94ms',                                   weight: 3 },
      { level: 'INFO',  message: 'POST /v1/charges - 200 OK - 87ms',                                   weight: 3 },
      { level: 'INFO',  message: 'POST /v1/charges - 200 OK - 112ms',                                  weight: 2 },
      { level: 'INFO',  message: 'GET /v1/payment-methods - 200 OK - 41ms',                            weight: 2 },
      { level: 'DEBUG', message: 'JDBC connection borrowed from pool in 2ms',                           weight: 2 },
      { level: 'DEBUG', message: 'JDBC connection returned to pool',                                    weight: 2 },
      { level: 'INFO',  message: 'Fraud check passed: score=0.04',                                     weight: 2 },
      { level: 'INFO',  message: 'Fraud check passed: score=0.11',                                     weight: 1 },
    ],
  },

  nodejs_api: {
    baseRate: 10,
    lines: [
      { level: 'INFO',  message: 'GET /health 200 - 1ms',                                              weight: 4 },
      { level: 'INFO',  message: 'GET /health 200 - 2ms',                                              weight: 3 },
      { level: 'DEBUG', message: 'keepAlive ping sent',                                                 weight: 2 },
      { level: 'DEBUG', message: 'event loop lag: 1ms',                                                 weight: 2 },
      { level: 'INFO',  message: 'POST /api/v2/orders 200 - 54ms',                                     weight: 3 },
      { level: 'INFO',  message: 'POST /api/v2/orders 200 - 61ms',                                     weight: 3 },
      { level: 'INFO',  message: 'GET /api/v2/products 200 - 28ms',                                    weight: 2 },
      { level: 'INFO',  message: 'GET /api/v2/cart 200 - 19ms',                                        weight: 2 },
      { level: 'DEBUG', message: 'Redis GET hit: session:u9f3a2 (ttl 1742s)',                           weight: 2 },
      { level: 'DEBUG', message: 'Redis GET hit: catalog:featured (ttl 58s)',                           weight: 1 },
      { level: 'INFO',  message: 'Cron: stale session cleanup ran — 0 removed',                        weight: 1 },
      { level: 'DEBUG', message: 'DB pool: idle=8 active=2 waiting=0',                                 weight: 2 },
      { level: 'INFO',  message: 'Metrics scrape: 200 OK - 1ms',                                       weight: 2 },
    ],
  },

  python_worker: {
    baseRate: 5,
    lines: [
      { level: 'INFO',  message: 'Worker heartbeat — queue depth: 0',                                  weight: 3 },
      { level: 'INFO',  message: 'Worker heartbeat — queue depth: 1',                                  weight: 2 },
      { level: 'DEBUG', message: 'Celery beat: no tasks due',                                          weight: 2 },
      { level: 'INFO',  message: 'Task process_payment[a3f2] succeeded in 0.82s',                      weight: 3 },
      { level: 'INFO',  message: 'Task process_payment[b7c1] succeeded in 0.91s',                      weight: 2 },
      { level: 'DEBUG', message: 'Prefetch multiplier: 4, active=1',                                   weight: 1 },
      { level: 'INFO',  message: 'DB pool: connections 3/10',                                          weight: 2 },
      { level: 'DEBUG', message: 'Cache set: payment_config (ttl=300)',                                 weight: 1 },
      { level: 'INFO',  message: 'Rate limiter check: OK (tokens=98/100)',                              weight: 1 },
    ],
  },

  sidecar_proxy: {
    baseRate: 12,
    lines: [
      { level: 'DEBUG', message: '[upstream] connection established to 10.0.1.42:8080',                weight: 3 },
      { level: 'DEBUG', message: '[upstream] connection established to 10.0.1.43:8080',                weight: 2 },
      { level: 'INFO',  message: 'health: upstream cluster healthy (3/3 hosts)',                       weight: 3 },
      { level: 'DEBUG', message: 'xDS: no config changes from control plane',                          weight: 2 },
      { level: 'DEBUG', message: 'outbound -> 10.0.2.11:5432 [TCP] bytes_sent=142 bytes_recv=88',      weight: 2 },
      { level: 'INFO',  message: 'circuit breaker: CLOSED (failure rate 0.0%)',                        weight: 2 },
      { level: 'DEBUG', message: 'TLS session resumed (ticket reuse)',                                  weight: 1 },
      { level: 'INFO',  message: 'mTLS: cert valid, expires in 23d',                                   weight: 1 },
      { level: 'DEBUG', message: 'access_log: GET /health 200 0ms',                                    weight: 4 },
    ],
  },
}

// ── Density multipliers ───────────────────────────────────────────────────────

const DENSITY_MULTIPLIER: Record<string, number> = {
  low:    0.4,
  medium: 1.0,
  high:   2.2,
}

export function getDensityMultiplier(density: string): number {
  return DENSITY_MULTIPLIER[density] ?? 1.0
}

// ── Seeded RNG (Mulberry32) ───────────────────────────────────────────────────
// Used only when the author supplies an explicit seed. Otherwise Math.random()
// is used so every session gets its own stream.

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return function (): number {
    s += 0x6d2b79f5
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000
  }
}

export function makeRng(seed: number | undefined): () => number {
  if (seed === undefined) return Math.random.bind(Math)
  return mulberry32(seed)
}
