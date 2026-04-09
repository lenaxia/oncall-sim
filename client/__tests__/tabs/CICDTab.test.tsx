import { describe, it, expect } from 'vitest'
import { screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { renderWithProviders, buildTestSnapshot, buildMockSSE } from '../../src/testutil/index'
import { CICDTab } from '../../src/components/tabs/CICDTab'
import { server } from '../../src/testutil/setup'
import { http, HttpResponse } from 'msw'
import type { Pipeline, PipelineStage } from '@shared/types/events'

function buildStage(overrides: Partial<PipelineStage> = {}): PipelineStage {
  return {
    id: 'prod', name: 'Prod', type: 'deploy',
    currentVersion: 'v2.4.1', previousVersion: 'v2.4.0',
    status: 'succeeded', deployedAtSec: -1200,
    commitMessage: 'config: fix pool size', author: 'sara-chen',
    blockers: [], alarmWatches: [], tests: [], promotionEvents: [],
    ...overrides,
  }
}

function buildPipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'pipeline-payment', name: 'payment-service', service: 'payment-service',
    stages: [
      buildStage({ id: 'build',   name: 'Build',    type: 'build',  status: 'succeeded', deployedAtSec: -1500 }),
      buildStage({ id: 'staging', name: 'Staging',  type: 'deploy', status: 'succeeded', deployedAtSec: -1400 }),
      buildStage({ id: 'preprod', name: 'Pre-Prod', type: 'deploy', status: 'blocked',   deployedAtSec: -1200,
        blockers: [{ type: "alarm", alarmId: "alarm-001", message: "Alarm firing: p99 latency > 2000ms on payment-service" }], alarmWatches: ["alarm-001"], tests: [], promotionEvents: [] }),
      buildStage({ id: 'prod',    name: 'Prod',     type: 'deploy', status: 'succeeded', deployedAtSec: -1200 }),
    ],
    ...overrides,
  }
}

function renderCICD(pipelines: Pipeline[] = [buildPipeline()]) {
  const sse = buildMockSSE()
  const result = renderWithProviders(<CICDTab />, { sse })
  act(() => { sse.emit({ type: 'session_snapshot', snapshot: buildTestSnapshot({ pipelines }) }) })
  return { ...result, sse }
}

