import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MarkdownRenderer } from '../../src/components/MarkdownRenderer'

describe('MarkdownRenderer', () => {
  it('renders markdown paragraph as HTML', () => {
    const { container } = render(<MarkdownRenderer content="Hello **world**" />)
    expect(container.querySelector('strong')).not.toBeNull()
    expect(container.querySelector('strong')!.textContent).toBe('world')
  })

  it('renders heading tags', () => {
    const { container } = render(<MarkdownRenderer content="# Title" />)
    expect(container.querySelector('h1')).not.toBeNull()
  })

  it('renders code blocks', () => {
    const { container } = render(<MarkdownRenderer content={"```\ncode here\n```"} />)
    expect(container.querySelector('pre')).not.toBeNull()
    expect(container.querySelector('code')).not.toBeNull()
  })

  it('renders lists', () => {
    const { container } = render(<MarkdownRenderer content={"- item one\n- item two"} />)
    expect(container.querySelector('ul')).not.toBeNull()
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('strips script tags (XSS prevention)', () => {
    const { container } = render(
      <MarkdownRenderer content='<script>alert("xss")</script>safe text' />
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('safe text')
  })

  it('strips onclick attributes (XSS prevention)', () => {
    const { container } = render(
      <MarkdownRenderer content='<a href="/" onclick="evil()">link</a>' />
    )
    const anchor = container.querySelector('a')
    expect(anchor?.getAttribute('onclick')).toBeNull()
  })

  it('wraps output in sim-prose class', () => {
    const { container } = render(<MarkdownRenderer content="text" />)
    expect(container.firstChild).toHaveClass('sim-prose')
  })

  it('applies additional className', () => {
    const { container } = render(
      <MarkdownRenderer content="text" className="extra-class" />
    )
    expect(container.firstChild).toHaveClass('extra-class')
  })

  it('renders empty string without error', () => {
    expect(() => render(<MarkdownRenderer content="" />)).not.toThrow()
  })
})
