import { describe, it, expect } from 'vitest'
import { screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, buildTestSnapshot, buildTicket, buildTicketComment, buildMockSSE } from '../../src/testutil/index'
import { TicketingTab } from '../../src/components/tabs/TicketingTab'
import { server } from '../../src/testutil/setup'
import { http, HttpResponse } from 'msw'

function renderTickets(tickets = [buildTicket()], comments: Record<string, ReturnType<typeof buildTicketComment>[]> = {}) {
  const sse = buildMockSSE()
  const result = renderWithProviders(<TicketingTab />, { sse })
  act(() => {
    sse.emit({ type: 'session_snapshot', snapshot: buildTestSnapshot({ tickets, ticketComments: comments }) })
  })
  return { ...result, sse }
}

describe('TicketingTab', () => {
  describe('rendering', () => {
    it('ticket list rendered from snapshot.tickets', () => {
      renderTickets([buildTicket({ title: 'Payment service down' })])
      expect(screen.getByText('Payment service down')).toBeInTheDocument()
    })

    it('empty list state shown when tickets=[]', () => {
      renderTickets([])
      expect(screen.getByText(/no tickets/i)).toBeInTheDocument()
    })

    it('no-ticket-selected empty state on initial load', () => {
      renderTickets()
      expect(screen.getByText(/select a ticket/i)).toBeInTheDocument()
    })
  })

  describe('ticket detail', () => {
    it('clicking ticket shows detail view', async () => {
      const user = userEvent.setup()
      renderTickets([buildTicket({ title: 'DB Error', description: '## Problem\n\nDatabase is down.' })])
      await user.click(screen.getByText('DB Error'))
      expect(screen.getByRole('heading', { name: /problem/i })).toBeInTheDocument()
    })

    it('description rendered via MarkdownRenderer', async () => {
      const user = userEvent.setup()
      renderTickets([buildTicket({ title: 'T1', description: '**Bold text** in description' })])
      await user.click(screen.getByText('T1'))
      expect(screen.getByText('Bold text')).toBeInTheDocument()
    })

    it('comments rendered in order', async () => {
      const user = userEvent.setup()
      const t = buildTicket({ id: 't1', title: 'T1' })
      const c1 = buildTicketComment('t1', { body: 'First comment', simTime: 10 })
      const c2 = buildTicketComment('t1', { body: 'Second comment', simTime: 20 })
      renderTickets([t], { t1: [c1, c2] })
      await user.click(screen.getByText('T1'))
      const first  = screen.getByText('First comment')
      const second = screen.getByText('Second comment')
      expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
  })

  describe('status via metadata panel', () => {
    it('status dropdown shown in metadata panel when ticket selected', async () => {
      const user = userEvent.setup()
      renderTickets([buildTicket({ title: 'T1', status: 'open' })])
      await user.click(screen.getByText('T1'))
      expect(screen.getByTestId('ticket-status-select')).toBeInTheDocument()
    })

    it('status dropdown has correct value', async () => {
      const user = userEvent.setup()
      renderTickets([buildTicket({ title: 'T1', status: 'in_progress' })])
      await user.click(screen.getByText('T1'))
      expect(screen.getByTestId('ticket-status-select')).toHaveValue('in_progress')
    })

    it('changing status to resolved dispatches mark_resolved AND update_ticket', async () => {
      const user = userEvent.setup()
      const dispatched: string[] = []
      server.use(
        http.post('/api/sessions/:id/actions', async ({ request }) => {
          const body = await request.json() as { action: string }
          dispatched.push(body.action)
          return new HttpResponse(null, { status: 204 })
        })
      )
      renderTickets([buildTicket({ id: 't1', title: 'T1', status: 'in_progress' })])
      await user.click(screen.getByText('T1'))
      await user.selectOptions(screen.getByTestId('ticket-status-select'), 'resolved')
      await waitFor(() => {
        expect(dispatched).toContain('update_ticket')
      })
    })
  })

  describe('add comment', () => {
    it('add comment calls add_ticket_comment dispatch', async () => {
      const user = userEvent.setup()
      let captured: unknown
      server.use(
        http.post('/api/sessions/:id/actions', async ({ request }) => {
          const body = await request.json() as { action: string }
          if (body.action === 'add_ticket_comment') captured = body
          return new HttpResponse(null, { status: 204 })
        })
      )
      renderTickets([buildTicket({ id: 't1', title: 'T1' })])
      await user.click(screen.getByText('T1'))
      await user.type(screen.getByPlaceholderText(/add a comment/i), 'Investigating the issue.')
      await user.click(screen.getByRole('button', { name: /comment/i }))
      await waitFor(() => {
        expect((captured as { action: string })?.action).toBe('add_ticket_comment')
      })
    })
  })

  describe('SSE events', () => {
    it('ticket_comment event adds comment to ticket', async () => {
      const user = userEvent.setup()
      const { sse } = renderTickets([buildTicket({ id: 't1', title: 'T1' })])
      await user.click(screen.getByText('T1'))
      act(() => {
        sse.emit({ type: 'ticket_comment', ticketId: 't1', comment: buildTicketComment('t1', { body: 'SSE comment' }) })
      })
      expect(screen.getByText('SSE comment')).toBeInTheDocument()
    })

    it('ticket_updated event updates status select value', async () => {
      const user = userEvent.setup()
      const { sse } = renderTickets([buildTicket({ id: 't1', title: 'T1', status: 'open' })])
      await user.click(screen.getByText('T1'))
      act(() => {
        sse.emit({ type: 'ticket_updated', ticketId: 't1', changes: { status: 'in_progress' } })
      })
      await waitFor(() => {
        expect(screen.getByTestId('ticket-status-select')).toHaveValue('in_progress')
      })
    })
  })

  describe('metadata panel', () => {
    it('shows metadata panel when ticket selected', async () => {
      const user = userEvent.setup()
      renderTickets([buildTicket({ id: 't1', title: 'T1' })])
      await user.click(screen.getByText('T1'))
      expect(screen.getByTestId('ticket-metadata')).toBeInTheDocument()
    })

    it('shows status dropdown in metadata panel', async () => {
      const user = userEvent.setup()
      renderTickets([buildTicket({ id: 't1', title: 'T1', status: 'open' })])
      await user.click(screen.getByText('T1'))
      expect(screen.getByTestId('ticket-status-select')).toBeInTheDocument()
    })

    it('shows severity dropdown in metadata panel', async () => {
      const user = userEvent.setup()
      renderTickets([buildTicket({ id: 't1', title: 'T1', severity: 'SEV2' })])
      await user.click(screen.getByText('T1'))
      expect(screen.getByTestId('ticket-severity-select')).toBeInTheDocument()
    })

    it('changing status dispatches update_ticket', async () => {
      const user = userEvent.setup()
      let captured: unknown
      server.use(http.post('/api/sessions/:id/actions', async ({ request }) => {
        captured = await request.json()
        return new HttpResponse(null, { status: 204 })
      }))
      renderTickets([buildTicket({ id: 't1', title: 'T1', status: 'open' })])
      await user.click(screen.getByText('T1'))
      await user.selectOptions(screen.getByTestId('ticket-status-select'), 'in_progress')
      await waitFor(() => {
        expect((captured as { action: string })?.action).toBe('update_ticket')
      })
    })

    it('changing severity dispatches update_ticket', async () => {
      const user = userEvent.setup()
      let captured: unknown
      server.use(http.post('/api/sessions/:id/actions', async ({ request }) => {
        captured = await request.json()
        return new HttpResponse(null, { status: 204 })
      }))
      renderTickets([buildTicket({ id: 't1', title: 'T1', severity: 'SEV2' })])
      await user.click(screen.getByText('T1'))
      await user.selectOptions(screen.getByTestId('ticket-severity-select'), 'SEV3')
      await waitFor(() => {
        expect((captured as { action: string })?.action).toBe('update_ticket')
      })
    })

    it('shows assignee select with Unassigned option', async () => {
      const user = userEvent.setup()
      renderTickets([buildTicket({ id: 't1', title: 'T1' })])
      await user.click(screen.getByText('T1'))
      const assigneeSelect = screen.getByTestId('ticket-assignee-select')
      expect(assigneeSelect).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /unassigned/i })).toBeInTheDocument()
    })

    it('assigning to a persona dispatches update_ticket with assignee', async () => {
      const user = userEvent.setup()
      let captured: unknown
      server.use(http.post('/api/sessions/:id/actions', async ({ request }) => {
        captured = await request.json()
        return new HttpResponse(null, { status: 204 })
      }))
      renderTickets([buildTicket({ id: 't1', title: 'T1' })])
      await user.click(screen.getByText('T1'))
      await user.selectOptions(screen.getByTestId('ticket-assignee-select'), 'trainee')
      await waitFor(() => {
        const body = captured as { action: string; params: { changes: { assignee: string } } }
        expect(body?.action).toBe('update_ticket')
        expect(body?.params?.changes?.assignee).toBe('trainee')
      })
    })

    it('shows created time', async () => {
      const user = userEvent.setup()
      renderTickets([buildTicket({ id: 't1', title: 'T1', simTime: 0 })])
      await user.click(screen.getByText('T1'))
      // Should show a wall-clock time for creation
      expect(screen.getByTestId('ticket-created-time')).toBeInTheDocument()
    })

    it('shows elapsed time since ticket creation', async () => {
      const user = userEvent.setup()
      renderTickets([buildTicket({ id: 't1', title: 'T1', simTime: -120 })])
      await user.click(screen.getByText('T1'))
      expect(screen.getByTestId('ticket-elapsed')).toBeInTheDocument()
    })

    it('metadata panel not shown when no ticket selected', () => {
      renderTickets([buildTicket({ id: 't1', title: 'T1' })])
      expect(screen.queryByTestId('ticket-metadata')).toBeNull()
    })
  })
})
