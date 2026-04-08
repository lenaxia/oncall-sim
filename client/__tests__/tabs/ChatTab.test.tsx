import { describe, it, expect } from 'vitest'
import { screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React, { useState } from 'react'
import { renderWithProviders, buildTestSnapshot, buildChatMessage, buildMockSSE } from '../../src/testutil/index'
import { ChatTab } from '../../src/components/tabs/ChatTab'
import { server } from '../../src/testutil/setup'
import { http, HttpResponse } from 'msw'

const defaultChatUnread = new Map<string, number>()

// Wrapper owns the controlled state
function ChatTabWrapper({ channels = {}, chatUnread = defaultChatUnread }: {
  channels?: Record<string, ReturnType<typeof buildChatMessage>[]>
  chatUnread?: Map<string, number>
}) {
  const [activeChannel, setActiveChannel] = useState<string | null>(null)
  return (
    <ChatTab
      chatUnread={chatUnread}
      activeChannel={activeChannel}
      onChannelChange={setActiveChannel}
    />
  )
}

function renderChat(channels: Record<string, ReturnType<typeof buildChatMessage>[]> = {}, chatUnread = defaultChatUnread) {
  const sse = buildMockSSE()
  const result = renderWithProviders(
    <ChatTabWrapper channels={channels} chatUnread={chatUnread} />,
    { sse }
  )
  act(() => {
    sse.emit({ type: 'session_snapshot', snapshot: buildTestSnapshot({ chatChannels: channels }) })
  })
  return { ...result, sse }
}

describe('ChatTab', () => {
  describe('channel list', () => {
    it('renders # channels in CHANNELS section', () => {
      renderChat({ '#incidents': [] })
      expect(screen.getAllByText('#incidents').length).toBeGreaterThan(0)
    })

    it('DM channels shown in DMS section', () => {
      renderChat({ 'dm:fixture-persona': [] })
      expect(screen.getByText(/DMS/i)).toBeInTheDocument()
    })

    it('clicking channel shows its messages', async () => {
      const user = userEvent.setup()
      renderChat({ '#incidents': [buildChatMessage({ text: 'hello channel' })] })
      await user.click(screen.getAllByText('#incidents')[0])
      expect(screen.getByText('hello channel')).toBeInTheDocument()
    })
  })

  describe('messages', () => {
    it('messages rendered in chronological order', async () => {
      const user = userEvent.setup()
      const msg1 = buildChatMessage({ text: 'first',  simTime: 10, channel: '#incidents' })
      const msg2 = buildChatMessage({ text: 'second', simTime: 20, channel: '#incidents' })
      renderChat({ '#incidents': [msg2, msg1] }) // intentionally out of order
      await user.click(screen.getAllByText('#incidents')[0])
      const first  = screen.getByText('first')
      const second = screen.getByText('second')
      expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('persona messages use sim-persona colour', async () => {
      const user = userEvent.setup()
      const msg = buildChatMessage({ persona: 'fixture-persona', channel: '#incidents' })
      renderChat({ '#incidents': [msg] })
      await user.click(screen.getAllByText('#incidents')[0])
      const senderEl = screen.getByText('fixture-persona', { selector: '[data-sender]' })
      expect(senderEl.className).toContain('sim-persona')
    })

    it('trainee messages use sim-trainee colour', async () => {
      const user = userEvent.setup()
      const msg = buildChatMessage({ persona: 'trainee', text: 'my msg', channel: '#incidents' })
      renderChat({ '#incidents': [msg] })
      await user.click(screen.getAllByText('#incidents')[0])
      const senderEl = screen.getByText('trainee', { selector: '[data-sender]' })
      expect(senderEl.className).toContain('sim-trainee')
    })

    it('empty channel state shown when channel has no messages', async () => {
      const user = userEvent.setup()
      renderChat({ '#incidents': [] })
      await user.click(screen.getAllByText('#incidents')[0])
      expect(screen.getByText(/no messages yet/i)).toBeInTheDocument()
    })
  })

  describe('send message', () => {
    it('Enter key sends message (without Shift)', async () => {
      const user = userEvent.setup()
      let captured: unknown
      server.use(
        http.post('/api/sessions/:id/chat', async ({ request }) => {
          captured = await request.json()
          return new HttpResponse(null, { status: 204 })
        })
      )
      renderChat({ '#incidents': [] })
      await user.click(screen.getAllByText('#incidents')[0])
      await user.type(screen.getByPlaceholderText(/message/i), 'hello{Enter}')
      await waitFor(() => {
        expect((captured as { text: string })?.text).toBe('hello')
      })
    })

    it('Shift+Enter inserts newline instead of sending', async () => {
      const user = userEvent.setup()
      let callCount = 0
      server.use(
        http.post('/api/sessions/:id/chat', async () => {
          callCount++
          return new HttpResponse(null, { status: 204 })
        })
      )
      renderChat({ '#incidents': [] })
      await user.click(screen.getAllByText('#incidents')[0])
      await user.type(screen.getByPlaceholderText(/message/i), 'line1{Shift>}{Enter}{/Shift}line2')
      expect(callCount).toBe(0)
    })

    it('message send disabled when text empty', async () => {
      const user = userEvent.setup()
      renderChat({ '#incidents': [] })
      await user.click(screen.getAllByText('#incidents')[0])
      expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
    })
  })

  describe('@ mention dropdown', () => {
    it('@ character in input shows mention dropdown', async () => {
      const user = userEvent.setup()
      renderChat({ '#incidents': [] })
      await user.click(screen.getAllByText('#incidents')[0])
      await user.type(screen.getByPlaceholderText(/message/i), '@')
      expect(screen.getByTestId('mention-dropdown')).toBeInTheDocument()
    })

    it('pressing Escape in dropdown closes without inserting', async () => {
      const user = userEvent.setup()
      renderChat({ '#incidents': [] })
      await user.click(screen.getAllByText('#incidents')[0])
      await user.type(screen.getByPlaceholderText(/message/i), '@')
      await user.keyboard('{Escape}')
      expect(screen.queryByTestId('mention-dropdown')).toBeNull()
    })
  })

  describe('audit actions', () => {
    it('direct_message_persona dispatched on first DM open', async () => {
      const user = userEvent.setup()
      let captured: unknown
      server.use(
        http.post('/api/sessions/:id/actions', async ({ request }) => {
          const body = await request.json() as { action: string }
          if (body.action === 'direct_message_persona') captured = body
          return new HttpResponse(null, { status: 204 })
        })
      )
      renderChat({ 'dm:fixture-persona': [] })
      // Wait for ScenarioContext to load persona names
      const personaEl = await screen.findByText('Fixture Persona')
      await user.click(personaEl)
      await waitFor(() => {
        expect((captured as { action: string })?.action).toBe('direct_message_persona')
      })
    })

    it('direct_message_persona NOT dispatched on subsequent DM re-opens', async () => {
      const user = userEvent.setup()
      let count = 0
      server.use(
        http.post('/api/sessions/:id/actions', async ({ request }) => {
          const body = await request.json() as { action: string }
          if (body.action === 'direct_message_persona') count++
          return new HttpResponse(null, { status: 204 })
        })
      )
      renderChat({ '#incidents': [], 'dm:fixture-persona': [] })
      const personaEl = await screen.findByText('Fixture Persona')
      // First click
      await user.click(personaEl)
      // Switch to another channel then back
      await user.click(screen.getAllByText('#incidents')[0])
      await user.click(screen.getByText('Fixture Persona'))
      await waitFor(() => expect(count).toBe(1))
    })
  })

  describe('SSE events', () => {
    it('new chat_message event appears in channel', async () => {
      const user = userEvent.setup()
      const { sse } = renderChat({ '#incidents': [] })
      await user.click(screen.getAllByText('#incidents')[0])
      act(() => {
        sse.emit({ type: 'chat_message', channel: '#incidents', message: buildChatMessage({ text: 'live update' }) })
      })
      expect(screen.getByText('live update')).toBeInTheDocument()
    })
  })
})
