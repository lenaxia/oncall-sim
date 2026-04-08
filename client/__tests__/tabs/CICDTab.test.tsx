import { describe, it, expect } from 'vitest'
import { screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, buildTestSnapshot, buildDeployment, buildMockSSE } from '../../src/testutil/index'
import { CICDTab } from '../../src/components/tabs/CICDTab'
import { server } from '../../src/testutil/setup'
import { http, HttpResponse } from 'msw'

function renderCICD(
  deployments: Record<string, ReturnType<typeof buildDeployment>[]> = {},
  opts: { hasFeatureFlags?: boolean } = {}
) {
  server.use(
    http.get('/api/scenarios/:id', () =>
      HttpResponse.json({
        id: '_fixture', title: 'Test', description: '', serviceType: 'api',
        difficulty: 'medium', tags: [], topology: { focalService: 'svc-a', upstream: [], downstream: [] },
        personas: [], wiki: { pages: [] }, cicd: { pipelines: [] },
        featureFlags: opts.hasFeatureFlags ? [{ id: 'ff-1', label: 'New Checkout' }] : [],
        evaluation: { rootCause: '', relevantActions: [], redHerrings: [], debriefContext: '' },
        engine: { defaultTab: 'cicd', tickIntervalSeconds: 15 },
        timeline: { durationMinutes: 10 },
      })
    )
  )
  const sse = buildMockSSE()
  const result = renderWithProviders(<CICDTab />, { sse })
  act(() => {
    sse.emit({ type: 'session_snapshot', snapshot: buildTestSnapshot({ deployments }) })
  })
  return { ...result, sse }
}

