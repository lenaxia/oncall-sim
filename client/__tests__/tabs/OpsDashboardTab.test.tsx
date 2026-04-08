import { describe, it, expect } from 'vitest'
import { screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  renderWithProviders, buildTestSnapshot, buildAlarm, buildFlatSeries, buildMockSSE
} from '../../src/testutil/index'
import { OpsDashboardTab } from '../../src/components/tabs/OpsDashboardTab'
import { server } from '../../src/testutil/setup'
import { http, HttpResponse } from 'msw'
import type { PageAlert } from '@shared/types/events'

function renderOps(opts: {
  alarms?: ReturnType<typeof buildAlarm>[]
  metrics?: Record<string, Record<string, ReturnType<typeof buildFlatSeries>>>
  pages?: PageAlert[]
} = {}) {
  const sse = buildMockSSE()
  const result = renderWithProviders(<OpsDashboardTab />, { sse })
  act(() => {
    sse.emit({
      type: 'session_snapshot',
      snapshot: buildTestSnapshot({
        alarms:  opts.alarms  ?? [],
        metrics: opts.metrics ?? { 'fixture-service': { error_rate: buildFlatSeries(0, -300, 600, 15) } },
        pages:   opts.pages   ?? [],
      }),
    })
  })
  return { ...result, sse }
}

describe('OpsDashboardTab', () => {
  describe('service sub-tabs', () => {
    it('renders sub-tab for each service in metrics', () => {
      renderOps({ metrics: { 'svc-a': { m1: buildFlatSeries(0, 0, 60) }, 'svc-b': { m2: buildFlatSeries(0, 0, 60) } } })
      expect(screen.getByText('svc-a')).toBeInTheDocument()
      expect(screen.getByText('svc-b')).toBeInTheDocument()
    })
  })

  describe('alarm panel', () => {
    it('renders alarms from snapshot', () => {
      renderOps({ alarms: [buildAlarm({ id: 'a1', condition: 'error_rate > 5%' })] })
      expect(screen.getByText('error_rate > 5%')).toBeInTheDocument()
    })

    it('no alarms → empty state', () => {
      renderOps({ alarms: [] })
      expect(screen.getByText(/no active alarms/i)).toBeInTheDocument()
    })

    it('firing alarm shows Ack and Suppress buttons', () => {
      renderOps({ alarms: [buildAlarm({ id: 'a1', status: 'firing' })] })
      expect(screen.getByRole('button', { name: /ack/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /suppress/i })).toBeInTheDocument()
    })

    it('acknowledged alarm has no action buttons', () => {
      renderOps({ alarms: [buildAlarm({ id: 'a1', status: 'acknowledged' })] })
      expect(screen.queryByRole('button', { name: /ack/i })).toBeNull()
    })

    it('suppressed alarm has no action buttons', () => {
      renderOps({ alarms: [buildAlarm({ id: 'a1', status: 'suppressed' })] })
      expect(screen.queryByRole('button', { name: /ack/i })).toBeNull()
    })

    it('Ack click dispatches investigate_alert then ack_page', async () => {
      const user = userEvent.setup()
      const dispatched: string[] = []
      server.use(
        http.post('/api/sessions/:id/actions', async ({ request }) => {
          const body = await request.json() as { action: string }
          dispatched.push(body.action)
          return new HttpResponse(null, { status: 204 })
        })
      )
      renderOps({ alarms: [buildAlarm({ id: 'a1', status: 'firing' })] })
      await user.click(screen.getByRole('button', { name: /ack/i }))
      await waitFor(() => {
        expect(dispatched).toContain('investigate_alert')
        expect(dispatched).toContain('ack_page')
      })
    })

    it('Ack click immediately updates alarm to acknowledged (optimistic)', async () => {
      const user = userEvent.setup()
      renderOps({ alarms: [buildAlarm({ id: 'a1', status: 'firing' })] })
      await user.click(screen.getByRole('button', { name: /ack/i }))
      // Action buttons should be gone after ack
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /ack/i })).toBeNull()
      })
    })

    it('Suppress click dispatches suppress_alarm', async () => {
      const user = userEvent.setup()
      let captured: unknown
      server.use(
        http.post('/api/sessions/:id/actions', async ({ request }) => {
          captured = await request.json()
          return new HttpResponse(null, { status: 204 })
        })
      )
      renderOps({ alarms: [buildAlarm({ id: 'a1', status: 'firing' })] })
      await user.click(screen.getByRole('button', { name: /suppress/i }))
      await waitFor(() => {
        expect((captured as { action: string })?.action).toBe('suppress_alarm')
      })
    })
  })

  describe('Page User modal', () => {
    it('Page User button opens modal', async () => {
      const user = userEvent.setup()
      renderOps({ alarms: [buildAlarm({ id: 'a1', status: 'firing' })] })
      const pageButtons = screen.getAllByRole('button', { name: /page user/i })
      await user.click(pageButtons[0])
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  describe('SENT PAGES section', () => {
    it('shown when pages.length > 0', () => {
      renderOps({ pages: [{ id: 'p1', personaId: 'fp', message: 'urgent!', simTime: 10 }] })
      expect(screen.getByText(/sent pages/i)).toBeInTheDocument()
    })

    it('hidden when pages is empty', () => {
      renderOps({ pages: [] })
      expect(screen.queryByText(/sent pages/i)).toBeNull()
    })

    it('SSE page_sent event shows new page', () => {
      const { sse } = renderOps({ pages: [] })
      act(() => {
        sse.emit({ type: 'page_sent', alert: { id: 'p2', personaId: 'fp', message: 'new page', simTime: 20 } })
      })
      expect(screen.getByText(/sent pages/i)).toBeInTheDocument()
    })
  })

  describe('SSE events', () => {
    it('alarm_fired SSE event adds alarm to panel', () => {
      const { sse } = renderOps({ alarms: [] })
      act(() => {
        sse.emit({ type: 'alarm_fired', alarm: buildAlarm({ condition: 'latency > 200ms' }) })
      })
      expect(screen.getByText('latency > 200ms')).toBeInTheDocument()
    })

    it('alarm_silenced SSE event updates alarm status', () => {
      const { sse } = renderOps({ alarms: [buildAlarm({ id: 'a1', status: 'firing' })] })
      act(() => {
        sse.emit({ type: 'alarm_silenced', alarmId: 'a1' })
      })
      // Action buttons should be gone after suppression
      expect(screen.queryByRole('button', { name: /ack/i })).toBeNull()
    })
  })
})
