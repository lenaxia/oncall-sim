import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Spinner } from '../../src/components/Spinner'

describe('Spinner', () => {
  it('renders an svg element', () => {
    const { container } = render(<Spinner />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('default size is 16px', () => {
    const { container } = render(<Spinner />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('16')
    expect(svg.getAttribute('height')).toBe('16')
  })

  it('size=sm renders 12px', () => {
    const { container } = render(<Spinner size="sm" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('12')
    expect(svg.getAttribute('height')).toBe('12')
  })

  it('size=lg renders 24px', () => {
    const { container } = render(<Spinner size="lg" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('24')
    expect(svg.getAttribute('height')).toBe('24')
  })

  it('has animate-spin class', () => {
    const { container } = render(<Spinner />)
    const svg = container.querySelector('svg')!
    expect(svg.classList.contains('animate-spin')).toBe(true)
  })
})
