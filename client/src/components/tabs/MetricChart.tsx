import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Brush,
} from 'recharts'
import type { TimeSeriesPoint } from '@shared/types/events'
import { Badge } from '../Badge'

interface MetricChartProps {
  metricId:           string
  service:            string
  label:              string
  unit:               string
  series:             TimeSeriesPoint[]
  simTime:            number
  clockAnchorMs:      number
  criticalThreshold?: number   // single alarm threshold — red line when breached
  onFirstHover?:      () => void
}

// Default visible window: 4 hours of sim-time
const DEFAULT_WINDOW_SECONDS = 4 * 3600

export function MetricChart({
  metricId: _metricId, service: _service, label, unit, series, simTime,
  clockAnchorMs, criticalThreshold, onFirstHover,
}: MetricChartProps) {
  // All points up to now
  const visible = series.filter(p => p.t <= simTime)
  const current = visible.length > 0 ? visible[visible.length - 1].v : null

  // Default brush window: show last DEFAULT_WINDOW_SECONDS ending at simTime
  const windowStart = simTime - DEFAULT_WINDOW_SECONDS
  const defaultStartIndex = Math.max(
    0,
    visible.findIndex(p => p.t >= windowStart)
  )
  const defaultEndIndex = visible.length > 0 ? visible.length - 1 : 0

  const breaching = criticalThreshold != null && current != null && current >= criticalThreshold
  const lineColor = breaching ? '#f85149' : '#1f6feb'

  const valueDisplay = current != null
    ? `${current.toFixed(current < 10 ? 2 : 1)} ${unit}`.trim()
    : '—'

  function fmtTick(t: number): string {
    if (!clockAnchorMs) return ''
    const d = new Date(clockAnchorMs + t * 1000)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  function fmtTooltipLabel(t: number): string {
    if (!clockAnchorMs) return String(t)
    const d = new Date(clockAnchorMs + t * 1000)
    // Show full date+time if history spans multiple days
    const dayLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return `${dayLabel} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  }

  return (
    <div className="bg-sim-surface border border-sim-border rounded overflow-hidden">
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-sim-border flex items-center justify-between">
        <span className="text-xs font-medium text-sim-text">{label}</span>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold tabular-nums ${breaching ? 'text-sim-red' : 'text-sim-text'}`}>
            {valueDisplay}
          </span>
          {breaching && <Badge label="ALARM" variant="sev1" />}
        </div>
      </div>

      {/* Chart */}
      <div
        className="h-[220px] w-full"
        onMouseEnter={onFirstHover}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={visible} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#21262d" strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              tick={{ fill: '#8b949e', fontSize: 10, fontFamily: 'monospace' }}
              tickFormatter={fmtTick}
              axisLine={{ stroke: '#30363d' }}
              tickLine={false}
              minTickGap={50}
            />
            <YAxis
              tick={{ fill: '#8b949e', fontSize: 10, fontFamily: 'monospace' }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip
              contentStyle={{
                background:   '#1c2128',
                border:       '1px solid #30363d',
                borderRadius: 6,
                fontSize:     13,
                fontFamily:   'monospace',
                padding:      '8px 12px',
                lineHeight:   '1.6',
              }}
              itemStyle={{ color: '#e6edf3', fontSize: 13 }}
              labelStyle={{ color: '#8b949e', fontSize: 12, marginBottom: 4 }}
              labelFormatter={fmtTooltipLabel}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={((value: number) => `${value.toFixed(2)} ${unit}`.trim()) as any}
            />
            {criticalThreshold != null && (
              <ReferenceLine y={criticalThreshold} stroke="#f85149" strokeDasharray="4 2" strokeWidth={1} />
            )}
            <Line
              type="monotone"
              dataKey="v"
              stroke={lineColor}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 4, stroke: 'none' }}
              isAnimationActive={false}
            />
            {/* Brush: mini-map at the bottom for pan/zoom over 72h history */}
            {visible.length > 1 && (
              <Brush
                dataKey="t"
                startIndex={defaultStartIndex}
                endIndex={defaultEndIndex}
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
  )
}
