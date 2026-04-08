import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { EmptyState } from '../../src/components/EmptyState'

describe('EmptyState', () => {
  it('renders title', () => {
    const { getByText } = render(<EmptyState title="No emails" />)
    expect(getByText('No emails')).toBeInTheDocument()
  })

  it('renders message when provided', () => {
    const { getByText } = render(
      <EmptyState title="No emails" message="Emails will arrive during the incident." />
    )
    expect(getByText('Emails will arrive during the incident.')).toBeInTheDocument()
  })

  it('does not render message element when omitted', () => {
    const { queryByText } = render(<EmptyState title="Empty" />)
    // Only the title should be in the document — no secondary text node
    expect(queryByText(/will arrive/)).toBeNull()
  })

  it('renders the ∅ symbol', () => {
    const { getByText } = render(<EmptyState title="Nothing" />)
    expect(getByText('∅')).toBeInTheDocument()
  })

  it('renders optional action when provided', async () => {
    const { getByRole } = render(
      <EmptyState
        title="Nothing"
        action={<button onClick={() => {}}>Retry</button>}
      />
    )
    expect(getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('is centred — has flex and items-center classes', () => {
    const { container } = render(<EmptyState title="X" />)
    expect(container.firstChild).toHaveClass('flex')
    expect(container.firstChild).toHaveClass('items-center')
  })
})
