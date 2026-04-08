interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
}

const SIZE_PX: Record<NonNullable<SpinnerProps['size']>, number> = {
  sm: 12,
  md: 16,
  lg: 24,
}

export function Spinner({ size = 'md' }: SpinnerProps) {
  const px = SIZE_PX[size]
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 16 16"
      fill="none"
      className="animate-spin"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
