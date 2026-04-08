import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScenarioPicker } from '../../src/components/ScenarioPicker'
import { server } from '../../src/testutil/setup'
import { http, HttpResponse } from 'msw'

describe('ScenarioPicker', () => {
  describe('loading', () => {
    it('shows loading spinner while fetching', () => {
      server.use(http.get('/api/scenarios', () => new Promise(() => {})))
      const { container } = render(<ScenarioPicker onStart={() => {}} />)
      expect(container.querySelector('svg.animate-spin')).not.toBeNull()
    })
  })

  describe('after successful fetch', () => {
    it('renders scenario title', async () => {
      render(<ScenarioPicker onStart={() => {}} />)
      await waitFor(() => {
        expect(screen.getByText('Fixture Scenario')).toBeInTheDocument()
      })
    })

    it('renders scenario difficulty', async () => {
      render(<ScenarioPicker onStart={() => {}} />)
      await waitFor(() => {
        expect(screen.getByText(/medium/i)).toBeInTheDocument()
      })
    })

    it('renders scenario tags', async () => {
      render(<ScenarioPicker onStart={() => {}} />)
      await waitFor(() => {
        expect(screen.getByText('fixture')).toBeInTheDocument()
      })
    })

    it('Start button calls onStart with correct scenarioId', async () => {
      const user = userEvent.setup()
      const onStart = vi.fn()
      render(<ScenarioPicker onStart={onStart} />)
      const btn = await screen.findByRole('button', { name: /start/i })
      await user.click(btn)
      expect(onStart).toHaveBeenCalledWith('_fixture')
    })
  })

  describe('error state', () => {
    it('shows error state when fetch fails', async () => {
      server.use(http.get('/api/scenarios', () => HttpResponse.error()))
      render(<ScenarioPicker onStart={() => {}} />)
      await waitFor(() => {
        expect(screen.getByText(/failed to load/i)).toBeInTheDocument()
      })
    })
  })

  describe('loading state on Start', () => {
    it('Start button shows loading while session being created', async () => {
      const user = userEvent.setup()
      // Block session creation
      server.use(http.post('/api/sessions', () => new Promise(() => {})))
      const onStart = vi.fn()
      render(<ScenarioPicker onStart={onStart} />)
      const btn = await screen.findByRole('button', { name: /start/i })
      await user.click(btn)
      // Button should be loading (disabled, spinner visible)
      expect(btn).toBeDisabled()
    })
  })
})
