import { useMemo, memo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import type { TimeSeriesPoint } from "@shared/types/events";
import { Badge } from "../Badge";
import { prepareChartSeries } from "../../metrics/downsample";

interface MetricChartProps {
  metricId: string;
  service: string;
  label: string;
  unit: string;
  series: TimeSeriesPoint[];
  simTime: number;
  clockAnchorMs: number;
  criticalThreshold?: number;
  /** Whether the metric is bad when high (>=) or bad when low (<=). Default: "high". */
  thresholdDirection?: "high" | "low";
  onFirstHover?: () => void;
}

const DEFAULT_WINDOW_SECONDS = 4 * 3600;

function lowerBound(arr: TimeSeriesPoint[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].t < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const MetricChart = memo(function MetricChart({
  metricId: _metricId,
  service: _service,
  label,
  unit,
  series,
  simTime,
  clockAnchorMs,
  criticalThreshold,
  thresholdDirection = "high",
  onFirstHover,
}: MetricChartProps) {
  const prepared = useMemo(() => prepareChartSeries(series), [series]);

  // Last 4 hours of visible data
  const windowed = useMemo(() => {
    const windowStart = simTime - DEFAULT_WINDOW_SECONDS;
    const all = prepared.filter((p) => p.t <= simTime);
    const startIdx = lowerBound(all, windowStart);
    return all.slice(startIdx);
  }, [prepared, simTime]);

  const current = windowed.length > 0 ? windowed[windowed.length - 1].v : null;

  const breaching =
    criticalThreshold != null &&
    current != null &&
    (thresholdDirection === "low"
      ? current <= criticalThreshold
      : current >= criticalThreshold);
  const lineColor = breaching ? "#f85149" : "#1f6feb";

  const valueDisplay =
    current != null
      ? `${current.toFixed(current < 10 ? 2 : 1)} ${unit}`.trim()
      : "—";

  function fmtTick(t: number): string {
    if (!clockAnchorMs) return "";
    const d = new Date(clockAnchorMs + t * 1000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function fmtTooltipLabel(t: number): string {
    if (!clockAnchorMs) return String(t);
    const d = new Date(clockAnchorMs + t * 1000);
    const dayLabel = d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    return `${dayLabel} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  }

  return (
    <div className="bg-sim-surface border border-sim-border rounded overflow-hidden">
      <div className="px-3 py-1.5 border-b border-sim-border flex items-center justify-between">
        <span className="text-xs font-medium text-sim-text">{label}</span>
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-semibold tabular-nums ${breaching ? "text-sim-red" : "text-sim-text"}`}
          >
            {valueDisplay}
          </span>
          {breaching && <Badge label="ALARM" variant="sev1" />}
        </div>
      </div>

      <div className="h-[220px] w-full min-w-0" onMouseEnter={onFirstHover}>
        <ResponsiveContainer width="100%" height="100%" minWidth={1}>
          <LineChart
            data={windowed}
            margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
          >
            <CartesianGrid stroke="#21262d" strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tick={{
                fill: "#8b949e",
                fontSize: 10,
                fontFamily: "monospace",
              }}
              tickFormatter={fmtTick}
              axisLine={{ stroke: "#30363d" }}
              tickLine={false}
              minTickGap={50}
            />
            <YAxis
              domain={
                thresholdDirection === "low"
                  ? // For low-direction metrics (cert_expiry, availability): show from 0
                    // to slightly above the max data value, with the threshold line visible
                    [0, (dataMax: number) => Math.ceil(dataMax * 1.1)]
                  : [
                      0,
                      (dataMax: number) =>
                        Math.ceil(
                          Math.max(dataMax, criticalThreshold ?? 0) * 1.1,
                        ),
                    ]
              }
              tick={{
                fill: "#8b949e",
                fontSize: 10,
                fontFamily: "monospace",
              }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip
              contentStyle={{
                background: "#1c2128",
                border: "1px solid #30363d",
                borderRadius: 6,
                fontSize: 13,
                fontFamily: "monospace",
                padding: "8px 12px",
                lineHeight: "1.6",
              }}
              itemStyle={{ color: "#e6edf3", fontSize: 13 }}
              labelStyle={{ color: "#8b949e", fontSize: 12, marginBottom: 4 }}
              labelFormatter={fmtTooltipLabel}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={
                ((value: number) => `${value.toFixed(2)} ${unit}`.trim()) as any
              }
            />
            {criticalThreshold != null && (
              <ReferenceLine
                y={criticalThreshold}
                stroke="#f85149"
                strokeDasharray="4 2"
                strokeWidth={1}
              />
            )}
            <Line
              type="monotone"
              dataKey="v"
              stroke={lineColor}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 4, stroke: "none" }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