describe('CICDTab', () => {
  describe('service list', () => {
    it('renders services from deployments', () => {
      renderCICD({ 'svc-a': [buildDeployment()] })
      expect(screen.getByText('svc-a')).toBeInTheDocument()
    })

    it('clicking service shows deployment table', async () => {
      const user = userEvent.setup()
      renderCICD({ 'svc-a': [buildDeployment({ version: 'v2.0.0', status: 'active' })] })
      await user.click(screen.getByText('svc-a'))
      expect(screen.getByText('v2.0.0')).toBeInTheDocument()
    })
  })

  describe('deployment table', () => {
    it('active deployment row is highlighted', async () => {
      const user = userEvent.setup()
      renderCICD({ 'svc-a': [buildDeployment({ version: 'v1.0.0', status: 'active' })] })
      await user.click(screen.getByText('svc-a'))
      const versionEl = await screen.findByText('v1.0.0')
      expect(versionEl.closest('tr')).toHaveClass('bg-sim-surface-2')
    })

    it('pre-incident deployments show relative time', async () => {
      const user = userEvent.setup()
      renderCICD({ 'svc-a': [buildDeployment({ deployedAtSec: -300, status: 'previous', version: 'v0.9.0' })] })
      await user.click(screen.getByText('svc-a'))
      await screen.findByText('v0.9.0')
      expect(screen.getByText(/before/i)).toBeInTheDocument()
    })

    it('rolled_back deployment shows strikethrough', async () => {
      const user = userEvent.setup()
      renderCICD({ 'svc-a': [buildDeployment({ version: 'v1.1.0', status: 'rolled_back' })] })
      await user.click(screen.getByText('svc-a'))
      const versionEl = await screen.findByText('v1.1.0')
      expect(versionEl).toHaveClass('line-through')
    })
  })

  describe('action buttons', () => {
    it('Rollback button shown when previous deployment exists', async () => {
      const user = userEvent.setup()
      renderCICD({
        'svc-a': [
          buildDeployment({ version: 'v2.0.0', status: 'active' }),
          buildDeployment({ version: 'v1.0.0', status: 'previous' }),
        ]
      })
      await user.click(screen.getByText('svc-a'))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /rollback/i })).toBeInTheDocument()
      })
    })

    it('Rollback button shows confirmation modal', async () => {
      const user = userEvent.setup()
      renderCICD({
        'svc-a': [
          buildDeployment({ version: 'v2.0.0', status: 'active' }),
          buildDeployment({ version: 'v1.0.0', status: 'previous' }),
        ]
      })
      await user.click(screen.getByText('svc-a'))
      await user.click(await screen.findByRole('button', { name: /rollback/i }))
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('confirming rollback dispatches trigger_rollback', async () => {
      const user = userEvent.setup()
      let captured: unknown
      server.use(
        http.post('/api/sessions/:id/actions', async ({ request }) => {
          captured = await request.json()
          return new HttpResponse(null, { status: 204 })
        })
      )
      renderCICD({
        'svc-a': [
          buildDeployment({ version: 'v2.0.0', status: 'active' }),
          buildDeployment({ version: 'v1.0.0', status: 'previous' }),
        ]
      })
      await user.click(screen.getByText('svc-a'))
      await user.click(await screen.findByRole('button', { name: /rollback/i }))
      await user.click(screen.getByRole('button', { name: /rollback →/i }))
      await waitFor(() => {
        expect((captured as { action: string })?.action).toBe('trigger_rollback')
      })
    })

    it('cancelling rollback modal does not dispatch', async () => {
      const user = userEvent.setup()
      let rollbackCalled = false
      server.use(
        http.post('/api/sessions/:id/actions', async ({ request }) => {
          const body = await request.json() as { action: string }
          if (body.action === 'trigger_rollback') rollbackCalled = true
          return new HttpResponse(null, { status: 204 })
        })
      )
      renderCICD({
        'svc-a': [
          buildDeployment({ version: 'v2.0.0', status: 'active' }),
          buildDeployment({ version: 'v1.0.0', status: 'previous' }),
        ]
      })
      await user.click(screen.getByText('svc-a'))
      await user.click(await screen.findByRole('button', { name: /rollback/i }))
      await user.click(screen.getByRole('button', { name: /cancel/i }))
      expect(rollbackCalled).toBe(false)
    })

    it('Restart service button dispatches restart_service', async () => {
      const user = userEvent.setup()
      let captured: unknown
      server.use(
        http.post('/api/sessions/:id/actions', async ({ request }) => {
          captured = await request.json()
          return new HttpResponse(null, { status: 204 })
        })
      )
      renderCICD({ 'svc-a': [buildDeployment()] })
      await user.click(screen.getByText('svc-a'))
      await user.click(await screen.findByRole('button', { name: /restart service/i }))
      await waitFor(() => {
        expect((captured as { action: string })?.action).toBe('restart_service')
      })
    })

    it('Toggle Feature Flag button not shown when no feature flags', async () => {
      const user = userEvent.setup()
      renderCICD({ 'svc-a': [buildDeployment()] }, { hasFeatureFlags: false })
      await user.click(screen.getByText('svc-a'))
      await waitFor(() => screen.getByRole('button', { name: /restart service/i }))
      expect(screen.queryByRole('button', { name: /toggle feature flag/i })).toBeNull()
    })

    it('Toggle Feature Flag button shown when hasFeatureFlags=true', async () => {
      const user = userEvent.setup()
      renderCICD({ 'svc-a': [buildDeployment()] }, { hasFeatureFlags: true })
      await user.click(screen.getByText('svc-a'))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /toggle feature flag/i })).toBeInTheDocument()
      })
    })
  })

  describe('view_deployment_history', () => {
    it('dispatched when service selected', async () => {
      const user = userEvent.setup()
      let captured: unknown
      server.use(
        http.post('/api/sessions/:id/actions', async ({ request }) => {
          const body = await request.json() as { action: string }
          if (body.action === 'view_deployment_history') captured = body
          return new HttpResponse(null, { status: 204 })
        })
      )
      renderCICD({ 'svc-a': [buildDeployment()] })
      await user.click(screen.getByText('svc-a'))
      await waitFor(() => {
        expect((captured as { action: string })?.action).toBe('view_deployment_history')
      })
    })
  })
})
