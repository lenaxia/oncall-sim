import React from 'react'
import { Spinner } from './Spinner'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:  'primary' | 'secondary' | 'danger' | 'ghost'
  size?:     'sm' | 'md' | 'lg'
  loading?:  boolean
  iconOnly?: boolean
}

const BASE = 'font-medium transition-colors duration-100 inline-flex items-center justify-center gap-1.5'

const VARIANT_CLASSES = {
  primary:   'bg-sim-accent text-white border border-transparent hover:bg-sim-accent-dim',
  secondary: 'bg-sim-surface-2 text-sim-text border border-sim-border hover:border-sim-accent',
  danger:    'bg-sim-red text-white border border-transparent hover:bg-sim-red-dim hover:text-sim-red hover:border-sim-red',
  ghost:     'text-sim-text-muted bg-transparent border border-transparent hover:text-sim-text hover:bg-sim-surface-2',
}

const SIZE_NORMAL: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'text-xs px-2.5 py-1 rounded',
  md: 'text-xs px-3 py-1.5 rounded',
  lg: 'text-sm px-4 py-2 rounded',
}

const SIZE_ICON: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'text-xs p-1 rounded',
  md: 'text-xs p-1.5 rounded',
  lg: 'text-sm p-2 rounded',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  iconOnly = false,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading
  const sizeClasses = iconOnly ? SIZE_ICON[size] : SIZE_NORMAL[size]
  const disabledClasses = isDisabled ? 'opacity-40 cursor-not-allowed' : 'active:opacity-90'

  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-busy={loading ? 'true' : undefined}
      className={`${BASE} ${VARIANT_CLASSES[variant]} ${sizeClasses} ${disabledClasses} ${className ?? ''}`.trim()}
      {...rest}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  )
}
