import type { AlarmSeverity, LogLevel } from '@shared/types/events'

export type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'info'
  | 'sev1'
  | 'sev2'
  | 'sev3'
  | 'sev4'

interface BadgeProps {
  label:    string
  variant?: BadgeVariant
  pulse?:   boolean
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: 'bg-sim-surface-2 text-sim-text-muted',
  success: 'bg-sim-green-dim text-sim-green',
  warning: 'bg-sim-yellow-dim text-sim-yellow',
  info:    'bg-sim-info-dim text-sim-info',
  sev1:    'bg-sim-red-dim text-sim-red',
  sev2:    'bg-sim-orange-dim text-sim-orange',
  sev3:    'bg-sim-yellow-dim text-sim-yellow',
  sev4:    'bg-sim-info-dim text-sim-info',
}

export function Badge({ label, variant = 'default', pulse = false }: BadgeProps) {
  const variantClasses = VARIANT_CLASSES[variant]
  const pulseClass = pulse ? 'animate-pulse' : ''
  return (
    <span
      className={`text-xs font-medium px-1.5 py-0.5 rounded-sm font-mono inline-flex items-center ${variantClasses} ${pulseClass}`.trim()}
    >
      {label}
    </span>
  )
}

export function severityVariant(sev: AlarmSeverity): BadgeVariant {
  const map: Record<AlarmSeverity, BadgeVariant> = {
    SEV1: 'sev1',
    SEV2: 'sev2',
    SEV3: 'sev3',
    SEV4: 'sev4',
  }
  return map[sev]
}

export function logLevelVariant(level: LogLevel): BadgeVariant | 'debug' {
  const map: Record<LogLevel, BadgeVariant | 'debug'> = {
    ERROR: 'sev1',
    WARN:  'warning',
    INFO:  'info',
    DEBUG: 'debug',
  }
  return map[level]
}
