import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorToast } from '../../src/components/ErrorToast'

describe('ErrorToast', () => {
  it('not rendered when message is null', () => {
    const { queryByRole } = render(<ErrorToast message={null} onDismiss={() => {}} />)
    expect(queryByRole('alert')).toBeNull()
  })

  it('rendered with message text when message is non-null', () => {
    const { getByText } = render(
      <ErrorToast message="Action failed — open_tab could not be submitted." onDismiss={() => {}} />
    )
    expect(getByText(/Action failed/)).toBeInTheDocument()
  })

  it('dismiss button calls onDismiss', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    const { getByLabelText } = render(
      <ErrorToast message="Error" onDismiss={onDismiss} />
    )
    await user.click(getByLabelText('Dismiss'))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('has role=alert for accessibility', () => {
    const { getByRole } = render(
      <ErrorToast message="Something went wrong" onDismiss={() => {}} />
    )
    expect(getByRole('alert')).toBeInTheDocument()
  })

  it('renders ! icon', () => {
    const { getByText } = render(<ErrorToast message="Err" onDismiss={() => {}} />)
    expect(getByText('!')).toBeInTheDocument()
  })
})
