import { useState } from 'react'
import { useScenario } from '../../context/ScenarioContext'
import { useSession } from '../../context/SessionContext'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { EmptyState } from '../EmptyState'

export function WikiTab() {
  const { scenario }      = useScenario()
  const { dispatchAction } = useSession()

  const [selectedTitle, setSelectedTitle] = useState<string | null>(null)
  const [query, setQuery]                 = useState('')

  const pages = scenario?.wikiPages ?? []
  const selectedPage = pages.find(p => p.title === selectedTitle) ?? null

  const noMatch = query.length > 0 && pages.every(p => !matchesSearch(p, query))

  function handleSelectPage(title: string) {
    setSelectedTitle(title)
    const page = pages.find(p => p.title === title)
    if (page) dispatchAction('read_wiki_page', { pageTitle: page.title })
  }

  return (
    <div className="flex h-full">
      {/* Left — page list */}
      <div className="w-44 border-r border-sim-border overflow-auto flex-shrink-0 bg-sim-surface flex flex-col">
        {/* Search */}
        <div className="border-b border-sim-border flex-shrink-0">
          <input
            type="text"
            placeholder="Search wiki..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full px-3 py-2 bg-sim-surface text-sim-text text-xs font-mono
                       outline-none placeholder:text-sim-text-faint"
          />
        </div>

        {/* Page list */}
        <div className="flex-1 overflow-auto">
          {pages.map(page => {
            const hidden  = query.length > 0 && !matchesSearch(page, query)
            const isActive = page.title === selectedTitle
            return (
              <div
                key={page.title}
                data-wiki-page=""
                data-active={isActive ? 'true' : 'false'}
                style={hidden ? { display: 'none' } : {}}
                className={[
                  'px-3 py-2 border-b border-sim-border-muted cursor-pointer text-xs transition-colors duration-75',
                  isActive
                    ? 'bg-sim-surface-2 text-sim-text border-l-2 border-l-sim-accent pl-[10px]'
                    : 'text-sim-text-muted hover:bg-sim-surface-2',
                ].join(' ')}
                onClick={() => handleSelectPage(page.title)}
              >
                {page.title}
              </div>
            )
          })}
          {noMatch && (
            <div className="text-xs text-sim-text-faint px-3 py-4 text-center">
              No pages match
            </div>
          )}
        </div>
      </div>

      {/* Right — content pane */}
      <div className="flex-1 overflow-auto">
        {selectedPage === null ? (
          <EmptyState
            title="Select a page"
            message="Choose a wiki page from the list."
          />
        ) : (
          <>
            <div className="px-3 py-2 border-b border-sim-border flex-shrink-0 bg-sim-surface">
              <span className="text-sm font-semibold text-sim-text">{selectedPage.title}</span>
            </div>
            <div className="p-4">
              <MarkdownRenderer content={selectedPage.content} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function matchesSearch(page: { title: string; content: string }, query: string): boolean {
  const q   = query.toLowerCase()
  const snippet = page.content.slice(0, 200).toLowerCase()
  return page.title.toLowerCase().includes(q) || snippet.includes(q)
}
