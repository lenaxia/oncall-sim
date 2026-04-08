import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import { SimShell } from '../../src/components/SimShell'
import { buildTestSnapshot, buildMockSSE } from '../../src/testutil/index'
import { SessionProvider } from '../../src/context/SessionContext'
import { ScenarioProvider } from '../../src/context/ScenarioContext'

function renderSimShell(opts: { onResolve?: () => void } = {}) {
  const sse = buildMockSSE()
  const result = render(
    <ScenarioProvider scenarioId="_fixture">
      <SessionProvider
        sessionId="test-session-id"
        sseConnection={sse}
        onExpired={() => {}}
        onDebriefReady={() => {}}
        onError={() => {}}
      >
        <SimShell onResolve={opts.onResolve ?? (() => {})} />
      </SessionProvider>
    </ScenarioProvider>
  )
  return { ...result, sse }
}

describe('SimShell', () => {
  describe('connecting state', () => {
    it('shows connecting spinner before first session_snapshot', () => {
      const { container } = renderSimShell()
      expect(container.querySelector('svg.animate-spin')).not.toBeNull()
    })

    it('hides connecting spinner after session_snapshot received', () => {
      const { sse } = renderSimShell()
      act(() => {
        sse.emit({ type: 'session_snapshot', snapshot: buildTestSnapshot() })
      })
      // Tab content should be shown, connecting spinner gone
      expect(screen.getByRole('tablist')).toBeInTheDocument()
    })
  })

  describe('after connected', () => {
    it('renders tab bar', () => {
      const { sse } = renderSimShell()
      act(() => {
        sse.emit({ type: 'session_snapshot', snapshot: buildTestSnapshot() })
      })
      expect(screen.getByRole('tablist')).toBeInTheDocument()
    })

    it('renders tabpanel', () => {
      const { sse } = renderSimShell()
      act(() => {
        sse.emit({ type: 'session_snapshot', snapshot: buildTestSnapshot() })
      })
      expect(screen.getByRole('tabpanel')).toBeInTheDocument()
    })
  })

  describe('resolving overlay', () => {
    it('resolving overlay hidden by default', () => {
      const { sse, queryByText } = renderSimShell()
      act(() => {
        sse.emit({ type: 'session_snapshot', snapshot: buildTestSnapshot() })
      })
      expect(queryByText(/generating debrief/i)).toBeNull()
    })
  })
})
