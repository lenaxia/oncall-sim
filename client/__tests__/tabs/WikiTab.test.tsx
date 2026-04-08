import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../src/testutil/index'
import { WikiTab } from '../../src/components/tabs/WikiTab'
import { server } from '../../src/testutil/setup'
import { http, HttpResponse } from 'msw'

const WIKI_PAGES = [
  { title: 'Architecture', content: '# Architecture\n\nThe **system** overview.' },
  { title: 'Runbook',      content: '# Runbook\n\nStep 1: check metrics.' },
]

// Override scenario to include wiki pages — use server response shape (wiki.pages, not wikiPages)
function renderWiki(pages = WIKI_PAGES) {
  server.use(
    http.get('/api/scenarios/:id', () =>
      HttpResponse.json({
        id: '_fixture', title: 'Test', description: '', serviceType: 'api',
        difficulty: 'medium', tags: [], topology: { focalService: 'svc', upstream: [], downstream: [] },
        personas: [{ id: 'fp', displayName: 'FP', jobTitle: 'SRE', team: 'Platform', systemPrompt: '' }],
        wiki: { pages },
        cicd: { pipelines: [] }, featureFlags: [],
        evaluation: { rootCause: '', relevantActions: [], redHerrings: [], debriefContext: '' },
        engine: { defaultTab: 'wiki', tickIntervalSeconds: 15 },
        timeline: { durationMinutes: 10 },
      })
    )
  )
  return renderWithProviders(<WikiTab />)
}

describe('WikiTab', () => {
  describe('page list', () => {
    it('renders page titles from scenario', async () => {
      renderWiki()
      await waitFor(() => {
        expect(screen.getByText('Architecture')).toBeInTheDocument()
        expect(screen.getByText('Runbook')).toBeInTheDocument()
      })
    })

    it('empty state when no pages', async () => {
      renderWiki([])
      await waitFor(() => {
        expect(screen.getByText(/select a page/i)).toBeInTheDocument()
      })
    })
  })

  describe('page selection', () => {
    it('clicking page shows content via MarkdownRenderer', async () => {
      const user = userEvent.setup()
      renderWiki()
      await waitFor(() => screen.getByText('Architecture'))
      await user.click(screen.getByText('Architecture'))
      // MarkdownRenderer should render the h1
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /architecture/i })).toBeInTheDocument()
      })
    })

    it('no page selected shows empty state initially', async () => {
      renderWiki()
      await waitFor(() => screen.getByText('Architecture'))
      expect(screen.getByText(/select a page/i)).toBeInTheDocument()
    })

    it('active page has visual highlight', async () => {
      const user = userEvent.setup()
      renderWiki()
      await waitFor(() => screen.getByText('Architecture'))
      await user.click(screen.getByText('Architecture'))
      // Active page container should have data-active=true
      await waitFor(() => {
        const pageItems = screen.getAllByText('Architecture')
        const listItem = pageItems.find(el => el.closest('[data-wiki-page]'))
        expect(listItem?.closest('[data-wiki-page]')).toHaveAttribute('data-active', 'true')
      })
    })
  })

  describe('search', () => {
    it('filters pages by title (case-insensitive)', async () => {
      const user = userEvent.setup()
      renderWiki()
      await waitFor(() => screen.getByText('Architecture'))
      await user.type(screen.getByPlaceholderText(/search wiki/i), 'run')
      await waitFor(() => {
        expect(screen.getByText('Runbook')).toBeInTheDocument()
      })
      // Architecture should be hidden (not removed from DOM, but hidden)
      const archItem = screen.getByText('Architecture').closest('[data-wiki-page]') as HTMLElement
      expect(archItem.style.display).toBe('none')
    })

    it('shows "No pages match" when 0 pages match', async () => {
      const user = userEvent.setup()
      renderWiki()
      await waitFor(() => screen.getByText('Architecture'))
      await user.type(screen.getByPlaceholderText(/search wiki/i), 'zzz-no-match')
      await waitFor(() => {
        expect(screen.getByText(/no pages match/i)).toBeInTheDocument()
      })
    })
  })

  describe('audit actions', () => {
    it('read_wiki_page dispatched when page opened', async () => {
      const user = userEvent.setup()
      let captured: unknown
      server.use(
        http.post('/api/sessions/:id/actions', async ({ request }) => {
          captured = await request.json()
          return new HttpResponse(null, { status: 204 })
        })
      )
      renderWiki()
      await waitFor(() => screen.getByText('Architecture'))
      await user.click(screen.getByText('Architecture'))
      await waitFor(() => {
        expect((captured as { action: string })?.action).toBe('read_wiki_page')
      })
    })
  })
})
