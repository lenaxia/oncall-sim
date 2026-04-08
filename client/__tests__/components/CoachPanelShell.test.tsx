import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { CoachPanelShell } from '../../src/components/CoachPanelShell'
import { buildMockSSE, buildTestSnapshot, buildCoachMessage } from '../../src/testutil/index'
import { SessionProvider } from '../../src/context/SessionContext'

function renderCoach(_opts = {}) {
  const sse = buildMockSSE()
  const result = render(
    <SessionProvider
      sessionId="test-session-id"
      sseConnection={sse}
      onExpired={() => {}}
      onDebriefReady={() => {}}
      onError={() => {}}
    >
      <CoachPanelShell />
    </SessionProvider>
  )
  return { ...result, sse }
}

describe('CoachPanelShell', () => {
  describe('toggle', () => {
    it('starts collapsed', () => {
      const { queryByTestId } = renderCoach()
      expect(queryByTestId('coach-panel')).toBeNull()
    })

    it('opens when toggle button clicked', async () => {
      const user = userEvent.setup()
      const { getByLabelText, getByTestId } = renderCoach()
      await user.click(getByLabelText(/coach/i))
      expect(getByTestId('coach-panel')).toBeInTheDocument()
    })

    it('closes when toggle clicked again', async () => {
      const user = userEvent.setup()
      const { getByLabelText, queryByTestId } = renderCoach()
      await user.click(getByLabelText(/coach/i))
      await user.click(getByLabelText(/coach/i))
      expect(queryByTestId('coach-panel')).toBeNull()
    })
  })

  describe('coach messages', () => {
    it('renders coach messages from session state', () => {
      const { sse, getByLabelText } = renderCoach()
      act(() => {
        sse.emit({ type: 'session_snapshot', snapshot: buildTestSnapshot({
          coachMessages: [buildCoachMessage({ text: 'Check the error rate metric first.' })]
        }) })
      })
      act(() => {
        // Open panel
        getByLabelText(/coach/i).click()
      })
      expect(screen.getByText('Check the error rate metric first.')).toBeInTheDocument()
    })

    it('shows unread badge dot when new message arrives and panel is closed', () => {
      const { sse, container } = renderCoach()
      act(() => {
        sse.emit({ type: 'session_snapshot', snapshot: buildTestSnapshot() })
        sse.emit({ type: 'coach_message', message: buildCoachMessage() })
      })
      expect(container.querySelector('[data-coach-badge]')).not.toBeNull()
    })
  })
})
