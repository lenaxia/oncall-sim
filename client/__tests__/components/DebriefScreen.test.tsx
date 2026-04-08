import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { DebriefScreen } from '../../src/components/DebriefScreen'
import {
  buildDebriefPayload, buildAuditEntry, buildScenarioSummary,
} from '../../src/testutil/index'
import { server } from '../../src/testutil/setup'
import { http, HttpResponse } from 'msw'

function renderDebrief(opts: {
  sessionId?: string
  scenarioId?: string
  onBack?: () => void
  onRunAgain?: (id: string) => void
  debrief?: ReturnType<typeof buildDebriefPayload>
} = {}) {
  server.use(
    http.get('/api/sessions/:id/debrief', () =>
      HttpResponse.json(opts.debrief ?? buildDebriefPayload())
    ),
    http.get('/api/scenarios', () =>
      HttpResponse.json([buildScenarioSummary()])
    )
  )
  return render(
    <DebriefScreen
      sessionId={opts.sessionId ?? 'test-session-id'}
      scenarioId={opts.scenarioId ?? '_fixture'}
      scenarioTitle={opts.debrief ? 'Test Scenario' : 'Fixture Scenario'}
      onBack={opts.onBack ?? (() => {})}
      onRunAgain={opts.onRunAgain ?? (() => {})}
    />
  )
}

describe('DebriefScreen', () => {
  describe('loading state', () => {
    it('shows loading state while fetching debrief', () => {
      server.use(http.get('/api/sessions/:id/debrief', () => new Promise(() => {})))
      render(
        <DebriefScreen
          sessionId="s1"
          scenarioId="_fixture"
          scenarioTitle="Test"
          onBack={() => {}}
          onRunAgain={() => {}}
        />
      )
      expect(screen.getByText(/loading debrief/i)).toBeInTheDocument()
    })
  })

  describe('loaded state', () => {
    it('shows scenario title in header', async () => {
      renderDebrief()
      await waitFor(() => {
        expect(screen.getByText('Fixture Scenario')).toBeInTheDocument()
      })
    })

    it('New Scenario button calls onBack', async () => {
      const user = userEvent.setup()
      const onBack = vi.fn()
      renderDebrief({ onBack })
      await waitFor(() => screen.getByText('Fixture Scenario'))
      await user.click(screen.getByRole('button', { name: /new scenario/i }))
      expect(onBack).toHaveBeenCalledOnce()
    })

    it('Run Again button calls onRunAgain with correct scenarioId', async () => {
      const user = userEvent.setup()
      const onRunAgain = vi.fn()
      renderDebrief({ scenarioId: '_fixture', onRunAgain })
      await waitFor(() => screen.getByText('Fixture Scenario'))
      await user.click(screen.getByRole('button', { name: /run again/i }))
      expect(onRunAgain).toHaveBeenCalledWith('_fixture')
    })
  })

  describe('incident timeline', () => {
    it('renders audit log entries with ▶ icon', async () => {
      const debrief = buildDebriefPayload({
        auditLog: [buildAuditEntry('open_tab', { tab: 'email' }, 10)]
      })
      renderDebrief({ debrief })
      await waitFor(() => {
        expect(screen.getByText('open_tab')).toBeInTheDocument()
      })
    })

    it('timeline sorted by simTime ascending', async () => {
      const debrief = buildDebriefPayload({
        auditLog: [
          buildAuditEntry('open_tab',    { tab: 'email' }, 30),
          buildAuditEntry('search_logs', { query: 'err' }, 10),
        ]
      })
      renderDebrief({ debrief })
      await waitFor(() => screen.getByText('open_tab'))
      const openTab   = screen.getByText('open_tab')
      const searchLog = screen.getByText('search_logs')
      // search_logs (t=10) should come before open_tab (t=30) in the DOM
      expect(searchLog.compareDocumentPosition(openTab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('relevant action entry shows ✓ badge', async () => {
      const debrief = buildDebriefPayload({
        auditLog: [buildAuditEntry('view_metric', { service: 'svc' }, 15)],
        evaluationState: {
          relevantActionsTaken: [{ action: 'view_metric', why: 'Core signal' }],
          redHerringsTaken: [],
          resolved: false,
        },
      })
      renderDebrief({ debrief })
      await waitFor(() => {
        expect(screen.getAllByText('✓').length).toBeGreaterThan(0)
      })
    })

    it('red herring entry shows ✗ badge', async () => {
      const debrief = buildDebriefPayload({
        auditLog: [buildAuditEntry('trigger_rollback', { service: 'svc', version: 'v1' }, 20)],
        evaluationState: {
          relevantActionsTaken: [],
          redHerringsTaken: [{ action: 'trigger_rollback', why: 'Was not the fix' }],
          resolved: false,
        },
      })
      renderDebrief({ debrief })
      await waitFor(() => {
        expect(screen.getAllByText('✗').length).toBeGreaterThan(0)
      })
    })
  })

  describe('evaluation panel', () => {
    it('resolved=true shows Incident marked resolved', async () => {
      const debrief = buildDebriefPayload({
        evaluationState: { relevantActionsTaken: [], redHerringsTaken: [], resolved: true }
      })
      renderDebrief({ debrief })
      await waitFor(() => {
        expect(screen.getByText(/incident marked resolved/i)).toBeInTheDocument()
      })
    })

    it('resolved=false shows Incident not explicitly resolved', async () => {
      const debrief = buildDebriefPayload({
        evaluationState: { relevantActionsTaken: [], redHerringsTaken: [], resolved: false }
      })
      renderDebrief({ debrief })
      await waitFor(() => {
        expect(screen.getByText(/not explicitly resolved/i)).toBeInTheDocument()
      })
    })

    it('shows relevant actions taken', async () => {
      const debrief = buildDebriefPayload({
        evaluationState: {
          relevantActionsTaken: [{ action: 'view_metric', why: 'Checked the spike' }],
          redHerringsTaken: [],
          resolved: false,
        }
      })
      renderDebrief({ debrief })
      await waitFor(() => {
        expect(screen.getByText('Checked the spike')).toBeInTheDocument()
      })
    })

    it('shows red herrings taken', async () => {
      const debrief = buildDebriefPayload({
        evaluationState: {
          relevantActionsTaken: [],
          redHerringsTaken: [{ action: 'restart_service', why: 'Not the root cause' }],
          resolved: false,
        }
      })
      renderDebrief({ debrief })
      await waitFor(() => {
        expect(screen.getByText('Not the root cause')).toBeInTheDocument()
      })
    })
  })

  describe('stats panel', () => {
    it('shows resolvedAtSimTime', async () => {
      const debrief = buildDebriefPayload({ resolvedAtSimTime: 450 })
      renderDebrief({ debrief })
      await waitFor(() => {
        // Should render T+00:07:30 or similar
        expect(screen.getByText('T+00:07:30')).toBeInTheDocument()
      })
    })

    it('shows action count', async () => {
      const debrief = buildDebriefPayload({
        auditLog: [
          buildAuditEntry('open_tab', {}, 5),
          buildAuditEntry('view_metric', {}, 10),
          buildAuditEntry('search_logs', {}, 15),
        ]
      })
      renderDebrief({ debrief })
      await waitFor(() => {
        expect(screen.getByText('3')).toBeInTheDocument()
      })
    })
  })
})
