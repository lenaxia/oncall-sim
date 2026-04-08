import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Panel } from '../../src/components/Panel'

describe('Panel', () => {
  it('renders children', () => {
    const { getByText } = render(<Panel>Hello</Panel>)
    expect(getByText('Hello')).toBeInTheDocument()
  })

  it('renders title in header when provided', () => {
    const { getByText } = render(<Panel title="DETAILS">Content</Panel>)
    expect(getByText('DETAILS')).toBeInTheDocument()
  })

  it('does not render header when title is omitted', () => {
    const { container } = render(<Panel>Content</Panel>)
    // No header div rendered — no uppercase section header
    expect(container.querySelector('header')).toBeNull()
  })

  it('renders actions in header when provided', () => {
    const { getByRole } = render(
      <Panel title="INFO" actions={<button>Edit</button>}>Content</Panel>
    )
    expect(getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('body has padding by default', () => {
    const { container } = render(<Panel>Content</Panel>)
    const body = container.querySelector('[data-panel-body]')
    expect(body).toHaveClass('p-3')
  })

  it('noPadding=true removes body padding', () => {
    const { container } = render(<Panel noPadding>Content</Panel>)
    const body = container.querySelector('[data-panel-body]')
    expect(body).not.toHaveClass('p-3')
  })

  it('has sim-surface background', () => {
    const { container } = render(<Panel>X</Panel>)
    expect(container.firstChild).toHaveClass('bg-sim-surface')
  })
})
