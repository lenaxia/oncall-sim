// metric-summary.ts — produces a grounded, LLM-consumable narrative description
// of the current metric state for the stakeholder engine system prompt.
//
// Design: pure template filling from deterministic inputs. No LLM involved.
// Each metric gets a one-to-two sentence description built from four anchors:
//
//   1. Pre-incident baseline  — what normal looks like (resolvedParams.baselineValue)
//   2. Current value          — live reading from the series at simTime
//   3. Threshold bands        — warningThreshold / criticalThreshold from scenario config
//   4. Trajectory             — slope + time-in-band, derived from series points
//
// The correlated service's `correlation` field gates verbosity:
//   - focal service + upstream_impact  → full narrative
//   - independent                      → current value + status only
//   - exonerated                       → single "not involved" line
//
// renderMetricSummary() produces the final text block injected into the system
// prompt. The LLM is explicitly told not to contradict it.

import type { LoadedScenario } from '../scenario/types'
import type { MetricStore } from './metric-store'
import type { CorrelationType } from '../scenario/types'

// ── Configuration ─────────────────────────────────────────────────────────────

// How many seconds back to look when computing slope / time-in-band.
const SLOPE_WINDOW_SECONDS = 60

// Minimum fraction of baseline change per minute to be called "rising"/"falling"
// rather than "stable". Prevents noise from generating spurious labels.
const SLOPE_THRESHOLD_FRACTION = 0.04  // 4% of baseline per minute

// ── Public types ──────────────────────────────────────────────────────────────

export type StatusBand = 'healthy' | 'warning' | 'critical' | 'unknown'
export type SlopeLabel = 'rising sharply' | 'rising' | 'stable' | 'falling' | 'recovering' | 'unknown'

export interface MetricNarrative {
  service:      string
  metricId:     string
  label:        string
  unit:         string
  status:       StatusBand
  currentValue: number | null
  preIncident:  number | null   // value just before onsetSecond
  slope:        SlopeLabel
  timeInBand:   number          // seconds spent at current status band
  sentence:     string          // final human-readable description
}

export interface MetricSummary {
  simTime:    number
  narratives: MetricNarrative[]
}

// ── Band classification ───────────────────────────────────────────────────────

function classifyBand(
  value:   number,
  warning: number | null | undefined,
  critical: number | null | undefined,
  archetype: string,
): StatusBand {
  if (critical != null && value >= critical) return 'critical'
  if (warning  != null && value >= warning)  return 'warning'

  // For metrics where lower is worse (availability, throughput, request_rate during
  // shedding), the scenario author sets criticalThreshold as a lower bound.
  // We detect this by checking if this is an "inverse" archetype.
  const inverseArchetypes = new Set([
    'availability', 'conversion_rate', 'throughput_bytes',
    'request_rate', 'active_users',
  ])
  if (inverseArchetypes.has(archetype)) {
    if (critical != null && value <= critical) return 'critical'
    if (warning  != null && value <= warning)  return 'warning'
  }

  return 'healthy'
}

// ── Slope derivation ──────────────────────────────────────────────────────────

function computeSlope(
  service:   string,
  metricId:  string,
  simTime:   number,
  baseline:  number,
  store:     MetricStore,
): SlopeLabel {
  const allSeries = store.getAllSeries()
  const pts = (allSeries[service]?.[metricId] ?? [])
    .filter(p => p.t > simTime - SLOPE_WINDOW_SECONDS && p.t <= simTime)

  if (pts.length < 3) return 'unknown'

  // Simple linear regression over the window
  const n    = pts.length
  const sumX  = pts.reduce((a, p) => a + p.t, 0)
  const sumY  = pts.reduce((a, p) => a + p.v, 0)
  const sumXY = pts.reduce((a, p) => a + p.t * p.v, 0)
  const sumX2 = pts.reduce((a, p) => a + p.t * p.t, 0)
  const slopePerSecond = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const slopePerMinute = slopePerSecond * 60

  // Normalise against baseline so the threshold is scale-invariant
  const ref = baseline > 0 ? baseline : 1
  const normalised = slopePerMinute / ref

  if (normalised >  SLOPE_THRESHOLD_FRACTION * 3) return 'rising sharply'
  if (normalised >  SLOPE_THRESHOLD_FRACTION)     return 'rising'
  if (normalised < -SLOPE_THRESHOLD_FRACTION * 3) return 'recovering'
  if (normalised < -SLOPE_THRESHOLD_FRACTION)     return 'falling'
  return 'stable'
}

// ── Time-in-band ──────────────────────────────────────────────────────────────

/**
 * Returns the number of seconds the metric has continuously been in its current
 * status band. Walks backwards from simTime until the band changes.
 */
