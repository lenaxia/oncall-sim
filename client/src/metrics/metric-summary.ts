// metric-summary.ts — produces a grounded, LLM-consumable narrative description of current metric state.

import type { LoadedScenario } from "../scenario/types";
import type { MetricStore } from "./metric-store";
import type { CorrelationType } from "../scenario/types";

const SLOPE_WINDOW_SECONDS = 60;
const SLOPE_THRESHOLD_FRACTION = 0.04;

export type StatusBand = "healthy" | "warning" | "critical" | "unknown";
export type SlopeLabel =
  | "rising sharply"
  | "rising"
  | "stable"
  | "falling"
  | "recovering"
  | "unknown";

export interface MetricNarrative {
  service: string;
  metricId: string;
  label: string;
  unit: string;
  status: StatusBand;
  currentValue: number | null;
  preIncident: number | null;
  slope: SlopeLabel;
  timeInBand: number;
  sentence: string;
}

export interface MetricSummary {
  simTime: number;
  narratives: MetricNarrative[];
}

function classifyBand(
  value: number,
  warning: number | null | undefined,
  critical: number | null | undefined,
  archetype: string,
): StatusBand {
  if (critical != null && value >= critical) return "critical";
  if (warning != null && value >= warning) return "warning";

  const inverseArchetypes = new Set([
    "availability",
    "conversion_rate",
    "throughput_bytes",
    "request_rate",
    "active_users",
  ]);
  if (inverseArchetypes.has(archetype)) {
    if (critical != null && value <= critical) return "critical";
    if (warning != null && value <= warning) return "warning";
  }

  return "healthy";
}

function computeSlope(
  service: string,
  metricId: string,
  simTime: number,
  baseline: number,
  store: MetricStore,
): SlopeLabel {
  const allSeries = store.getAllSeries();
  const pts = (allSeries[service]?.[metricId] ?? []).filter(
    (p) => p.t > simTime - SLOPE_WINDOW_SECONDS && p.t <= simTime,
  );

  if (pts.length < 3) return "unknown";

  const n = pts.length;
  const sumX = pts.reduce((a, p) => a + p.t, 0);
  const sumY = pts.reduce((a, p) => a + p.v, 0);
  const sumXY = pts.reduce((a, p) => a + p.t * p.v, 0);
  const sumX2 = pts.reduce((a, p) => a + p.t * p.t, 0);
  const slopePerSecond = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const slopePerMinute = slopePerSecond * 60;
  const ref = baseline > 0 ? baseline : 1;
  const normalised = slopePerMinute / ref;

  if (normalised > SLOPE_THRESHOLD_FRACTION * 3) return "rising sharply";
  if (normalised > SLOPE_THRESHOLD_FRACTION) return "rising";
  if (normalised < -SLOPE_THRESHOLD_FRACTION * 3) return "recovering";
  if (normalised < -SLOPE_THRESHOLD_FRACTION) return "falling";
  return "stable";
}

function computeTimeInBand(
  service: string,
  metricId: string,
  simTime: number,
  currentBand: StatusBand,
  warning: number | null | undefined,
  critical: number | null | undefined,
  archetype: string,
  store: MetricStore,
): number {
  const allSeries = store.getAllSeries();
  const pts = allSeries[service]?.[metricId] ?? [];
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i].t > simTime) continue;
    const band = classifyBand(pts[i].v, warning, critical, archetype);
    if (band !== currentBand) return simTime - pts[i].t;
  }
  return simTime - (pts[0]?.t ?? simTime);
}

function getPreIncidentValue(
  service: string,
  metricId: string,
  onsetSecond: number,
  store: MetricStore,
): number | null {
  return store.getCurrentValue(service, metricId, onsetSecond - 1);
}

