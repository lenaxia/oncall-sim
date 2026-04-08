import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
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
  warningThreshold?:  number
  criticalThreshold?: number
  onFirstHover?:      () => void
}

// Fixed sliding window: show this many sim-seconds of history
const WINDOW_SECONDS = 600  // 10 sim-minutes

export function MetricChart({
  metricId: _metricId, service: _service, label, unit, series, simTime,
  clockAnchorMs, warningThreshold, criticalThreshold, onFirstHover,
}: MetricChartProps) {
  // All points up to now — keep full history so line connects across the window
  const visible = series.filter(p => p.t <= simTime)
  const current = visible.length > 0 ? visible[visible.length - 1].v : null

  // Sliding window domain: always show exactly WINDOW_SECONDS of sim time
  const windowStart = simTime - WINDOW_SECONDS
  const xDomain: [number, number] = [windowStart, simTime]

  const breachCrit = criticalThreshold != null && current != null && current >= criticalThreshold
  const breachWarn = warningThreshold  != null && current != null && current >= warningThreshold

  const lineColor = breachCrit ? '#f85149' : breachWarn ? '#d29922' : '#1f6feb'

  const valueDisplay = current != null
    ? `${current.toFixed(current < 10 ? 2 : 1)} ${unit}`.trim()
    : '—'

  function fmtTick(t: number): string {
    if (!clockAnchorMs) return ''
    const d  = new Date(clockAnchorMs + t * 1000)
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  }

  function fmtTooltipLabel(t: number): string {
    if (!clockAnchorMs) return String(t)
    const d  = new Date(clockAnchorMs + t * 1000)
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`
  }

  return (
    <div className="bg-sim-surface border border-sim-border rounded overflow-hidden">
      <div className="px-3 py-1.5 border-b border-sim-border flex items-center justify-between">
        <span className="text-xs font-medium text-sim-text">{label}</span>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold tabular-nums ${breachCrit ? 'text-sim-red' : breachWarn ? 'text-sim-yellow' : 'text-sim-text'}`}>
            {valueDisplay}
          </span>
          {breachCrit && <Badge label="CRITICAL" variant="sev1" />}
          {!breachCrit && breachWarn && <Badge label="WARNING" variant="warning" />}
        </div>
      </div>
      <div
        className="h-[180px] w-full"
        onMouseEnter={onFirstHover}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={visible} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#21262d" strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              type="number"
              domain={xDomain}
              tick={{ fill: '#8b949e', fontSize: 10, fontFamily: 'monospace' }}
              tickFormatter={fmtTick}
              axisLine={{ stroke: '#30363d' }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              tick={{ fill: '#8b949e', fontSize: 10, fontFamily: 'monospace' }}
              axisLine={false}
              tickLine={false}
              width={45}
            />
            <Tooltip
              contentStyle={{
                background: '#1c2128',
                border: '1px solid #30363d',
                borderRadius: 4,
                fontSize: 10,
                fontFamily: 'monospace',
              }}
              itemStyle={{ color: '#e6edf3' }}
              labelStyle={{ color: '#8b949e' }}
              labelFormatter={fmtTooltipLabel}
            />
            {criticalThreshold != null && (
              <ReferenceLine y={criticalThreshold} stroke="#f85149" strokeDasharray="4 2" strokeWidth={1} />
            )}
            {warningThreshold != null && (
              <ReferenceLine y={warningThreshold} stroke="#d29922" strokeDasharray="4 2" strokeWidth={1} />
            )}
            <Line
              type="monotone"
              dataKey="v"
              stroke={lineColor}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, stroke: 'none' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
