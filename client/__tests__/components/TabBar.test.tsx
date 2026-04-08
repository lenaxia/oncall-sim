import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TabBar } from '../../src/components/TabBar'

const TABS = [
  { id: 'email',   label: 'Email' },
  { id: 'chat',    label: 'Chat',    badge: 3 },
  { id: 'tickets', label: 'Tickets' },
  { id: 'ops',     label: 'Ops',     alarm: true },
  { id: 'logs',    label: 'Logs' },
  { id: 'wiki',    label: 'Wiki' },
  { id: 'cicd',    label: 'CI/CD',   badge: 1 },
]

describe('TabBar', () => {
  describe('rendering', () => {
    it('renders all tab labels', () => {
      render(
        <TabBar tabs={TABS} activeTab="email" onTabChange={() => {}} onResolve={() => {}} />
      )
      for (const tab of TABS) {
        expect(screen.getByText(tab.label)).toBeInTheDocument()
      }
    })

    it('active tab has aria-selected=true', () => {
      render(
        <TabBar tabs={TABS} activeTab="chat" onTabChange={() => {}} onResolve={() => {}} />
      )
      const chatTab = screen.getByRole('tab', { name: /chat/i })
      expect(chatTab).toHaveAttribute('aria-selected', 'true')
    })

    it('inactive tabs have aria-selected=false', () => {
      render(
        <TabBar tabs={TABS} activeTab="email" onTabChange={() => {}} onResolve={() => {}} />
      )
      const chatTab = screen.getByRole('tab', { name: /chat/i })
      expect(chatTab).toHaveAttribute('aria-selected', 'false')
    })

    it('badge count rendered when > 0', () => {
      render(
        <TabBar tabs={TABS} activeTab="email" onTabChange={() => {}} onResolve={() => {}} />
      )
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('badge not rendered for tabs with no badge', () => {
      render(
        <TabBar tabs={TABS} activeTab="email" onTabChange={() => {}} onResolve={() => {}} />
      )
      // Logs tab has no badge — there should be no badge element inside it
      const logsTab = screen.getByRole('tab', { name: /logs/i })
      expect(logsTab.querySelector('[data-badge]')).toBeNull()
    })

    it('alarm dot rendered when alarm=true', () => {
      render(
        <TabBar tabs={TABS} activeTab="email" onTabChange={() => {}} onResolve={() => {}} />
      )
      const opsTab = screen.getByRole('tab', { name: /ops/i })
      expect(opsTab.querySelector('[data-alarm-dot]')).not.toBeNull()
    })

    it('End Simulation button is present', () => {
      render(
        <TabBar tabs={TABS} activeTab="email" onTabChange={() => {}} onResolve={() => {}} />
      )
      expect(screen.getByRole('button', { name: /end simulation/i })).toBeInTheDocument()
    })

    it('End Simulation button disabled when resolveDisabled=true', () => {
      render(
        <TabBar
          tabs={TABS}
          activeTab="email"
          onTabChange={() => {}}
          onResolve={() => {}}
          resolveDisabled
        />
      )
      expect(screen.getByRole('button', { name: /end simulation/i })).toBeDisabled()
    })
  })

  describe('interactions', () => {
    it('clicking inactive tab calls onTabChange with correct id', async () => {
      const user = userEvent.setup()
      const onTabChange = vi.fn()
      render(
        <TabBar tabs={TABS} activeTab="email" onTabChange={onTabChange} onResolve={() => {}} />
      )
      await user.click(screen.getByRole('tab', { name: /chat/i }))
      expect(onTabChange).toHaveBeenCalledWith('chat')
    })

    it('End Simulation button calls onResolve on click', async () => {
      const user = userEvent.setup()
      const onResolve = vi.fn()
      render(
        <TabBar tabs={TABS} activeTab="email" onTabChange={() => {}} onResolve={onResolve} />
      )
      await user.click(screen.getByRole('button', { name: /end simulation/i }))
      expect(onResolve).toHaveBeenCalledOnce()
    })
  })

  describe('keyboard navigation', () => {
    it('Right arrow key activates next tab', async () => {
      const user = userEvent.setup()
      const onTabChange = vi.fn()
      render(
        <TabBar tabs={TABS} activeTab="email" onTabChange={onTabChange} onResolve={() => {}} />
      )
      screen.getByRole('tab', { name: /email/i }).focus()
      await user.keyboard('{ArrowRight}')
      expect(onTabChange).toHaveBeenCalledWith('chat')
    })

    it('Left arrow key activates previous tab', async () => {
      const user = userEvent.setup()
      const onTabChange = vi.fn()
      render(
        <TabBar tabs={TABS} activeTab="chat" onTabChange={onTabChange} onResolve={() => {}} />
      )
      screen.getByRole('tab', { name: /chat/i }).focus()
      await user.keyboard('{ArrowLeft}')
      expect(onTabChange).toHaveBeenCalledWith('email')
    })

    it('Home key activates first tab', async () => {
      const user = userEvent.setup()
      const onTabChange = vi.fn()
      render(
        <TabBar tabs={TABS} activeTab="chat" onTabChange={onTabChange} onResolve={() => {}} />
      )
      screen.getByRole('tab', { name: /chat/i }).focus()
      await user.keyboard('{Home}')
      expect(onTabChange).toHaveBeenCalledWith('email')
    })

    it('End key activates last tab', async () => {
      const user = userEvent.setup()
      const onTabChange = vi.fn()
      render(
        <TabBar tabs={TABS} activeTab="email" onTabChange={onTabChange} onResolve={() => {}} />
      )
      screen.getByRole('tab', { name: /email/i }).focus()
      await user.keyboard('{End}')
      expect(onTabChange).toHaveBeenCalledWith('cicd')
    })
  })

  describe('accessibility', () => {
    it('has role=tablist on container', () => {
      render(
        <TabBar tabs={TABS} activeTab="email" onTabChange={() => {}} onResolve={() => {}} />
      )
      expect(screen.getByRole('tablist')).toBeInTheDocument()
    })
  })
})
