import { useMemo, memo, useState, useRef, useEffect } from "react";
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
  onFirstHover?: () => void;
}

// Default visible window: 4 hours of sim-time
const DEFAULT_WINDOW_SECONDS = 4 * 3600;

// Binary search: first index where arr[i].t >= target
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
  // Downsample old history for chart rendering — memoised on the raw series
  // reference so it only reruns when this specific metric gets a new point.
  const prepared = useMemo(() => prepareChartSeries(series), [series]);

  // All points up to now
  const visible = useMemo(
    () => prepared.filter((p) => p.t <= simTime),
    [prepared, simTime],
  );

  const current = visible.length > 0 ? visible[visible.length - 1].v : null;

  // Default 4h window indices
  const windowStart = simTime - DEFAULT_WINDOW_SECONDS;
  const defaultStartIndex = useMemo(
    () =>
      Math.min(
        lowerBound(visible, windowStart),
        Math.max(0, visible.length - 1),
      ),
    [visible, windowStart],
  );
  const defaultEndIndex = Math.max(0, visible.length - 1);

  // User-override brush indices. null = use the auto-computed default.
  const [userBrushStart, setUserBrushStart] = useState<number | null>(null);
  const [userBrushEnd, setUserBrushEnd] = useState<number | null>(null);

  const brushStart =
    userBrushStart !== null
      ? Math.min(userBrushStart, defaultEndIndex)
      : defaultStartIndex;
  const brushEnd =
    userBrushEnd !== null
      ? Math.min(userBrushEnd, defaultEndIndex)
      : defaultEndIndex;

  const windowed = useMemo(
    () => visible.slice(brushStart, brushEnd + 1),
    [visible, brushStart, brushEnd],
  );

  // Track whether the container div has been measured by the browser.
  // Recharts Brush computes traveller positions as (index/total)*containerWidth.
  // If the container width is 0 or -1 (before ResizeObserver fires), those
  // positions are NaN and the Brush renders broken. We defer the Brush until
  // the container has a real positive width.
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerReady, setContainerReady] = useState(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setContainerReady(true);
    });
    ro.observe(el);
    // Also check immediately in case it's already laid out
    if (el.offsetWidth > 0) setContainerReady(true);
    return () => ro.disconnect();
  }, []);

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
    const dayLabel = d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    return `${dayLabel} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  }

  const hasData = windowed.length >= 2;

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

      {/* Chart — min-w-0 prevents grid cell overflow collapsing measured width to 0 */}
      <div
        ref={containerRef}
        className="h-[220px] w-full min-w-0"
        onMouseEnter={onFirstHover}
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={1}>
          <LineChart
            data={hasData ? windowed : []}
            margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
          >
            <CartesianGrid stroke="#21262d" strokeDasharray="3 3" />
            {hasData && (
              <>
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
                  domain={[
                    0,
                    (dataMax: number) =>
                      Math.ceil(
                        Math.max(dataMax, criticalThreshold ?? 0) * 1.1,
                      ),
                  ]}
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
                  labelStyle={{
                    color: "#8b949e",
                    fontSize: 12,
                    marginBottom: 4,
                  }}
                  labelFormatter={fmtTooltipLabel}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={
                    ((value: number) =>
                      `${value.toFixed(2)} ${unit}`.trim()) as any
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
                {/* Brush minimap — deferred until container has a real pixel
                    width so Recharts doesn't compute NaN traveller positions */}
                {visible.length > 2 && containerReady && (
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
                        const atLiveEnd = range.endIndex >= visible.length - 1;
                        if (atLiveEnd) {
                          setUserBrushStart(null);
                          setUserBrushEnd(null);
                        } else {
                          setUserBrushStart(range.startIndex);
                          setUserBrushEnd(range.endIndex);
                        }
                      }
                    }}
                    height={28}
                    stroke="#30363d"
                    fill="#161b22"
                    travellerWidth={6}
                    tickFormatter={fmtTick}
                  />
                )}
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