function computeTimeInBand(
  service:   string,
  metricId:  string,
  simTime:   number,
  currentBand: StatusBand,
  warning:   number | null | undefined,
  critical:  number | null | undefined,
  archetype: string,
  store:     MetricStore,
): number {
  const allSeries = store.getAllSeries()
  const pts = allSeries[service]?.[metricId] ?? []

  // Walk backwards from the current sim time
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i].t > simTime) continue
    const band = classifyBand(pts[i].v, warning, critical, archetype)
    if (band !== currentBand) {
      return simTime - pts[i].t
    }
  }
  // Been in this band for the entire recorded series
  return simTime - (pts[0]?.t ?? simTime)
}

// ── Pre-incident baseline snapshot ───────────────────────────────────────────

function getPreIncidentValue(
  service:     string,
  metricId:    string,
  onsetSecond: number,
  store:       MetricStore,
): number | null {
  // Use the point just before onset as the pre-incident anchor
  return store.getCurrentValue(service, metricId, onsetSecond - 1)
}

// ── Value formatting ──────────────────────────────────────────────────────────

function fmt(value: number, unit: string): string {
  let rounded: number
  if (unit === 'ms' || unit === 'bytes/s' || unit === 'iops' || unit === 'count' || unit === 'mb') {
    rounded = Math.round(value)
  } else if (unit === 'percent') {
    rounded = parseFloat(value.toFixed(1))
  } else {
    rounded = parseFloat(value.toFixed(2))
  }

  // Unit display formatting
  switch (unit) {
    case 'percent':   return `${rounded}%`
    case 'ms':        return `${rounded}ms`
    case 'rps':       return `${rounded} rps`
    case 'mb':        return `${rounded} MB`
    case 'bytes/s':   return `${fmtBytes(rounded)}/s`
    case 'iops':      return `${rounded} IOPS`
    case 'count':     return String(rounded)
    case 'days':      return `${rounded}d`
    default:          return unit ? `${rounded} ${unit}` : String(rounded)
  }
}

