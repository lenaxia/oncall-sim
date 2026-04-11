import { useMemo, memo, useState, useEffect } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Brush,
} from "recharts";
import type { TimeSeriesPoint } from "@shared/types/events";
import { Badge } from "../Badge";

interface MetricChartProps {
  metricId: string;
  service: string;
  label: string;
  unit: string;
  series: TimeSeriesPoint[];
  simTime: number;
  clockAnchorMs: number;
  criticalThreshold?: number; // single alarm threshold — red line when breached
  onFirstHover?: () => void;
}

// Default visible window: 4 hours of sim-time
const DEFAULT_WINDOW_SECONDS = 4 * 3600;

// Binary search: returns index of first element where arr[i].t >= target.
// Returns arr.length when all elements are before target.
// O(log n) vs O(n) for findIndex on large pre-incident history arrays.
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
  onFirstHover,
}: MetricChartProps) {
  // All points up to now — memoised so the filter only re-runs when series
  // reference changes (new reactive overlay spliced in) or simTime crosses a
  // point boundary. At 10x speed simTime ticks every 100ms real-time; without
  // memo this filter ran 40× per tick across the full dashboard.
  const visible = useMemo(
    () => series.filter((p) => p.t <= simTime),
    [series, simTime],
  );
  const current = visible.length > 0 ? visible[visible.length - 1].v : null;

  // The chart line and XAxis render only the last 4h by default.
  // The Brush minimap receives the full visible series so the trainee
  // can slide the handles to pan back into older history.
  const windowStart = simTime - DEFAULT_WINDOW_SECONDS;
  const defaultStartIndex = useMemo(
    () =>
      Math.min(
        lowerBound(visible, windowStart),
        Math.max(0, visible.length - 1),
      ),
    [visible, windowStart],
  );
  const defaultEndIndex = visible.length > 0 ? visible.length - 1 : 0;

  // Controlled brush indices — initialised to the 4h window, updated on drag.
  // Reset to the default window whenever new points arrive (simTime advances).
  const [brushStart, setBrushStart] = useState(defaultStartIndex);
  const [brushEnd, setBrushEnd] = useState(defaultEndIndex);

  // When the trailing edge of the default window moves forward (new point
  // appended), auto-advance the brush end so the window tracks the present —
  // but only when the user hasn't zoomed out (brushEnd was already at the last
  // point before the new one arrived).
  useEffect(() => {
    if (brushEnd >= visible.length - 2) {
      // User is viewing the live end — keep them there
      setBrushEnd(defaultEndIndex);
      setBrushStart(defaultStartIndex);
    }
  }, [defaultStartIndex, defaultEndIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // The data slice the chart actually renders
  const windowed = useMemo(
    () => visible.slice(brushStart, brushEnd + 1),
    [visible, brushStart, brushEnd],
  );

  const breaching =
    criticalThreshold != null &&
    current != null &&
    current >= criticalThreshold;
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
    // Show full date+time if history spans multiple days
    const dayLabel = d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    return `${dayLabel} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  }

  return (
    <div className="bg-sim-surface border border-sim-border rounded overflow-hidden">
      {/* Header */}
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

      {/* Chart */}
      <div className="h-[220px] w-full" onMouseEnter={onFirstHover}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={windowed}
            margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
          >
            <CartesianGrid stroke="#21262d" strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              tick={{ fill: "#8b949e", fontSize: 10, fontFamily: "monospace" }}
              tickFormatter={fmtTick}
              axisLine={{ stroke: "#30363d" }}
              tickLine={false}
              minTickGap={50}
            />
            <YAxis
              domain={[
                0,
                (dataMax: number) =>
                  Math.ceil(Math.max(dataMax, criticalThreshold ?? 0) * 1.1),
              ]}
              tick={{ fill: "#8b949e", fontSize: 10, fontFamily: "monospace" }}
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
            {/* Brush: minimap over full history so trainee can pan back */}
            {visible.length > 1 && (
              <Brush
                data={visible}
                dataKey="t"
                startIndex={brushStart}
                endIndex={brushEnd}
                onChange={(range) => {
                  if (
                    range &&
                    typeof range.startIndex === "number" &&
                    typeof range.endIndex === "number"
                  ) {
                    setBrushStart(range.startIndex);
                    setBrushEnd(range.endIndex);
                  }
                }}
                height={28}
                stroke="#30363d"
                fill="#161b22"
                travellerWidth={6}
                tickFormatter={fmtTick}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
