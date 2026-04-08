import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Timestamp, formatSimTime } from '../../src/components/Timestamp'

describe('formatSimTime', () => {
  it('simTime=0 → T+00:00:00', () => {
    expect(formatSimTime(0)).toBe('T+00:00:00')
  })

  it('simTime=222 → T+00:03:42', () => {
    expect(formatSimTime(222)).toBe('T+00:03:42')
  })

  it('simTime=3662 → T+01:01:02', () => {
    expect(formatSimTime(3662)).toBe('T+01:01:02')
  })

  it('simTime=-300 → T-00:05:00 (negative overrides prefix)', () => {
    expect(formatSimTime(-300)).toBe('T-00:05:00')
  })

  it('simTime=90061 → T+25:01:01 (hours can exceed 23)', () => {
    expect(formatSimTime(90061)).toBe('T+25:01:01')
  })

  it('custom prefix used for positive values', () => {
    expect(formatSimTime(60, 'T')).toBe('T00:01:00')
  })

  it('negative simTime always renders T- regardless of prefix', () => {
    expect(formatSimTime(-60, 'T')).toBe('T-00:01:00')
  })
})

describe('Timestamp component', () => {
  it('renders simTime=0 as T+00:00:00', () => {
    const { getByText } = render(<Timestamp simTime={0} />)
    expect(getByText('T+00:00:00')).toBeInTheDocument()
  })

  it('renders simTime=222 as T+00:03:42', () => {
    const { getByText } = render(<Timestamp simTime={222} />)
    expect(getByText('T+00:03:42')).toBeInTheDocument()
  })

  it('renders negative simTime with T- prefix', () => {
    const { getByText } = render(<Timestamp simTime={-300} />)
    expect(getByText('T-00:05:00')).toBeInTheDocument()
  })

  it('renders simTime exceeding 23h', () => {
    const { getByText } = render(<Timestamp simTime={90061} />)
    expect(getByText('T+25:01:01')).toBeInTheDocument()
  })

  it('custom prefix applied to positive simTime', () => {
    const { getByText } = render(<Timestamp simTime={60} prefix="T" />)
    expect(getByText('T00:01:00')).toBeInTheDocument()
  })

  it('renders as a span', () => {
    const { container } = render(<Timestamp simTime={0} />)
    expect(container.querySelector('span')).not.toBeNull()
  })
})