function fmt(value: number, unit: string): string {
  let rounded: number;
  if (
    unit === "ms" ||
    unit === "bytes/s" ||
    unit === "iops" ||
    unit === "count" ||
    unit === "mb"
  ) {
    rounded = Math.round(value);
  } else if (unit === "percent") {
    rounded = parseFloat(value.toFixed(1));
  } else {
    rounded = parseFloat(value.toFixed(2));
  }
  switch (unit) {
    case "percent":
      return `${rounded}%`;
    case "ms":
      return `${rounded}ms`;
    case "rps":
      return `${rounded} rps`;
    case "mb":
      return `${rounded} MB`;
    case "bytes/s":
      return `${fmtBytes(rounded)}/s`;
    case "iops":
      return `${rounded} IOPS`;
    case "count":
      return String(rounded);
    case "days":
      return `${rounded}d`;
    default:
      return unit ? `${rounded} ${unit}` : String(rounded);
  }
}

function fmtBytes(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`;
  if (b >= 1_000) return `${(b / 1_000).toFixed(1)} KB`;
  return `${b} B`;
}

function fmtSeconds(s: number): string {
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function buildSentence(n: MetricNarrative, archetype: string): string {
  const { label, unit, status, currentValue, preIncident, slope, timeInBand } =
    n;
  if (currentValue === null) return `${label}: no data`;

  const cur = fmt(currentValue, unit);
  const pre = preIncident != null ? fmt(preIncident, unit) : null;
  const duration = fmtSeconds(timeInBand);

  if (status === "healthy" && slope === "stable") {
    return pre != null
      ? `${label} is normal at ${cur} (was ${pre} before incident — no change).`
      : `${label} is normal at ${cur}.`;
  }
  if (status === "healthy" && (slope === "recovering" || slope === "falling")) {
    return pre != null
      ? `${label} has recovered to ${cur} (was ${pre} before the incident). Back to normal.`
      : `${label} is back to normal at ${cur}.`;
  }
  if (status === "critical") {
    const sinceClause = timeInBand > 5 ? `, critical for ${duration}` : "";
    const preClause = pre != null ? ` (was ${pre} before incident)` : "";
    if (slope === "rising sharply")
      return `${label} is at ${cur}${preClause} and still climbing sharply${sinceClause}.`;
    if (slope === "rising")
      return `${label} is at ${cur}${preClause} and still rising${sinceClause}.`;
    if (slope === "stable") {
      const saturationArchetypes = new Set([
        "connection_pool_used",
        "cpu_utilization",
        "queue_depth",
        "thread_count",
      ]);
      if (saturationArchetypes.has(archetype)) {
        return `${label} is fully saturated at ${cur}${preClause} — no headroom, has been stuck here for ${duration}.`;
      }
      return `${label} is at ${cur}${preClause} — sustained critical level for ${duration}.`;
    }
    if (slope === "recovering" || slope === "falling") {
      return `${label} is still critical at ${cur}${preClause} but starting to come down (${duration} at critical level).`;
    }
    return `${label} is critical at ${cur}${preClause}${sinceClause}.`;
  }
  if (status === "warning") {
    const sinceClause = timeInBand > 5 ? ` for the past ${duration}` : "";
    const preClause = pre != null ? ` (was ${pre} before incident)` : "";
    if (slope === "rising sharply" || slope === "rising") {
      return `${label} is elevated at ${cur}${preClause} and still rising — approaching critical${sinceClause}.`;
    }
    if (slope === "stable") {
      return `${label} is elevated at ${cur}${preClause} — holding at warning level${sinceClause}.`;
    }
    if (slope === "recovering" || slope === "falling") {
      return `${label} was elevated but is now improving — currently ${cur}${preClause}.`;
    }
    return `${label} is at warning level: ${cur}${preClause}${sinceClause}.`;
  }
  if (slope === "rising sharply" || slope === "rising") {
    return pre != null
      ? `${label} is rising (${pre} → ${cur}) but not yet at warning threshold.`
      : `${label} is rising at ${cur} — not yet at warning threshold.`;
  }
  return `${label}: ${cur}.`;
}

function buildNarrative(
  service: string,
  metricId: string,
  label: string,
  unit: string,
  archetype: string,
  warning: number | null | undefined,
  critical: number | null | undefined,
  store: MetricStore,
  simTime: number,
): MetricNarrative {
  const rp = store.getResolvedParams(service, metricId);
  const baseline = rp?.baselineValue ?? 1;
  const onsetSecond = rp?.onsetSecond ?? 0;

  const currentValue = store.getCurrentValue(service, metricId, simTime);
  const preIncident = getPreIncidentValue(
    service,
    metricId,
    onsetSecond,
    store,
  );
  const status =
    currentValue != null
      ? classifyBand(currentValue, warning, critical, archetype)
      : "unknown";
  const slope =
    currentValue != null
      ? computeSlope(service, metricId, simTime, baseline, store)
      : "unknown";
  const timeInBand =
    currentValue != null
      ? computeTimeInBand(
          service,
          metricId,
          simTime,
          status,
          warning,
          critical,
          archetype,
          store,
        )
      : 0;

  const partial: MetricNarrative = {
    service,
    metricId,
    label,
    unit,
    status,
    currentValue,
    preIncident,
    slope,
    timeInBand,
    sentence: "",
  };
  partial.sentence = buildSentence(partial, archetype);
  return partial;
}

export function computeMetricSummary(
  scenario: LoadedScenario,
  store: MetricStore,
  simTime: number,
): MetricSummary {
  const narratives: MetricNarrative[] = [];

  for (const metric of scenario.opsDashboard.focalService.metrics) {
    narratives.push(
      buildNarrative(
        scenario.opsDashboard.focalService.name,
        metric.archetype,
        metric.label ?? metric.archetype,
        metric.unit ?? "",
        metric.archetype,
        metric.warningThreshold,
        metric.criticalThreshold,
        store,
        simTime,
      ),
    );
  }

  for (const cs of scenario.opsDashboard.correlatedServices) {
    for (const metric of cs.overrides ?? []) {
      narratives.push(
        buildNarrative(
          cs.name,
          metric.archetype,
          metric.label ?? metric.archetype,
          metric.unit ?? "",
          metric.archetype,
          metric.warningThreshold,
          metric.criticalThreshold,
          store,
          simTime,
        ),
      );
    }
  }

  return { simTime, narratives };
}

export function renderMetricSummary(
  summary: MetricSummary,
  scenario: LoadedScenario,
): string {
  if (summary.narratives.length === 0) return "";

  const correlationOf = new Map<string, CorrelationType | "focal">();
  correlationOf.set(scenario.opsDashboard.focalService.name, "focal");
  for (const cs of scenario.opsDashboard.correlatedServices) {
    correlationOf.set(cs.name, cs.correlation);
  }

  const lines: string[] = [
    "## Current System State (grounded — do not contradict these values)",
    "",
    "The following is the actual metric state right now. Personas MUST reflect this.",
    "Do not describe a metric as improving if it is marked rising or stable-critical.",
    "Do not describe a metric as worsening if it is marked recovering.",
    "",
  ];

  const byService = new Map<string, MetricNarrative[]>();
  for (const n of summary.narratives) {
    if (!byService.has(n.service)) byService.set(n.service, []);
    byService.get(n.service)!.push(n);
  }

  for (const [service, narratives] of byService) {
    const correlation = correlationOf.get(service) ?? "independent";

    if (correlation === "exonerated") {
      lines.push(
        `**${service}** — not involved in this incident (all metrics normal).`,
      );
      continue;
    }

    lines.push(
      `**${service}**${correlation === "focal" ? " (focal service)" : ""}:`,
    );

    for (const n of narratives) {
      if (correlation === "independent") {
        const cur =
          n.currentValue != null ? fmt(n.currentValue, n.unit) : "N/A";
        lines.push(`  - ${n.label}: ${cur} [${n.status}]`);
      } else {
        lines.push(`  - ${n.sentence}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}
