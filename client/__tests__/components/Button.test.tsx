import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '../../src/components/Button'

describe('Button', () => {
  describe('rendering', () => {
    it('renders children text', () => {
      const { getByText } = render(<Button>Click me</Button>)
      expect(getByText('Click me')).toBeInTheDocument()
    })

    it('type=button by default (not submit)', () => {
      const { getByRole } = render(<Button>Save</Button>)
      expect(getByRole('button')).toHaveAttribute('type', 'button')
    })

    it('variant=primary has bg-sim-accent class', () => {
      const { getByRole } = render(<Button variant="primary">Go</Button>)
      expect(getByRole('button')).toHaveClass('bg-sim-accent')
    })

    it('variant=danger has bg-sim-red class', () => {
      const { getByRole } = render(<Button variant="danger">Delete</Button>)
      expect(getByRole('button')).toHaveClass('bg-sim-red')
    })

    it('variant=secondary is default and has bg-sim-surface-2', () => {
      const { getByRole } = render(<Button>Secondary</Button>)
      expect(getByRole('button')).toHaveClass('bg-sim-surface-2')
    })

    it('variant=ghost has bg-transparent', () => {
      const { getByRole } = render(<Button variant="ghost">Ghost</Button>)
      expect(getByRole('button')).toHaveClass('bg-transparent')
    })
  })

  describe('sizes', () => {
    it('size=sm has px-2.5 class', () => {
      const { getByRole } = render(<Button size="sm">Small</Button>)
      expect(getByRole('button')).toHaveClass('px-2.5')
    })

    it('size=lg has px-4 class', () => {
      const { getByRole } = render(<Button size="lg">Large</Button>)
      expect(getByRole('button')).toHaveClass('px-4')
    })
  })

  describe('interactions', () => {
    it('onClick called when clicked', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()
      const { getByRole } = render(<Button onClick={onClick}>Click</Button>)
      await user.click(getByRole('button'))
      expect(onClick).toHaveBeenCalledOnce()
    })

    it('disabled prevents onClick', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()
      const { getByRole } = render(<Button disabled onClick={onClick}>Click</Button>)
      await user.click(getByRole('button'))
      expect(onClick).not.toHaveBeenCalled()
    })

    it('disabled button has opacity-40 class', () => {
      const { getByRole } = render(<Button disabled>Disabled</Button>)
      expect(getByRole('button')).toHaveClass('opacity-40')
    })
  })

  describe('loading state', () => {
    it('loading=true renders Spinner', () => {
      const { container } = render(<Button loading>Save</Button>)
      expect(container.querySelector('svg')).not.toBeNull()
    })

    it('loading=true sets aria-busy=true', () => {
      const { getByRole } = render(<Button loading>Save</Button>)
      expect(getByRole('button')).toHaveAttribute('aria-busy', 'true')
    })

    it('loading=true disables button', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()
      const { getByRole } = render(<Button loading onClick={onClick}>Save</Button>)
      await user.click(getByRole('button'))
      expect(onClick).not.toHaveBeenCalled()
    })

    it('children text still visible when loading', () => {
      const { getByText } = render(<Button loading>Saving...</Button>)
      expect(getByText('Saving...')).toBeInTheDocument()
    })
  })

  describe('iconOnly', () => {
    it('iconOnly=true renders square button (no px padding)', () => {
      const { getByRole } = render(
        <Button iconOnly aria-label="Close">×</Button>
      )
      // Icon-only uses p-1.5 not px-3 — check it doesn't have the normal padding
      expect(getByRole('button')).not.toHaveClass('px-3')
    })
  })
})
