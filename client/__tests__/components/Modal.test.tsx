import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from '../../src/components/Modal'

describe('Modal', () => {
  describe('visibility', () => {
    it('not rendered when open=false', () => {
      const { queryByRole } = render(
        <Modal open={false} onClose={() => {}} title="Test">Body</Modal>
      )
      expect(queryByRole('dialog')).toBeNull()
    })

    it('rendered when open=true', () => {
      const { getByRole } = render(
        <Modal open onClose={() => {}} title="Test">Body</Modal>
      )
      expect(getByRole('dialog')).toBeInTheDocument()
    })
  })

  describe('content', () => {
    it('displays title in header', () => {
      const { getByText } = render(
        <Modal open onClose={() => {}} title="Confirm Rollback">Body</Modal>
      )
      expect(getByText('Confirm Rollback')).toBeInTheDocument()
    })

    it('renders children', () => {
      const { getByText } = render(
        <Modal open onClose={() => {}} title="T">Modal body text</Modal>
      )
      expect(getByText('Modal body text')).toBeInTheDocument()
    })

    it('renders footer when provided', () => {
      const { getByRole } = render(
        <Modal
          open
          onClose={() => {}}
          title="T"
          footer={<button>Confirm</button>}
        >
          Body
        </Modal>
      )
      expect(getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    })

    it('does not render footer element when omitted', () => {
      const { queryByTestId } = render(
        <Modal open onClose={() => {}} title="T">Body</Modal>
      )
      expect(queryByTestId('modal-footer')).toBeNull()
    })
  })

  describe('close behaviour', () => {
    it('× button calls onClose', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      const { getByLabelText } = render(
        <Modal open onClose={onClose} title="T">Body</Modal>
      )
      await user.click(getByLabelText('Close'))
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('overlay click calls onClose', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      const { getByTestId } = render(
        <Modal open onClose={onClose} title="T">Body</Modal>
      )
      await user.click(getByTestId('modal-overlay'))
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('Escape key calls onClose', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(<Modal open onClose={onClose} title="T">Body</Modal>)
      await user.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('clicking inside dialog does not call onClose', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      const { getByRole } = render(
        <Modal open onClose={onClose} title="T">Body content</Modal>
      )
      await user.click(getByRole('dialog'))
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('focus management', () => {
    it('focus moves into dialog on open', () => {
      const { getByRole } = render(
        <Modal open onClose={() => {}} title="T">
          <button>First</button>
        </Modal>
      )
      // A focusable element inside the dialog should receive focus
      expect(getByRole('dialog')).toBeInTheDocument()
      // The close button is always the first focusable element
      expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull()
    })

    it('Tab key cycles through focusable elements inside dialog', async () => {
      const user = userEvent.setup()
      const { getByLabelText, getByRole } = render(
        <Modal open onClose={() => {}} title="T">
          <button>Action</button>
        </Modal>
      )
      // Close button and Action button are focusable inside dialog
      const closeBtn = getByLabelText('Close')
      const actionBtn = getByRole('button', { name: 'Action' })
      closeBtn.focus()
      await user.tab()
      expect(document.activeElement).toBe(actionBtn)
      // Wraps around: tab again should go back to close button
      await user.tab()
      expect(document.activeElement).toBe(closeBtn)
    })

    it('Shift+Tab cycles backward through focusable elements', async () => {
      const user = userEvent.setup()
      const { getByLabelText } = render(
        <Modal open onClose={() => {}} title="T">
          <button>Action</button>
        </Modal>
      )
      const closeBtn = getByLabelText('Close')
      closeBtn.focus()
      await user.tab({ shift: true })
      // Should wrap to last focusable = Action button
      expect(document.activeElement).toHaveTextContent('Action')
    })
  })

  describe('accessibility', () => {
    it('has role=dialog', () => {
      const { getByRole } = render(
        <Modal open onClose={() => {}} title="T">B</Modal>
      )
      expect(getByRole('dialog')).toBeInTheDocument()
    })

    it('has aria-modal=true', () => {
      const { getByRole } = render(
        <Modal open onClose={() => {}} title="T">B</Modal>
      )
      expect(getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    })

    it('has aria-labelledby pointing to title', () => {
      const { getByRole, getByText } = render(
        <Modal open onClose={() => {}} title="My Title">B</Modal>
      )
      const dialog = getByRole('dialog')
      const titleId = dialog.getAttribute('aria-labelledby')!
      expect(getByText('My Title').id).toBe(titleId)
    })
  })
})