function fmtBytes(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`
  if (b >= 1_000)     return `${(b / 1_000).toFixed(1)} KB`
  return `${b} B`
}

function fmtSeconds(s: number): string {
  if (s < 90)  return `${Math.round(s)}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${(s / 3600).toFixed(1)}h`
}

// ── Sentence template selection ───────────────────────────────────────────────
//
// Templates are selected by the combination of (status, slope, hasPreIncident).
// They produce a single description the LLM can use verbatim or paraphrase.

function buildSentence(n: MetricNarrative, archetype: string): string {
  const { label, unit, status, currentValue, preIncident, slope, timeInBand } = n

  if (currentValue === null) return `${label}: no data`

  const cur      = fmt(currentValue, unit)
  const pre      = preIncident != null ? fmt(preIncident, unit) : null
  const duration = fmtSeconds(timeInBand)

  // Exonerated — called out explicitly so personas don't over-index on it
  // (handled at the call site, but guard here too)
  if (status === 'healthy' && slope === 'stable') {
    return pre != null
      ? `${label} is normal at ${cur} (was ${pre} before incident — no change).`
      : `${label} is normal at ${cur}.`
  }

  if (status === 'healthy' && (slope === 'recovering' || slope === 'falling')) {
    return pre != null
      ? `${label} has recovered to ${cur} (was ${pre} before the incident). Back to normal.`
      : `${label} is back to normal at ${cur}.`
  }

  if (status === 'critical') {
    const sinceClause = timeInBand > 5 ? `, critical for ${duration}` : ''
    const preClause   = pre != null ? ` (was ${pre} before incident)` : ''

    if (slope === 'rising sharply') {
      return `${label} is at ${cur}${preClause} and still climbing sharply${sinceClause}.`
    }
    if (slope === 'rising') {
      return `${label} is at ${cur}${preClause} and still rising${sinceClause}.`
    }
    if (slope === 'stable') {
      // Saturated — common for pool exhaustion, cpu pegged at 100%
      const saturationArchetypes = new Set([
        'connection_pool_used', 'cpu_utilization', 'queue_depth', 'thread_count',
      ])
      if (saturationArchetypes.has(archetype)) {
        return `${label} is fully saturated at ${cur}${preClause} — no headroom, has been stuck here for ${duration}.`
      }
      return `${label} is at ${cur}${preClause} — sustained critical level for ${duration}.`
    }
    if (slope === 'recovering' || slope === 'falling') {
      return `${label} is still critical at ${cur}${preClause} but starting to come down (${duration} at critical level).`
    }
    return `${label} is critical at ${cur}${preClause}${sinceClause}.`
  }

  if (status === 'warning') {
    const sinceClause = timeInBand > 5 ? ` for the past ${duration}` : ''
    const preClause   = pre != null ? ` (was ${pre} before incident)` : ''

    if (slope === 'rising sharply' || slope === 'rising') {
      return `${label} is elevated at ${cur}${preClause} and still rising — approaching critical${sinceClause}.`
    }
    if (slope === 'stable') {
      return `${label} is elevated at ${cur}${preClause} — holding at warning level${sinceClause}.`
    }
    if (slope === 'recovering' || slope === 'falling') {
      return `${label} was elevated but is now improving — currently ${cur}${preClause}.`
    }
    return `${label} is at warning level: ${cur}${preClause}${sinceClause}.`
  }

  // Healthy but moving — anomalous (rising healthy metric, or early-onset)
  if (slope === 'rising sharply' || slope === 'rising') {
    return pre != null
      ? `${label} is rising (${pre} → ${cur}) but not yet at warning threshold.`
      : `${label} is rising at ${cur} — not yet at warning threshold.`
  }

  return `${label}: ${cur}.`
}

// ── Main computation ──────────────────────────────────────────────────────────

/**
 * Builds a MetricNarrative for a single service+metric at the given simTime.
 */
function buildNarrative(
  service:      string,
  metricId:     string,
  label:        string,
  unit:         string,
  archetype:    string,
  warning:      number | null | undefined,
  critical:     number | null | undefined,
  store:        MetricStore,
  simTime:      number,
): MetricNarrative {
  const rp           = store.getResolvedParams(service, metricId)
  const baseline     = rp?.baselineValue ?? 1
  const onsetSecond  = rp?.onsetSecond ?? 0

  const currentValue  = store.getCurrentValue(service, metricId, simTime)
  const preIncident   = getPreIncidentValue(service, metricId, onsetSecond, store)
  const status        = currentValue != null
    ? classifyBand(currentValue, warning, critical, archetype)
    : 'unknown'
  const slope         = currentValue != null
    ? computeSlope(service, metricId, simTime, baseline, store)
    : 'unknown'
  const timeInBand    = currentValue != null
    ? computeTimeInBand(service, metricId, simTime, status, warning, critical, archetype, store)
    : 0

  const partial: MetricNarrative = {
    service, metricId, label, unit, status,
    currentValue, preIncident, slope, timeInBand,
    sentence: '',   // filled below
  }
  partial.sentence = buildSentence(partial, archetype)
  return partial
}

/**
 * Builds a MetricSummary for all services in the scenario at the given simTime.
 */
export function computeMetricSummary(
  scenario: LoadedScenario,
  store:    MetricStore,
  simTime:  number,
): MetricSummary {
  const narratives: MetricNarrative[] = []

  for (const metric of scenario.opsDashboard.focalService.metrics) {
    narratives.push(buildNarrative(
      scenario.opsDashboard.focalService.name,
      metric.archetype,
      metric.label ?? metric.archetype,
      metric.unit ?? '',
      metric.archetype,
      metric.warningThreshold,
      metric.criticalThreshold,
      store,
      simTime,
    ))
  }

  for (const cs of scenario.opsDashboard.correlatedServices) {
    for (const metric of (cs.overrides ?? [])) {
      narratives.push(buildNarrative(
        cs.name,
        metric.archetype,
        metric.label ?? metric.archetype,
        metric.unit ?? '',
        metric.archetype,
        metric.warningThreshold,
        metric.criticalThreshold,
        store,
        simTime,
      ))
    }
  }

  return { simTime, narratives }
}

// ── Text rendering ────────────────────────────────────────────────────────────

/**
 * Renders a MetricSummary as a text block for the stakeholder engine system
 * prompt. Groups by service and gates verbosity by correlation type.
 */
export function renderMetricSummary(
  summary:  MetricSummary,
  scenario: LoadedScenario,
): string {
  if (summary.narratives.length === 0) return ''

  // Build correlation lookup: service → CorrelationType
  const correlationOf = new Map<string, CorrelationType | 'focal'>()
  correlationOf.set(scenario.opsDashboard.focalService.name, 'focal')
  for (const cs of scenario.opsDashboard.correlatedServices) {
    correlationOf.set(cs.name, cs.correlation)
  }

  const lines: string[] = [
    '## Current System State (grounded — do not contradict these values)',
    '',
    'The following is the actual metric state right now. Personas MUST reflect this.',
    'Do not describe a metric as improving if it is marked rising or stable-critical.',
    'Do not describe a metric as worsening if it is marked recovering.',
    '',
  ]

  // Group by service
  const byService = new Map<string, MetricNarrative[]>()
  for (const n of summary.narratives) {
    if (!byService.has(n.service)) byService.set(n.service, [])
    byService.get(n.service)!.push(n)
  }

  for (const [service, narratives] of byService) {
    const correlation = correlationOf.get(service) ?? 'independent'

    if (correlation === 'exonerated') {
      // Single line — don't draw attention to it
      lines.push(`**${service}** — not involved in this incident (all metrics normal).`)
      continue
    }

    lines.push(`**${service}**${correlation === 'focal' ? ' (focal service)' : ''}:`)

    for (const n of narratives) {
      if (correlation === 'independent') {
        // Brief — current value and status only, no trajectory
        const cur = n.currentValue != null ? fmt(n.currentValue, n.unit) : 'N/A'
        lines.push(`  - ${n.label}: ${cur} [${n.status}]`)
      } else {
        // Full narrative for focal and upstream_impact
        lines.push(`  - ${n.sentence}`)
      }
    }

    lines.push('')
  }

  return lines.join('\n')
}