describe('CICDTab', () => {
  describe('pipeline list', () => {
    it('shows empty state when no pipelines', () => {
      renderCICD([])
      expect(screen.getByText(/no pipelines/i)).toBeInTheDocument()
    })

    it('renders pipeline names in list', () => {
      renderCICD([
        buildPipeline({ id: 'p1', name: 'payment-service' }),
        buildPipeline({ id: 'p2', name: 'fraud-service', service: 'fraud-service' }),
      ])
      expect(screen.getByText('payment-service')).toBeInTheDocument()
      expect(screen.getByText('fraud-service')).toBeInTheDocument()
    })

    it('shows BLOCKED for pipeline with a blocked stage', () => {
      renderCICD([buildPipeline()])
      expect(screen.getAllByText(/blocked/i).length).toBeGreaterThan(0)
    })

    it('shows HEALTHY for pipeline where all stages succeeded', () => {
      renderCICD([buildPipeline({
        stages: [
          buildStage({ id: 'build',   name: 'Build',    status: 'succeeded' }),
          buildStage({ id: 'staging', name: 'Staging',  status: 'succeeded' }),
          buildStage({ id: 'preprod', name: 'Pre-Prod', status: 'succeeded' }),
          buildStage({ id: 'prod',    name: 'Prod',     status: 'succeeded' }),
        ],
      })])
      expect(screen.getByText(/healthy/i)).toBeInTheDocument()
    })

    it('shows last prod deploy metric', () => {
      renderCICD()
      expect(screen.getByTestId('pipeline-last-prod')).toBeInTheDocument()
    })

    it('shows oldest version not in prod metric', () => {
      renderCICD()
      expect(screen.getByTestId('pipeline-oldest-not-prod')).toBeInTheDocument()
    })
  })

  describe('stage flow', () => {
    it('clicking a pipeline shows stage flow', async () => {
      const user = userEvent.setup()
      renderCICD()
      await user.click(screen.getByText('payment-service'))
      expect(screen.getByTestId('stage-flow')).toBeInTheDocument()
    })

    it('all 4 stage names visible in stage flow', async () => {
      const user = userEvent.setup()
      renderCICD()
      await user.click(screen.getByText('payment-service'))
      expect(screen.getByText('Build')).toBeInTheDocument()
      expect(screen.getByText('Staging')).toBeInTheDocument()
      expect(screen.getByText('Pre-Prod')).toBeInTheDocument()
      expect(screen.getByText('Prod')).toBeInTheDocument()
    })

    it('blocked stage shows blocker message in detail panel', async () => {
      const user = userEvent.setup()
      renderCICD()
      await user.click(screen.getByText('payment-service'))
      await user.click(screen.getByTestId('stage-pill-preprod'))
      expect(screen.getByText(/p99 latency > 2000ms/i)).toBeInTheDocument()
    })
  })

  describe('stage actions', () => {
    it('Rollback button shown when stage has previousVersion', async () => {
      const user = userEvent.setup()
      renderCICD()
      await user.click(screen.getByText('payment-service'))
      await user.click(screen.getByTestId('stage-pill-prod'))
      expect(screen.getByRole('button', { name: /rollback/i })).toBeInTheDocument()
    })

    it('Rollback dispatches trigger_rollback with pipelineId and stageId', async () => {
      const user = userEvent.setup()
      let captured: unknown
      server.use(http.post('/api/sessions/:id/actions', async ({ request }) => {
        captured = await request.json()
        return new HttpResponse(null, { status: 204 })
      }))
      renderCICD()
      await user.click(screen.getByText('payment-service'))
      await user.click(screen.getByTestId('stage-pill-prod'))
      await user.click(screen.getByRole('button', { name: /rollback/i }))
      await user.click(screen.getByRole('button', { name: /rollback →/i }))
      await waitFor(() => {
        const body = captured as { action: string; params: { pipelineId: string; stageId: string } }
        expect(body.action).toBe('trigger_rollback')
        expect(body.params.pipelineId).toBe('pipeline-payment')
        expect(body.params.stageId).toBe('prod')
      })
    })

    it('Override Blocker button shown for alarm-blocked stage', async () => {
      const user = userEvent.setup()
      renderCICD()
      await user.click(screen.getByText('payment-service'))
      await user.click(screen.getByTestId('stage-pill-preprod'))
      expect(screen.getByRole('button', { name: /override blocker/i })).toBeInTheDocument()
    })

    it('Override Blocker dispatches override_blocker', async () => {
      const user = userEvent.setup()
      let captured: unknown
      server.use(http.post('/api/sessions/:id/actions', async ({ request }) => {
        captured = await request.json()
        return new HttpResponse(null, { status: 204 })
      }))
      renderCICD()
      await user.click(screen.getByText('payment-service'))
      await user.click(screen.getByTestId('stage-pill-preprod'))
      await user.click(screen.getByRole('button', { name: /override blocker/i }))
      await user.click(screen.getByRole('button', { name: /override →/i }))
      await waitFor(() => {
        const body = captured as { action: string; params: { stageId: string } }
        expect(body.action).toBe('override_blocker')
        expect(body.params.stageId).toBe('preprod')
      })
    })

    it('Approve Gate shown for manual_approval blocked stage', async () => {
      const user = userEvent.setup()
      renderCICD([buildPipeline({
        stages: [
          buildStage({ id: 'build',   name: 'Build',    status: 'succeeded' }),
          buildStage({ id: 'staging', name: 'Staging',  status: 'succeeded' }),
          buildStage({ id: 'preprod', name: 'Pre-Prod', status: 'blocked',
            blockers: [{ type: 'manual_approval', message: 'Awaiting release manager' }] }),
          buildStage({ id: 'prod',    name: 'Prod',     status: 'not_started' }),
        ],
      })])
      await user.click(screen.getByText('payment-service'))
      await user.click(screen.getByTestId('stage-pill-preprod'))
      expect(screen.getByRole('button', { name: /approve gate/i })).toBeInTheDocument()
    })

    it('Block Promotion dispatches block_promotion', async () => {
      const user = userEvent.setup()
      let captured: unknown
      server.use(http.post('/api/sessions/:id/actions', async ({ request }) => {
        captured = await request.json()
        return new HttpResponse(null, { status: 204 })
      }))
      renderCICD()
      await user.click(screen.getByText('payment-service'))
      await user.click(screen.getByTestId('stage-pill-prod'))
      await user.click(screen.getByRole('button', { name: /block promotion/i }))
      await waitFor(() => {
        const body = captured as { action: string; params: { stageId: string } }
        expect(body.action).toBe('block_promotion')
        expect(body.params.stageId).toBe('prod')
      })
    })
  })

  describe('SSE updates', () => {
    it('pipeline_stage_updated clears blocker in detail panel', async () => {
      const user = userEvent.setup()
      const { sse } = renderCICD()
      await user.click(screen.getByText('payment-service'))
      await user.click(screen.getByTestId('stage-pill-preprod'))
      expect(screen.getByText(/p99 latency > 2000ms/i)).toBeInTheDocument()
      act(() => {
        sse.emit({
          type: 'pipeline_stage_updated',
          pipelineId: 'pipeline-payment',
          stage: buildStage({ id: 'preprod', name: 'Pre-Prod', status: 'succeeded', blockers: [] }),
        })
      })
      await waitFor(() => {
        expect(screen.queryByText(/p99 latency > 2000ms/i)).toBeNull()
      })
    })
  })

  describe('view_pipeline dispatch', () => {
    it('dispatches view_pipeline when pipeline selected', async () => {
      const user = userEvent.setup()
      let captured: unknown
      server.use(http.post('/api/sessions/:id/actions', async ({ request }) => {
        const body = await request.json() as { action: string }
        if (body.action === 'view_pipeline') captured = body
        return new HttpResponse(null, { status: 204 })
      }))
      renderCICD()
      await user.click(screen.getByText('payment-service'))
      await waitFor(() => {
        expect((captured as { action: string })?.action).toBe('view_pipeline')
      })
    })
  })
})
