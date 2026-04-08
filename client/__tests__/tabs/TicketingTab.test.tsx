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

  describe('status buttons', () => {
    it('Mark In Progress shown when status=open', async () => {
      const user = userEvent.setup()
      renderTickets([buildTicket({ title: 'T1', status: 'open' })])
      await user.click(screen.getByText('T1'))
      expect(screen.getByRole('button', { name: /mark in progress/i })).toBeInTheDocument()
    })

    it('Mark Resolved shown when status=in_progress', async () => {
      const user = userEvent.setup()
      renderTickets([buildTicket({ title: 'T1', status: 'in_progress' })])
      await user.click(screen.getByText('T1'))
      expect(screen.getByRole('button', { name: /mark resolved/i })).toBeInTheDocument()
    })

    it('Mark In Progress NOT shown when status=in_progress', async () => {
      const user = userEvent.setup()
      renderTickets([buildTicket({ title: 'T1', status: 'in_progress' })])
      await user.click(screen.getByText('T1'))
      expect(screen.queryByRole('button', { name: /mark in progress/i })).toBeNull()
    })

    it('Mark Resolved calls mark_resolved AND update_ticket (not resolve())', async () => {
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
      await user.click(screen.getByRole('button', { name: /mark resolved/i }))
      await waitFor(() => {
        expect(dispatched).toContain('mark_resolved')
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

    it('ticket_updated event updates ticket status without reload', async () => {
      const user = userEvent.setup()
      const { sse } = renderTickets([buildTicket({ id: 't1', title: 'T1', status: 'open' })])
      await user.click(screen.getByText('T1'))
      act(() => {
        sse.emit({ type: 'ticket_updated', ticketId: 't1', changes: { status: 'in_progress' } })
      })
      // Status should update — Mark In Progress should disappear
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /mark in progress/i })).toBeNull()
      })
    })
  })
})
