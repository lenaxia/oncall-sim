import { Marked } from 'marked'
import DOMPurifyFactory from 'dompurify'

// Configure a synchronous Marked instance — no async renderer extensions
const _marked = new Marked({ async: false, gfm: true, breaks: false })

interface MarkdownRendererProps {
  content:    string
  className?: string
}

const ALLOWED_TAGS = [
  'p', 'br', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li',
  'code', 'pre', 'blockquote', 'a', 'strong', 'em', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const rawHtml = _marked.parse(content) as string

  // Initialise DOMPurify lazily so it always binds to the live window object.
  // This is safe: DOMPurifyFactory is idempotent when called with the same window.
  const purify = DOMPurifyFactory(window)
  const clean  = purify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href'],
  })

  return (
    <div
      className={`sim-prose ${className ?? ''}`.trim()}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}
