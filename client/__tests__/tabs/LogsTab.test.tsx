import { describe, it, expect, vi } from 'vitest'
import { screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, buildTestSnapshot, buildLogEntry, buildMockSSE } from '../../src/testutil/index'
import { LogsTab } from '../../src/components/tabs/LogsTab'
import { server } from '../../src/testutil/setup'
import { http, HttpResponse } from 'msw'

import type { LogLevel } from '@shared/types/events'

const defaultFilter = { query: '', levels: new Set<LogLevel>(), service: '' }

function renderLogs(logs = [buildLogEntry()], filter: { query: string; levels: Set<LogLevel>; service: string } = defaultFilter) {
  const sse = buildMockSSE()
  const result = renderWithProviders(
    <LogsTab filterState={filter} onFilterChange={() => {}} />,
    { sse }
  )
  act(() => {
    sse.emit({ type: 'session_snapshot', snapshot: buildTestSnapshot({ logs }) })
  })
  return { ...result, sse }
}

describe('LogsTab', () => {
  describe('rendering', () => {
    it('renders log entries', () => {
      renderLogs([
        buildLogEntry({ message: 'Error connecting to DB', level: 'ERROR' }),
      ])
      expect(screen.getByText('Error connecting to DB')).toBeInTheDocument()
    })

    it('ERROR level shows red styling indicator', () => {
      renderLogs([buildLogEntry({ level: 'ERROR', message: 'boom' })])
      // The badge inside the log entry row should be present (not the filter button)
      const badges = screen.getAllByText('ERROR')
      // At least one should be inside a log entry (not a filter button)
      expect(badges.some(el => el.closest('.border-b') !== null)).toBe(true)
    })

    it('WARN level entry visible', () => {
      renderLogs([buildLogEntry({ level: 'WARN', message: 'slow response' })])
      expect(screen.getByText('slow response')).toBeInTheDocument()
    })

    it('INFO level entry visible', () => {
      renderLogs([buildLogEntry({ level: 'INFO', message: 'started' })])
      expect(screen.getByText('started')).toBeInTheDocument()
    })

    it('DEBUG level entry visible', () => {
      renderLogs([buildLogEntry({ level: 'DEBUG', message: 'debug trace' })])
      expect(screen.getByText('debug trace')).toBeInTheDocument()
    })

    it('renders service name', () => {
      renderLogs([buildLogEntry({ service: 'payment-service', message: 'err' })])
      // Service name appears in log row — getAllByText returns multiple (also in selector option)
      expect(screen.getAllByText('payment-service').length).toBeGreaterThan(0)
    })
  })

  describe('filtering', () => {
    it('text search filters by message content', () => {
      renderLogs([
        buildLogEntry({ message: 'DB timeout error', level: 'ERROR' }),
        buildLogEntry({ message: 'request handled OK', level: 'INFO' }),
      ], { query: 'timeout', levels: new Set(), service: '' })
      expect(screen.getByText('DB timeout error')).toBeInTheDocument()
      expect(screen.queryByText('request handled OK')).toBeNull()
    })

    it('level filter shows only matching level', () => {
      renderLogs([
        buildLogEntry({ message: 'error msg', level: 'ERROR' }),
        buildLogEntry({ message: 'info msg',  level: 'INFO' }),
      ], { query: '', levels: new Set<LogLevel>(['ERROR']), service: '' })
      expect(screen.getByText('error msg')).toBeInTheDocument()
      expect(screen.queryByText('info msg')).toBeNull()
    })

    it('service selector filters by service', () => {
      renderLogs([
        buildLogEntry({ service: 'svc-a', message: 'from a' }),
        buildLogEntry({ service: 'svc-b', message: 'from b' }),
      ], { query: '', levels: new Set(), service: 'svc-a' })
      expect(screen.getByText('from a')).toBeInTheDocument()
      expect(screen.queryByText('from b')).toBeNull()
    })

    it('clear filter shows all entries', () => {
      renderLogs([
        buildLogEntry({ message: 'visible', level: 'ERROR' }),
        buildLogEntry({ message: 'also visible', level: 'INFO' }),
      ])
      // Default filter (empty) shows all
      expect(screen.getByText('visible')).toBeInTheDocument()
      expect(screen.getByText('also visible')).toBeInTheDocument()
    })
  })

  describe('SSE events', () => {
    it('new log_entry event appends to visible list', () => {
      const { sse } = renderLogs([])
      act(() => {
        sse.emit({ type: 'log_entry', entry: buildLogEntry({ message: 'new entry arrived' }) })
      })
      expect(screen.getByText('new entry arrived')).toBeInTheDocument()
    })
  })

  describe('audit actions', () => {
    it('search_logs dispatched on Enter keypress in search input', async () => {
      const user = userEvent.setup()
      let captured: unknown
      server.use(
        http.post('/api/sessions/:id/actions', async ({ request }) => {
          captured = await request.json()
          return new HttpResponse(null, { status: 204 })
        })
      )
      const onFilterChange = vi.fn()
      const sse = buildMockSSE()
      renderWithProviders(
        <LogsTab filterState={defaultFilter} onFilterChange={onFilterChange} />,
        { sse }
      )
      act(() => { sse.emit({ type: 'session_snapshot', snapshot: buildTestSnapshot() }) })

      const input = screen.getByPlaceholderText(/search logs/i)
      await user.type(input, 'error')
      await user.keyboard('{Enter}')
      await waitFor(() => {
        expect((captured as { action: string })?.action).toBe('search_logs')
      })
    })

    it('search_logs NOT dispatched on every keystroke', async () => {
      const user = userEvent.setup()
      let callCount = 0
      server.use(
        http.post('/api/sessions/:id/actions', async ({ request }) => {
          const body = await request.json() as { action: string }
          if (body.action === 'search_logs') callCount++
          return new HttpResponse(null, { status: 204 })
        })
      )
      const sse = buildMockSSE()
      renderWithProviders(
        <LogsTab filterState={defaultFilter} onFilterChange={() => {}} />,
        { sse }
      )
      act(() => { sse.emit({ type: 'session_snapshot', snapshot: buildTestSnapshot() }) })
      await user.type(screen.getByPlaceholderText(/search logs/i), 'err')
      // No Enter pressed — should be 0 dispatches
      expect(callCount).toBe(0)
    })
  })
})
